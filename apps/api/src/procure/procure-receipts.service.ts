import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AiService } from '../ai/ai.service';
import { DocumentsService } from '../documents/documents.service';
import { ProcureService, PostedExpense } from './procure.service';
import { ProcurePocket } from './dto/receive-request.dto';
import { PH_TIMEZONE, cleanSourceName, isSourceKind, type SourceKind } from '@repo/shared-types';
import {
  promptFor, parseReceiptJson, matchIngredient, derivePack, spreadDiscount,
  MaterialRef, ParsedLine,
} from './receipt-parser';
import { ParseReceiptDto, ConfirmReceiptDto, ReceiptStockLineDto } from './dto/receipts.dto';
import { readTag, withTag, appendNote } from './procure-notes';
import { CostSanityService, IngredientCostLine } from '../common/sanity/cost-sanity.service';
import { sanityValueKey } from '@repo/shared-types';
import { SanityContext, SanityWarning } from '../common/sanity/sanity.types';

/**
 * A receipt photo in, stock and expenses out.
 *
 * The owner comes back from the market with a receipt and a boot full of
 * groceries. Until now the receipt went into a drawer and the groceries went
 * onto the shelf unrecorded, or somebody typed fifteen lines into a form at
 * the end of a shift. This is the other way round: photograph it, correct
 * what the reader got wrong, post it. One screen, once.
 *
 * Two calls. `parse` is a SUGGESTION -- the photo read, each line matched to
 * the shop's own ingredient by plain code, nothing written. `confirm` is the
 * POSTING -- what the person agreed to, after correcting it, becomes a
 * purchase request in BOUGHT state and is received line by line through the
 * same path a hand-typed request takes. Nothing is posted from a photo alone:
 * the model is never trusted to move stock, only to save typing.
 *
 * Reuse over invention, deliberately: the request is an ordinary
 * PurchaseRequest, the stock movement is receiveRawMaterial with its VAT
 * split, cost guard and per-line idempotency, the expense is a SimpleEntry,
 * the photo is a Document. No new table, no new posting rule.
 */

export interface SuggestedLine extends ParsedLine {
  index:   number;
  match:   { rawMaterialId: string; name: string; unit: string; category: string; score: number } | null;
  alternatives: Array<{ rawMaterialId: string; name: string; unit: string; score: number }>;
  pack:    ReturnType<typeof derivePack> | null;
}

@Injectable()
export class ProcureReceiptsService {
  constructor(
    private readonly prisma:    PrismaService,
    private readonly inventory: InventoryService,
    private readonly procure:   ProcureService,
    private readonly ai:        AiService,
    private readonly documents: DocumentsService,
    @Optional() private readonly sanity?: CostSanityService,
  ) {}

  // ── reading ───────────────────────────────────────────────────────────────

  async parse(tenantId: string, userId: string, dto: ParseReceiptDto, viewerRole?: string | null) {
    /*
      Only an owner may name the provider. It decides what the read costs and
      which company sees the photo, so it is not a knob for whoever happens to
      be holding the phone. Anyone else asking is ignored rather than refused
      -- the read still happens, on the deployment's own provider.
    */
    const provider = dto.provider && (viewerRole === 'BUSINESS_OWNER' || viewerRole === 'SUPER_ADMIN')
      ? dto.provider
      : undefined;

    /*
      One frame, or several strips of a long receipt. The strips arrive in
      reading order, top to bottom, overlapping — a metre of thermal paper
      squeezed into a single frame leaves the text a few pixels tall, which no
      reader can do anything with.
    */
    const strips = (dto.images ?? []).map((i) => ({
      data: i.base64,
      mediaType: i.mediaType ?? dto.mediaType ?? 'image/jpeg',
    }));
    if (strips.length === 0 && dto.imageBase64) {
      strips.push({ data: dto.imageBase64, mediaType: dto.mediaType ?? 'image/jpeg' });
    }
    if (strips.length === 0) throw new BadRequestException('A photo of the receipt is required.');

    // ~6 MB of base64 is ~4.5 MB of image; a phone photo resized for upload is
    // well under, and the strips of one receipt together should be too.
    const totalBytes = strips.reduce((n, s) => n + s.data.length, 0);
    if (totalBytes > 8_000_000) {
      throw new BadRequestException('That photo is too large. Take it again at a lower resolution.');
    }

    const kind = dto.documentKind ?? 'receipt';
    const kindText = kind === 'order_screen'
      ? 'This is a screenshot of an online order page. '
      : kind === 'delivery_receipt' ? 'This is a supplier\'s delivery receipt. ' : '';
    const text = await this.ai.call({
      tenantId,
      userId,
      action:       'procure_receipt_lines',
      systemPrompt: promptFor(kind),
      // The prompt is identical on every call, so it caches.
      cacheSystem:  true,
      // A long market receipt is thirty lines; each is ~60 tokens of JSON.
      maxTokens:    2500,
      ...(provider ? { provider } : {}),
      messages: [{
        role: 'user',
        content: [
          ...strips.map((s) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: s.mediaType, data: s.data },
          })),
          {
            type: 'text' as const,
            text: kindText + (strips.length > 1
              ? `These ${strips.length} images are ONE receipt, photographed in strips from top to bottom. `
                + 'Consecutive strips overlap, so a line visible at the bottom of one and the top of the next '
                + 'is the SAME line — report it once. Read every purchased line and the header per the system '
                + 'prompt. JSON only.'
              : 'Read every purchased line and the header per the system prompt. JSON only.'),
          },
        ],
      }],
    });

    let parsed;
    try {
      parsed = parseReceiptJson(text);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'The receipt could not be read.');
    }
    // A voucher is money not paid; the lines must say what WAS paid.
    const applied = spreadDiscount(parsed);
    parsed = applied.parsed;

    const materials = await this.materials(tenantId);
    /*
      The request's own ingredients first. A shop with three sugars and a
      reading of "SUGAR 1KG" is a tie among strangers -- unless the kitchen
      asked for one of them, in which case that is the one. Only when nothing
      on the list fits does the whole shelf get a look.
    */
    const onList = dto.purchaseRequestId ? await this.requestMaterials(tenantId, dto.purchaseRequestId, materials) : [];
    const lines: SuggestedLine[] = parsed.lines.map((l, index) => {
      // An expense line is not on the shelf, so there is nothing to match it to.
      const m = l.kind === 'expense'
        ? { best: null, alternatives: [] }
        : (() => {
            const first = onList.length ? matchIngredient(l.description, onList) : null;
            return first?.best ? first : matchIngredient(l.description, materials);
          })();
      const best = m.best;
      return {
        index,
        ...l,
        match: best ? {
          rawMaterialId: best.material.id,
          name:          best.material.name,
          unit:          best.material.unit,
          category:      best.material.category,
          score:         +best.score.toFixed(3),
        } : null,
        alternatives: m.alternatives.map((a) => ({
          rawMaterialId: a.material.id, name: a.material.name, unit: a.material.unit, score: +a.score.toFixed(3),
        })),
        pack: best ? derivePack(l, best.material) : null,
      };
    });

    const linesTotal = lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
    return {
      documentKind:    kind,
      vendor:          parsed.vendor,
      dateText:        parsed.dateText,
      dateIso:         parsed.dateIso,
      referenceNumber: parsed.referenceNumber,
      total:           parsed.total,
      discount:        parsed.discount,
      discountNote:    applied.note,
      lines,
      summary: {
        lines:      lines.length,
        matched:    lines.filter((l) => l.match).length,
        unmatched:  lines.filter((l) => l.kind !== 'expense' && !l.match).length,
        expenses:   lines.filter((l) => l.kind === 'expense').length,
        needsPack:  lines.filter((l) => l.pack?.needsPackSize).length,
        linesTotal: +linesTotal.toFixed(2),
        // A total that does not foot to its lines is the reader missing a line
        // or reading a subtotal as the total. Either way, worth a look.
        footsToTotal: parsed.total == null ? null : Math.abs(linesTotal - parsed.total) < 1,
      },
    };
  }

  /** The materials on a request, as the matcher sees them. Unknown request: nothing, no error -- reading is a suggestion. */
  private async requestMaterials(tenantId: string, requestId: string, materials: MaterialRef[]): Promise<MaterialRef[]> {
    const req = await this.prisma.purchaseRequest.findFirst({
      where: { id: requestId, tenantId }, select: { lines: { select: { rawMaterialId: true } } },
    });
    if (!req) return [];
    const ids = new Set(req.lines.map((l) => l.rawMaterialId));
    return materials.filter((m) => ids.has(m.id));
  }

  // ── posting ───────────────────────────────────────────────────────────────

  /**
   * "Are you sure this is the correct cost?" -- asked once for the whole
   * receipt, per printed row, before any of its three write paths runs.
   *
   * Per ROW, not per ingredient: two rows of the same ingredient are blended
   * into one delivery further down, and a wrong price hidden inside that blend
   * would match nothing a person could point at. A row that creates a new
   * ingredient has no history, so there is nothing to ask about it yet.
   */
  async confirm(tenantId: string, userId: string, fallbackBranchId: string | undefined, dto: ConfirmReceiptDto, sanity?: SanityContext) {
    let confirmed: SanityWarning[] = [];
    if (this.sanity && sanity?.optedIn && dto.lines?.length) {
      const posted = await this.alreadyOnTheShelf(tenantId, dto);
      const rows = dto.lines
        .map((l, i): IngredientCostLine | null => l.rawMaterialId && l.packSize > 0 && !posted.has(l.rawMaterialId)
          ? {
            key: `row:${i}`, rawMaterialId: l.rawMaterialId, grossPerUnit: l.packCost / l.packSize,
            packSize: l.packSize, packCost: l.packCost, branchId: dto.branchId ?? fallbackBranchId,
            paymentMethod: dto.paymentMethod,
          }
          : null)
        .filter((r): r is IngredientCostLine => r !== null);
      confirmed = this.sanity.enforce(await this.sanity.checkIngredientCosts(tenantId, rows, sanity), sanity);
      // A price the person just said is right has answered the old ten-times guard too.
      const accepted = new Set(confirmed.map((w) => w.key));
      if (accepted.size > 0) {
        dto = { ...dto, lines: dto.lines.map((l, i) => (accepted.has(`row:${i}`) ? { ...l, acceptCostChange: true } : l)) } as ConfirmReceiptDto;
      }
    }
    const result = await this.confirmChecked(tenantId, userId, fallbackBranchId, dto, confirmed);
    if (this.sanity && confirmed.length > 0) {
      // Only prices that reached the books: a row that failed to post was never "adjusted".
      const failed = (result as { failed?: Array<{ name?: string }> }).failed ?? [];
      const failedNames = new Set(failed.map((f) => f.name));
      const kept = confirmed.filter((w) => !failedNames.has(w.name));
      await this.sanity.recordConfirmed(tenantId, userId, kept, (w) => ({ type: 'RawMaterial', id: w.rawMaterialId ?? w.key }));
    }
    return result;
  }

  /**
   * Ingredients this receipt has already put on the shelf -- a retry of the
   * same receipt, or a request some of whose lines were posted. Their prices
   * are not asked about again: they are not about to be written.
   */
  private async alreadyOnTheShelf(tenantId: string, dto: ConfirmReceiptDto): Promise<Set<string>> {
    const where = dto.purchaseRequestId
      ? { id: dto.purchaseRequestId, tenantId }
      : dto.idempotencyKey ? { tenantId, notes: { startsWith: this.keyTag(dto.idempotencyKey) } } : null;
    if (!where) return new Set();
    const req = await this.prisma.purchaseRequest.findFirst({
      where, select: { lines: { where: { receivedAt: { not: null } }, select: { rawMaterialId: true } } },
    });
    return new Set((req?.lines ?? []).map((l) => l.rawMaterialId));
  }

  private async confirmChecked(tenantId: string, userId: string, fallbackBranchId: string | undefined, dto: ConfirmReceiptDto, confirmed: SanityWarning[] = []) {
    if (dto.purchaseRequestId) return this.confirmOnto(tenantId, userId, dto, confirmed);
    const branchId = dto.branchId ?? fallbackBranchId;
    if (!branchId) throw new BadRequestException('Which branch received this?');
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found in your organization.');

    if (!dto.lines?.length && !dto.expenses?.length) {
      throw new BadRequestException('Nothing to post. Add at least one line.');
    }

    /*
      Replay, not re-post. A retry after a dropped connection carries the same
      key and gets the same answer; the stock is not doubled and the second
      photo is not filed. receiveRawMaterial already refuses a line reference
      it has seen -- this lifts the same rule to the whole receipt so the
      request itself is not created twice either.
    */
    if (dto.idempotencyKey) {
      const seen = await this.prisma.purchaseRequest.findFirst({
        where:   { tenantId, notes: { startsWith: this.keyTag(dto.idempotencyKey) } },
        include: this.include(),
      });
      if (seen) {
        /*
          A replay finishes what the first attempt started. If the request
          was created but the connection dropped before its lines posted, it
          is sitting at BOUGHT with nothing on the shelf -- and handing that
          back as "already done" would leave it there for good. Receiving is
          idempotent per line (the line reference), so running it again posts
          only what never landed. Expenses and the photo are not re-attempted:
          neither carries a reference that would stop a second copy.
        */
        if (seen.status === 'BOUGHT') {
          /*
            The replay carries the person's CORRECTIONS. A line that failed the
            cost guard -- pack size typed as 1 instead of 18 -- is fixed on
            screen and posted again under the same key. Receiving the stored
            line as it was would fail identically forever, and the only way
            out would be a fresh key, which receives the lines that DID post a
            second time. So the resubmitted numbers are written onto the lines
            still waiting, a line the person added is added, and "the price
            really changed" travels with them. Lines already on the shelf are
            untouched and skipped by their reference.
          */
          const createdAgain: Array<{ id: string; name: string; unit: string }> = [];
          const resolvedAgain: Array<ReceiptStockLineDto & { rawMaterialId: string }> = [];
          for (const line of dto.lines ?? []) {
            resolvedAgain.push({ ...line, rawMaterialId: await this.resolveMaterial(tenantId, line, createdAgain, true) });
          }
          const mergedAgain = this.mergeLines(resolvedAgain);
          const acceptAgain = new Set(resolvedAgain.filter((l) => l.acceptCostChange).map((l) => l.rawMaterialId));
          let nextSuffix = seen.lines.length;
          for (const m of mergedAgain) {
            const row = seen.lines.find((l) => l.rawMaterialId === m.rawMaterialId);
            if (row && row.receivedAt) continue;
            const data = {
              qtyRequested: new Prisma.Decimal(m.packsBought * m.packSize),
              packsBought:  new Prisma.Decimal(m.packsBought),
              packSize:     new Prisma.Decimal(m.packSize),
              packCost:     new Prisma.Decimal(m.packCost),
              brandNote:    m.brandNote ?? null,
              ...this.whereFrom(dto),
            };
            if (row) {
              await this.prisma.purchaseRequestLine.update({ where: { id: row.id }, data });
            } else {
              nextSuffix += 1;
              await this.prisma.purchaseRequestLine.create({
                data: {
                  purchaseRequestId: seen.id,
                  lineNumber: `${seen.requestNumber}-${String(nextSuffix).padStart(2, '0')}`,
                  rawMaterialId: m.rawMaterialId,
                  ...data,
                },
              });
            }
          }
          const again = await this.procure.receiveRequest(tenantId, seen.id, userId, dto.paymentMethod, {
            receivedAt: this.resolveDate(dto.receiptDate),
            note:       [dto.vendor?.trim(), dto.referenceNumber?.trim()].filter(Boolean).join(' · ') || undefined,
            acceptCostChangeFor: acceptAgain,
          });
          return { duplicate: true, request: again.request, posted: again.posted, skipped: again.skipped,
                   failed: again.failed, expenses: [], created: createdAgain, document: null };
        }
        return { duplicate: true, request: seen, posted: [], skipped: [], failed: [], expenses: [], created: [], document: null };
      }
    }

    const receiptDate = this.resolveDate(dto.receiptDate);
    const label = [dto.vendor?.trim(), dto.referenceNumber?.trim()].filter(Boolean).join(' · ');

    // 1. Every line is checked before any ingredient is created. Creating
    //    line by line meant a refusal on line 2 left line 1's new ingredient
    //    behind -- and the retry then refused line 1 as its own twin.
    await this.validateLines(tenantId, dto.lines ?? []);
    const created: Array<{ id: string; name: string; unit: string }> = [];
    const resolved: Array<ReceiptStockLineDto & { rawMaterialId: string }> = [];
    for (const line of dto.lines ?? []) {
      resolved.push({ ...line, rawMaterialId: await this.resolveMaterial(tenantId, line, created) });
    }

    // 2. One request line per ingredient. The unique index on (request,
    //    ingredient) says so, and a receipt with chicken wings on two lines
    //    is one delivery of chicken wings.
    const merged = this.mergeLines(resolved);
    const acceptFor = new Set(resolved.filter((l) => l.acceptCostChange).map((l) => l.rawMaterialId));

    // 3. The request, already BOUGHT: the shopping happened before the photo.
    const requestNumber = await this.procure.nextRequestNumber(tenantId);
    const now = new Date();
    const request = await this.prisma.purchaseRequest.create({
      data: {
        tenantId, branchId, requestNumber,
        status:      'BOUGHT',
        sentAt:      now,
        boughtAt:    now,
        notes:       [dto.idempotencyKey ? this.keyTag(dto.idempotencyKey) : null, label || null]
                       .filter(Boolean).join(' ') || null,
        createdById: userId,
        sentById:    userId,
        lines: {
          create: merged.map((l, i) => ({
            lineNumber:    `${requestNumber}-${String(i + 1).padStart(2, '0')}`,
            rawMaterialId: l.rawMaterialId,
            qtyRequested:  new Prisma.Decimal(l.packsBought * l.packSize),
            packsBought:   new Prisma.Decimal(l.packsBought),
            packSize:      new Prisma.Decimal(l.packSize),
            packCost:      new Prisma.Decimal(l.packCost),
            brandNote:     l.brandNote ?? null,
            ...this.whereFrom(dto),
          })),
        },
      },
      include: this.include(),
    });

    // 4. Onto the shelf, through the same door a hand-typed request uses.
    const receipt = merged.length
      ? await this.procure.receiveRequest(tenantId, request.id, userId, dto.paymentMethod, {
          receivedAt: receiptDate,
          note:       label || undefined,
          acceptCostChangeFor: acceptFor,
        })
      : {
          // Nothing to put on the shelf -- a receipt that was all delivery fee
          // and parking. The request exists to carry the photo, and it is done
          // the moment it is made; left at BOUGHT it would sit in the list
          // asking to be added to stock forever.
          request: await this.prisma.purchaseRequest.update({
            where: { id: request.id },
            data:  { status: 'RECEIVED', receivedAt: now, receivedById: userId },
            include: this.include(),
          }),
          posted: [], skipped: [], failed: [],
        };

    // 5. Lines that were never stock: a delivery fee, the plumber, parking.
    //    Posted the same way the request card posts its own charges.
    const expenses = await this.procure.postExpenses(
      tenantId, userId, receiptDate, label, dto.paymentMethod, dto.expenses ?? [],
    );

    // 6. The photo, kept with the request. A posting failure above does not
    //    lose the evidence; a filing failure below does not undo the posting.
    let document: { id: string; filename: string } | null = null;
    if (dto.imageBase64) {
      try {
        const mime = dto.mediaType ?? 'image/jpeg';
        const ext  = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
        const doc = await this.documents.uploadBuffer(
          tenantId, 'PurchaseRequest', request.id,
          Buffer.from(dto.imageBase64, 'base64'), mime,
          `receipt-${requestNumber}.${ext}`, 'Receipt', userId,
        );
        document = { id: doc.id, filename: doc.filename };
      } catch {
        document = null;
      }
    }

    return {
      duplicate: false,
      request:   receipt.request,
      posted:    receipt.posted,
      skipped:   receipt.skipped,
      failed:    receipt.failed,
      expenses,
      created,
      document,
    };
  }

  /**
   * Where the receipt says it was bought, for each line it writes: the vendor
   * as the store, and the kind of place when the person said. A receipt with
   * neither leaves a line's store as it was.
   */
  private whereFrom(dto: ConfirmReceiptDto): { sourceKind?: SourceKind | null; sourceName?: string | null } {
    const name = cleanSourceName(dto.vendor)?.slice(0, 80) ?? null;
    const kind = isSourceKind(dto.sourceKind) ? dto.sourceKind : null;
    if (!name && !kind) return {};
    return { sourceKind: kind, sourceName: name };
  }

  /**
   * The receipt written ONTO the request the kitchen sent.
   *
   * One trip, one request, one control number. Before this, every
   * photographed receipt became a second request beside the list, and the
   * list itself sat at SENT until somebody cancelled it by hand.
   *
   * The request's lines keep what was asked for -- only packs, size, price
   * and brand are written onto them; a printed line the list did not have
   * becomes a new line with the next control number. Record-only mode
   * (postNow: false) writes and files but posts nothing: an order screenshot
   * on the day it was placed, a delivery slip before the owner has looked.
   * Idempotent by construction: a replay writes the same numbers onto lines
   * not yet posted, and receiving skips the ones that are; the photo is
   * filed once per key.
   */
  private async confirmOnto(tenantId: string, userId: string, dto: ConfirmReceiptDto, confirmed: SanityWarning[] = []) {
    const req = await this.prisma.purchaseRequest.findFirst({
      where: { id: dto.purchaseRequestId!, tenantId }, include: this.include(),
    });
    if (!req) throw new NotFoundException('Purchase request not found.');
    const replay = !!dto.idempotencyKey && readTag(req.notes, 'RCPT') === dto.idempotencyKey;
    // A retry after the first answer was lost, and the first answer had
    // already put everything on the shelf: the same answer, nothing more.
    if (req.status === 'RECEIVED' && replay) {
      return { duplicate: true, recorded: true, request: req, posted: [], skipped: [], failed: [], expenses: [], created: [], document: null };
    }
    if (req.status !== 'SENT' && req.status !== 'BOUGHT') {
      throw new BadRequestException(
        req.status === 'RECEIVED'
          ? 'That request is already in stock. Post this receipt on its own instead.'
          : `That request is ${req.status.toLowerCase()}; send it first, or post this receipt on its own.`,
      );
    }
    if (!dto.lines?.length && !dto.expenses?.length) {
      throw new BadRequestException('Nothing to record. Add at least one line.');
    }
    const receiptDate = this.resolveDate(dto.receiptDate);
    const label = [dto.vendor?.trim(), dto.referenceNumber?.trim()].filter(Boolean).join(' · ');

    await this.validateLines(tenantId, dto.lines ?? []);
    const created: Array<{ id: string; name: string; unit: string }> = [];
    const resolved: Array<ReceiptStockLineDto & { rawMaterialId: string }> = [];
    for (const line of dto.lines ?? []) {
      resolved.push({ ...line, rawMaterialId: await this.resolveMaterial(tenantId, line, created, replay) });
    }
    const merged = this.mergeLines(resolved);
    const acceptFor = new Set(resolved.filter((l) => l.acceptCostChange).map((l) => l.rawMaterialId));

    // Onto the list's own lines; what the list did not have becomes a line.
    const numbered = req.lines.map((l) => ({ lineNumber: l.lineNumber }));
    const landedOn: Array<{ rawMaterialId: string; lineId: string; perUnit: number }> = [];
    const skipped: Array<{ line: string; name: string; reason: string }> = [];
    for (const m of merged) {
      const own = req.lines.find((l) => l.rawMaterialId === m.rawMaterialId);
      const pack = {
        packsBought: new Prisma.Decimal(m.packsBought),
        packSize:    new Prisma.Decimal(m.packSize),
        packCost:    new Prisma.Decimal(m.packCost),
        brandNote:   m.brandNote ?? null,
        ...this.whereFrom(dto),
      };
      if (own?.receivedAt) {
        skipped.push({ line: own.lineNumber, name: own.rawMaterial.name, reason: 'Already in stock; this receipt did not change it.' });
        continue;
      }
      if (own) {
        await this.prisma.purchaseRequestLine.update({ where: { id: own.id }, data: pack });
        landedOn.push({ rawMaterialId: m.rawMaterialId, lineId: own.id, perUnit: m.packCost / m.packSize });
        continue;
      }
      const lineNumber = this.procure.nextLineNumber(req.requestNumber, numbered);
      numbered.push({ lineNumber });
      const created = await this.prisma.purchaseRequestLine.create({
        data: {
          purchaseRequestId: req.id, lineNumber, rawMaterialId: m.rawMaterialId,
          qtyRequested: new Prisma.Decimal(m.packsBought * m.packSize),
          ...pack,
        },
      });
      if (created?.id) landedOn.push({ rawMaterialId: m.rawMaterialId, lineId: created.id, perUnit: m.packCost / m.packSize });
    }

    /*
      A price confirmed here, saved to the request and posted later from the
      buy list, must not be refused then by the ten-times guard: remember the
      answer against the line it landed on, at the value of that line (two
      printed rows of one ingredient are blended into one).
    */
    if (this.sanity && confirmed.length > 0) {
      const answered = new Set(confirmed.map((w) => w.rawMaterialId));
      const lines = landedOn.filter((l) => answered.has(l.rawMaterialId));
      for (const l of lines) {
        const w = confirmed.find((c) => c.rawMaterialId === l.rawMaterialId)!;
        await this.sanity.recordConfirmed(tenantId, userId, [w], () => ({ type: 'PurchaseRequestLine', id: l.lineId, value: sanityValueKey(l.perUnit) }));
      }
    }

    let notes = req.notes;
    if (dto.idempotencyKey && !replay) notes = withTag(notes, 'RCPT', dto.idempotencyKey);
    if (label && !(notes ?? '').includes(label)) notes = appendNote(notes, label);
    const request = await this.prisma.purchaseRequest.update({
      where: { id: req.id },
      data: {
        status:   'BOUGHT',
        boughtAt: req.boughtAt ?? new Date(`${receiptDate}T00:00:00+08:00`),
        ...(notes !== req.notes ? { notes } : {}),
      },
      include: this.include(),
    });

    // The photo, once per key; a posting failure below does not lose it.
    let document: { id: string; filename: string } | null = null;
    if (dto.imageBase64 && !replay) {
      try {
        const mime = dto.mediaType ?? 'image/jpeg';
        const ext  = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
        const doc = await this.documents.uploadBuffer(
          tenantId, 'PurchaseRequest', req.id,
          Buffer.from(dto.imageBase64, 'base64'), mime,
          `receipt-${req.requestNumber}.${ext}`, 'Receipt', userId,
        );
        document = { id: doc.id, filename: doc.filename };
      } catch {
        document = null;
      }
    }

    if (dto.postNow === false) {
      if (dto.paidAhead) {
        /*
          The order screenshot: the money left today. Fees on it left today
          too -- once. The advance itself runs on every attempt, because it
          posts only the difference between what the lines now say and what
          the request already holds: a true replay posts nothing, while a
          first attempt that died between writing the key and reaching the
          ledger still gets its money out. Skipping it on a replay left the
          arrival crediting 1063 for an advance that was never debited, and
          the screen said it had already been posted.
        */
        const fees = (dto.expenses ?? []).map((e) => ({ description: e.description, amount: e.amount, category: e.category }));
        const feesDone = !!dto.idempotencyKey && readTag(request.notes, 'FEES') === dto.idempotencyKey;
        const paid = await this.procure.payAhead(
          tenantId, request, userId, dto.paymentMethod, receiptDate, feesDone ? [] : fees,
        );
        let landed = paid.request;
        if (dto.idempotencyKey && !feesDone
            && paid.summary.entries.some((c) => c.entryNumber && fees.some((f) => f.description === c.description))) {
          landed = await this.prisma.purchaseRequest.update({
            where:   { id: req.id },
            data:    { notes: withTag(landed.notes, 'FEES', dto.idempotencyKey) },
            include: this.include(),
          });
        }
        return { duplicate: replay, recorded: true, request: landed, posted: [], skipped, failed: [], expenses: paid.summary.entries, created, document, paidAhead: paid.summary };
      }
      return { duplicate: replay, recorded: true, request, posted: [], skipped, failed: [], expenses: [], created, document };
    }

    /*
      A price on the slip that differs from the one the order was paid at
      is a difference in the money too. The request remembers the pocket;
      posting the difference now keeps 1063 equal to the goods it is about
      to hand over.
    */
    const prepaidPocket = readTag(request.notes, 'PREPAID') as ProcurePocket | null;
    let adjusted: PostedExpense[] = [];
    if (prepaidPocket) {
      const paid = await this.procure.payAhead(tenantId, request, userId, prepaidPocket, receiptDate, []);
      adjusted = paid.summary.entries;
    }

    /*
      Through the same door a hand-typed request uses -- the charges ride
      with the goods and post once. "Fix the line and post again" keeps the
      same key and the same fee row on screen, and the first attempt had
      already posted the fee alongside the lines that did work -- so a fee
      that has already ridden is not sent a second time. Which is not the
      same as a replay: a record-only pass writes the key and posts nothing,
      and its fee still has to go when the goods are finally posted. So the
      request remembers the key whose fees are done, not merely seen.
    */
    const fees = (dto.expenses ?? []).map((e) => ({ description: e.description, amount: e.amount, category: e.category }));
    const feesDone = !!dto.idempotencyKey && readTag(request.notes, 'FEES') === dto.idempotencyKey;
    const out = await this.procure.receiveRequest(tenantId, req.id, userId, dto.paymentMethod, {
      receivedAt: receiptDate,
      note:       label || undefined,
      acceptCostChangeFor: acceptFor,
      charges:    feesDone ? [] : fees,
    });
    let landed = out.request;
    if (dto.idempotencyKey && !feesDone
        && out.charges.some((c) => c.entryNumber && fees.some((f) => f.description === c.description))) {
      landed = await this.prisma.purchaseRequest.update({
        where: { id: req.id },
        data:  { notes: withTag(landed.notes, 'FEES', dto.idempotencyKey) },
        include: this.include(),
      });
    }
    return {
      duplicate: replay, recorded: true,
      request:   landed,
      posted:    out.posted,
      skipped:   [...skipped, ...out.skipped],
      failed:    out.failed,
      expenses:  [
        ...adjusted,
        ...out.charges,
        ...(feesDone ? fees.map((f): PostedExpense => ({ description: f.description, amount: f.amount, error: 'Already recorded when this receipt was first posted.' })) : []),
      ],
      created,
      document,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private keyTag(key: string) { return `[RCPT:${key}]`; }

  /** Everything resolveMaterial would refuse, asked up front, creating nothing. */
  private async validateLines(tenantId: string, lines: ReceiptStockLineDto[]) {
    const newNames = new Set<string>();
    for (const line of lines) {
      if (line.rawMaterialId && line.create) {
        throw new BadRequestException('A line is either an existing ingredient or a new one, not both.');
      }
      if (line.rawMaterialId) {
        const rm = await this.prisma.rawMaterial.findFirst({ where: { id: line.rawMaterialId, tenantId }, select: { id: true } });
        if (!rm) throw new BadRequestException('Ingredient not found in your list.');
        continue;
      }
      if (!line.create) throw new BadRequestException('Each stock line needs an ingredient.');
      const name = line.create.name.trim().replace(/\s+/g, ' ');
      if (!name) throw new BadRequestException('The new ingredient needs a name.');
      if (newNames.has(name.toLowerCase())) continue;
      newNames.add(name.toLowerCase());
      const twin = await this.prisma.rawMaterial.findFirst({
        where:  { tenantId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true, name: true, isActive: true },
      });
      if (twin) {
        throw new BadRequestException(
          `"${twin.name}" already exists${twin.isActive ? '' : ' (inactive)'}. Pick it from the list instead of `
          + 'creating a second one -- two records for one ingredient split the stock and the cost between them.',
        );
      }
    }
  }

  private include() {
    return {
      lines: {
        include: { rawMaterial: { select: { id: true, name: true, unit: true, costPrice: true } } },
        orderBy: { lineNumber: 'asc' as const },
      },
      branch: { select: { id: true, name: true } },
    };
  }

  private async materials(tenantId: string): Promise<MaterialRef[]> {
    const rows = await this.prisma.rawMaterial.findMany({
      where:  { tenantId, isActive: true },
      select: { id: true, name: true, unit: true, category: true, costPrice: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, unit: r.unit, category: String(r.category),
      costPrice: r.costPrice != null ? Number(r.costPrice) : null,
    }));
  }

  /** Today in the shop's own timezone, or the date the receipt says. */
  private resolveDate(given?: string): string {
    if (given) {
      const d = given.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(`${d}T00:00:00Z`).getTime())) {
        throw new BadRequestException('The receipt date has to be a real date (YYYY-MM-DD).');
      }
      return d;
    }
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  /**
   * An existing ingredient by id, or a new one -- but never a near-duplicate.
   *
   * Ingredient matching elsewhere in Clerque is case-sensitive, and the shop
   * already carries "Chicken Wings" beside "Chicken wings" from exactly this
   * kind of entry. Creating from a receipt is the easiest place to make a
   * third, so a name that already exists in any capitalisation is refused
   * with the existing one named, rather than quietly split.
   */
  private async resolveMaterial(
    tenantId: string,
    line: ReceiptStockLineDto,
    created: Array<{ id: string; name: string; unit: string }>,
    /** On a replay, the twin IS the ingredient this receipt created last time. */
    reuseTwin = false,
  ): Promise<string> {
    if (line.rawMaterialId && line.create) {
      throw new BadRequestException('A line is either an existing ingredient or a new one, not both.');
    }
    if (line.rawMaterialId) {
      const rm = await this.prisma.rawMaterial.findFirst({
        where: { id: line.rawMaterialId, tenantId }, select: { id: true },
      });
      if (!rm) throw new BadRequestException('Ingredient not found in your list.');
      return rm.id;
    }
    if (!line.create) throw new BadRequestException('Each stock line needs an ingredient.');

    const name = line.create.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('The new ingredient needs a name.');
    // Two new lines with one name on the same receipt are one ingredient,
    // and the second must find the first -- before the twin check does.
    const again = created.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (again) return again.id;
    const twin = await this.prisma.rawMaterial.findFirst({
      where:  { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, isActive: true },
    });
    if (twin && reuseTwin && twin.isActive) return twin.id;
    if (twin) {
      throw new BadRequestException(
        `"${twin.name}" already exists${twin.isActive ? '' : ' (inactive)'}. Pick it from the list instead of `
        + 'creating a second one -- two records for one ingredient split the stock and the cost between them.',
      );
    }
    const made = await this.inventory.createRawMaterial(tenantId, {
      name,
      unit:     line.create.unit.trim(),
      category: line.create.category,
    });
    created.push({ id: made.id, name: made.name, unit: made.unit });
    return made.id;
  }

  /**
   * Two printed lines of one ingredient become one request line.
   *
   * Same pack and same price -- the usual case, two bags of the same sugar --
   * simply add up. Otherwise the line is restated in the ingredient's own
   * unit with the blended cost, so the quantity and the pesos are both exact
   * and only the "how many bags" reading is lost, which the note records.
   */
  private mergeLines(lines: Array<ReceiptStockLineDto & { rawMaterialId: string }>) {
    const byId = new Map<string, Array<ReceiptStockLineDto & { rawMaterialId: string }>>();
    for (const l of lines) {
      if (!byId.has(l.rawMaterialId)) byId.set(l.rawMaterialId, []);
      byId.get(l.rawMaterialId)!.push(l);
    }
    const out: Array<{ rawMaterialId: string; packsBought: number; packSize: number; packCost: number; brandNote?: string }> = [];
    for (const [rawMaterialId, group] of byId) {
      if (group.length === 1) {
        const g = group[0];
        out.push({ rawMaterialId, packsBought: g.packsBought, packSize: g.packSize, packCost: g.packCost, brandNote: g.brandNote });
        continue;
      }
      const samePack = group.every((g) => g.packSize === group[0].packSize && g.packCost === group[0].packCost);
      const notes = group.map((g) => g.brandNote?.trim()).filter(Boolean);
      if (samePack) {
        out.push({
          rawMaterialId,
          packsBought: +group.reduce((s, g) => s + g.packsBought, 0).toFixed(4),
          packSize:    group[0].packSize,
          packCost:    group[0].packCost,
          brandNote:   [...new Set(notes)].join('; ') || undefined,
        });
      } else {
        /*
          ONE pack holding the whole quantity at the whole price -- not a
          per-unit cost rounded to four places. 25 kg at P1,250 and 10 kg at
          P520 is P1,770 for 35,000 g; as a rounded P0.0506/g it would post
          P1,771 to inventory and cash, one peso that nobody paid. Receiving
          divides cost by size unrounded, so the pesos that land are the pesos
          on the receipt.
        */
        const qty  = group.reduce((s, g) => s + g.packsBought * g.packSize, 0);
        const cost = group.reduce((s, g) => s + g.packsBought * g.packCost, 0);
        out.push({
          rawMaterialId,
          packsBought: 1,
          packSize:    +qty.toFixed(4),
          packCost:    +cost.toFixed(2),
          brandNote:   [`${group.length} lines on the receipt, combined`, ...new Set(notes)].join('; '),
        });
      }
    }
    return out;
  }
}

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AiService } from '../ai/ai.service';
import { DocumentsService } from '../documents/documents.service';
import { SimpleEntriesService } from '../simple-entries/simple-entries.service';
import { ProcureService } from './procure.service';
import { PH_TIMEZONE } from '@repo/shared-types';
import {
  RECEIPT_LINES_SYSTEM_PROMPT, parseReceiptJson, matchIngredient, derivePack,
  MaterialRef, ParsedLine,
} from './receipt-parser';
import { ParseReceiptDto, ConfirmReceiptDto, ReceiptStockLineDto } from './dto/receipts.dto';

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
    private readonly simple:    SimpleEntriesService,
  ) {}

  // ── reading ───────────────────────────────────────────────────────────────

  async parse(tenantId: string, userId: string, dto: ParseReceiptDto) {
    if (!dto.imageBase64) throw new BadRequestException('A photo of the receipt is required.');
    // ~6 MB of base64 is ~4.5 MB of image; a phone photo resized for upload is well under.
    if (dto.imageBase64.length > 8_000_000) {
      throw new BadRequestException('That photo is too large. Take it again at a lower resolution.');
    }

    const text = await this.ai.call({
      tenantId,
      userId,
      action:       'procure_receipt_lines',
      systemPrompt: RECEIPT_LINES_SYSTEM_PROMPT,
      // The prompt is identical on every call, so it caches.
      cacheSystem:  true,
      // A long market receipt is thirty lines; each is ~60 tokens of JSON.
      maxTokens:    2500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: dto.mediaType ?? 'image/jpeg', data: dto.imageBase64 } },
          { type: 'text',  text: 'Read every purchased line and the header per the system prompt. JSON only.' },
        ],
      }],
    });

    let parsed;
    try {
      parsed = parseReceiptJson(text);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'The receipt could not be read.');
    }

    const materials = await this.materials(tenantId);
    const lines: SuggestedLine[] = parsed.lines.map((l, index) => {
      // An expense line is not on the shelf, so there is nothing to match it to.
      const m = l.kind === 'expense'
        ? { best: null, alternatives: [] }
        : matchIngredient(l.description, materials);
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
      vendor:          parsed.vendor,
      dateText:        parsed.dateText,
      dateIso:         parsed.dateIso,
      referenceNumber: parsed.referenceNumber,
      total:           parsed.total,
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

  // ── posting ───────────────────────────────────────────────────────────────

  async confirm(tenantId: string, userId: string, fallbackBranchId: string | undefined, dto: ConfirmReceiptDto) {
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
    const expenses: Array<{ description: string; amount: number; entryNumber?: string; status?: string; error?: string }> = [];
    for (const e of dto.expenses ?? []) {
      try {
        const note = `${label ? label + ': ' : ''}${e.description}`.slice(0, 200);
        /*
          Owner-funded is two honest entries, not one clever one: the owner
          put the money in (Dr cash, Cr owner's capital), then the business
          spent it (Dr expense, Cr cash). Same end state as a direct
          Dr expense / Cr capital, and both halves are entries the simple
          ledger already knows how to reverse.
        */
        const je = await this.simple.create(tenantId, userId, {
          type: 'EXPENSE', amount: e.amount, date: receiptDate, source: 'CASH',
          category: e.category ?? 'OTHER', note,
        });
        // The expense first, so a failure here leaves nothing behind. The
        // contribution second, so a failure THERE leaves a real expense on the
        // books and a message saying which half is missing -- never an orphan
        // contribution with no spend against it.
        let contributionNote: string | undefined;
        if (dto.paymentMethod === 'OWNER_FUNDED') {
          try {
            await this.simple.create(tenantId, userId, {
              type: 'OWNER_CONTRIBUTION', amount: e.amount, date: receiptDate, source: 'CASH',
              note: `Owner paid: ${note}`.slice(0, 200),
            });
          } catch (err) {
            contributionNote = `Expense posted, but the owner contribution did not: ${
              err instanceof Error ? err.message : 'unknown error'}. Record it under Ledger > Record Entry.`;
          }
        }
        // status is PENDING_APPROVAL when the shop has a journal threshold:
        // the entry exists but is not in the books until someone approves it.
        expenses.push({ description: e.description, amount: e.amount, entryNumber: je.entryNumber, status: je.status,
                        ...(contributionNote ? { error: contributionNote } : {}) });
      } catch (err) {
        expenses.push({
          description: e.description, amount: e.amount,
          error: err instanceof Error ? err.message : 'Could not post this expense.',
        });
      }
    }

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

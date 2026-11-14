import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { ProcureService } from '../procure/procure.service';
import { JournalService } from '../accounting/journal.service';
import { AuditService } from '../audit/audit.service';
import { heldAt, heldUsage } from '../orders/held-usage';
import { appendNote } from '../procure/procure-notes';
import { apiKeyActorId } from '../auth/strategies/api-key.strategy';
import { money2, optionalText, parseDecimal, qty4, requireDay, requireId, requireReference } from './format';
import { findDuplicateInvoice, matchVendor, ReceivingLine } from './receiving-rules';

/**
 * The three drafts an API key may open (contract: "every write here creates
 * something a person finishes in Clerque"):
 *
 *   count             a CycleCount, OPEN, with the lines asked for
 *   purchase request  lines on the branch's OPEN PurchaseRequest
 *   journal           a JournalEntry, DRAFT, source AIBA
 *   receiving         a ReceivingDraft, DRAFT: a supplier delivery read from
 *                     an invoice photo, received only when a person confirms
 *                     it (ReceivingDraftsService.confirm)
 *
 * Nothing here posts, approves, voids or deletes. Every draft:
 *   - is made once per (tenant, reference): a retry answers with the first
 *     draft (service_drafts' unique key decides, even when retries race);
 *   - names only the key's own tenant's branch, items and accounts -- another
 *     tenant's reads as not found;
 *   - is written to the audit trail as made by the key ("apikey:<id>", its
 *     label in the record), and its creator column holds the same marker,
 *     never a person's id.
 */

export interface ServiceCaller {
  tenantId: string;
  keyId:    string;
  label:    string;
}

export interface DraftAnswer {
  id:        string;
  status:    string;
  reference: string;
  [extra: string]: unknown;
}

type DraftKind = 'COUNT' | 'PURCHASE_REQUEST' | 'JOURNAL' | 'RECEIVING';

const ENTITY: Record<DraftKind, string> = {
  COUNT: 'CycleCount', PURCHASE_REQUEST: 'PurchaseRequest', JOURNAL: 'JournalEntry', RECEIVING: 'ReceivingDraft',
};
const WORDS: Record<DraftKind, string> = {
  COUNT: 'count', PURCHASE_REQUEST: 'purchase request', JOURNAL: 'journal entry draft', RECEIVING: 'receiving draft',
};

/** A claimed reference with no draft behind it this long is a crashed attempt; it may be claimed again. */
const ABANDONED_CLAIM_MS = 2 * 60 * 1000;

const MAX_LINES = 200;

@Injectable()
export class ServiceDraftsService {
  private readonly logger = new Logger(ServiceDraftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouse: WarehouseService,
    private readonly procure: ProcureService,
    private readonly journal: JournalService,
    private readonly audit: AuditService,
  ) {}

  // ── Count ────────────────────────────────────────────────────────────────

  /**
   * Opens a cycle count with exactly the lines asked for. Each line expects
   * the book figure less what waiting kitchen/bar tickets hold (as a count
   * opened on the counts screen does), and its counted figure starts at that
   * expectation, so posting it untouched moves nothing.
   *
   * proposedQty never becomes the counted figure: it is written into the
   * line's note ("AIBA proposes 7.5000 ...") for the counter to read. A
   * person enters what is on the shelf, and someone else posts
   * (WarehouseService.postCycleCount).
   */
  async draftCount(caller: ServiceCaller, body: Record<string, unknown>): Promise<DraftAnswer> {
    const reference = requireReference(body?.reference);
    const branchId = requireId(body?.branchId, 'branchId');
    const reason = optionalText(body?.reason, 'reason', 300);
    const lines = this.lines(body?.lines).map((l, i) => {
      const at = `lines[${i}]`;
      const itemId = this.rawItem(l, at);
      return {
        itemId,
        proposed: l.proposedQty == null || l.proposedQty === '' ? null : parseDecimal(l.proposedQty, `${at}.proposedQty`, 4),
        why: optionalText(l.why, `${at}.why`, 300),
      };
    });
    this.noDuplicates(lines.map((l) => l.itemId));

    return this.once(caller, reference, 'COUNT', async () => {
      await this.branchOf(caller.tenantId, branchId);
      await this.materialsOf(caller.tenantId, lines.map((l) => l.itemId));

      const count = await this.withCountNumber(caller.tenantId, (countNumber) => this.prisma.$transaction(async (tx) => {
        const onHand = new Map(
          (await tx.rawMaterialInventory.findMany({
            where:  { tenantId: caller.tenantId, branchId, rawMaterialId: { in: lines.map((l) => l.itemId) } },
            select: { rawMaterialId: true, quantity: true },
          })).map((r) => [r.rawMaterialId, r.quantity]),
        );
        const held = await heldUsage(tx, caller.tenantId, [branchId], { rawMaterialIds: lines.map((l) => l.itemId) });
        return tx.cycleCount.create({
          data: {
            tenantId:    caller.tenantId,
            branchId,
            countNumber,
            status:      'OPEN',
            startedById: apiKeyActorId(caller.keyId),
            notes:       this.byKey(caller, reference, reason),
            lines: {
              create: lines.map((l) => {
                const book = new Prisma.Decimal(onHand.get(l.itemId) ?? 0);
                const heldQty = heldAt(held, branchId, l.itemId);
                const expected = heldQty > 0 ? Prisma.Decimal.max(book.minus(heldQty), 0) : book;
                const note = [
                  l.proposed ? `AIBA proposes ${qty4(l.proposed)}` : 'Please count',
                  l.why,
                ].filter(Boolean).join(': ');
                return {
                  rawMaterialId: l.itemId,
                  expectedQty:   expected,
                  countedQty:    expected,
                  notes:         note.slice(0, 500),
                };
              }),
            },
          },
          select: { id: true, countNumber: true, status: true },
        });
      }));
      return { id: count.id, status: count.status, extra: { number: count.countNumber } };
    });
  }

  // ── Purchase request ─────────────────────────────────────────────────────

  /**
   * Adds the lines asked for to the branch's OPEN purchase request, opening
   * one when there is none. Clerque keeps one open request per branch (a
   * second would split the shopping in two), so a draft joins it rather than
   * starting another. An item already on it keeps the quantity a person
   * gave and is answered under `skipped`; a prep (made in the kitchen, not
   * bought) is refused, as on the screen.
   */
  async draftPurchaseRequest(caller: ServiceCaller, body: Record<string, unknown>): Promise<DraftAnswer> {
    const reference = requireReference(body?.reference);
    const branchId = requireId(body?.branchId, 'branchId');
    const note = optionalText(body?.note, 'note', 300);
    const lines = this.lines(body?.lines).map((l, i) => {
      const at = `lines[${i}]`;
      return {
        itemId: this.rawItem(l, at),
        qty:    parseDecimal(l.qty, `${at}.qty`, 4, { positive: true }),
        why:    optionalText(l.why, `${at}.why`, 200),
      };
    });
    this.noDuplicates(lines.map((l) => l.itemId));

    return this.once(caller, reference, 'PURCHASE_REQUEST', async () => {
      await this.branchOf(caller.tenantId, branchId);
      const materials = await this.materialsOf(caller.tenantId, lines.map((l) => l.itemId));
      const preps = materials.filter((m) => m.subRecipeItems.length > 0);
      if (preps.length) {
        throw new BadRequestException(
          `${preps.map((p) => p.name).join(', ')} ${preps.length === 1 ? 'is' : 'are'} made in the kitchen, not bought.`,
        );
      }
      const nameOf = new Map(materials.map((m) => [m.id, m.name]));

      let req = await this.prisma.purchaseRequest.findFirst({
        where:   { tenantId: caller.tenantId, branchId, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, requestNumber: true, status: true, notes: true, lines: { select: { rawMaterialId: true, lineNumber: true } } },
      });
      if (!req) {
        req = await this.withRequestNumber(caller.tenantId, (requestNumber) => this.prisma.purchaseRequest.create({
          data:   { tenantId: caller.tenantId, branchId, requestNumber, createdById: apiKeyActorId(caller.keyId) },
          select: { id: true, requestNumber: true, status: true, notes: true, lines: { select: { rawMaterialId: true, lineNumber: true } } },
        }));
      }

      const already = new Set(req.lines.map((l) => l.rawMaterialId));
      const adding = lines.filter((l) => !already.has(l.itemId));
      const skipped = lines.filter((l) => already.has(l.itemId)).map((l) => l.itemId);
      const numbered = [...req.lines];
      for (const l of adding) {
        const lineNumber = this.procure.nextLineNumber(req.requestNumber, numbered);
        numbered.push({ rawMaterialId: l.itemId, lineNumber });
        await this.prisma.purchaseRequestLine.create({
          data: { purchaseRequestId: req.id, lineNumber, rawMaterialId: l.itemId, qtyRequested: l.qty },
        });
      }
      const whys = adding.filter((l) => l.why).map((l) => `${nameOf.get(l.itemId)}: ${l.why}`);
      const said = [this.byKey(caller, reference, note), ...whys].join('; ');
      await this.prisma.purchaseRequest.update({
        where: { id: req.id },
        data:  { notes: appendNote(req.notes, said) },
      });
      return { id: req.id, status: req.status, extra: { number: req.requestNumber, added: adding.map((l) => l.itemId), skipped } };
    });
  }

  // ── Journal ──────────────────────────────────────────────────────────────

  /**
   * A journal entry in DRAFT, source AIBA, through JournalService.create --
   * the one path every manual entry takes. Refused unless debits equal
   * credits to the centavo, every account code is the tenant's own, active,
   * and open to manual entries (an account only a sub-ledger may post to
   * would be refused when a person posted the draft, so it is refused now).
   * The period lock and the approval threshold apply when a person posts it
   * (JournalService.post).
   */
  async draftJournal(caller: ServiceCaller, body: Record<string, unknown>): Promise<DraftAnswer> {
    const reference = requireReference(body?.reference);
    const date = requireDay(body?.date, 'date');
    const memo = optionalText(body?.memo, 'memo', 300);
    if (!memo) throw new BadRequestException('memo is required.');
    const rawLines = this.lines(body?.lines, 100);
    if (rawLines.length < 2) throw new BadRequestException('A journal entry needs at least two lines.');
    const lines = rawLines.map((l, i) => {
      const at = `lines[${i}]`;
      if (typeof l.account !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(l.account)) {
        throw new BadRequestException(`${at}.account must be an account code.`);
      }
      const debit = parseDecimal(l.debit ?? '0', `${at}.debit`, 2);
      const credit = parseDecimal(l.credit ?? '0', `${at}.credit`, 2);
      if (debit.isZero() === credit.isZero()) {
        throw new BadRequestException(`${at} must carry a debit or a credit, not both and not neither.`);
      }
      return { account: l.account, debit, credit, memo: optionalText(l.memo, `${at}.memo`, 200) };
    });
    const debits = lines.reduce((s, l) => s.plus(l.debit), new Prisma.Decimal(0));
    const credits = lines.reduce((s, l) => s.plus(l.credit), new Prisma.Decimal(0));
    if (!debits.equals(credits)) {
      throw new BadRequestException(`Out of balance: debits ${debits.toFixed(2)}, credits ${credits.toFixed(2)}.`);
    }

    return this.once(caller, reference, 'JOURNAL', async () => {
      const codes = [...new Set(lines.map((l) => l.account))];
      const accounts = await this.prisma.account.findMany({
        where:  { tenantId: caller.tenantId, code: { in: codes } },
        select: { id: true, code: true, name: true, isActive: true, postingControl: true },
      });
      const unknown = codes.filter((c) => !accounts.some((a) => a.code === c));
      if (unknown.length) throw new BadRequestException(`Unknown account code(s): ${unknown.join(', ')}.`);
      const inactive = accounts.filter((a) => !a.isActive);
      if (inactive.length) throw new BadRequestException(`Inactive account(s): ${inactive.map((a) => a.code).join(', ')}.`);
      const restricted = accounts.filter((a) => a.postingControl !== 'OPEN');
      if (restricted.length) {
        throw new BadRequestException(
          `Only Clerque's own modules post to ${restricted.map((a) => `${a.code} ${a.name}`).join(', ')}; a journal draft cannot use ${restricted.length === 1 ? 'it' : 'them'}.`,
        );
      }
      const idOf = new Map(accounts.map((a) => [a.code, a.id]));

      const je = await this.journal.create(
        caller.tenantId,
        {
          date,
          description: memo,
          reference,
          saveDraft:   true,
          lines: lines.map((l) => ({
            accountId:   idOf.get(l.account)!,
            debit:       l.debit.toNumber(),
            credit:      l.credit.toNumber(),
            description: l.memo ?? undefined,
          })),
        },
        apiKeyActorId(caller.keyId),
        'AIBA',
      );
      if (je.status !== 'DRAFT') {
        // JournalService.create with saveDraft always drafts; if that ever
        // changes, a machine must not have posted anything.
        throw new Error(`Journal draft came back ${je.status}`);
      }
      return { id: je.id, status: je.status, extra: { number: je.entryNumber } };
    });
  }

  // ── Receiving ────────────────────────────────────────────────────────────

  /**
   * A supplier delivery read from the owner's invoice photo, held as a
   * ReceivingDraft. Nothing moves: no stock, no lot, no cost, no journal, no
   * AP bill until a person confirms it (ReceivingDraftsService.confirm), and
   * then only through Clerque's own receiving.
   *
   * Refused: a supplier invoice number already received (an AP bill for the
   * same supplier with that invoice number, a lot of one of these items
   * under that number, or another draft of it not cancelled); lines that do
   * not add up to the invoice; an item in a unit other than its own;
   * finished goods (kind "product": this path receives ingredients and
   * supplies, the only kind Clerque's receiving takes).
   */
  async draftReceiving(caller: ServiceCaller, body: Record<string, unknown>): Promise<DraftAnswer> {
    const reference = requireReference(body?.reference);
    const branchId = requireId(body?.branchId, 'branchId');

    const supplier = (body?.supplier ?? {}) as Record<string, unknown>;
    const supplierName = optionalText(supplier.name, 'supplier.name', 200);
    if (!supplierName) throw new BadRequestException('supplier.name is required.');
    const supplierTin = optionalText(supplier.tin, 'supplier.tin', 20);
    if (supplierTin && !/^[0-9-]{9,20}$/.test(supplierTin)) {
      throw new BadRequestException('supplier.tin must be digits and dashes, e.g. 123-456-789-000.');
    }

    const invoice = (body?.invoice ?? {}) as Record<string, unknown>;
    const invoiceNumber = optionalText(invoice.number, 'invoice.number', 60);
    if (!invoiceNumber) throw new BadRequestException('invoice.number is required.');
    const invoiceDate = requireDay(invoice.date, 'invoice.date');
    const dueDate = invoice.dueDate == null || invoice.dueDate === '' ? null : requireDay(invoice.dueDate, 'invoice.dueDate');
    if (dueDate && dueDate < invoiceDate) throw new BadRequestException('invoice.dueDate is before invoice.date.');
    if (typeof invoice.vatable !== 'boolean') throw new BadRequestException('invoice.vatable must be true or false.');
    const vatable = invoice.vatable;
    const subtotal = parseDecimal(invoice.subtotal, 'invoice.subtotal', 2);
    const vat = parseDecimal(invoice.vat ?? '0', 'invoice.vat', 2);
    const total = parseDecimal(invoice.total, 'invoice.total', 2, { positive: true });
    if (!subtotal.plus(vat).equals(total)) {
      throw new BadRequestException(`invoice.subtotal ${money2(subtotal)} plus vat ${money2(vat)} is not the total ${money2(total)}.`);
    }
    if (!vatable && !vat.isZero()) throw new BadRequestException('A non-VAT invoice carries no VAT.');
    /*
      Confirming grosses every line up by 12% and receiving takes 12% back out,
      so a vatable invoice must carry 12% of its subtotal as VAT (to the peso):
      an invoice with exempt or zero-rated lines would file bills that do not
      add up to it, and is refused here for a person to record by hand.
    */
    if (vatable && vat.minus(subtotal.times('0.12')).abs().greaterThan('1.00')) {
      throw new BadRequestException(
        `invoice.vat ${money2(vat)} is not 12% of the subtotal ${money2(subtotal)}: an invoice with exempt or zero-rated lines is recorded by hand.`,
      );
    }
    // VAT follows the shop at receiving (see ReceivingDraftsService.confirm): a VAT shop cannot take in a non-VAT invoice here yet.
    if (!vatable) {
      const shop = await this.prisma.tenant.findUnique({ where: { id: caller.tenantId }, select: { taxStatus: true } });
      if (shop?.taxStatus === 'VAT') {
        throw new BadRequestException('This shop is VAT-registered and the invoice has no VAT: receiving would book input VAT that does not exist. Record it by hand.');
      }
    }

    const lines: ReceivingLine[] = this.lines(body?.lines, 100).map((l, i) => {
      const at = `lines[${i}]`;
      const itemId = this.rawItem(l, at);
      const qty = parseDecimal(l.qty, `${at}.qty`, 4, { positive: true });
      const unitCost = parseDecimal(l.unitCost, `${at}.unitCost`, 4);
      const lineTotal = parseDecimal(l.lineTotal, `${at}.lineTotal`, 2);
      // A line is qty x unitCost, to the centavo (plus what a 4-decimal unit cost drifts over many units).
      const slack = Prisma.Decimal.max(new Prisma.Decimal('0.01'), qty.times('0.00005'));
      if (qty.times(unitCost).minus(lineTotal).abs().greaterThan(slack)) {
        throw new BadRequestException(`${at}: ${qty4(qty)} x ${qty4(unitCost)} is not the line total ${money2(lineTotal)}.`);
      }
      return {
        itemId, kind: 'raw' as const, qty: qty4(qty)!, unitCost: qty4(unitCost)!, lineTotal: money2(lineTotal)!,
        uom: optionalText(l.uom, `${at}.uom`, 20), printed: optionalText(l.printed, `${at}.printed`, 200),
      };
    });
    this.noDuplicates(lines.map((l) => l.itemId));
    const sum = lines.reduce((s, l) => s.plus(l.lineTotal), new Prisma.Decimal(0));
    if (sum.minus(subtotal).abs().greaterThan(new Prisma.Decimal('0.01').times(lines.length))) {
      throw new BadRequestException(`The lines add up to ${money2(sum)}, not the invoice subtotal ${money2(subtotal)}.`);
    }

    const evidence = (body?.evidence ?? {}) as Record<string, unknown>;
    const evidenceFile = optionalText(evidence.file, 'evidence.file', 200);
    const evidenceSha256 = evidence.sha256 == null || evidence.sha256 === '' ? null : String(evidence.sha256).toLowerCase();
    if (evidenceSha256 && !/^[0-9a-f]{64}$/.test(evidenceSha256)) throw new BadRequestException('evidence.sha256 must be 64 hex characters.');
    const purchaseOrderId = body?.purchaseOrderId == null || body.purchaseOrderId === ''
      ? null : requireId(body.purchaseOrderId, 'purchaseOrderId');

    return this.once(caller, reference, 'RECEIVING', async () => {
      await this.branchOf(caller.tenantId, branchId);
      const materials = await this.prisma.rawMaterial.findMany({
        where:  { tenantId: caller.tenantId, id: { in: lines.map((l) => l.itemId) }, isActive: true },
        select: { id: true, name: true, unit: true },
      });
      const missing = lines.filter((l) => !materials.some((m) => m.id === l.itemId)).map((l) => l.itemId);
      if (missing.length) throw new BadRequestException(`Item(s) not found: ${missing.join(', ')}.`);
      for (const l of lines) {
        const m = materials.find((x) => x.id === l.itemId)!;
        if (l.uom && l.uom.toLowerCase() !== m.unit.toLowerCase()) {
          throw new BadRequestException(`${m.name} is kept in ${m.unit}; send its quantity and unit cost in ${m.unit}, not ${l.uom}.`);
        }
      }

      const vendor = await matchVendor(this.prisma, caller.tenantId, supplierName, supplierTin);
      const dup = await findDuplicateInvoice(this.prisma, caller.tenantId, {
        invoiceNumber, vendorId: vendor?.id ?? null, supplierName, supplierTin, itemIds: lines.map((l) => l.itemId),
      });
      if (dup) throw new ConflictException(dup);

      if (purchaseOrderId) {
        const po = await this.prisma.purchaseOrder.findFirst({
          where:  { id: purchaseOrderId, tenantId: caller.tenantId },
          select: { id: true, branchId: true, vendorId: true, status: true, items: { select: { rawMaterialId: true, qtyOrdered: true, qtyReceived: true } } },
        });
        if (!po) throw new BadRequestException('Purchase order not found.');
        if (po.status !== 'ORDERED' && po.status !== 'PARTIAL') throw new BadRequestException(`That purchase order is ${po.status}, not open.`);
        if (po.branchId !== branchId) throw new BadRequestException('That purchase order is for another branch.');
        if (vendor && po.vendorId && po.vendorId !== vendor.id) throw new BadRequestException('That purchase order is with another supplier.');
        for (const l of lines) {
          const item = po.items.find((i) => i.rawMaterialId === l.itemId);
          if (!item) throw new BadRequestException(`Item ${l.itemId} is not on that purchase order.`);
          const left = new Prisma.Decimal(item.qtyOrdered).minus(item.qtyReceived);
          if (new Prisma.Decimal(l.qty).greaterThan(left)) {
            throw new BadRequestException(`Item ${l.itemId}: ${l.qty} is more than the ${qty4(left)} still to come on that purchase order.`);
          }
        }
      }

      const draft = await this.prisma.receivingDraft.create({
        data: {
          tenantId: caller.tenantId, branchId, reference, status: 'DRAFT',
          supplierName, supplierTin, vendorId: vendor?.id ?? null,
          invoiceNumber, invoiceDate: new Date(`${invoiceDate}T00:00:00+08:00`),
          dueDate: dueDate ? new Date(`${dueDate}T00:00:00+08:00`) : null,
          vatable, subtotal, vat, total, purchaseOrderId,
          lines: lines as unknown as Prisma.InputJsonValue,
          evidenceFile, evidenceSha256,
          createdByApiKeyId: caller.keyId,
        },
        select: { id: true, status: true },
      });
      return { id: draft.id, status: draft.status, extra: { invoiceNumber, supplierMatched: vendor != null } };
    });
  }

  // ── Once per reference ───────────────────────────────────────────────────

  /**
   * Claim the reference, make the draft, remember what it made, log it.
   * The same reference again answers with the first draft as it is now
   * (a person may have posted it since); the same reference for a different
   * kind of draft is a 409.
   */
  private async once(
    caller: ServiceCaller,
    reference: string,
    kind: DraftKind,
    make: () => Promise<{ id: string; status: string; extra?: Record<string, unknown> }>,
  ): Promise<DraftAnswer> {
    const replay = await this.replay(caller, reference, kind);
    if (replay) return replay;

    let claimId: string;
    try {
      claimId = (await this.prisma.serviceDraft.create({
        data:   { tenantId: caller.tenantId, apiKeyId: caller.keyId, reference, kind },
        select: { id: true },
      })).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Another attempt with this reference claimed it a moment ago.
        const raced = await this.replay(caller, reference, kind);
        if (raced) return raced;
        throw new ConflictException('A draft with this reference is being made; try again in a moment.');
      }
      throw err;
    }

    let made: Awaited<ReturnType<typeof make>>;
    try {
      made = await make();
    } catch (err) {
      // Nothing was made: free the reference so a corrected retry can use it.
      await this.prisma.serviceDraft.delete({ where: { id: claimId } }).catch(() => undefined);
      throw err;
    }
    await this.prisma.serviceDraft.update({ where: { id: claimId }, data: { targetId: made.id } });

    try {
      await this.audit.log({
        tenantId:    caller.tenantId,
        action:      'SERVICE_DRAFT_CREATED',
        entityType:  ENTITY[kind],
        entityId:    made.id,
        performedBy: apiKeyActorId(caller.keyId),
        description: `API key "${caller.label}" opened a ${WORDS[kind]} (reference ${reference}).`,
        after:       { reference, kind, status: made.status, apiKeyId: caller.keyId, apiKeyLabel: caller.label, ...(made.extra ?? {}) },
      });
    } catch (err) {
      // The draft stands; an audit write that failed is logged, not hidden.
      this.logger.error(`Audit log for service draft ${made.id} failed: ${err instanceof Error ? err.message : err}`);
    }
    return { id: made.id, status: made.status, reference, ...(made.extra ?? {}) };
  }

  /** The first draft for this reference, if there is one. */
  private async replay(caller: ServiceCaller, reference: string, kind: DraftKind): Promise<DraftAnswer | null> {
    const prior = await this.prisma.serviceDraft.findUnique({
      where:  { tenantId_reference: { tenantId: caller.tenantId, reference } },
      select: { id: true, kind: true, targetId: true, createdAt: true },
    });
    if (!prior) return null;
    if (prior.kind !== kind) {
      throw new ConflictException(`Reference ${reference} was already used for a different kind of draft.`);
    }
    if (!prior.targetId) {
      if (Date.now() - prior.createdAt.getTime() > ABANDONED_CLAIM_MS) {
        // An attempt that died between claiming and making: let this one try.
        await this.prisma.serviceDraft.deleteMany({ where: { id: prior.id, targetId: null } });
        return null;
      }
      throw new ConflictException('A draft with this reference is being made; try again in a moment.');
    }
    const current = await this.statusOf(caller.tenantId, kind, prior.targetId);
    return { id: prior.targetId, status: current, reference, replayed: true };
  }

  private async statusOf(tenantId: string, kind: DraftKind, id: string): Promise<string> {
    const row =
      kind === 'COUNT'
        ? await this.prisma.cycleCount.findFirst({ where: { id, tenantId }, select: { status: true } })
        : kind === 'PURCHASE_REQUEST'
          ? await this.prisma.purchaseRequest.findFirst({ where: { id, tenantId }, select: { status: true } })
          : kind === 'RECEIVING'
            ? await this.prisma.receivingDraft.findFirst({ where: { id, tenantId }, select: { status: true } })
            : await this.prisma.journalEntry.findFirst({ where: { id, tenantId }, select: { status: true } });
    return row?.status ?? 'GONE';
  }

  // ── Checks ───────────────────────────────────────────────────────────────

  private lines(value: unknown, max = MAX_LINES): Array<Record<string, unknown>> {
    if (!Array.isArray(value) || value.length === 0) throw new BadRequestException('lines is required.');
    if (value.length > max) throw new BadRequestException(`At most ${max} lines.`);
    return value.map((l, i) => {
      if (!l || typeof l !== 'object' || Array.isArray(l)) throw new BadRequestException(`lines[${i}] is not a line.`);
      return l as Record<string, unknown>;
    });
  }

  /** Counts and purchase requests hold ingredients and supplies only. */
  private rawItem(line: Record<string, unknown>, at: string): string {
    const kind = line.kind ?? 'raw';
    if (kind !== 'raw') {
      throw new BadRequestException(`${at}: Clerque counts and requests ingredients and supplies only (kind "raw").`);
    }
    return requireId(line.itemId, `${at}.itemId`);
  }

  private noDuplicates(ids: string[]) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) throw new BadRequestException(`Item ${id} is on more than one line.`);
      seen.add(id);
    }
  }

  /** The branch, only when it is the caller's own tenant's. */
  private async branchOf(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found.');
    return branch;
  }

  /** The items, only when every one is the caller's own tenant's and still in use. */
  private async materialsOf(tenantId: string, ids: string[]) {
    const found = await this.prisma.rawMaterial.findMany({
      where:  { tenantId, id: { in: ids }, isActive: true },
      select: { id: true, name: true, subRecipeItems: { select: { id: true }, take: 1 } },
    });
    const missing = ids.filter((id) => !found.some((m) => m.id === id));
    if (missing.length) throw new BadRequestException(`Item(s) not found: ${missing.join(', ')}.`);
    return found;
  }

  /** "Opened by API key "label" (reference X): reason" -- the human text on the draft. */
  private byKey(caller: ServiceCaller, reference: string, text: string | null): string {
    const label = caller.label.replace(/[[\]"]/g, '');
    return `Opened by API key "${label}" (reference ${reference})${text ? `: ${text}` : ''}`;
  }

  /** CC-YYYY-NNNNNN, retried when two counts take the same number in the same instant. */
  private async withCountNumber<T>(tenantId: string, make: (countNumber: string) => Promise<T>): Promise<T> {
    for (let tries = 0; ; tries++) {
      try {
        return await make(await this.warehouse.nextCountNumber(this.prisma, tenantId));
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && tries < 4)) throw err;
      }
    }
  }

  /** REQ-YYYYMMDD-NNN, retried the same way. */
  private async withRequestNumber<T>(tenantId: string, make: (requestNumber: string) => Promise<T>): Promise<T> {
    for (let tries = 0; ; tries++) {
      try {
        return await make(await this.procure.nextRequestNumber(tenantId));
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && tries < 4)) throw err;
      }
    }
  }
}

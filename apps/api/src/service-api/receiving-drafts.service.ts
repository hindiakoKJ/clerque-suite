import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { isApiKeyActor } from '../auth/strategies/api-key.strategy';
import { chargedUnitCost, findDuplicateInvoice, matchVendor, ReceivingLine } from './receiving-rules';

const DAY_MS = 24 * 60 * 60 * 1000;

export type LineOutcome =
  | { itemId: string; outcome: 'POSTED'; quantityAfter: number }
  | { itemId: string; outcome: 'ALREADY_POSTED' }
  | { itemId: string; outcome: 'FAILED'; reason: string };

/**
 * The person's side of a receiving draft (ServiceDraftsService.draftReceiving
 * made it from an invoice photo): see it, confirm it, or discard it.
 *
 * Confirming is one tap that does what receiving the delivery on the screen
 * does, line by line, through InventoryService.receiveRawMaterial: stock in,
 * a lot, the weighted-average cost and the recipe re-cost, the journal event
 * (Dr inventory / Cr 2010 Accounts Payable), and the AP bill on the
 * supplier's terms (paymentMethod CREDIT, terms = due date less invoice
 * date). That method files one bill per line, with the invoice number as the
 * bill's vendor reference; a three-line invoice is three bills that add up to
 * it. Nothing here writes stock, cost or the books itself.
 *
 * Each line is received under the invoice number, which receiveRawMaterial
 * already treats as "this delivery of this item": a line that failed (a
 * closed period, a cost ten times off) leaves the draft a DRAFT with the
 * reason, and confirming again receives only what is still missing -- the
 * lines already in come back as already posted, with no second bill.
 */
@Injectable()
export class ReceivingDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * The drafts for the Deliveries screen, newest first, each with the branch
   * name and, per line, the Clerque item it was matched to (itemName), so the
   * person checks the match before confirming.
   */
  async list(tenantId: string, status?: string) {
    const wanted = status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status) ? status : undefined;
    const rows = await this.prisma.receivingDraft.findMany({
      where:   { tenantId, ...(wanted ? { status: wanted } : {}) },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
    return this.withNames(tenantId, rows);
  }

  async get(tenantId: string, id: string) {
    const d = await this.prisma.receivingDraft.findFirst({ where: { id, tenantId } });
    if (!d) throw new NotFoundException('Receiving draft not found.');
    return d;
  }

  /** One draft as the screen shows it (branch and item names added). */
  async getNamed(tenantId: string, id: string) {
    const [named] = await this.withNames(tenantId, [await this.get(tenantId, id)]);
    return named;
  }

  private async withNames<T extends { branchId: string; lines: unknown }>(tenantId: string, rows: T[]) {
    if (!rows.length) return [];
    const itemIds = [...new Set(rows.flatMap((r) => ((r.lines ?? []) as ReceivingLine[]).map((l) => l.itemId)))];
    const branchIds = [...new Set(rows.map((r) => r.branchId))];
    const [items, branches] = await Promise.all([
      this.prisma.rawMaterial.findMany({ where: { tenantId, id: { in: itemIds } }, select: { id: true, name: true, unit: true } }),
      this.prisma.branch.findMany({ where: { tenantId, id: { in: branchIds } }, select: { id: true, name: true } }),
    ]);
    const item = new Map(items.map((i) => [i.id, i]));
    const branch = new Map(branches.map((b) => [b.id, b.name]));
    return rows.map((r) => ({
      ...r,
      branchName: branch.get(r.branchId) ?? null,
      lines: ((r.lines ?? []) as ReceivingLine[]).map((l) => ({
        ...l,
        itemName: item.get(l.itemId)?.name ?? null,
        itemUnit: item.get(l.itemId)?.unit ?? null,
      })),
    }));
  }

  async confirm(tenantId: string, id: string, userId: string, opts: { acceptCostChange?: boolean } = {}) {
    // A machine drafts; only a person signed in to Clerque confirms.
    if (!userId || isApiKeyActor(userId)) {
      throw new ForbiddenException('A receiving draft is confirmed by a person signed in to Clerque.');
    }
    const draft = await this.get(tenantId, id);
    if (draft.status === 'CONFIRMED') throw new BadRequestException('This delivery is already received.');
    if (draft.status === 'CANCELLED') throw new BadRequestException('This draft was discarded.');

    // One confirm at a time: two taps must not receive the lines twice.
    const claimed = await this.prisma.receivingDraft.updateMany({
      where: { id, tenantId, status: 'DRAFT' },
      data:  { status: 'POSTING' },
    });
    if (claimed.count === 0) throw new ConflictException('This draft is being received right now.');

    const outcomes: LineOutcome[] = [];
    try {
      const lines = draft.lines as unknown as ReceivingLine[];
      const firstTry = draft.result == null;

      // Received since it was drafted (on the screen, or another draft)?
      // Asked again only before anything of this draft is in.
      const vendor = draft.vendorId
        ? await this.prisma.vendor.findFirst({ where: { id: draft.vendorId, tenantId }, select: { id: true } })
          ?? await matchVendor(this.prisma, tenantId, draft.supplierName, draft.supplierTin)
        : await matchVendor(this.prisma, tenantId, draft.supplierName, draft.supplierTin);
      if (firstTry) {
        const dup = await findDuplicateInvoice(this.prisma, tenantId, {
          invoiceNumber: draft.invoiceNumber, vendorId: vendor?.id ?? null,
          supplierName: draft.supplierName, supplierTin: draft.supplierTin,
          itemIds: lines.map((l) => l.itemId), excludeDraftId: draft.id,
        });
        if (dup) throw new ConflictException(dup);
      }
      // A supplier new to the shop is added from the invoice, so the bill has someone to be owed to.
      const vendorId = vendor?.id ?? (await this.prisma.vendor.create({
        data:   { tenantId, name: draft.supplierName, tin: draft.supplierTin ?? null },
        select: { id: true },
      })).id;

      const poItems = draft.purchaseOrderId
        ? await this.prisma.purchaseOrderItem.findMany({
            where:  { purchaseOrderId: draft.purchaseOrderId, purchaseOrder: { tenantId } },
            select: { id: true, rawMaterialId: true },
          })
        : [];
      const termsDays = draft.dueDate
        ? Math.max(0, Math.round((draft.dueDate.getTime() - draft.invoiceDate.getTime()) / DAY_MS))
        : 0;
      // The invoice's day, at midday Manila: the day the books date it, whatever the clock.
      const receivedAt = new Date(draft.invoiceDate.getTime() + 12 * 60 * 60 * 1000).toISOString();

      for (const line of lines) {
        const poItem = poItems.find((p) => p.rawMaterialId === line.itemId);
        try {
          const r = await this.inventory.receiveRawMaterial(tenantId, line.itemId, {
            branchId:        draft.branchId,
            quantity:        Number(line.qty),
            costPrice:       chargedUnitCost(line, draft.vatable),
            paymentMethod:   'CREDIT',
            vendorId,
            termsDays,
            receivedAt,
            referenceNumber: draft.invoiceNumber,
            note:            `Invoice ${draft.invoiceNumber} from ${draft.supplierName} (draft ${draft.reference})`,
            ...(opts.acceptCostChange === true ? { acceptCostChange: true } : {}),
            ...(poItem ? { purchaseOrderItemId: poItem.id } : {}),
          } as never) as { duplicate?: boolean; quantityAfter?: number };
          if (r.duplicate) {
            outcomes.push({ itemId: line.itemId, outcome: 'ALREADY_POSTED' });
          } else {
            outcomes.push({ itemId: line.itemId, outcome: 'POSTED', quantityAfter: Number(r.quantityAfter ?? 0) });
            if (poItem) await this.receivedOnPo(draft.purchaseOrderId!, poItem.id, line.qty);
          }
        } catch (err) {
          outcomes.push({ itemId: line.itemId, outcome: 'FAILED', reason: err instanceof Error ? err.message : 'Could not receive this line.' });
        }
      }
    } catch (err) {
      await this.prisma.receivingDraft.updateMany({ where: { id, tenantId, status: 'POSTING' }, data: { status: 'DRAFT' } });
      throw err;
    }

    const done = outcomes.every((o) => o.outcome !== 'FAILED');
    const updated = await this.prisma.receivingDraft.update({
      where: { id },
      data:  {
        status: done ? 'CONFIRMED' : 'DRAFT',
        result: outcomes as unknown as Prisma.InputJsonValue,
        ...(done ? { confirmedById: userId, confirmedAt: new Date() } : {}),
      },
    });
    return { ...updated, lines: outcomes };
  }

  /** Discard a draft nothing of which has been received. */
  async cancel(tenantId: string, id: string) {
    const draft = await this.get(tenantId, id);
    const anyIn = ((draft.result ?? []) as unknown as LineOutcome[]).some((o) => o.outcome !== 'FAILED');
    if (draft.status !== 'DRAFT' || anyIn) {
      throw new BadRequestException('Only a draft nothing of which is received can be discarded.');
    }
    const r = await this.prisma.receivingDraft.updateMany({ where: { id, tenantId, status: 'DRAFT' }, data: { status: 'CANCELLED' } });
    if (r.count === 0) throw new ConflictException('This draft changed a moment ago; open it again.');
    return { id, status: 'CANCELLED' };
  }

  /** The PO's own bookkeeping, as PurchaseOrdersService.receive keeps it: quantity received, then its status. */
  private async receivedOnPo(purchaseOrderId: string, itemId: string, qty: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.update({ where: { id: itemId }, data: { qtyReceived: { increment: new Prisma.Decimal(qty) } } });
      const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId }, select: { qtyOrdered: true, qtyReceived: true } });
      const full = items.every((r) => Number(r.qtyReceived) >= Number(r.qtyOrdered) - 1e-6);
      const any = items.some((r) => Number(r.qtyReceived) > 0);
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data:  { status: full ? 'RECEIVED' : any ? 'PARTIAL' : undefined },
      });
    });
  }
}

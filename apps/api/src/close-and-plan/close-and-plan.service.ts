/**
 * Close & Plan — service layer for the bakery evening routine.
 *
 * The Close & Plan flow is the operating cadence of a small bakery: at
 * night the owner reviews today, plans tomorrow, optionally enters any
 * deliveries, and prints a morning briefing for the cook. Daytime stays
 * pure POS — no inventory entry, no decisions. This service powers all
 * three: day summary, batch-receive with duplicate detection, and the
 * briefing build.
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StickerTier, Prisma } from '@prisma/client';
import { detectDuplicateLot, type DuplicateCandidate } from './duplicate-detection';
import { recomputeStickerTiersForItem } from './sticker-tier';
import {
  formatBriefingText,
  formatBriefingEscPos,
  type BriefingInput,
  type BriefingBakeItem,
  type BriefingUseFirstItem,
  type BriefingPickup,
} from './briefing-formatter';

export interface DaySummary {
  date:               string;
  bakeryName:         string;
  grossSalesCents:    number;
  netSalesCents:      number;
  orderCount:         number;
  voidCount:          number;
  varianceCents:      number | null;
  shiftStatus:        'OPEN' | 'CLOSED' | 'NONE';
  bakeListTomorrow:   BriefingBakeItem[];
  useFirstTomorrow:   BriefingUseFirstItem[];
  pickupsTomorrow:    BriefingPickup[];
  /** Pending pre-orders for tomorrow. */
  pickupsCount:       number;
  /** Active lots whose tier changed since last print → need reprint. */
  stickersNeedingReprint: number;
}

export interface ReceiveLineInput {
  rawMaterialId:    string;
  qtyReceived:      number;
  unitCost:         number;
  expirationDate?:  string | null;     // ISO date
  referenceNumber?: string;
  /** When true, save even if duplicate detection flags it. */
  dupeOverride?:    boolean;
}

export interface ReceiveResult {
  saved:            { lotId: string; rawMaterialId: string; stickerTier: StickerTier }[];
  duplicates:       { rawMaterialId: string; candidates: DuplicateCandidate[] }[];
}

@Injectable()
export class CloseAndPlanService {
  constructor(private prisma: PrismaService) {}

  // ─── Day summary ──────────────────────────────────────────────────────

  async getDaySummary(tenantId: string, branchId: string, dateISO?: string): Promise<DaySummary> {
    const day = dateISO ? new Date(dateISO) : new Date();
    const startOfDay = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0));
    const endOfDay   = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999));
    const tomorrow   = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowEnd = new Date(endOfDay.getTime() + 24 * 60 * 60 * 1000);

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { name: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    // Today's sales aggregate
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      select: { totalAmount: true, status: true },
    });
    const orderCount      = orders.length;
    const voidCount       = orders.filter((o) => o.status === 'VOIDED').length;
    const grossSalesCents = Math.round(
      orders
        .filter((o) => o.status !== 'VOIDED')
        .reduce((s, o) => s + Number(o.totalAmount), 0) * 100,
    );

    // Open shift / variance
    const shift = await this.prisma.shift.findFirst({
      where:   { tenantId, branchId, closedAt: null },
      orderBy: { openedAt: 'desc' },
      select:  { id: true, openedAt: true },
    });
    const shiftStatus: 'OPEN' | 'CLOSED' | 'NONE' = shift ? 'OPEN' : orderCount > 0 ? 'CLOSED' : 'NONE';

    // Stickers needing reprint
    const stickersNeedingReprint = await this.prisma.rawMaterialLot.count({
      where: {
        tenantId,
        branchId,
        qtyRemaining: { gt: 0 },
        stickerTier:  { in: [StickerTier.USE_FIRST, StickerTier.EXPIRING_SOON, StickerTier.EXPIRED] },
        stickerLastPrintedAt: null,
      },
    });

    // Tomorrow's plan
    const bakeListTomorrow = await this.buildBakeListForDate(tenantId, branchId, tomorrow);
    const useFirstTomorrow = await this.buildUseFirstForDate(tenantId, branchId, tomorrow);
    const pickupsTomorrow  = await this.buildPickupsForDate(tenantId, branchId, tomorrow, tomorrowEnd);

    return {
      date:                  startOfDay.toISOString().split('T')[0],
      bakeryName:            tenant.name,
      grossSalesCents,
      netSalesCents:         grossSalesCents, // discounts already netted in totalAmount
      orderCount,
      voidCount,
      varianceCents:         null,            // computed at shift close
      shiftStatus,
      bakeListTomorrow,
      useFirstTomorrow,
      pickupsTomorrow,
      pickupsCount:          pickupsTomorrow.length,
      stickersNeedingReprint,
    };
  }

  // ─── Tomorrow's bake list ─────────────────────────────────────────────

  private async buildBakeListForDate(
    tenantId: string,
    branchId: string,
    targetDate: Date,
  ): Promise<BriefingBakeItem[]> {
    // Rolling 7-day average of sales per product for this branch.
    // Plus tomorrow's pre-orders consumption per product (linked via items).
    const sevenDaysAgo = new Date(targetDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const recentOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        status:    { notIn: ['VOIDED'] },
        createdAt: { gte: sevenDaysAgo, lte: targetDate },
      },
      select: {
        items: {
          select: {
            productId:   true,
            productName: true,
            quantity:    true,
          },
        },
      },
    });

    const totals = new Map<string, { name: string; qty: number }>();
    for (const order of recentOrders) {
      for (const item of order.items) {
        const existing = totals.get(item.productId) ?? { name: item.productName, qty: 0 };
        existing.qty += Number(item.quantity);
        totals.set(item.productId, existing);
      }
    }

    const bakeList: BriefingBakeItem[] = [];
    for (const { name, qty } of totals.values()) {
      const dailyAvg = Math.ceil(qty / 7);
      if (dailyAvg <= 0) continue;
      bakeList.push({
        productName:    name,
        recommendedQty: dailyAvg,
        reason:         `7-day avg: ${Math.round((qty / 7) * 10) / 10}/day`,
      });
    }
    bakeList.sort((a, b) => b.recommendedQty - a.recommendedQty);
    return bakeList.slice(0, 12); // cap for legibility
  }

  // ─── Use-first list for tomorrow ──────────────────────────────────────

  private async buildUseFirstForDate(
    tenantId: string,
    branchId: string,
    targetDate: Date,
  ): Promise<BriefingUseFirstItem[]> {
    const lots = await this.prisma.rawMaterialLot.findMany({
      where: {
        tenantId,
        branchId,
        qtyRemaining: { gt: 0 },
        stickerTier:  { in: [StickerTier.USE_FIRST, StickerTier.EXPIRING_SOON, StickerTier.EXPIRED] },
      },
      include: {
        rawMaterial: { select: { name: true, unit: true } },
      },
      orderBy: [{ stickerTier: 'asc' }, { expirationDate: 'asc' }],
      take: 20,
    });

    return lots.map((lot) => ({
      rawMaterialName: lot.rawMaterial.name,
      lotCode:         lot.id.slice(-8).toUpperCase(),
      qtyRemaining:    Number(lot.qtyRemaining),
      unit:            lot.rawMaterial.unit ?? '',
      expirationDate:  lot.expirationDate,
      tier:            lot.stickerTier ?? StickerTier.NORMAL,
    }));
  }

  // ─── Pickups for tomorrow ─────────────────────────────────────────────

  private async buildPickupsForDate(
    tenantId: string,
    branchId: string,
    targetStart: Date,
    targetEnd: Date,
  ): Promise<BriefingPickup[]> {
    const preOrders = await this.prisma.preOrder.findMany({
      where: {
        tenantId,
        branchId,
        pickupDate: { gte: targetStart, lte: targetEnd },
        status: { in: ['DEPOSIT_PAID', 'READY', 'DRAFT'] },
      },
      include: { customer: { select: { name: true } } },
      orderBy: { pickupDate: 'asc' },
    });

    return preOrders.map((p) => {
      const time = p.pickupTime ?? '—';
      const balancePeso = p.balanceCents / 100;
      const summary = p.inscription
        ? `"${p.inscription.slice(0, 40)}"`
        : p.notes
          ? p.notes.slice(0, 40)
          : `pre-order ${p.preOrderNumber}`;
      const details = balancePeso > 0
        ? `${summary} · balance P${balancePeso.toFixed(2)}`
        : `${summary} · paid in full`;
      return {
        time,
        customerName: p.customer?.name ?? 'Walk-in',
        details,
      };
    });
  }

  // ─── Batch receive (with duplicate detection) ─────────────────────────

  async batchReceive(
    tenantId: string,
    branchId: string,
    cashierId: string,
    lines: ReceiveLineInput[],
  ): Promise<ReceiveResult> {
    if (lines.length === 0) {
      throw new BadRequestException('No lines to receive.');
    }

    // Validate every rawMaterialId belongs to this tenant.
    const materialIds = Array.from(new Set(lines.map((l) => l.rawMaterialId)));
    const ownedMaterials = await this.prisma.rawMaterial.findMany({
      where:  { id: { in: materialIds }, tenantId },
      select: { id: true, name: true },
    });
    if (ownedMaterials.length !== materialIds.length) {
      throw new BadRequestException('One or more raw materials do not belong to your organization.');
    }

    // Validate branch belongs to tenant.
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException('Branch does not belong to your organization.');
    }

    // Run duplicate detection per line. Lines without dupeOverride that
    // hit candidates get returned as warnings; the caller can re-submit
    // with dupeOverride=true to save anyway.
    const duplicates: ReceiveResult['duplicates'] = [];
    const linesToSave: ReceiveLineInput[] = [];
    for (const line of lines) {
      if (line.dupeOverride) {
        linesToSave.push(line);
        continue;
      }
      const candidates = await detectDuplicateLot(this.prisma, {
        tenantId,
        branchId,
        rawMaterialId:  line.rawMaterialId,
        qtyReceived:    line.qtyReceived,
        expirationDate: line.expirationDate ? new Date(line.expirationDate) : null,
      });
      if (candidates.length > 0) {
        duplicates.push({ rawMaterialId: line.rawMaterialId, candidates });
      } else {
        linesToSave.push(line);
      }
    }

    // If anything was flagged AND nothing was already overridden, return
    // duplicates without saving anything — let the UI confirm first.
    if (duplicates.length > 0 && linesToSave.length === 0) {
      return { saved: [], duplicates };
    }

    // Create the surviving lots in a single transaction. WAC recompute
    // and stocked-in event go through the existing InventoryService
    // pathway (not duplicated here).
    const saved: ReceiveResult['saved'] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const line of linesToSave) {
        const lot = await tx.rawMaterialLot.create({
          data: {
            tenantId,
            branchId,
            rawMaterialId:    line.rawMaterialId,
            qtyReceived:      new Prisma.Decimal(line.qtyReceived),
            qtyRemaining:     new Prisma.Decimal(line.qtyReceived),
            unitCost:         new Prisma.Decimal(line.unitCost),
            receivedAt:       new Date(),
            expirationDate:   line.expirationDate ? new Date(line.expirationDate) : null,
            referenceNumber:  line.referenceNumber,
            dupeOverride:     !!line.dupeOverride,
            stickerTier:      StickerTier.NORMAL, // recomputed below
          },
        });
        saved.push({
          lotId:         lot.id,
          rawMaterialId: line.rawMaterialId,
          stickerTier:   StickerTier.NORMAL,
        });
      }
    });

    // Recompute sticker tiers per affected (rawMaterialId, branchId).
    const affectedItems = Array.from(new Set(linesToSave.map((l) => l.rawMaterialId)));
    for (const rmId of affectedItems) {
      const changes = await recomputeStickerTiersForItem(this.prisma, rmId, branchId);
      for (const change of changes) {
        const saveRow = saved.find((s) => s.lotId === change.id);
        if (saveRow) saveRow.stickerTier = change.newTier;
      }
    }

    return { saved, duplicates };
  }

  // ─── Briefing builder ─────────────────────────────────────────────────

  async buildBriefing(tenantId: string, branchId: string, dateISO?: string): Promise<BriefingInput> {
    const summary = await this.getDaySummary(tenantId, branchId, dateISO);
    return {
      bakeryName: summary.bakeryName,
      date:       new Date(`${summary.date}T00:00:00+08:00`),
      bakeList:   summary.bakeListTomorrow,
      useFirst:   summary.useFirstTomorrow,
      pickups:    summary.pickupsTomorrow,
    };
  }

  async buildBriefingText(tenantId: string, branchId: string, dateISO?: string): Promise<string> {
    const input = await this.buildBriefing(tenantId, branchId, dateISO);
    return formatBriefingText(input);
  }

  /**
   * Build the ESC/POS byte stream. We import EscPosBuilder dynamically
   * from the counter package so the API doesn't carry a hard runtime dep
   * on counter's printer module — useful when the API runs in a Worker
   * dyno that doesn't bundle that code.
   */
  async buildBriefingEscPos(
    tenantId: string,
    branchId: string,
    EscPosBuilder: any,
    dateISO?: string,
  ): Promise<Uint8Array> {
    const input = await this.buildBriefing(tenantId, branchId, dateISO);
    // Mark stickers as printed.
    await this.prisma.rawMaterialLot.updateMany({
      where: {
        tenantId,
        branchId,
        qtyRemaining: { gt: 0 },
        stickerTier:  { in: [StickerTier.USE_FIRST, StickerTier.EXPIRING_SOON, StickerTier.EXPIRED] },
        stickerLastPrintedAt: null,
      },
      data: { stickerLastPrintedAt: new Date() },
    });
    return formatBriefingEscPos(input, EscPosBuilder);
  }

  // ─── Check duplicate (standalone — for the UI's live warning) ─────────

  async checkDuplicate(
    tenantId: string,
    branchId: string,
    input: {
      rawMaterialId:  string;
      qtyReceived:    number;
      expirationDate?: string | null;
    },
  ): Promise<DuplicateCandidate[]> {
    return detectDuplicateLot(this.prisma, {
      tenantId,
      branchId,
      rawMaterialId:  input.rawMaterialId,
      qtyReceived:    input.qtyReceived,
      expirationDate: input.expirationDate ? new Date(input.expirationDate) : null,
    });
  }
}

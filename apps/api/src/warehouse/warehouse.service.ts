import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, StockTransferStatus, CycleCountStatus } from '@prisma/client';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';

// ── Stock Transfer DTOs ────────────────────────────────────────────────────────

export interface CreateTransferDto {
  fromBranchId: string;
  toBranchId:   string;
  notes?:       string;
  lines: Array<{ rawMaterialId: string; quantity: number; notes?: string }>;
}

@Injectable()
export class WarehouseService {
  constructor(
    private prisma: PrismaService,
    /*
      Posting a count moves stock AND writes to the books, so it has to respect
      the same period lock every other stock movement does. `receiveRawMaterial`
      and `writeOffRawMaterial` both check before any write; this path was
      reimplemented against Prisma directly and never did, so a count could
      restate a month that was already closed and reconciled — and the only
      sign would be last month's numbers quietly moving.

      Optional so an older wiring that constructs this service with Prisma
      alone still boots. When it is absent the check is skipped rather than
      throwing, which is the behaviour that existed before it was injected.
    */
    @Optional() private readonly periods?: AccountingPeriodsService,
  ) {}

  // ── Numbering helpers (per-tenant per-year, race-safe within tx) ─────────
  private async nextTransferNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `ST-${year}-`;
    const last = await tx.stockTransfer.findFirst({
      where:   { tenantId, transferNumber: { startsWith: prefix } },
      orderBy: { transferNumber: 'desc' },
      select:  { transferNumber: true },
    });
    const seq = (last ? parseInt(last.transferNumber.slice(prefix.length), 10) : 0) + 1;
    return `${prefix}${String(seq).padStart(6, '0')}`;
  }

  private async nextCountNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `CC-${year}-`;
    const last = await tx.cycleCount.findFirst({
      where:   { tenantId, countNumber: { startsWith: prefix } },
      orderBy: { countNumber: 'desc' },
      select:  { countNumber: true },
    });
    const seq = (last ? parseInt(last.countNumber.slice(prefix.length), 10) : 0) + 1;
    return `${prefix}${String(seq).padStart(6, '0')}`;
  }

  // ── Stock Transfers ──────────────────────────────────────────────────────

  /**
   * Creates a DRAFT stock transfer with lines pre-priced at the source
   * branch's current WAC (pulled from RawMaterial.costPrice). Status flows:
   *   DRAFT → IN_TRANSIT (send) → RECEIVED (book at destination)
   *   DRAFT/IN_TRANSIT → CANCELLED
   */
  async createTransfer(tenantId: string, userId: string, dto: CreateTransferDto) {
    if (dto.fromBranchId === dto.toBranchId) {
      throw new BadRequestException('From and To branches must differ.');
    }
    if (!dto.lines.length) {
      throw new BadRequestException('At least one line is required.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Validate both branches in this tenant.
      const branches = await tx.branch.findMany({
        where:  { id: { in: [dto.fromBranchId, dto.toBranchId] }, tenantId },
        select: { id: true },
      });
      if (branches.length !== 2) {
        throw new BadRequestException('Branches not found in this tenant.');
      }

      // Resolve cost prices.
      const rmIds = dto.lines.map((l) => l.rawMaterialId);
      const rms = await tx.rawMaterial.findMany({
        where:  { id: { in: rmIds }, tenantId },
        select: { id: true, costPrice: true },
      });
      if (rms.length !== rmIds.length) {
        throw new BadRequestException('One or more raw materials not found.');
      }
      const costByRm = new Map(rms.map((r) => [r.id, Number(r.costPrice ?? 0)]));

      const transferNumber = await this.nextTransferNumber(tx, tenantId);
      return tx.stockTransfer.create({
        data: {
          tenantId,
          transferNumber,
          fromBranchId: dto.fromBranchId,
          toBranchId:   dto.toBranchId,
          status:       'DRAFT',
          notes:        dto.notes ?? null,
          createdById:  userId,
          lines: {
            create: dto.lines.map((l) => ({
              rawMaterialId: l.rawMaterialId,
              quantity:      new Prisma.Decimal(l.quantity),
              unitCost:      new Prisma.Decimal(costByRm.get(l.rawMaterialId) ?? 0),
              notes:         l.notes ?? null,
            })),
          },
        },
        include: { lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      });
    });
  }

  async listTransfers(tenantId: string, status?: StockTransferStatus) {
    return this.prisma.stockTransfer.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch:   { select: { id: true, name: true } },
        _count:     { select: { lines: true } },
      },
    });
  }

  async getTransfer(tenantId: string, id: string) {
    const t = await this.prisma.stockTransfer.findFirst({
      where: { id, tenantId },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch:   { select: { id: true, name: true } },
        lines:      { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
      },
    });
    if (!t) throw new NotFoundException('Transfer not found.');
    return t;
  }

  /** Send: deducts from source RawMaterialInventory; status → IN_TRANSIT.
   *
   *  Race-safe: uses an atomic status-conditional updateMany to claim the
   *  DRAFT row before any inventory math runs. Two concurrent send calls
   *  cannot both pass — the second sees status already changed and aborts.
   */
  async sendTransfer(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Atomic claim: flip DRAFT → IN_TRANSIT only if currently DRAFT. If
      // someone else already sent it, this returns count=0 and we abort.
      const claimed = await tx.stockTransfer.updateMany({
        where: { id, tenantId, status: 'DRAFT' },
        data:  { status: 'IN_TRANSIT', sentAt: new Date() },
      });
      if (claimed.count === 0) {
        const existing = await tx.stockTransfer.findFirst({
          where: { id, tenantId },
          select: { status: true },
        });
        if (!existing) throw new NotFoundException('Transfer not found.');
        throw new BadRequestException(`Only DRAFT transfers can be sent (current: ${existing.status}).`);
      }

      const t = await tx.stockTransfer.findFirstOrThrow({
        where:   { id, tenantId },
        include: { lines: true },
      });

      for (const line of t.lines) {
        const inv = await tx.rawMaterialInventory.findUnique({
          where: { branchId_rawMaterialId: { branchId: t.fromBranchId, rawMaterialId: line.rawMaterialId } },
        });
        const onHand = Number(inv?.quantity ?? 0);
        if (onHand < Number(line.quantity)) {
          // Roll the status flip back so the caller can retry after restocking.
          await tx.stockTransfer.update({ where: { id }, data: { status: 'DRAFT', sentAt: null } });
          throw new BadRequestException(
            `Insufficient stock at source for raw-material ${line.rawMaterialId}: have ${onHand}, need ${line.quantity}.`,
          );
        }
        await tx.rawMaterialInventory.update({
          where: { branchId_rawMaterialId: { branchId: t.fromBranchId, rawMaterialId: line.rawMaterialId } },
          data:  { quantity: { decrement: line.quantity } },
        });
      }

      return t;
    });
  }

  /** Receive: increments destination inventory; status → RECEIVED.
   *  Atomic IN_TRANSIT → RECEIVED claim prevents double-receive races.
   */
  async receiveTransfer(tenantId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockTransfer.updateMany({
        where: { id, tenantId, status: 'IN_TRANSIT' },
        data:  { status: 'RECEIVED', receivedAt: new Date(), receivedById: userId },
      });
      if (claimed.count === 0) {
        const existing = await tx.stockTransfer.findFirst({ where: { id, tenantId }, select: { status: true } });
        if (!existing) throw new NotFoundException('Transfer not found.');
        throw new BadRequestException(`Only IN_TRANSIT transfers can be received (current: ${existing.status}).`);
      }

      const t = await tx.stockTransfer.findFirstOrThrow({
        where:   { id, tenantId },
        include: { lines: true },
      });

      for (const line of t.lines) {
        await tx.rawMaterialInventory.upsert({
          where:  { branchId_rawMaterialId: { branchId: t.toBranchId, rawMaterialId: line.rawMaterialId } },
          create: {
            tenantId, branchId: t.toBranchId, rawMaterialId: line.rawMaterialId,
            quantity: line.quantity,
          },
          update: { quantity: { increment: line.quantity } },
        });
      }

      return t;
    });
  }

  async cancelTransfer(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Atomic claim: only DRAFT or IN_TRANSIT can transition to CANCELLED.
      // A double-cancel race sees count=0 on the second call and aborts
      // before any double-refund of inventory.
      const claimed = await tx.stockTransfer.updateMany({
        where: { id, tenantId, status: { in: ['DRAFT', 'IN_TRANSIT'] } },
        data:  { status: 'CANCELLED' },
      });
      if (claimed.count === 0) {
        const existing = await tx.stockTransfer.findFirst({ where: { id, tenantId }, select: { status: true } });
        if (!existing) throw new NotFoundException('Transfer not found.');
        throw new BadRequestException(`Cannot cancel a ${existing.status} transfer.`);
      }

      const t = await tx.stockTransfer.findFirstOrThrow({
        where:   { id, tenantId },
        // Use a fresh load — we need the PRE-cancel sentAt to know whether
        // inventory was already deducted at source.
        include: { lines: true },
      });

      // If the transfer was already IN_TRANSIT, refund source inventory.
      if (t.sentAt) {
        for (const line of t.lines) {
          await tx.rawMaterialInventory.update({
            where: { branchId_rawMaterialId: { branchId: t.fromBranchId, rawMaterialId: line.rawMaterialId } },
            data:  { quantity: { increment: line.quantity } },
          });
        }
      }

      return t;
    });
  }

  // ── Cycle Counts ─────────────────────────────────────────────────────────

  /**
   * Starts a cycle count for a branch. Snapshots the current
   * RawMaterialInventory.quantity for every active raw material as
   * `expectedQty`. Counter then enters `countedQty` per line. On post,
   * variances become InventoryLog adjustments and RawMaterialInventory
   * updates atomically.
   */
  async startCycleCount(tenantId: string, branchId: string, userId: string, notes?: string) {
    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: branchId, tenantId } });
      if (!branch) throw new BadRequestException('Branch not found.');

      /*
        Count what the shop STOCKS, not what the system already has a row for.

        Seeding from RawMaterialInventory meant a shop that had never received
        an ingredient had no line for it, and a shop that had never received
        ANYTHING got "No raw materials in inventory at this branch" and could
        not open a count at all. That is precisely the shop doing its first
        count: 53 ingredients on the shelf, zero inventory rows, and the
        documented route to opening stock refusing to start. The upsert added
        inside postCycleCount to handle exactly that case was unreachable.

        An ingredient with no row is not "does not exist", it is zero — which
        is also the honest expected figure for a first count.

        Supplies are included deliberately. They are expensed on receipt so a
        variance posts nothing to the books, but a shop still needs to know how
        much bleach is on the shelf.
      */
      const materials = await tx.rawMaterial.findMany({
        where:  { tenantId, isActive: true },
        select: { id: true },
        orderBy: { name: 'asc' },
      });
      if (!materials.length) {
        throw new BadRequestException(
          'There are no ingredients to count yet. Add them under Stock on hand first.',
        );
      }

      const onHand = new Map(
        (await tx.rawMaterialInventory.findMany({
          where:  { tenantId, branchId },
          select: { rawMaterialId: true, quantity: true },
        })).map((i) => [i.rawMaterialId, i.quantity]),
      );

      const countNumber = await this.nextCountNumber(tx, tenantId);
      return tx.cycleCount.create({
        data: {
          tenantId, branchId, countNumber,
          status: 'OPEN', notes: notes ?? null, startedById: userId,
          lines: {
            create: materials.map((m) => {
              const qty = onHand.get(m.id) ?? new Prisma.Decimal(0);
              return {
                rawMaterialId: m.id,
                expectedQty:   qty,
                countedQty:    qty, // operator updates this
              };
            }),
          },
        },
        include: { lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      });
    });
  }

  async listCycleCounts(tenantId: string, status?: CycleCountStatus) {
    return this.prisma.cycleCount.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
    });
  }

  async getCycleCount(tenantId: string, id: string) {
    const c = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId },
      include: {
        branch: { select: { id: true, name: true } },
        lines:  { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
      },
    });
    if (!c) throw new NotFoundException('Cycle count not found.');
    return c;
  }

  /** Operator enters/updates the counted qty for a line. */
  async setLineCount(tenantId: string, lineId: string, countedQty: number) {
    if (!Number.isFinite(countedQty) || countedQty < 0) {
      throw new BadRequestException('countedQty must be a non-negative number.');
    }
    const line = await this.prisma.cycleCountLine.findFirst({
      where: { id: lineId, count: { tenantId, status: 'OPEN' } },
    });
    if (!line) throw new NotFoundException('Line not found or count is not OPEN.');
    // Use Prisma.Decimal arithmetic to preserve precision for high-volume kg.
    const counted  = new Prisma.Decimal(countedQty);
    const expected = new Prisma.Decimal(line.expectedQty);
    return this.prisma.cycleCountLine.update({
      where: { id: lineId },
      data:  {
        countedQty:  counted,
        varianceQty: counted.minus(expected),
      },
    });
  }

  /**
   * Post the count: applies variances to RawMaterialInventory and writes
   * InventoryLog rows. Skips lines with zero variance.
   */
  async postCycleCount(tenantId: string, id: string, userId: string, isOpeningBalance = false) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.cycleCount.findFirst({
        where:   { id, tenantId },
        // The raw material comes along so the variance can be VALUED and
        // routed. Counting the shelf is the one thing that is supposed to
        // make stock and the books agree, and this method used to move only
        // the stock -- it never created an AccountingEvent, so every count
        // pushed the two further apart instead.
        include: { lines: { include: { rawMaterial: {
          select: { id: true, name: true, unit: true, costPrice: true, category: true },
        } } } },
      });
      if (!c) throw new NotFoundException('Cycle count not found.');
      if (c.status !== 'OPEN') {
        throw new BadRequestException(`Only OPEN counts can be posted (current: ${c.status}).`);
      }

      /*
        Checked BEFORE any line is written, not per line: a count is one event
        on one date, and half a posted count is worse than none — the stock
        would have moved for some ingredients and not others with no record of
        where it stopped.
      */
      if (this.periods) {
        await this.periods.assertDateIsOpen(tenantId, c.postedAt ?? new Date());
      }

      for (const line of c.lines) {
        const counted  = new Prisma.Decimal(line.countedQty);
        const expected = new Prisma.Decimal(line.expectedQty);
        const variance = counted.minus(expected);

        // Skip zero-variance (within 1g / 1ml precision).
        if (variance.abs().lessThan(new Prisma.Decimal('0.001'))) continue;

        // Refuse to post a count that would drive inventory negative.
        if (counted.lessThan(0)) {
          throw new BadRequestException(
            `Line ${line.id}: counted quantity ${counted} cannot be negative.`,
          );
        }

        /*
          Apply what the count FOUND to what is on the shelf NOW.

          `expectedQty` is a snapshot taken when the count was STARTED, and a
          count is not instant: someone walks the stockroom with a tablet while
          the till keeps selling. Writing `counted` straight over the quantity
          silently reversed every sale that happened in between -- count 500 g
          of beans at 3pm, sell 100 g, post at 5pm, and the shelf goes back to
          500 while COGS has already relieved the 100. The stock ledger and the
          books disagree from then on, and nothing says so.

          The variance is still measured against the snapshot, because that IS
          the discrepancy the counter discovered. It is the APPLICATION that
          has to be relative: live + variance. With no movements in between,
          live equals expected and this lands on `counted` exactly as before.
        */
        const liveRow = await tx.rawMaterialInventory.findUnique({
          where:  { branchId_rawMaterialId: { branchId: c.branchId, rawMaterialId: line.rawMaterialId } },
          select: { quantity: true },
        });
        const live = liveRow ? new Prisma.Decimal(liveRow.quantity) : new Prisma.Decimal(0);
        // Never negative: a correction cannot drive the shelf below empty.
        const settled = Prisma.Decimal.max(live.plus(variance), new Prisma.Decimal(0));

        // upsert, not update.
        //
        // A shop that has never received an ingredient has no
        // RawMaterialInventory row for it, and `update` on a compound key
        // throws P2025 when the row is absent. That is precisely the shop
        // doing its FIRST count: Cafe Carolina has 53 ingredients and zero
        // inventory rows, so posting their opening count failed on line one.
        //
        // Counting is also the only way an ingredient's quantity can be
        // corrected — `adjust` takes a productId and validates against
        // Product, so it does not reach raw materials at all. Refusing to
        // create the row therefore left no path to opening stock except
        // recording purchases that never happened.
        await tx.rawMaterialInventory.upsert({
          where:  { branchId_rawMaterialId: { branchId: c.branchId, rawMaterialId: line.rawMaterialId } },
          update: { quantity: settled },
          create: {
            tenantId,
            branchId:      c.branchId,
            rawMaterialId: line.rawMaterialId,
            // No row yet means nothing has moved, so there is nothing to
            // preserve and the count is the whole truth.
            quantity:      counted,
          },
        });
        await tx.cycleCountLine.update({
          where: { id: line.id },
          data:  { varianceQty: variance },
        });

        /*
          Tell the books what the count found.

          Emitted as an ordinary INVENTORY_ADJUSTMENT so it goes through the
          same routing as every other stock movement: an ingredient hits its
          asset account, a supply that was already expensed on receipt posts
          nothing at all, and COUNT_CORRECTION lands in 5060 rather than being
          buried in cost of sale.

          Valued at the material's own cost. A variance with no cost price is
          a quantity correction the books cannot express, so no event is
          created rather than one worth zero.
        */
        const unitCost = Number(line.rawMaterial?.costPrice ?? 0);
        const varianceQty = Number(variance);
        if (unitCost > 0) {
          await tx.accountingEvent.create({
            data: {
              tenantId,
              type:    'INVENTORY_ADJUSTMENT',
              status:  'PENDING',
              payload: {
                kind:            'RAW_MATERIAL_RECEIPT',
                rawMaterialId:   line.rawMaterialId,
                rawMaterialName: line.rawMaterial?.name ?? 'Ingredient',
                category:        line.rawMaterial?.category ?? null,
                unit:            line.rawMaterial?.unit ?? '',
                quantity:        varianceQty,               // signed: + found, - missing
                unitCost,
                totalValue:      Math.abs(varianceQty) * unitCost * (varianceQty < 0 ? -1 : 1),
                branchId:        c.branchId,
                /*
                  An opening count is not a correction — nothing was wrong.
                  It is the owner putting goods into the business, so it
                  credits Owner's Capital rather than reversing a write-off
                  that never happened.
                */
                reasonCode:      isOpeningBalance ? 'OPENING_BALANCE' : 'COUNT_CORRECTION',
                referenceNumber: c.countNumber ?? null,
                // Legacy fields the journal handler reads
                productName:     line.rawMaterial?.name ?? 'Ingredient',
                adjustmentType:  isOpeningBalance ? 'OPENING_BALANCE' : 'COUNT_CORRECTION',
                reason:          isOpeningBalance
                  ? `Opening stock${c.countNumber ? ` ${c.countNumber}` : ''}`
                  : `Physical count${c.countNumber ? ` ${c.countNumber}` : ''}`,
              } as unknown as Prisma.JsonObject,
            },
          });
        }
      }

      return tx.cycleCount.update({
        where: { id },
        data:  { status: 'POSTED', postedAt: new Date(), postedById: userId },
        include: { lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      });
    });
  }
}

import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, StockTransferStatus, CycleCountStatus } from '@prisma/client';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { noCostWarning } from '../inventory/inventory.service';
import { availableQty, heldAt, heldUsage } from '../orders/held-usage';
import { releasedHolds } from './released-holds';

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

  /** CC-YYYY-NNNNNN. Public: a count can also be started one line at a time, from the buy list. */
  async nextCountNumber(tx: Prisma.TransactionClient | PrismaService, tenantId: string): Promise<string> {
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

      /*
        Tickets still waiting at a kitchen or bar screen at the source have not
        taken their ingredients off the books yet, but that milk is promised:
        the ready tap will take it. Letting a transfer carry it away would leave
        the tap with nothing to take and the next branch holding stock the
        first one already sold. So the check is against what is free; the
        decrement below is still the plain amount moved.
      */
      const held = await heldUsage(tx, tenantId, [t.fromBranchId], {
        rawMaterialIds: t.lines.map((l) => l.rawMaterialId),
      });

      for (const line of t.lines) {
        const inv = await tx.rawMaterialInventory.findUnique({
          where: { branchId_rawMaterialId: { branchId: t.fromBranchId, rawMaterialId: line.rawMaterialId } },
        });
        const onHand = Number(inv?.quantity ?? 0);
        const heldQty = heldAt(held, t.fromBranchId, line.rawMaterialId);
        const free = availableQty(onHand, heldQty);
        if (free < Number(line.quantity)) {
          // Roll the status flip back so the caller can retry after restocking.
          await tx.stockTransfer.update({ where: { id }, data: { status: 'DRAFT', sentAt: null } });
          throw new BadRequestException(
            heldQty > 0
              ? `Insufficient stock at source for raw-material ${line.rawMaterialId}: have ${onHand}, ` +
                `of which ${heldQty} is held for kitchen/bar tickets still waiting to be made, ` +
                `so ${free} can be sent; need ${line.quantity}.`
              : `Insufficient stock at source for raw-material ${line.rawMaterialId}: have ${onHand}, need ${line.quantity}.`,
          );
        }
        await tx.rawMaterialInventory.update({
          where: { branchId_rawMaterialId: { branchId: t.fromBranchId, rawMaterialId: line.rawMaterialId } },
          data:  { quantity: { decrement: line.quantity } },
        });
        // The lots leave with the stock, oldest first, or the source branch
        // keeps layers it no longer holds and its expiry order goes wrong.
        const drained = await this.drainLots(tx, t.fromBranchId, line.rawMaterialId, Number(line.quantity));
        /*
          What the stock actually cost on the shelf it left, not what the
          ingredient averages today. On a FIFO/FEFO shop those differ, and
          the destination lot is created from this number -- so without it
          value walks out of one branch at layer cost and arrives at the
          other at the running average, and the lot ledger drifts away from
          1051 a little on every transfer. Only when lots covered the move;
          a shop with no layers keeps the average it was created with.
        */
        if (drained.qty > 0) {
          await tx.stockTransferLine.update({
            where: { id: line.id },
            data:  { unitCost: new Prisma.Decimal((drained.value / drained.qty).toFixed(4)) },
          });
        }
      }

      // Re-read so the trail and the caller see the realised costs.
      const sent = await tx.stockTransfer.findFirstOrThrow({ where: { id, tenantId }, include: { lines: true } });
      await this.transferTrail(tx, tenantId, sent, 'OUT');
      return sent;
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
        // The stock arrives as a lot at exactly what it cost where it left
        // (send wrote the realised layer cost onto the line), so the
        // destination can drain it FEFO and the value that left is the
        // value that arrived.
        await tx.rawMaterialLot.create({
          data: {
            tenantId,
            branchId:        t.toBranchId,
            rawMaterialId:   line.rawMaterialId,
            qtyReceived:     line.quantity,
            qtyRemaining:    line.quantity,
            unitCost:        line.unitCost,
            receivedAt:      new Date(),
            referenceNumber: t.transferNumber,
            paymentMethod:   'OWNER_FUNDED',
          },
        });
      }

      await this.transferTrail(tx, tenantId, t, 'IN', { byId: userId });
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
          // The lots drained at send cannot be un-drained exactly; the stock
          // comes back as one fresh lot at the current unit cost.
          await tx.rawMaterialLot.create({
            data: {
              tenantId,
              branchId:        t.fromBranchId,
              rawMaterialId:   line.rawMaterialId,
              qtyReceived:     line.quantity,
              qtyRemaining:    line.quantity,
              unitCost:        line.unitCost,
              receivedAt:      new Date(),
              referenceNumber: `${t.transferNumber}-CANCELLED`,
              paymentMethod:   'OWNER_FUNDED',
            },
          });
        }
        await this.transferTrail(tx, tenantId, t, 'IN', { returned: true });
      }

      return t;
    });
  }

  // ── Cycle Counts ─────────────────────────────────────────────────────────

  /**
   * Starts a cycle count for a branch. Snapshots the current
   * RawMaterialInventory.quantity, less what waiting kitchen/bar tickets
   * hold, for every active raw material as `expectedQty`. Counter then
   * enters `countedQty` per line. On post,
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

      /*
        Expect the shelf to be short by what waiting kitchen/bar tickets hold.

        Those tickets have not taken their ingredients off the books yet -- the
        ready tap does that -- but the milk for a drink on the bar screen is in
        the jug, not in the carton the counter is looking at. Expecting the
        book figure would book it as missing now, and the tap would take it
        again later. Posting applies the variance relatively, so the tap that
        lands after the count still takes exactly its share. A ticket voided or
        refunded instead is never made, and posting gives its share back to
        what the count expected (releasedHolds).
      */
      const held = await heldUsage(tx, tenantId, [branchId]);

      const countNumber = await this.nextCountNumber(tx, tenantId);
      return tx.cycleCount.create({
        data: {
          tenantId, branchId, countNumber,
          status: 'OPEN', notes: notes ?? null, startedById: userId,
          lines: {
            create: materials.map((m) => {
              const book = new Prisma.Decimal(onHand.get(m.id) ?? 0);
              const heldQty = heldAt(held, branchId, m.id);
              // Nothing held keeps the book figure exactly as it was snapshotted before.
              const qty = heldQty > 0 ? Prisma.Decimal.max(book.minus(heldQty), 0) : book;
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
   *
   * An OPEN count, or a RECORDED one: a weekly count a kitchen or bar screen
   * sent, kept as a record until the owner adjusts the books from it.
   * `skipRawMaterialIds` leaves those items' lines exactly as they are -- no
   * stock change, no event, the variance as recorded. The weekly review
   * passes the items a later count has replaced (station-count.service.ts),
   * an empty list when there are none; the counts screen passes nothing, and
   * so cannot post a RECORDED count.
   */
  async postCycleCount(tenantId: string, id: string, userId: string, isOpeningBalance = false, skipRawMaterialIds?: string[]) {
    const skip = new Set(skipRawMaterialIds ?? []);
    return this.prisma.$transaction(async (tx) => {
      /*
        One post of a count at a time. Two taps in the same moment (the owner
        and a manager, each from their own bell) both read the count as not
        yet posted and moved every line twice. The second waits on this row
        lock, then reads the count as POSTED and is refused.
      */
      await tx.$queryRaw`SELECT id FROM "cycle_counts" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
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
      // Only the weekly review knows which of a record's lines a later count replaced.
      if (c.status === 'RECORDED' && !skipRawMaterialIds) {
        throw new BadRequestException('A weekly count is adjusted from its Review under Procure > Counts.');
      }
      if (c.status !== 'OPEN' && c.status !== 'RECORDED') {
        throw new BadRequestException('Only open or recorded counts can be posted.');
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

      // Variances the books could not value. Said back, not swallowed.
      const noCost: string[] = [];

      /*
        Give back what a waiting ticket stopped holding without being made.

        The expected figures were taken less what waiting kitchen/bar tickets
        held when the count was opened. One voided or refunded since was never
        made, so its share never comes off the book -- measured against the
        snapshot as it stands, that share reads as stock found. It goes back
        onto what the count expected before the variance is worked out.

        Only where the snapshot was above zero: there the whole hold was taken
        off, so the whole release goes back. A snapshot stopped at zero took
        off an unknown part of it, and giving it all back could invent a loss.

        A buy list's count takes each line's snapshot when that line is first
        counted, which can be later than the count was opened; those lines are
        measured from the opening too, as nothing records the later moment.
      */
      const lines = c.lines.filter((l) => !skip.has(l.rawMaterialId));
      const snapshotted = [...new Set(
        lines.filter((l) => new Prisma.Decimal(l.expectedQty).greaterThan(0)).map((l) => l.rawMaterialId),
      )];
      const released = await releasedHolds(tx, tenantId, c.branchId, snapshotted, c.createdAt);

      for (const line of lines) {
        const counted  = new Prisma.Decimal(line.countedQty);
        const snapshot = new Prisma.Decimal(line.expectedQty);
        const giveBack = snapshot.greaterThan(0) ? (released.get(line.rawMaterialId) ?? 0) : 0;
        const expected = giveBack > 0 ? snapshot.plus(giveBack) : snapshot;
        const variance = counted.minus(expected);

        // Skip zero-variance (within 1g / 1ml precision).
        if (variance.abs().lessThan(new Prisma.Decimal('0.001'))) {
          // Nothing moves, but the line still says what it was measured against.
          if (giveBack > 0) {
            await tx.cycleCountLine.update({
              where: { id: line.id },
              data:  { expectedQty: expected, varianceQty: variance },
            });
          }
          continue;
        }

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
        /*
          Written as a change, not as `settled`. A kitchen or bar ready tap is
          a writer too: it takes a waiting ticket's ingredients with its own
          relative decrement, and it can land between the read above and the
          write below. Writing the absolute figure would put that milk back on
          the shelf; moving the row by the same amount keeps the tap's share
          taken. With nothing in between it lands on `settled` exactly.
        */
        const change = settled.minus(live);

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
          update: {
            quantity: change.isNegative() ? { decrement: change.negated() } : { increment: change },
          },
          create: {
            tenantId,
            branchId:      c.branchId,
            rawMaterialId: line.rawMaterialId,
            // No row yet means nothing has moved, so there is nothing to
            // preserve and the count is the whole truth.
            quantity:      counted,
          },
        });
        // A change cannot clamp itself: a tap that took its share between the read and the write can leave the row just below zero.
        await tx.rawMaterialInventory.updateMany({
          where: { branchId: c.branchId, rawMaterialId: line.rawMaterialId, quantity: { lt: 0 } },
          data:  { quantity: new Prisma.Decimal(0) },
        });
        await tx.cycleCountLine.update({
          where: { id: line.id },
          // The expected figure too when a released hold was given back, so counted less expected is still the variance.
          data:  giveBack > 0 ? { expectedQty: expected, varianceQty: variance } : { varianceQty: variance },
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
        if (!(unitCost > 0) && varianceQty !== 0) noCost.push(line.rawMaterial?.name ?? 'an ingredient');
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

      const posted = await tx.cycleCount.update({
        where: { id },
        data:  { status: 'POSTED', postedAt: new Date(), postedById: userId },
        include: { lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      });
      return { ...posted, warnings: noCost.map((name) => noCostWarning(name)) };
    });
  }

  // ── Transfers: lots and the trail ────────────────────────────────────────

  /**
   * Oldest-expiry-first, then oldest-received: the same order a sale uses.
   * Reports how much it actually took and what those layers cost, so the
   * transfer can carry the real value to the other branch.
   */
  private async drainLots(
    tx: Prisma.TransactionClient,
    branchId: string,
    rawMaterialId: string,
    qty: number,
  ): Promise<{ qty: number; value: number }> {
    let remaining = qty;
    let value = 0;
    const lots = await tx.rawMaterialLot.findMany({
      where:   { branchId, rawMaterialId, qtyRemaining: { gt: 0 } },
      orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
    });
    for (const lot of lots) {
      if (remaining <= 0) break;
      const lotRem = Number(lot.qtyRemaining);
      const drain = Math.min(lotRem, remaining);
      await tx.rawMaterialLot.update({ where: { id: lot.id }, data: { qtyRemaining: new Prisma.Decimal(lotRem - drain) } });
      value += drain * Number(lot.unitCost ?? 0);
      remaining -= drain;
    }
    return { qty: qty - remaining, value };
  }

  /**
   * One event per line, so Stock Movements shows the stock leaving one branch
   * and arriving at the other. The journal skips the kind: same shop, same
   * asset account, no entry. Valued at the shop's unit cost for the log only.
   */
  private async transferTrail(
    tx: Prisma.TransactionClient,
    tenantId: string,
    t: { transferNumber: string; fromBranchId: string; toBranchId: string; lines: Array<{ rawMaterialId: string; quantity: Prisma.Decimal; unitCost?: Prisma.Decimal }> },
    direction: 'OUT' | 'IN',
    opts: { byId?: string | null; returned?: boolean } = {},
  ): Promise<void> {
    // A cancelled transfer comes back to the source; everything else is
    // out of the source or into the destination.
    const here  = opts.returned ? t.fromBranchId : (direction === 'OUT' ? t.fromBranchId : t.toBranchId);
    const other = opts.returned ? t.toBranchId   : (direction === 'OUT' ? t.toBranchId   : t.fromBranchId);
    const rmIds = t.lines.map((l) => l.rawMaterialId);

    const [branches, materials, onHand] = await Promise.all([
      tx.branch.findMany({ where: { id: { in: [t.fromBranchId, t.toBranchId] } }, select: { id: true, name: true } }),
      tx.rawMaterial.findMany({
        where:  { id: { in: rmIds } },
        select: { id: true, name: true, unit: true, costPrice: true, category: true },
      }),
      /*
        The shelf as it stands now, so the movement log can show the count
        before and after. This runs AFTER the stock has already moved, so
        what comes back is the "after"; the "before" is that plus or minus
        the line. Without this both columns read 0 and the log looked like
        the transfer had come from nowhere and gone nowhere.
      */
      tx.rawMaterialInventory.findMany({
        where:  { branchId: here, rawMaterialId: { in: rmIds } },
        select: { rawMaterialId: true, quantity: true },
      }),
    ]);
    const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? 'another branch';
    const reason = opts.returned
      ? `Transfer ${t.transferNumber} cancelled - returned`
      : direction === 'OUT' ? `Transferred to ${nameOf(other)}` : `Transferred from ${nameOf(other)}`;

    for (const line of t.lines) {
      const m = materials.find((x) => x.id === line.rawMaterialId);
      const qty = Number(line.quantity);
      // What this move is worth: the line's own cost when it has one (the
      // realised layer cost written at send), else the running average.
      const unitCost = Number(line.unitCost ?? m?.costPrice ?? 0);
      const after  = Number(onHand.find((r) => r.rawMaterialId === line.rawMaterialId)?.quantity ?? 0);
      const before = direction === 'OUT' ? after + qty : after - qty;
      await tx.accountingEvent.create({
        data: {
          tenantId,
          type:    'INVENTORY_ADJUSTMENT',
          status:  'PENDING',
          payload: {
            kind:            'STOCK_TRANSFER',
            direction,
            rawMaterialId:   line.rawMaterialId,
            rawMaterialName: m?.name ?? 'Ingredient',
            category:        m?.category ?? null,
            unit:            m?.unit ?? '',
            quantity:        qty,
            quantityBefore:  before,
            quantityAfter:   after,
            unitCost,
            totalValue:      qty * unitCost,
            branchId:        here,
            otherBranchId:   other,
            otherBranchName: nameOf(other),
            referenceNumber: t.transferNumber,
            byId:            opts.byId ?? null,
            productName:     m?.name ?? 'Ingredient',
            adjustmentType:  'STOCK_TRANSFER',
            reason,
          } as unknown as Prisma.JsonObject,
        },
      });
    }
  }
}

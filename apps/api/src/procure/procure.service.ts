import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Clerque Procure — the shop asking the owner to buy something.
 *
 * The failure this removes is one of timing, not paperwork: a shortage is
 * found while someone is already standing in the grocery, so a message goes to
 * the owners and somebody makes a second trip, purely to keep "nothing
 * unavailable on the menu" true. A better form does not prevent that. Knowing
 * before anyone leaves does.
 *
 * No vendor, no terms, no accrual. An MSME cafe buys at the grocery and on
 * Shopee and owes nobody, so a request becomes a cash or owner-funded receipt
 * directly. OWNER_FUNDED credits 3010 Owner's Capital, which is the honest
 * treatment when an owner pays out of pocket.
 *
 * The line's control number is passed through as the receive reference, so
 * "do not receive the same line twice" is enforced by the database instead of
 * by someone remembering.
 */

export interface AddLineDto {
  rawMaterialId: string;
  qtyRequested:  number;
  shortBy?:      number;
}

export interface BoughtLineDto {
  lineId:      string;
  packsBought: number;
  packSize:    number;
  packCost:    number;
  brandNote?:  string;
}

@Injectable()
export class ProcureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  // ── the open request ──────────────────────────────────────────────────────

  /**
   * One OPEN request per branch at a time. Anyone can add to it through the
   * day; a second open request would split the shopping list in half and
   * guarantee two trips, which is the thing being fixed.
   */
  async openRequest(tenantId: string, branchId: string, userId: string) {
    const existing = await this.prisma.purchaseRequest.findFirst({
      where:   { tenantId, branchId, status: 'OPEN' },
      include: this.lineInclude(),
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;

    const requestNumber = await this.nextNumber(tenantId);
    return this.prisma.purchaseRequest.create({
      data:    { tenantId, branchId, requestNumber, createdById: userId },
      include: this.lineInclude(),
    });
  }

  async list(tenantId: string, branchId?: string, status?: PurchaseRequestStatus) {
    return this.prisma.purchaseRequest.findMany({
      where:   { tenantId, ...(branchId ? { branchId } : {}), ...(status ? { status } : {}) },
      include: this.lineInclude(),
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
  }

  async get(tenantId: string, id: string) {
    const req = await this.prisma.purchaseRequest.findFirst({
      where: { id, tenantId }, include: this.lineInclude(),
    });
    if (!req) throw new NotFoundException('Purchase request not found.');
    return req;
  }

  /**
   * Add a line, or raise an existing one. Asking for the same ingredient twice
   * on one request is always a mistake — it would send someone for sugar twice.
   */
  async addLine(tenantId: string, requestId: string, dto: AddLineDto) {
    const req = await this.get(tenantId, requestId);
    if (req.status !== 'OPEN') {
      throw new BadRequestException(
        `This request is already ${req.status.toLowerCase()}. Start a new one to add more.`,
      );
    }
    if (!(dto.qtyRequested > 0)) {
      throw new BadRequestException('Enter how much is needed.');
    }
    const rm = await this.prisma.rawMaterial.findFirst({
      where: { id: dto.rawMaterialId, tenantId }, select: { id: true, name: true },
    });
    if (!rm) throw new BadRequestException('Ingredient not found in your list.');

    const existing = req.lines.find((l) => l.rawMaterialId === dto.rawMaterialId);
    if (existing) {
      return this.prisma.purchaseRequestLine.update({
        where: { id: existing.id },
        data:  { qtyRequested: new Prisma.Decimal(dto.qtyRequested) },
      });
    }
    return this.prisma.purchaseRequestLine.create({
      data: {
        purchaseRequestId: requestId,
        lineNumber:        `${req.requestNumber}-${String(req.lines.length + 1).padStart(2, '0')}`,
        rawMaterialId:     dto.rawMaterialId,
        qtyRequested:      new Prisma.Decimal(dto.qtyRequested),
        shortBy:           dto.shortBy != null ? new Prisma.Decimal(dto.shortBy) : null,
      },
    });
  }

  async removeLine(tenantId: string, requestId: string, lineId: string) {
    const req = await this.get(tenantId, requestId);
    if (req.status !== 'OPEN') {
      throw new BadRequestException('Only an open request can be edited.');
    }
    await this.prisma.purchaseRequestLine.deleteMany({
      where: { id: lineId, purchaseRequestId: requestId },
    });
    return { removed: lineId };
  }

  /**
   * Pull everything currently below its reorder level onto the open request.
   *
   * This is the whole point of the feature: the list assembles itself from
   * what the shop already knows, instead of from whoever happens to notice.
   */
  async pullLowStock(tenantId: string, branchId: string, userId: string) {
    const req = await this.openRequest(tenantId, branchId, userId);
    if (req.status !== 'OPEN') throw new BadRequestException('The current request is closed.');

    const low = await this.inventory.getLowStock(tenantId, branchId);
    const ingredients = (low as Array<Record<string, unknown>>).filter(
      (r) => r['kind'] === 'INGREDIENT' || r['rawMaterialId'],
    );

    let added = 0;
    for (const row of ingredients) {
      const rawMaterialId = String(row['rawMaterialId'] ?? row['id'] ?? '');
      if (!rawMaterialId) continue;
      const shortBy = Number(row['shortBy'] ?? 0);
      if (!(shortBy > 0)) continue;
      if (req.lines.some((l) => l.rawMaterialId === rawMaterialId)) continue;
      await this.addLine(tenantId, req.id, { rawMaterialId, qtyRequested: shortBy, shortBy });
      added++;
    }
    return { requestId: req.id, requestNumber: req.requestNumber, added };
  }

  // ── cutoff ────────────────────────────────────────────────────────────────

  /**
   * Close the request and send it.
   *
   * An EMPTY request is still sent, on purpose. Silence cannot be told apart
   * from a cron that died or a shop that never looked, so an explicit "nothing
   * hit the warning level" is what makes the absence of a request mean
   * something. That is why this returns `empty` rather than refusing.
   */
  async sendRequest(tenantId: string, requestId: string, userId: string) {
    const req = await this.get(tenantId, requestId);
    if (req.status !== 'OPEN') {
      throw new BadRequestException(`This request was already sent (${req.status.toLowerCase()}).`);
    }
    const updated = await this.prisma.purchaseRequest.update({
      where:   { id: requestId },
      data:    { status: 'SENT', sentAt: new Date(), sentById: userId },
      include: this.lineInclude(),
    });
    return { ...updated, empty: updated.lines.length === 0 };
  }

  // ── shopping ──────────────────────────────────────────────────────────────

  /**
   * Record what was actually bought: containers, what each holds, what each
   * cost. Doing the packs-to-units maths here is what lets the spreadsheet be
   * a backup rather than the only place the conversion can happen.
   */
  async recordBought(tenantId: string, requestId: string, lines: BoughtLineDto[]) {
    const req = await this.get(tenantId, requestId);
    if (req.status !== 'SENT' && req.status !== 'BOUGHT') {
      throw new BadRequestException(
        `A request has to be sent before it can be bought against (this one is ${req.status.toLowerCase()}).`,
      );
    }
    for (const l of lines) {
      if (!(l.packsBought > 0)) throw new BadRequestException('How many packs were bought?');
      if (!(l.packSize    > 0)) throw new BadRequestException('What does one pack hold?');
      if (!(l.packCost   >= 0)) throw new BadRequestException('What did one pack cost?');
      const owned = req.lines.find((x) => x.id === l.lineId);
      if (!owned) throw new BadRequestException('That line is not on this request.');
    }

    await this.prisma.$transaction(
      lines.map((l) =>
        this.prisma.purchaseRequestLine.update({
          where: { id: l.lineId },
          data: {
            packsBought: new Prisma.Decimal(l.packsBought),
            packSize:    new Prisma.Decimal(l.packSize),
            packCost:    new Prisma.Decimal(l.packCost),
            brandNote:   l.brandNote?.trim() || null,
          },
        }),
      ),
    );
    return this.prisma.purchaseRequest.update({
      where:   { id: requestId },
      data:    { status: 'BOUGHT', boughtAt: new Date() },
      include: this.lineInclude(),
    });
  }

  // ── posting to stock ──────────────────────────────────────────────────────

  /**
   * Post the bought lines to stock.
   *
   * Each line is received on its own, with its own control number as the
   * reference. A line that fails — a locked period, say — does not cost the
   * rest of the delivery, and a line already received is skipped rather than
   * doubled, because receiveRawMaterial refuses a reference it has seen.
   */
  async receiveRequest(tenantId: string, requestId: string, userId: string, paymentMethod: 'CASH' | 'OWNER_FUNDED' = 'CASH') {
    const req = await this.get(tenantId, requestId);
    if (req.status !== 'BOUGHT' && req.status !== 'RECEIVED') {
      throw new BadRequestException(
        `Record what was bought before posting it to stock (this one is ${req.status.toLowerCase()}).`,
      );
    }

    const posted: Array<{ line: string; name: string; quantity: number; unitCost: number }> = [];
    const skipped: Array<{ line: string; name: string; reason: string }> = [];
    const failed:  Array<{ line: string; name: string; reason: string }> = [];

    for (const line of req.lines) {
      const name = line.rawMaterial.name;
      if (line.receivedAt) { skipped.push({ line: line.lineNumber, name, reason: 'Already posted.' }); continue; }
      if (line.packsBought == null || line.packSize == null || line.packCost == null) {
        skipped.push({ line: line.lineNumber, name, reason: 'Nothing was bought for this line.' });
        continue;
      }
      const quantity = Number(line.packsBought) * Number(line.packSize);
      const unitCost = Number(line.packCost) / Number(line.packSize);
      if (!(quantity > 0)) { skipped.push({ line: line.lineNumber, name, reason: 'Zero quantity.' }); continue; }

      try {
        const res = await this.inventory.receiveRawMaterial(tenantId, line.rawMaterialId, {
          branchId:        req.branchId,
          quantity,
          costPrice:       unitCost,
          paymentMethod,
          referenceNumber: line.lineNumber,
          note:            line.brandNote ?? undefined,
        } as never);
        if ((res as { duplicate?: boolean }).duplicate) {
          skipped.push({ line: line.lineNumber, name, reason: 'This line was already received.' });
        } else {
          posted.push({ line: line.lineNumber, name, quantity, unitCost });
        }
        await this.prisma.purchaseRequestLine.update({
          where: { id: line.id }, data: { receivedAt: new Date() },
        });
      } catch (err) {
        failed.push({
          line: line.lineNumber, name,
          reason: err instanceof Error ? err.message : 'Could not post this line.',
        });
      }
    }

    // Only close the request when nothing is left outstanding — a partly
    // posted request that reads RECEIVED would hide the lines that failed.
    const allDone = failed.length === 0;
    const updated = await this.prisma.purchaseRequest.update({
      where: { id: requestId },
      data:  allDone
        ? { status: 'RECEIVED', receivedAt: new Date(), receivedById: userId }
        : {},
      include: this.lineInclude(),
    });
    return { request: updated, posted, skipped, failed };
  }

  async cancel(tenantId: string, requestId: string) {
    const req = await this.get(tenantId, requestId);
    if (req.status === 'RECEIVED') {
      throw new BadRequestException('This request is already in stock and cannot be cancelled.');
    }
    return this.prisma.purchaseRequest.update({
      where: { id: requestId }, data: { status: 'CANCELLED' }, include: this.lineInclude(),
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private lineInclude() {
    return {
      lines: {
        include: {
          rawMaterial: { select: { id: true, name: true, unit: true, costPrice: true } },
        },
        orderBy: { lineNumber: 'asc' as const },
      },
      branch: { select: { id: true, name: true } },
    };
  }

  /** REQ-YYYYMMDD-NNN, sequential within the day so it reads as a date. */
  private async nextNumber(tenantId: string): Promise<string> {
    const today  = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `REQ-${today}-`;
    const last = await this.prisma.purchaseRequest.findFirst({
      where:   { tenantId, requestNumber: { startsWith: prefix } },
      orderBy: { requestNumber: 'desc' },
      select:  { requestNumber: true },
    });
    const n = last ? (parseInt(last.requestNumber.slice(prefix.length), 10) || 0) + 1 : 1;
    return `${prefix}${String(n).padStart(3, '0')}`;
  }
}

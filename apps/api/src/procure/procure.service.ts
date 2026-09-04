import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PH_TIMEZONE } from '@repo/shared-types';

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

  /**
   * The branch a request belongs to, when the caller did not say.
   *
   * A second owner or an MDM account is often created with no branch, and
   * every Procure route read `user.branchId!` -- so for them the open list,
   * Check stock and the menu ceiling all queried a branch of `undefined` and
   * came back empty with no error. Given nothing, the shop's first branch;
   * given something, it has to be this tenant's.
   */
  async resolveBranch(tenantId: string, branchId?: string | null): Promise<string> {
    if (branchId) {
      const own = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId }, select: { id: true } });
      if (!own) throw new BadRequestException('Branch not found in your organization.');
      return own.id;
    }
    const first = await this.prisma.branch.findFirst({
      where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { id: true },
    });
    if (!first) throw new BadRequestException('This organization has no branch yet.');
    return first.id;
  }

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
        /*
          Derive the suffix from the highest one used, not from how many lines
          there are. Removing line 02 of three left a count of 2, so the next
          add produced -03 again -- a duplicate control number on a request,
          and that number is the idempotency key the receive relies on to know
          a line has already been posted.
        */
        lineNumber:        `${req.requestNumber}-${String(
          // Never below the line count either: a row whose number cannot be
          // parsed must not let the next one collide with an existing suffix.
          Math.max(
            req.lines.length,
            req.lines.reduce((max, l) => {
              const n = parseInt(String(l.lineNumber ?? '').slice(-2), 10);
              return Number.isFinite(n) && n > max ? n : max;
            }, 0),
          ) + 1,
        ).padStart(2, '0')}`,
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
    /*
      Only things the shop can BUY.

      A prepared item is short of being MADE. Putting "White Sugar Syrup --
      SHORT 800 ml" on a grocery slip sends someone to a supplier for
      something their own bar produces, and for a shop that rotates a parked
      batch it would nag every single day, because empty is that batch's
      normal state.
    */
    const ingredients = (low as Array<Record<string, unknown>>).filter(
      (r) => r['kind'] !== 'PREP' && (r['kind'] === 'INGREDIENT' || r['rawMaterialId']),
    );
    const toMake = (low as Array<Record<string, unknown>>).filter((r) => r['kind'] === 'PREP');

    let added = 0;
    for (const row of ingredients) {
      const rawMaterialId = String(row['rawMaterialId'] ?? row['id'] ?? '');
      if (!rawMaterialId) continue;
      /*
        An item sitting EXACTLY on its line is short too.

        "Is this low?" is asked in three places and this one disagreed with the
        other two at the boundary. getLowStock flags `onHand <= lowStockAlert`
        and the nightly alert uses the same test, so an item resting exactly on
        its level is flagged by both -- but its shortfall is 0, and `> 0`
        dropped it here. One shop, one night, three answers: the email said
        "Straws - 6 pcs left", the printed slip said "SHORT 0 pcs", and Check
        stock said "Nothing is below its reorder level right now."

        A cafe weighing grams almost never lands on exact equality, which is
        why this stayed hidden. A shop counting whole units -- cups, lids,
        sachets, slices -- lands on it constantly, and Carolina counts cups and
        lids in pieces.

        `>= 0` also keeps a NaN out, the way `> 0` did.
      */
      const shortBy = Number(row['shortBy'] ?? 0);
      if (!(shortBy >= 0)) continue;
      if (req.lines.some((l) => l.rawMaterialId === rawMaterialId)) continue;
      /*
        Buy PAST the line, not exactly to it.

        The low-stock test is `quantity <= lowStockAlert`, so restoring stock to
        exactly the reorder level leaves the item still flagged: it reappears on
        the next Check stock, gets bought again, and never clears. A reorder
        level is the point at which you buy, not the amount you want on the
        shelf — so ask for enough to get above it and leave some cover.

        Doubling the shortfall is a deliberately simple rule. A real
        reorder-quantity per ingredient is worth having, but guessing one is
        worse than a rule the owner can see and override on the line.
      */
      /*
        Exactly on the line the shortfall is zero, and asking for zero is not
        asking. Fall back to the reorder level itself, which follows the same
        rule as the doubling: get above the line and leave some cover.
      */
      const level = Number(row['lowStockAlert'] ?? 0);
      const qtyRequested = shortBy > 0 ? shortBy * 2 : (level > 0 ? level : 1);
      await this.addLine(tenantId, req.id, { rawMaterialId, qtyRequested, shortBy });
      added++;
    }

    /*
      How many ingredients this check could not have found, whatever their
      stock.

      The low-stock test is `quantity <= lowStockAlert`, and an ingredient with
      no reorder level fails the `!= null` guard before the comparison. So it
      can never appear here — not when it runs low, not when it hits zero.
      Adding nothing therefore has two completely different meanings, and the
      screen said the reassuring one for both: "nothing is below its reorder
      level" reads as "you are fine" when the truth may be "nobody is
      watching any of these".

      A shop can pass a whole kitchen through the app or the onboarding
      workbook without filling this column once — it is optional in both — and
      then wonder why Check stock keeps coming back empty while the rice runs
      out. Counting them is the fix; inventing a default reorder level is not,
      because a threshold nobody chose is a number nobody can trust.
    */
    const unmonitored = await this.prisma.rawMaterial.count({
      where: { tenantId, isActive: true, lowStockAlert: null },
    });

    return {
      requestId: req.id, requestNumber: req.requestNumber, added, unmonitored,
      /*
        Prepared items that are low, reported separately so the screen can send
        someone to make them instead of to the market. Silence about these
        would be worse than the old behaviour: the shortage is real, only the
        remedy is different.
      */
      toMake: toMake.map((r) => ({
        id:       String(r['id'] ?? ''),
        name:     String(r['name'] ?? ''),
        unit:     String(r['unit'] ?? ''),
        quantity: Number(r['quantity'] ?? 0),
        shortBy:  Number(r['shortBy'] ?? 0),
      })),
    };
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
  async receiveRequest(
    tenantId: string,
    requestId: string,
    userId: string,
    paymentMethod: 'CASH' | 'OWNER_FUNDED' = 'CASH',
    /**
     * Set by the receipt path. A photographed delivery carries its own date,
     * its own vendor line, and -- per line -- whether a price an order of
     * magnitude off the one on file is a typo or a real move. A hand-typed
     * request passes nothing and behaves exactly as before.
     */
    opts: { receivedAt?: string; note?: string; acceptCostChangeFor?: Set<string>; acceptCostChangeAll?: boolean } = {},
  ) {
    const req = await this.get(tenantId, requestId);
    if (req.status !== 'BOUGHT' && req.status !== 'RECEIVED') {
      throw new BadRequestException(
        `Record what was bought before posting it to stock (this one is ${req.status.toLowerCase()}).`,
      );
    }

    const posted: Array<{ line: string; name: string; quantity: number; unitCost: number; warning: string | null }> = [];
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
        const res: { duplicate?: boolean; warning?: string | null } = await this.inventory.receiveRawMaterial(tenantId, line.rawMaterialId, {
          branchId:        req.branchId,
          quantity,
          costPrice:       unitCost,
          paymentMethod,
          referenceNumber: line.lineNumber,
          note:            [opts.note, line.brandNote].filter(Boolean).join(' · ') || undefined,
          ...(opts.receivedAt ? { receivedAt: opts.receivedAt } : {}),
          ...(opts.acceptCostChangeAll || opts.acceptCostChangeFor?.has(line.rawMaterialId) ? { acceptCostChange: true } : {}),
        } as never);
        if (res.duplicate) {
          skipped.push({ line: line.lineNumber, name, reason: 'This line was already received.' });
        } else {
          posted.push({ line: line.lineNumber, name, quantity, unitCost, warning: res.warning ?? null });
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
    /*
      A request can be PARTLY received -- some lines post, one fails on a closed
      period -- and its status stays BOUGHT rather than RECEIVED so the failures
      stay visible. Cancelling then hid lines whose stock was already on the
      shelf and whose journal entries were already posted, leaving a CANCELLED
      request that had genuinely moved inventory.
    */
    const received = req.lines.filter((l) => l.receivedAt != null);
    if (received.length > 0) {
      throw new BadRequestException(
        `${received.length} line${received.length === 1 ? ' is' : 's are'} already in stock `
        + `(${received.map((l) => l.rawMaterial?.name ?? l.lineNumber).join(', ')}), so this `
        + 'request cannot be cancelled. Post the rest, or write off what was received.',
      );
    }
    return this.prisma.purchaseRequest.update({
      where: { id: requestId }, data: { status: 'CANCELLED' }, include: this.lineInclude(),
    });
  }

  // ── what is capping the menu ───────────────────────────────────────────────

  /**
   * Which ingredients are limiting how many things the shop can sell.
   *
   * The POS tile says "16 left" and that number is real, but it is the wrong
   * end of the telescope for anyone who can act on it. The cashier sees a
   * consequence; whoever buys stock needs the cause. This inverts it: instead
   * of a product and its ceiling, an ingredient and everything it is holding
   * back.
   *
   * "Fresh Milk — 16 servings, capping 14 drinks" is a buy decision. "16 left"
   * on a latte tile is a reason to shout across the room.
   *
   * Deliberately its own query rather than reusing the POS product payload,
   * which drags in price lists, modifier groups and variants to answer a
   * question about stock.
   */
  async menuCeiling(tenantId: string, branchId: string) {
    const products = await this.prisma.product.findMany({
      where: { tenantId, isActive: true, inventoryMode: 'RECIPE_BASED' },
      select: {
        id: true, name: true,
        bomItems: {
          select: {
            rawMaterialId: true,
            quantity: true,
            rawMaterial: { select: { id: true, name: true, unit: true, lowStockAlert: true } },
          },
        },
      },
    });

    const rawMaterialIds = [...new Set(products.flatMap((p) => p.bomItems.map((b) => b.rawMaterialId)))];
    if (rawMaterialIds.length === 0) return { branchId, ingredients: [], productsChecked: 0 };

    const stockRows = await this.prisma.rawMaterialInventory.findMany({
      where:  { branchId, rawMaterialId: { in: rawMaterialIds } },
      select: { rawMaterialId: true, quantity: true },
    });
    const stockOf = new Map(stockRows.map((r) => [r.rawMaterialId, Number(r.quantity)]));

    // ingredientId -> what it is holding back
    const capping = new Map<string, {
      rawMaterialId: string; name: string; unit: string;
      stock: number; servingsLeft: number;
      products: Array<{ id: string; name: string; canMake: number }>;
    }>();

    for (const p of products) {
      if (p.bomItems.length === 0) continue;

      let min = Number.POSITIVE_INFINITY;
      let limiter: (typeof p.bomItems)[number] | null = null;
      for (const bom of p.bomItems) {
        const perUnit = Number(bom.quantity);
        if (perUnit <= 0) continue;
        const producible = Math.floor((stockOf.get(bom.rawMaterialId) ?? 0) / perUnit);
        if (producible < min) { min = producible; limiter = bom; }
      }
      if (!limiter || min === Number.POSITIVE_INFINITY) continue;

      const key = limiter.rawMaterialId;
      const entry = capping.get(key) ?? {
        rawMaterialId: key,
        name: limiter.rawMaterial?.name ?? 'Unknown ingredient',
        unit: limiter.rawMaterial?.unit ?? '',
        stock: stockOf.get(key) ?? 0,
        servingsLeft: min,
        products: [],
      };
      // The tightest product is the one that runs out first, so it sets the
      // number a person should act on.
      entry.servingsLeft = Math.min(entry.servingsLeft, min);
      entry.products.push({ id: p.id, name: p.name, canMake: min });
      capping.set(key, entry);
    }

    const ingredients = [...capping.values()]
      .map((i) => ({ ...i, productCount: i.products.length,
                     products: i.products.sort((a, b) => a.canMake - b.canMake) }))
      // Most urgent first: fewest servings, then whatever blocks the most menu.
      .sort((a, b) => a.servingsLeft - b.servingsLeft || b.productCount - a.productCount);

    return { branchId, productsChecked: products.length, ingredients };
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

  /** The next control number, for a request created outside this service. */
  nextRequestNumber(tenantId: string): Promise<string> {
    return this.nextNumber(tenantId);
  }

  /** REQ-YYYYMMDD-NNN, sequential within the day so it reads as a date. */
  private async nextNumber(tenantId: string): Promise<string> {
    /*
      The shop's date, not UTC. Manila is UTC+8, so toISOString() before 08:00
      local stamps YESTERDAY -- and the morning shift is exactly when someone
      opens the day's buy list. A request numbered for the previous day is
      confusing on its own and wrong when it is used to reconcile a delivery.
    */
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()).replace(/-/g, '');
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

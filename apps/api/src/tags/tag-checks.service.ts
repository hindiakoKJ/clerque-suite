import {
  BadRequestException, ConflictException, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { InventoryLogType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { AuditService } from '../audit/audit.service';
import { TelegramAlertsService } from '../telegram/telegram-alerts.service';
import { isTagNumber } from './tag-rules';

/**
 * Clerque Inventory: the checks that catch a part leaving without a sale
 * (tasks/surplus-autoparts-plan.md, "What already happened").
 *
 *  - Roll call: staff send the tag numbers they find, blind (they never see
 *    the list of what should be there); the owner gets what is missing.
 *  - Returned unsold: a customer brings back a part whose tag was never
 *    sold -- someone sold it off the books. The owner is told at once, with
 *    when the part was last seen and which shifts ran since.
 *  - Write-off: only the owner, with a photo of the numbered part, and the
 *    books say why (damage to 5070, loss or theft to 5060).
 *  - Label gaps: printed numbers that never became a tag.
 *
 * No new table: roll calls and alerts are rows in the insert-only audit log.
 */

const ROLL_CALL = 'TAG_ROLL_CALL';
const RETURNED_UNSOLD = 'TAG_RETURNED_UNSOLD';
const WRITTEN_OFF = 'TAG_WRITTEN_OFF';
const LABEL_RUN = 'TAG_LABEL_RUN';
const PHOTO_ENTITY = 'SerializedUnit';
const MAX_ROLL_CALL = 5000;

export type WriteOffReason = 'DAMAGED' | 'DEFECTIVE' | 'SCRAP' | 'LOST' | 'STOLEN';
export const WRITE_OFF_REASONS: WriteOffReason[] = ['DAMAGED', 'DEFECTIVE', 'SCRAP', 'LOST', 'STOLEN'];

/** Damage is waste (5070); a part that is simply gone is a loss (5060). */
export function writeOffReasonCode(reason: WriteOffReason): 'DAMAGE' | 'THEFT' {
  return reason === 'LOST' || reason === 'STOLEN' ? 'THEFT' : 'DAMAGE';
}

export interface RollCallResult {
  branchId: string;
  countedAt: string;
  countedById: string;
  found: string[];
  missing: { number: string; productName: string }[];
  unexpected: { number: string; why: string }[];
}

/** The pure comparison: what was found against what should be on the shelf. */
export function compareRollCall(
  scanned: string[],
  expected: { number: string; productName: string }[],
  known: Map<string, string>,
): Pick<RollCallResult, 'found' | 'missing' | 'unexpected'> {
  const seen = new Set(scanned);
  const expectedNumbers = new Set(expected.map((e) => e.number));
  return {
    found: [...seen].filter((n) => expectedNumbers.has(n)).sort(),
    missing: expected.filter((e) => !seen.has(e.number)).sort((a, b) => a.number.localeCompare(b.number)),
    unexpected: [...seen].filter((n) => !expectedNumbers.has(n)).sort()
      .map((n) => ({ number: n, why: known.get(n) ?? 'No tag has this number.' })),
  };
}

@Injectable()
export class TagChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    // Optional so the specs can build the service without Telegram; Nest always provides it (global module).
    @Optional() private readonly telegram?: TelegramAlertsService,
  ) {}

  /**
   * Every owner's bell, and the owners' Telegram (never the managers': the
   * person counting or at the counter may be one of them).
   */
  private async tellOwners(tenantId: string, branchId: string | null, title: string, body: string, link: string) {
    const owners = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: 'BUSINESS_OWNER' }, select: { id: true } });
    if (owners.length) {
      await this.prisma.notification.createMany({
        data: owners.map((o) => ({ tenantId, userId: o.id, kind: 'WARNING' as const, title, body, link })),
      });
    }
    // Not awaited: Telegram never holds up or fails the check (ownerNotice never rejects).
    void this.telegram?.ownerNotice(tenantId, branchId, title, body.split('\n'), { ownersOnly: true });
  }

  private async assertBranch(tenantId: string, branchId: string) {
    const b = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId }, select: { id: true } });
    if (!b) throw new NotFoundException('Branch not found.');
  }

  // ── Roll call ───────────────────────────────────────────────────────────

  async rollCall(tenantId: string, userId: string, role: string, branchId: string, numbers: string[]) {
    if (!branchId) throw new BadRequestException('Pick the branch you counted.');
    await this.assertBranch(tenantId, branchId);
    if (!Array.isArray(numbers) || numbers.length === 0) throw new BadRequestException('Scan or type at least one tag number.');
    if (numbers.length > MAX_ROLL_CALL) throw new BadRequestException(`Send at most ${MAX_ROLL_CALL} numbers at a time.`);
    const scanned = [...new Set(numbers.map((n) => String(n ?? '').trim()).filter(isTagNumber))];
    if (!scanned.length) throw new BadRequestException('None of those is a 6-digit tag number.');
    const countedAt = new Date();

    // What should be on this branch's shelf: costed tags in stock, tagged before the count.
    const onShelf = await this.prisma.serializedUnit.findMany({
      where: { tenantId, branchId, status: 'IN_STOCK', acquiredCost: { not: null }, createdAt: { lte: countedAt } },
      select: { serialNumber: true, product: { select: { name: true } } },
    });
    const expected = onShelf.map((t) => ({ number: t.serialNumber, productName: t.product.name }));
    const expectedSet = new Set(expected.map((e) => e.number));

    // Numbers found that should not be here: say why, for the owner.
    const extra = scanned.filter((n) => !expectedSet.has(n));
    const others = extra.length
      ? await this.prisma.serializedUnit.findMany({
          where: { tenantId, serialNumber: { in: extra } },
          select: { serialNumber: true, status: true, acquiredCost: true, branchId: true, soldOrderId: true },
        })
      : [];
    const soldIds = others.map((o) => o.soldOrderId).filter((x): x is string => !!x);
    const orders = soldIds.length
      ? await this.prisma.order.findMany({ where: { tenantId, id: { in: soldIds } }, select: { id: true, orderNumber: true } })
      : [];
    const orderNo = new Map(orders.map((o) => [o.id, o.orderNumber]));
    const known = new Map<string, string>();
    for (const o of others) {
      known.set(o.serialNumber,
        o.status === 'SOLD' ? `Sold${o.soldOrderId && orderNo.get(o.soldOrderId) ? ` on ${orderNo.get(o.soldOrderId)}` : ''}, but found on the shelf.`
        : o.status === 'RETIRED' ? 'Written off, but found on the shelf.'
        : o.branchId !== branchId ? 'Belongs to another branch.'
        : o.acquiredCost == null ? 'Still waiting for the owner\'s cost.'
        : 'Not for sale (rental or repair).');
    }

    const cmp = compareRollCall(scanned, expected, known);
    const result: RollCallResult = { branchId, countedAt: countedAt.toISOString(), countedById: userId, ...cmp };
    await this.prisma.auditLog.create({
      data: {
        tenantId, action: 'SETTING_CHANGED', entityType: ROLL_CALL, entityId: `${branchId}:${countedAt.getTime()}`,
        after: result as unknown as Prisma.InputJsonValue,
        description: `Roll call: ${cmp.found.length} found, ${cmp.missing.length} missing, ${cmp.unexpected.length} unexpected`,
        performedBy: userId,
      },
    });
    if (cmp.missing.length || cmp.unexpected.length) {
      const lines = [
        ...cmp.missing.slice(0, 10).map((m) => `Missing: Tag ${m.number} ${m.productName}`),
        ...cmp.unexpected.slice(0, 5).map((u) => `Tag ${u.number}: ${u.why}`),
      ];
      await this.tellOwners(tenantId, branchId, `Roll call: ${cmp.missing.length} missing`, lines.join('\n'), '/inventory/roll-call');
    }
    // Blind: staff learn only that it was sent; the owner sees the result.
    if (role === 'BUSINESS_OWNER' || role === 'SUPER_ADMIN') return { received: scanned.length, result };
    return { received: scanned.length };
  }

  async listRollCalls(tenantId: string, branchId?: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId, entityType: ROLL_CALL, ...(branchId ? { entityId: { startsWith: `${branchId}:` } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { after: true, createdAt: true, performedBy: true },
    });
    const userIds = [...new Set(rows.map((r) => r.performedBy).filter((x): x is string => !!x))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { tenantId, id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const calls = rows.map((r) => r.after as unknown as RollCallResult);
    // For each missing part, the last earlier roll call that found it.
    return calls.map((c, i) => ({
      countedAt: c.countedAt,
      branchId: c.branchId,
      countedByName: nameOf.get(c.countedById) ?? null,
      foundCount: c.found.length,
      missing: c.missing.map((m) => {
        const earlier = calls.slice(i + 1).find((e) => e.branchId === c.branchId && e.found.includes(m.number));
        return { ...m, lastSeenAt: earlier?.countedAt ?? null };
      }),
      unexpected: c.unexpected,
    }));
  }

  // ── A part returned that was never sold ────────────────────────────────

  async returnedUnsold(tenantId: string, userId: string, number: string, note?: string) {
    const n = String(number ?? '').trim();
    if (!isTagNumber(n)) throw new BadRequestException('Type the 6 digits on the part\'s label.');
    const tag = await this.prisma.serializedUnit.findFirst({
      where: { tenantId, serialNumber: n },
      select: { id: true, status: true, branchId: true, soldOrderId: true, product: { select: { name: true } } },
    });
    if (!tag) throw new NotFoundException(`No part has tag ${n}.`);
    if (tag.status === 'SOLD') {
      const order = tag.soldOrderId
        ? await this.prisma.order.findFirst({ where: { id: tag.soldOrderId, tenantId }, select: { orderNumber: true } })
        : null;
      throw new ConflictException({
        code: 'TAG_WAS_SOLD',
        message: `Tag ${n} was sold${order ? ` on ${order.orderNumber}` : ''}. A return of a sold part is refunded from Orders by the owner.`,
        orderNumber: order?.orderNumber ?? null,
      });
    }

    // When was it last seen, and who held a drawer at this branch since then?
    const calls = await this.prisma.auditLog.findMany({
      where: { tenantId, entityType: ROLL_CALL, entityId: { startsWith: `${tag.branchId}:` } },
      orderBy: { createdAt: 'desc' }, take: 60, select: { after: true },
    });
    const lastSeen = calls.map((c) => c.after as unknown as RollCallResult).find((c) => c.found.includes(n))?.countedAt ?? null;
    const since = lastSeen ? new Date(lastSeen) : new Date(Date.now() - 30 * 24 * 3600_000);
    const shifts = await this.prisma.shift.findMany({
      where: { tenantId, branchId: tag.branchId, openedAt: { gte: since } },
      select: { cashierId: true },
    });
    const cashierIds = [...new Set(shifts.map((s) => s.cashierId))];
    const cashiers = cashierIds.length
      ? await this.prisma.user.findMany({ where: { tenantId, id: { in: cashierIds } }, select: { name: true } })
      : [];
    const shiftNames = cashiers.map((c) => c.name).sort();

    const what = `Tag ${n} ${tag.product.name}`;
    await this.prisma.auditLog.create({
      data: {
        tenantId, action: 'SETTING_CHANGED', entityType: RETURNED_UNSOLD, entityId: tag.id,
        after: { number: n, status: tag.status, lastSeen, shiftsSince: shiftNames, note: note?.trim() || null },
        description: `${what} was brought back, but it was never sold`,
        performedBy: userId,
      },
    });
    const body = [
      `${what} was brought back by a customer, but Clerque has no sale of it. It may have been sold off the books.`,
      lastSeen ? `Last seen at the roll call of ${new Date(lastSeen).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}.` : 'Never seen at a roll call (or not in the last 60).',
      shiftNames.length ? `Drawers open since then: ${shiftNames.join(', ')}.` : '',
      note?.trim() ? `Note: ${note.trim()}` : '',
    ].filter(Boolean).join('\n');
    await this.tellOwners(tenantId, tag.branchId, `Returned but never sold: Tag ${n}`, body, '/inventory/find');
    // Whose drawers were open goes to the owner only: the person at the counter may be one of them.
    return { told: true, lastSeen };
  }

  // ── Write-off, owner only ───────────────────────────────────────────────

  async writeOff(
    tenantId: string, userId: string, tagId: string, reason: WriteOffReason, note: string | undefined,
    file: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
  ) {
    if (!WRITE_OFF_REASONS.includes(reason)) throw new BadRequestException('Say why: damaged, defective, scrap, lost or stolen.');
    if (!file?.buffer?.length) throw new BadRequestException('Take a photo of the part with its number showing.');
    const tag = await this.prisma.serializedUnit.findFirst({
      where: { id: tagId, tenantId },
      select: { id: true, serialNumber: true, status: true, acquiredCost: true, branchId: true, productId: true, product: { select: { name: true } } },
    });
    if (!tag) throw new NotFoundException('Tag not found.');
    if (tag.status !== 'IN_STOCK') throw new ConflictException(`Tag ${tag.serialNumber} is not on the shelf (${tag.status.toLowerCase()}).`);

    await this.documents.uploadBuffer(
      tenantId, PHOTO_ENTITY, tag.id, file.buffer, file.mimetype, file.originalname || `writeoff-${tag.serialNumber}.jpg`,
      `Write-off (${reason.toLowerCase()}): Tag ${tag.serialNumber}`, userId,
    );

    const cost = tag.acquiredCost != null ? Number(tag.acquiredCost) : null;
    const reasonCode = writeOffReasonCode(reason);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.serializedUnit.updateMany({ where: { id: tag.id, tenantId, status: 'IN_STOCK' }, data: { status: 'RETIRED' } });
      if (moved.count !== 1) throw new ConflictException(`Tag ${tag.serialNumber} is not on the shelf.`);
      // A part still waiting for its cost was never in stock or the books: nothing else moves.
      if (cost == null) return;
      const inv = await tx.inventoryItem.findUnique({ where: { branchId_productId: { branchId: tag.branchId, productId: tag.productId } } });
      const before = inv ? Number(inv.quantity) : 0;
      const after = Math.max(before - 1, 0);
      if (inv && before > 0) {
        await tx.inventoryItem.update({ where: { id: inv.id }, data: { quantity: new Prisma.Decimal(after) } });
      }
      const why = `Tag ${tag.serialNumber} written off: ${reason.toLowerCase()}${note?.trim() ? ` (${note.trim()})` : ''}`;
      await tx.inventoryLog.create({
        data: {
          tenantId, branchId: tag.branchId, productId: tag.productId, type: InventoryLogType.STOCK_OUT,
          quantity: new Prisma.Decimal(-1), quantityBefore: new Prisma.Decimal(before), quantityAfter: new Prisma.Decimal(after),
          reason: why, referenceId: tag.id, createdById: userId,
        },
      });
      await tx.accountingEvent.create({
        data: {
          tenantId, type: 'INVENTORY_ADJUSTMENT', status: 'PENDING',
          payload: {
            productId: tag.productId, productName: tag.product.name, branchId: tag.branchId,
            adjustmentType: 'STOCK_OUT', quantity: -1, quantityBefore: before, quantityAfter: after,
            costPrice: cost, totalValue: cost, reason: why, reasonCode,
          },
        },
      });
    });
    await this.audit.log({
      tenantId, action: 'SETTING_CHANGED', entityType: WRITTEN_OFF, entityId: tag.id,
      after: { number: tag.serialNumber, reason, cost, note: note?.trim() || null },
      description: `Tag ${tag.serialNumber} ${tag.product.name} written off: ${reason.toLowerCase()}`,
      performedBy: userId,
    });
    return { number: tag.serialNumber, status: 'RETIRED', bookedTo: cost == null ? null : reasonCode === 'THEFT' ? '5060' : '5070' };
  }

  // ── Label gaps ──────────────────────────────────────────────────────────

  async labelGaps(tenantId: string) {
    const runs = await this.prisma.auditLog.findMany({
      where: { tenantId, entityType: LABEL_RUN },
      orderBy: { createdAt: 'asc' },
      select: { after: true, createdAt: true },
    });
    const used = new Set(
      (await this.prisma.serializedUnit.findMany({ where: { tenantId }, select: { serialNumber: true } })).map((u) => u.serialNumber),
    );
    let total = 0;
    const out = runs.map((r) => {
      const a = (r.after ?? {}) as { from?: string; to?: string };
      const from = Number(a.from), to = Number(a.to);
      const unused: string[] = [];
      if (Number.isFinite(from) && Number.isFinite(to)) {
        for (let n = from; n <= to && total < 2000; n++) {
          const s = String(n).padStart(6, '0');
          if (!used.has(s)) { unused.push(s); total++; }
        }
      }
      return { from: a.from, to: a.to, printedAt: r.createdAt, unused };
    }).filter((r) => r.unused.length);
    return { totalUnused: total, runs: out };
  }
}

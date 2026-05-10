/**
 * Sprint 19 — Loyalty stamp cards.
 *
 * Tenant defines templates ("Coffee Lovers Card · 9 stamps · Free drink").
 * Customers earn stamps automatically on qualifying sales (via the
 * `accrueStampsForOrder` hook called from OrdersService). Cashiers redeem
 * at the till when threshold is met.
 *
 * Each customer/template pair has a permanent `publicToken` for the
 * unauthenticated /stamps/<token> page — the same identity backs the
 * physical printable card and the digital pull-up.
 */
import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, StampAccrualBasis } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Template CRUD ─────────────────────────────────────────────────────────

  listTemplates(tenantId: string) {
    return this.prisma.stampCardTemplate.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { cards: true } } },
    });
  }

  async createTemplate(tenantId: string, dto: {
    name: string;
    rewardLabel: string;
    requiredStamps: number;
    accrualBasis?: StampAccrualBasis;
    accrualThreshold?: number | null;
    minOrderTotal?: number | null;
    expiryDays?: number | null;
  }) {
    if (!dto.name?.trim())          throw new BadRequestException('Template name is required.');
    if (!dto.rewardLabel?.trim())   throw new BadRequestException('Reward description is required.');
    if (!Number.isFinite(dto.requiredStamps) || dto.requiredStamps < 1 || dto.requiredStamps > 50) {
      throw new BadRequestException('requiredStamps must be 1–50.');
    }
    if (dto.accrualBasis === 'PER_AMOUNT' && (!dto.accrualThreshold || dto.accrualThreshold <= 0)) {
      throw new BadRequestException('PER_AMOUNT accrual requires a positive accrualThreshold.');
    }
    return this.prisma.stampCardTemplate.create({
      data: {
        tenantId,
        name:             dto.name.trim(),
        rewardLabel:      dto.rewardLabel.trim(),
        requiredStamps:   dto.requiredStamps,
        accrualBasis:     dto.accrualBasis ?? 'PER_ORDER',
        accrualThreshold: dto.accrualThreshold != null ? new Prisma.Decimal(dto.accrualThreshold) : null,
        minOrderTotal:    dto.minOrderTotal    != null ? new Prisma.Decimal(dto.minOrderTotal) : null,
        expiryDays:       dto.expiryDays ?? null,
      },
    });
  }

  async updateTemplate(tenantId: string, id: string, dto: Partial<{
    name: string;
    rewardLabel: string;
    requiredStamps: number;
    accrualBasis: StampAccrualBasis;
    accrualThreshold: number | null;
    minOrderTotal: number | null;
    expiryDays: number | null;
    isActive: boolean;
  }>) {
    const existing = await this.prisma.stampCardTemplate.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Template not found.');
    return this.prisma.stampCardTemplate.update({
      where: { id },
      data: {
        ...(dto.name        !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.rewardLabel !== undefined ? { rewardLabel: dto.rewardLabel.trim() } : {}),
        ...(dto.requiredStamps !== undefined ? { requiredStamps: dto.requiredStamps } : {}),
        ...(dto.accrualBasis   !== undefined ? { accrualBasis: dto.accrualBasis } : {}),
        ...(dto.accrualThreshold !== undefined
          ? { accrualThreshold: dto.accrualThreshold != null ? new Prisma.Decimal(dto.accrualThreshold) : null }
          : {}),
        ...(dto.minOrderTotal !== undefined
          ? { minOrderTotal: dto.minOrderTotal != null ? new Prisma.Decimal(dto.minOrderTotal) : null }
          : {}),
        ...(dto.expiryDays !== undefined ? { expiryDays: dto.expiryDays } : {}),
        ...(dto.isActive   !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deleteTemplate(tenantId: string, id: string) {
    // Soft delete — keep historical cards' template references intact.
    const existing = await this.prisma.stampCardTemplate.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Template not found.');
    return this.prisma.stampCardTemplate.update({
      where: { id }, data: { isActive: false },
    });
  }

  // ── Cards ─────────────────────────────────────────────────────────────────

  /**
   * List all stamp cards for a customer. Lazy-creates a card per active
   * template so the customer page always shows every available program.
   */
  async listCustomerCards(tenantId: string, customerId: string) {
    const cust = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!cust) throw new NotFoundException('Customer not found.');

    const templates = await this.prisma.stampCardTemplate.findMany({
      where: { tenantId, isActive: true },
    });

    const rows = await Promise.all(templates.map(async (t) => {
      const existing = await this.prisma.customerStampCard.findUnique({
        where: { customerId_templateId: { customerId, templateId: t.id } },
        include: { template: true },
      });
      if (existing) return existing;
      return this.prisma.customerStampCard.create({
        data: {
          tenantId, customerId, templateId: t.id,
          publicToken: this.makeToken(),
        },
        include: { template: true },
      });
    }));

    // Flatten the response so the frontend can read templateName / requiredStamps
    // / rewardLabel directly (less prop-drilling in the StampCardsModal).
    return rows.map((r) => ({
      id:               r.id,
      templateId:       r.templateId,
      templateName:     r.template.name,
      rewardLabel:      r.template.rewardLabel,
      requiredStamps:   r.template.requiredStamps,
      stamps:           r.stamps,
      lifetimeStamps:   r.lifetimeStamps,
      redemptionCount:  r.redemptionCount,
      publicToken:      r.publicToken,
      lastEarnedAt:     r.lastEarnedAt,
      isActive:         r.template.isActive,
    }));
  }

  // ── Public stub (unauthenticated) ────────────────────────────────────────

  async getByPublicToken(token: string) {
    const card = await this.prisma.customerStampCard.findUnique({
      where: { publicToken: token },
      include: {
        template: true,
        customer: { select: { name: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!card) throw new NotFoundException('Card not found.');
    return {
      tenantBusinessName: undefined as string | undefined,  // filled by controller
      customerName:       card.customer.name,
      templateName:       card.template.name,
      rewardLabel:        card.template.rewardLabel,
      requiredStamps:     card.template.requiredStamps,
      stamps:             card.stamps,
      lifetimeStamps:     card.lifetimeStamps,
      redemptionCount:    card.redemptionCount,
      lastEarnedAt:       card.lastEarnedAt,
      expiryDays:         card.template.expiryDays,
      events:             card.events.map((e) => ({
        kind:        e.kind,
        delta:       e.delta,
        stampsAfter: e.stampsAfter,
        note:        e.note,
        createdAt:   e.createdAt,
      })),
      tenantId: card.tenantId,
    };
  }

  // ── Hook: called from OrdersService.create after payment lands ───────────

  /**
   * Auto-accrue stamps on a paid order. Idempotent on (orderId, cardId) —
   * calling twice for the same order is a no-op (the OrderItem refund flow
   * doesn't double-accrue if a partial refund triggers a re-paint).
   */
  async accrueStampsForOrder(
    tenantId: string,
    orderId: string,
    customerId: string,
    orderTotal: number,
  ) {
    const templates = await this.prisma.stampCardTemplate.findMany({
      where: { tenantId, isActive: true },
    });
    if (templates.length === 0) return;

    for (const t of templates) {
      // Min-order gate
      if (t.minOrderTotal && orderTotal < Number(t.minOrderTotal)) continue;

      // Compute stamps to add
      let toAdd = 1;
      if (t.accrualBasis === 'PER_AMOUNT' && t.accrualThreshold) {
        toAdd = Math.floor(orderTotal / Number(t.accrualThreshold));
        if (toAdd <= 0) continue;
      }

      // Idempotency check — has this order already earned on this template?
      const card = await this.prisma.customerStampCard.upsert({
        where: { customerId_templateId: { customerId, templateId: t.id } },
        create: {
          tenantId, customerId, templateId: t.id,
          publicToken: this.makeToken(),
        },
        update: {},
      });
      const dup = await this.prisma.stampCardEvent.findFirst({
        where: { cardId: card.id, orderId, kind: 'EARN' },
        select: { id: true },
      });
      if (dup) continue;

      // Cap stamps at requiredStamps — UI nudges redemption when reached.
      const newStamps = Math.min(card.stamps + toAdd, t.requiredStamps);
      const actualDelta = newStamps - card.stamps;
      if (actualDelta <= 0) continue;

      await this.prisma.$transaction([
        this.prisma.customerStampCard.update({
          where: { id: card.id },
          data: {
            stamps:         newStamps,
            lifetimeStamps: { increment: actualDelta },
            lastEarnedAt:   new Date(),
          },
        }),
        this.prisma.stampCardEvent.create({
          data: {
            cardId: card.id,
            kind: 'EARN',
            delta: actualDelta,
            stampsAfter: newStamps,
            orderId,
          },
        }),
      ]);
    }
  }

  /**
   * Redeem the reward on a card that has met the threshold. Resets stamps
   * to 0, increments redemptionCount, writes a REDEEM event. The actual
   * cash discount on the order is the cashier's responsibility — this
   * service only updates the card state.
   */
  async redeemCard(tenantId: string, cardId: string, performedBy: string, note?: string) {
    const card = await this.prisma.customerStampCard.findFirst({
      where: { id: cardId, tenantId },
      include: { template: true },
    });
    if (!card) throw new NotFoundException('Card not found.');
    if (card.stamps < card.template.requiredStamps) {
      throw new BadRequestException(
        `Card has ${card.stamps}/${card.template.requiredStamps} stamps — not yet eligible for redemption.`,
      );
    }
    const previous = card.stamps;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customerStampCard.update({
        where: { id: card.id },
        data: {
          stamps:          0,
          redemptionCount: { increment: 1 },
        },
      });
      await tx.stampCardEvent.create({
        data: {
          cardId: card.id,
          kind: 'REDEEM',
          delta: -previous,
          stampsAfter: 0,
          performedBy,
          note: note ?? null,
        },
      });
      return updated;
    });
  }

  /**
   * Manual stamp adjustment — owner can correct lost cards, gift stamps
   * for customer recovery, etc. Audit-tracked.
   */
  async adjustCard(
    tenantId: string,
    cardId: string,
    delta: number,
    note: string,
    performedBy: string,
  ) {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new BadRequestException('delta must be a non-zero integer.');
    }
    if (!note?.trim()) {
      throw new BadRequestException('A reason note is required for manual adjustments.');
    }
    const card = await this.prisma.customerStampCard.findFirst({
      where: { id: cardId, tenantId },
      include: { template: true },
    });
    if (!card) throw new NotFoundException('Card not found.');

    const newStamps = Math.max(0, Math.min(card.stamps + delta, card.template.requiredStamps));
    const actualDelta = newStamps - card.stamps;
    if (actualDelta === 0) {
      throw new ConflictException('Adjustment would not change stamp count (already at boundary).');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customerStampCard.update({
        where: { id: card.id },
        data: {
          stamps: newStamps,
          ...(actualDelta > 0 ? { lifetimeStamps: { increment: actualDelta } } : {}),
        },
      });
      await tx.stampCardEvent.create({
        data: {
          cardId: card.id,
          kind: 'ADJUST',
          delta: actualDelta,
          stampsAfter: newStamps,
          note: note.trim(),
          performedBy,
        },
      });
      return updated;
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private makeToken(): string {
    const a = crypto.randomBytes(4).toString('hex');
    const b = crypto.randomBytes(4).toString('hex');
    return `${a}-${b}`;
  }
}

/**
 * Sprint 25 Phase 2C — Loyalty Pro (Pro-tier).
 *
 * Digital stamp programs with QR-based redemption at the till. Sits alongside
 * the existing Sprint 19 stamp cards (LoyaltyService) — that module covers
 * the printable-card flow; this one is the simpler "scan QR, grant N stamps"
 * mechanic gated by the loyaltyPro plan feature.
 */
import {
  Injectable, BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LoyaltyProService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Stamp programs ────────────────────────────────────────────────────────

  listPrograms(tenantId: string) {
    return this.prisma.stampProgram.findMany({
      where:   { tenantId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createProgram(tenantId: string, body: {
    name:            string;
    stampsRequired:  number;
    rewardProductId?: string | null;
    isActive?:       boolean;
  }) {
    if (!body.name?.trim()) {
      throw new BadRequestException('Program name is required.');
    }
    if (!Number.isFinite(body.stampsRequired) || body.stampsRequired < 1) {
      throw new BadRequestException('stampsRequired must be >= 1.');
    }
    if (body.rewardProductId) {
      const exists = await this.prisma.product.findFirst({
        where:  { id: body.rewardProductId, tenantId },
        select: { id: true },
      });
      if (!exists) {
        throw new BadRequestException('rewardProductId does not belong to this tenant.');
      }
    }
    return this.prisma.stampProgram.create({
      data: {
        tenantId,
        name:            body.name.trim(),
        stampsRequired:  body.stampsRequired,
        rewardProductId: body.rewardProductId ?? null,
        isActive:        body.isActive ?? true,
      },
    });
  }

  // ── Stamp grant / redeem ──────────────────────────────────────────────────

  async grantStamps(tenantId: string, args: {
    customerId: string;
    programId:  string;
    count:      number;
  }) {
    const { customerId, programId, count } = args;
    if (!Number.isFinite(count) || count < 1) {
      throw new BadRequestException('count must be >= 1.');
    }
    const program = await this.prisma.stampProgram.findFirst({
      where:  { id: programId, tenantId, isActive: true },
      select: { id: true, stampsRequired: true },
    });
    if (!program) throw new NotFoundException('Stamp program not found or inactive.');

    const customer = await this.prisma.customer.findFirst({
      where:  { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found for this tenant.');

    return this.prisma.customerStamp.upsert({
      where:  { customerId_programId: { customerId, programId } },
      update: {
        stampsEarned: { increment: count },
        lastEarnedAt: new Date(),
        redeemedAt:   null,
      },
      create: {
        tenantId,
        customerId,
        programId,
        stampsEarned: count,
        lastEarnedAt: new Date(),
      },
    });
  }

  /**
   * Atomically: verify the customer has reached the threshold, zero stamps,
   * set redeemedAt, return the reward productId so the till can drop the
   * reward line on the order.
   */
  async redeem(tenantId: string, args: {
    customerId: string;
    programId:  string;
  }): Promise<{ redeemedAt: Date; rewardProductId: string | null }> {
    const { customerId, programId } = args;

    return this.prisma.$transaction(async (tx) => {
      const program = await tx.stampProgram.findFirst({
        where:  { id: programId, tenantId },
        select: { id: true, stampsRequired: true, rewardProductId: true, isActive: true },
      });
      if (!program)       throw new NotFoundException('Stamp program not found.');
      if (!program.isActive) throw new ConflictException('Stamp program is inactive.');

      const card = await tx.customerStamp.findUnique({
        where:  { customerId_programId: { customerId, programId } },
        select: { id: true, stampsEarned: true, tenantId: true },
      });
      if (!card || card.tenantId !== tenantId) {
        throw new NotFoundException('No stamps recorded for this customer/program.');
      }
      if (card.stampsEarned < program.stampsRequired) {
        throw new ConflictException(
          `Not enough stamps yet (${card.stampsEarned}/${program.stampsRequired}).`,
        );
      }

      const now = new Date();
      await tx.customerStamp.update({
        where: { id: card.id },
        data:  { stampsEarned: 0, redeemedAt: now },
      });
      return { redeemedAt: now, rewardProductId: program.rewardProductId };
    });
  }

  async getBalance(tenantId: string, customerId: string) {
    const rows = await this.prisma.customerStamp.findMany({
      where:   { tenantId, customerId },
      include: {
        program: {
          select: { id: true, name: true, stampsRequired: true, isActive: true, rewardProductId: true },
        },
      },
      orderBy: { lastEarnedAt: 'desc' },
    });
    return rows.map((r) => ({
      programId:       r.programId,
      programName:     r.program.name,
      stampsEarned:    r.stampsEarned,
      stampsRequired:  r.program.stampsRequired,
      ready:           r.stampsEarned >= r.program.stampsRequired,
      rewardProductId: r.program.rewardProductId,
      lastEarnedAt:    r.lastEarnedAt,
      redeemedAt:      r.redeemedAt,
    }));
  }
}

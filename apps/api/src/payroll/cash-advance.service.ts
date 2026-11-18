/**
 * Sync (Payroll) — staff cash advances.
 *
 * Two ways in:
 *   1. A staff member asks in Sync (REQUESTED). The owner or payroll master
 *      hands over the money and says where it came from (OPEN), or turns it
 *      down (REJECTED).
 *   2. The owner or payroll master records an advance they already handed
 *      over (straight to OPEN).
 *
 * Handing over the money posts:
 *   DR 1034 Advances to Employees     amount
 *       CR <where it came from>       amount   (1010 / 1011 / 1020 / 1022)
 *
 * Each processed pay run then takes up to `perPayday` back off the payslip
 * (PayrollService.processPayRun), and locking the run credits 1034 with what
 * was taken. Nobody can give themself an advance: the person handing over the
 * money is never the staff member receiving it.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { AccountsService } from '../accounting/accounts.service';
import { CA_ACCOUNT, CA_PAID_FROM, type CaPaidFrom, validateAdvanceTerms } from './cash-advance';

export interface CashAdvanceDto {
  id:              string;
  userId:          string;
  employeeName:    string;
  status:          'REQUESTED' | 'OPEN' | 'PAID' | 'REJECTED' | 'CANCELLED';
  amount:          number;
  perPayday:       number;
  balance:         number;
  reason:          string | null;
  paidFrom:        string | null;
  givenAt:         string | null;
  rejectionReason: string | null;
  createdAt:       string;
  deductions:      { payRunLabel: string; amount: number; date: string }[];
}

interface Actor { sub: string; role: string }

const num = (d: unknown) => Number(d ?? 0);

@Injectable()
export class CashAdvanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
    private readonly accounts: AccountsService,
  ) {}

  // ── Read ───────────────────────────────────────────────────────────────

  async list(tenantId: string, status?: string): Promise<CashAdvanceDto[]> {
    const rows = await this.prisma.cashAdvance.findMany({
      where:   { tenantId, ...(status ? { status: status as any } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: this.include(),
      take:    500,
    });
    return rows.map((r) => this.serialize(r));
  }

  async listMine(tenantId: string, userId: string): Promise<CashAdvanceDto[]> {
    const rows = await this.prisma.cashAdvance.findMany({
      where:   { tenantId, userId },
      orderBy: [{ createdAt: 'desc' }],
      include: this.include(),
      take:    100,
    });
    return rows.map((r) => this.serialize(r));
  }

  // ── Staff side ─────────────────────────────────────────────────────────

  async request(
    tenantId: string,
    userId: string,
    dto: { amount: number; perPayday: number; reason: string },
  ): Promise<CashAdvanceDto> {
    const bad = validateAdvanceTerms(dto.amount, dto.perPayday);
    if (bad) throw new BadRequestException(bad);
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 3) throw new BadRequestException('Say briefly what the advance is for.');

    const waiting = await this.prisma.cashAdvance.findFirst({
      where:  { tenantId, userId, status: 'REQUESTED' },
      select: { id: true },
    });
    if (waiting) {
      throw new ConflictException('You already have a cash advance request waiting. Withdraw it first to ask for a different amount.');
    }

    const row = await this.prisma.cashAdvance.create({
      data: {
        tenantId, userId,
        status:        'REQUESTED',
        amount:        dto.amount,
        perPayday:     dto.perPayday,
        balance:       0,
        reason,
        requestedById: userId,
      },
      include: this.include(),
    });
    return this.serialize(row);
  }

  async withdraw(tenantId: string, userId: string, id: string): Promise<CashAdvanceDto> {
    const res = await this.prisma.cashAdvance.updateMany({
      where: { id, tenantId, userId, status: 'REQUESTED' },
      data:  { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: userId },
    });
    if (res.count !== 1) throw new BadRequestException('Only a request that is still waiting can be withdrawn.');
    return this.getOne(tenantId, id);
  }

  // ── Owner / payroll master side ────────────────────────────────────────

  /** Record an advance that was handed over without a request in Sync. */
  async give(
    tenantId: string,
    actor: Actor,
    dto: { userId: string; amount: number; perPayday: number; paidFrom: string; reason?: string; givenOn?: string },
  ): Promise<CashAdvanceDto> {
    const bad = validateAdvanceTerms(dto.amount, dto.perPayday);
    if (bad) throw new BadRequestException(bad);
    this.assertNotSelf(actor, dto.userId);
    const employee = await this.assertEmployee(tenantId, dto.userId);
    const accounts = await this.resolveAccounts(tenantId, dto.paidFrom);
    const givenAt  = this.givenDate(dto.givenOn);

    const row = await this.prisma.cashAdvance.create({
      data: {
        tenantId,
        userId:       dto.userId,
        status:       'OPEN',
        amount:       dto.amount,
        perPayday:    dto.perPayday,
        balance:      dto.amount,
        reason:       dto.reason?.trim() || null,
        givenById:    actor.sub,
        decidedById:  actor.sub,
        givenAt,
        paidFromCode: dto.paidFrom,
      },
    });

    try {
      const je = await this.postGiven(tenantId, actor.sub, accounts, dto.amount, givenAt, employee.name, dto.paidFrom as CaPaidFrom, row.id);
      await this.prisma.cashAdvance.update({ where: { id: row.id }, data: { journalEntryId: je.id } });
    } catch (err) {
      // No entry, no advance: a closed period or a missing account must not
      // leave an OPEN advance that payslips would start taking back.
      await this.prisma.cashAdvance.delete({ where: { id: row.id } }).catch(() => undefined);
      throw err;
    }
    return this.getOne(tenantId, row.id);
  }

  /** Hand over the money for a staff request. Amount and pace may be changed. */
  async approve(
    tenantId: string,
    actor: Actor,
    id: string,
    dto: { paidFrom: string; amount?: number; perPayday?: number; givenOn?: string },
  ): Promise<CashAdvanceDto> {
    const req = await this.prisma.cashAdvance.findFirst({ where: { id, tenantId } });
    if (!req) throw new NotFoundException('Cash advance not found.');
    if (req.status !== 'REQUESTED') throw new BadRequestException('This request has already been decided.');
    this.assertNotSelf(actor, req.userId);
    const employee = await this.assertEmployee(tenantId, req.userId);

    const amount    = dto.amount    ?? num(req.amount);
    const perPayday = dto.perPayday ?? Math.min(num(req.perPayday), amount);
    const bad = validateAdvanceTerms(amount, perPayday);
    if (bad) throw new BadRequestException(bad);
    const accounts = await this.resolveAccounts(tenantId, dto.paidFrom);
    const givenAt  = this.givenDate(dto.givenOn);

    // Claim the request first so two people can't both pay it out.
    const claimed = await this.prisma.cashAdvance.updateMany({
      where: { id, tenantId, status: 'REQUESTED' },
      data: {
        status: 'OPEN', amount, perPayday, balance: amount,
        givenById: actor.sub, decidedById: actor.sub, givenAt, paidFromCode: dto.paidFrom,
      },
    });
    if (claimed.count !== 1) throw new ConflictException('Someone else just decided this request.');

    try {
      const je = await this.postGiven(tenantId, actor.sub, accounts, amount, givenAt, employee.name, dto.paidFrom as CaPaidFrom, id);
      await this.prisma.cashAdvance.update({ where: { id }, data: { journalEntryId: je.id } });
    } catch (err) {
      await this.prisma.cashAdvance.update({
        where: { id },
        data:  {
          status: 'REQUESTED', amount: req.amount, perPayday: req.perPayday, balance: 0,
          givenById: null, decidedById: null, givenAt: null, paidFromCode: null,
        },
      });
      throw err;
    }
    return this.getOne(tenantId, id);
  }

  async reject(tenantId: string, actor: Actor, id: string, reason: string): Promise<CashAdvanceDto> {
    const why = (reason ?? '').trim();
    if (why.length < 3) throw new BadRequestException('Give the staff member a short reason.');
    const req = await this.prisma.cashAdvance.findFirst({ where: { id, tenantId }, select: { userId: true } });
    if (!req) throw new NotFoundException('Cash advance not found.');
    this.assertNotSelf(actor, req.userId);
    const res = await this.prisma.cashAdvance.updateMany({
      where: { id, tenantId, status: 'REQUESTED' },
      data:  { status: 'REJECTED', decidedById: actor.sub, rejectionReason: why },
    });
    if (res.count !== 1) throw new BadRequestException('This request has already been decided.');
    return this.getOne(tenantId, id);
  }

  /**
   * Undo an advance recorded by mistake. Only while no payslip has taken
   * anything from it; after that the money is part of a payslip and has to
   * be fixed there.
   */
  async cancel(tenantId: string, actor: Actor, id: string): Promise<CashAdvanceDto> {
    const row = await this.prisma.cashAdvance.findFirst({
      where:   { id, tenantId },
      include: { _count: { select: { deductions: true } } },
    });
    if (!row) throw new NotFoundException('Cash advance not found.');
    if (row.status !== 'OPEN') throw new BadRequestException('Only an advance that is still being paid back can be cancelled.');
    if (row._count.deductions > 0 || num(row.balance) !== num(row.amount)) {
      throw new BadRequestException('A payslip has already taken part of this advance back, so it can no longer be cancelled.');
    }

    const res = await this.prisma.cashAdvance.updateMany({
      where: { id, tenantId, status: 'OPEN', balance: row.amount },
      data:  { status: 'CANCELLED', balance: 0, cancelledAt: new Date(), cancelledById: actor.sub },
    });
    if (res.count !== 1) throw new ConflictException('This advance changed while you were cancelling it. Refresh and try again.');

    if (row.journalEntryId) {
      try {
        await this.journal.reverse(tenantId, row.journalEntryId, actor.sub);
      } catch (err) {
        await this.prisma.cashAdvance.update({
          where: { id },
          data:  { status: 'OPEN', balance: row.amount, cancelledAt: null, cancelledById: null },
        });
        throw err;
      }
    }
    return this.getOne(tenantId, id);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private assertNotSelf(actor: Actor, employeeId: string) {
    if (actor.sub === employeeId) {
      throw new ForbiddenException("You can't give yourself a cash advance. The owner or another payroll person has to.");
    }
  }

  private async assertEmployee(tenantId: string, userId: string) {
    const u = await this.prisma.user.findFirst({
      where:  { id: userId, tenantId, role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR', 'KIOSK_DISPLAY'] as any[] } },
      select: { id: true, name: true, isActive: true },
    });
    if (!u) throw new NotFoundException('Staff member not found.');
    if (!u.isActive) throw new BadRequestException(`${u.name} is no longer active, so no new advance can be given.`);
    return u;
  }

  private async resolveAccounts(tenantId: string, paidFrom: string) {
    if (!(paidFrom in CA_PAID_FROM)) {
      throw new BadRequestException('Say where the money came from: cash on hand, petty cash or the bank.');
    }
    const [ca, from] = await Promise.all([
      this.accounts.findByCode(tenantId, CA_ACCOUNT),
      this.accounts.findByCode(tenantId, paidFrom),
    ]);
    if (!ca)   throw new BadRequestException(`Account ${CA_ACCOUNT} Advances to Employees is missing from this shop's chart of accounts.`);
    if (!from) throw new BadRequestException(`Account ${paidFrom} (${CA_PAID_FROM[paidFrom as CaPaidFrom]}) is missing from this shop's chart of accounts.`);
    return { caId: ca.id, fromId: from.id };
  }

  private givenDate(givenOn?: string): Date {
    if (!givenOn) return new Date();
    const d = new Date(`${givenOn.slice(0, 10)}T12:00:00+08:00`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('The date given must be a date (YYYY-MM-DD).');
    if (d.getTime() > Date.now() + 24 * 3600 * 1000) throw new BadRequestException("The date given can't be in the future.");
    return d;
  }

  private postGiven(
    tenantId: string, actorId: string,
    acc: { caId: string; fromId: string },
    amount: number, givenAt: Date, employeeName: string, paidFrom: CaPaidFrom, advanceId: string,
  ) {
    const day = givenAt.toISOString().slice(0, 10);
    return this.journal.create(
      tenantId,
      {
        date:        day,
        postingDate: day,
        description: `Cash advance to ${employeeName}`,
        reference:   `CA-${advanceId}`,
        lines: [
          { accountId: acc.caId,   debit:  amount, description: `Advance to ${employeeName}` },
          { accountId: acc.fromId, credit: amount, description: `Paid from ${CA_PAID_FROM[paidFrom].toLowerCase()}` },
        ],
      },
      actorId,
      'PAYROLL',
    );
  }

  private include() {
    return {
      user:       { select: { name: true } },
      deductions: {
        orderBy: { createdAt: 'asc' as const },
        select:  { amount: true, createdAt: true, payRun: { select: { label: true } } },
      },
    };
  }

  private async getOne(tenantId: string, id: string): Promise<CashAdvanceDto> {
    const r = await this.prisma.cashAdvance.findFirstOrThrow({ where: { id, tenantId }, include: this.include() });
    return this.serialize(r);
  }

  private serialize(r: any): CashAdvanceDto {
    return {
      id:              r.id,
      userId:          r.userId,
      employeeName:    r.user?.name ?? '',
      status:          r.status,
      amount:          num(r.amount),
      perPayday:       num(r.perPayday),
      balance:         num(r.balance),
      reason:          r.reason ?? null,
      paidFrom:        r.paidFromCode ? (CA_PAID_FROM as Record<string, string>)[r.paidFromCode] ?? r.paidFromCode : null,
      givenAt:         r.givenAt ? r.givenAt.toISOString() : null,
      rejectionReason: r.rejectionReason ?? null,
      createdAt:       r.createdAt.toISOString(),
      deductions:      (r.deductions ?? []).map((d: any) => ({
        payRunLabel: d.payRun?.label ?? '',
        amount:      num(d.amount),
        date:        d.createdAt.toISOString(),
      })),
    };
  }
}

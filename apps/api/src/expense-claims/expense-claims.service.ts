import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExpenseClaimStatus } from '@prisma/client';
import {
  CreateExpenseClaimDto,
  ReviewExpenseClaimDto,
  MarkPaidDto,
} from './dto/expense-claim.dto';

// Roles that can view all claims (not just their own)
const MANAGER_ROLES = [
  'BUSINESS_OWNER',
  'BRANCH_MANAGER',
  'ACCOUNTANT',
  'FINANCE_LEAD',
];

// Roles allowed to approve/reject claims
const REVIEWER_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'FINANCE_LEAD', 'ACCOUNTANT'];

// Roles allowed to mark claims as paid
const PAY_ROLES = ['BUSINESS_OWNER', 'FINANCE_LEAD'];

@Injectable()
export class ExpenseClaimsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private isManagerRole(role: string): boolean {
    return MANAGER_ROLES.includes(role);
  }

  // ── create ─────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    branchId: string | null,
    userId: string,
    dto: CreateExpenseClaimDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one expense item is required');
    }

    const totalAmount = dto.items.reduce((sum, item) => sum + item.amount, 0);
    const year = new Date().getFullYear();

    // Ensure the sequence row exists, then atomically increment.
    // Two-step to guarantee the update() path (which uses DB-level increment) always runs.
    await this.prisma.expenseClaimSequence.upsert({
      where:  { tenantId },
      create: { tenantId, lastNumber: 0 },
      update: {},
    });
    const seq = await this.prisma.expenseClaimSequence.update({
      where: { tenantId },
      data:  { lastNumber: { increment: 1 } },
    });

    const claimNumber = `EC-${year}-${String(seq.lastNumber).padStart(5, '0')}`;

    const claim = await this.prisma.$transaction(async (tx) => {
      return tx.expenseClaim.create({
        data: {
          tenantId,
          branchId:      branchId ?? undefined,
          claimNumber,
          submittedById: userId,
          title:         dto.title,
          description:   dto.description,
          totalAmount,
          status:        'DRAFT',
          items: {
            create: dto.items.map((item) => ({
              category:    item.category,
              description: item.description,
              amount:      item.amount,
              receiptDate: new Date(item.receiptDate),
              receiptRef:  item.receiptRef,
            })),
          },
        },
        include: { items: true },
      });
    });

    return claim;
  }

  // ── list ───────────────────────────────────────────────────────────────────

  async list(
    tenantId: string,
    userId: string,
    role: string,
    status?: ExpenseClaimStatus,
    page = 1,
    limit = 20,
  ) {
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;
    const isManager = this.isManagerRole(role);

    const where = {
      tenantId,
      ...(status ? { status } : {}),
      // Non-managers only see their own claims
      ...(!isManager ? { submittedById: userId } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.expenseClaim.count({ where }),
      this.prisma.expenseClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { items: true } },
          // Include submitter name for manager view
          ...(isManager
            ? {
                items: false,
              }
            : {}),
        },
      }),
    ]);

    // For manager view, attach submitter names
    if (isManager) {
      const submitterIds = [...new Set(data.map((c) => c.submittedById))];
      const users = await this.prisma.user.findMany({
        where: { id: { in: submitterIds } },
        select: { id: true, name: true, email: true },
      });
      const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

      const enriched = data.map((claim) => ({
        ...claim,
        submittedBy: userMap[claim.submittedById] ?? null,
      }));

      return { data: enriched, total, page, pages: Math.ceil(total / take) };
    }

    return { data, total, page, pages: Math.ceil(total / take) };
  }

  // ── findOne ────────────────────────────────────────────────────────────────

  async findOne(
    tenantId: string,
    claimId: string,
    userId: string,
    role: string,
  ) {
    const isManager = this.isManagerRole(role);

    const claim = await this.prisma.expenseClaim.findFirst({
      where: {
        id: claimId,
        tenantId,
        ...(!isManager ? { submittedById: userId } : {}),
      },
      include: { items: true },
    });

    if (!claim) throw new NotFoundException('Expense claim not found');

    // Enrich with submitter info
    const submitter = await this.prisma.user.findUnique({
      where:  { id: claim.submittedById },
      select: { id: true, name: true, email: true },
    });

    return { ...claim, submittedBy: submitter };
  }

  // ── submit ─────────────────────────────────────────────────────────────────

  async submit(tenantId: string, claimId: string, userId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId },
    });

    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.submittedById !== userId) {
      throw new ForbiddenException('You can only submit your own claims');
    }
    if (claim.status !== 'DRAFT') {
      throw new BadRequestException(
        `Claim cannot be submitted from status: ${claim.status}`,
      );
    }

    return this.prisma.expenseClaim.update({
      where: { id: claimId },
      data:  { status: 'SUBMITTED', submittedAt: new Date() },
      include: { items: true },
    });
  }

  // ── retract ────────────────────────────────────────────────────────────────

  async retract(tenantId: string, claimId: string, userId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId },
    });

    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.submittedById !== userId) {
      throw new ForbiddenException('You can only retract your own claims');
    }
    if (claim.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Only SUBMITTED claims can be retracted. Current status: ${claim.status}`,
      );
    }

    return this.prisma.expenseClaim.update({
      where: { id: claimId },
      data:  { status: 'DRAFT', submittedAt: null },
      include: { items: true },
    });
  }

  // ── review ─────────────────────────────────────────────────────────────────

  async review(
    tenantId: string,
    claimId: string,
    reviewerId: string,
    role: string,
    dto: ReviewExpenseClaimDto,
  ) {
    if (!REVIEWER_ROLES.includes(role)) {
      throw new ForbiddenException(
        'Only BUSINESS_OWNER, BRANCH_MANAGER, FINANCE_LEAD, or ACCOUNTANT can review claims',
      );
    }

    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId },
    });

    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Only SUBMITTED claims can be reviewed. Current status: ${claim.status}`,
      );
    }
    if (claim.submittedById === reviewerId) {
      throw new ForbiddenException('You cannot review your own expense claim');
    }

    const newStatus: ExpenseClaimStatus =
      dto.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    return this.prisma.expenseClaim.update({
      where: { id: claimId },
      data: {
        status:      newStatus,
        reviewedById: reviewerId,
        reviewedAt:  new Date(),
        reviewNotes: dto.reviewNotes,
      },
      include: { items: true },
    });
  }

  // ── markPaid ───────────────────────────────────────────────────────────────

  async markPaid(
    tenantId: string,
    claimId: string,
    role: string,
    dto: MarkPaidDto,
  ) {
    if (!PAY_ROLES.includes(role)) {
      throw new ForbiddenException(
        'Only BUSINESS_OWNER or FINANCE_LEAD can mark claims as paid',
      );
    }

    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId },
    });

    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.status !== 'APPROVED') {
      throw new BadRequestException(
        `Only APPROVED claims can be marked as paid. Current status: ${claim.status}`,
      );
    }

    /*
      Reimbursing a claim is money leaving the business, so it has to reach
      the books.

      Nothing in this whole directory referenced the journal: a claim went
      DRAFT to SUBMITTED to APPROVED to PAID, the employee got their money,
      and the expense never appeared anywhere. The shop's costs were
      understated by every peso ever reimbursed, and the period-close
      checklist told the owner these would 'leak across periods' while the
      screen quietly posted nothing at all.

      Posted on PAID rather than APPROVED because that is when the cash
      actually moves. Approving creates an obligation, not an outflow, and
      accruing it would need a liability account and a settlement path that
      this flow does not have.

      Emitted as PAID_OUT, one per line, because that is exactly this shape
      already: Dr expense routed by category / Cr cash. One event per line
      rather than per claim keeps the category detail in the GL instead of
      collapsing a taxi fare and a box of receipts into one number.

      In the same transaction as the status change: a claim marked PAID whose
      events did not queue would be invisible to both the screen and the
      books, and nothing would ever look at it again.
    */
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.expenseClaim.update({
        where: { id: claimId },
        data: {
          status:     'PAID',
          paidAt:     new Date(),
          paymentRef: dto.paymentRef,
        },
        include: { items: true },
      });

      for (const item of updated.items) {
        const amount = Number(item.amount);
        if (!(amount > 0)) continue;
        await tx.accountingEvent.create({
          data: {
            tenantId,
            type:   'PAID_OUT',
            status: 'PENDING',
            payload: {
              amount,
              category: String(item.category ?? 'OTHER').toUpperCase(),
              reason:   `Reimbursement ${updated.claimNumber ?? claimId.slice(-6)}` +
                        (item.description ? ` — ${item.description}` : ''),
            } as unknown as Prisma.JsonObject,
          },
        });
      }

      return updated;
    });
  }

  // ── deleteDraft ────────────────────────────────────────────────────────────

  async deleteDraft(tenantId: string, claimId: string, userId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId },
    });

    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.submittedById !== userId) {
      throw new ForbiddenException('You can only delete your own claims');
    }
    if (claim.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only DRAFT claims can be deleted. Current status: ${claim.status}`,
      );
    }

    await this.prisma.expenseClaim.delete({ where: { id: claimId } });
    return { message: 'Claim deleted successfully' };
  }
}

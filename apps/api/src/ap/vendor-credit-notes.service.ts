/**
 * VendorCreditNotesService — AP vendor credit note CRUD + GL posting +
 * bill application. Mirror of CreditMemosService for AP.
 *
 * Lifecycle:
 *   create()  → DRAFT  (no GL impact, editable)
 *   update()  → DRAFT (mutate while still draft)
 *   post()    → DRAFT → POSTED  (DR Accounts Payable · CR Expense/Inventory)
 *   apply()   → POSTED/APPLIED  (decreases APBill.balanceAmount, flips note → APPLIED when fully consumed)
 *   void()    → POSTED/APPLIED → VOIDED (reverses JE + unwinds applications)
 *
 * SOD: an AP_ACCOUNTANT cannot both create and post a credit note for the
 * same vendor (mirror of bill SOD on ap-bills.service.ts post()).
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { Prisma, VendorCreditNoteStatus, type TaxStatus } from '@prisma/client';
import {
  CreateVendorCreditNoteDto,
  UpdateVendorCreditNoteDto,
  ApplyVendorCreditNoteDto,
} from './dto/vendor-credit-note.dto';

@Injectable()
export class VendorCreditNotesService {
  constructor(
    private prisma:    PrismaService,
    private journal:   JournalService,
    private periods:   AccountingPeriodsService,
    private numbering: NumberingService,
    private audit:     AuditService,
  ) {}

  // ── COA lookups (mirror ap-bills.service.ts) ───────────────────────────────

  private async findApPayablesAccount(tenantId: string): Promise<string> {
    const byCode = await this.prisma.account.findFirst({
      where: { tenantId, code: '2010', isActive: true }, select: { id: true },
    });
    if (byCode) return byCode.id;
    const fallback = await this.prisma.account.findFirst({
      where: {
        tenantId, type: 'LIABILITY', isActive: true,
        OR: [
          { name: { contains: 'payable', mode: 'insensitive' } },
          { name: { contains: 'AP',      mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (fallback) return fallback.id;
    throw new BadRequestException('No AP Payables account in COA. Add one (e.g. code 2010, type LIABILITY).');
  }

  private async findInputVatAccount(tenantId: string): Promise<{ id: string } | null> {
    const byCode = await this.prisma.account.findFirst({
      where:  { tenantId, code: '1040', isActive: true },
      select: { id: true },
    });
    if (byCode) return byCode;
    return this.prisma.account.findFirst({
      where:  { tenantId, type: 'ASSET', isActive: true, name: { contains: 'input vat', mode: 'insensitive' } },
      select: { id: true },
    });
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateVendorCreditNoteDto) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Vendor credit note must have at least one line.');
    }

    const vendor = await this.prisma.vendor.findFirst({
      where:  { id: dto.vendorId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');

    const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
    const validAccounts = await this.prisma.account.count({
      where: { id: { in: accountIds }, tenantId, isActive: true },
    });
    if (validAccounts !== accountIds.length) {
      throw new BadRequestException('One or more line accounts are invalid for this tenant.');
    }

    if (dto.relatedBillId) {
      const bill = await this.prisma.aPBill.findFirst({
        where:  { id: dto.relatedBillId, tenantId, vendorId: dto.vendorId },
        select: { id: true },
      });
      if (!bill) throw new BadRequestException('relatedBillId is not a valid bill for this vendor.');
    }

    const noteDate    = new Date(dto.noteDate);
    const postingDate = dto.postingDate ? new Date(dto.postingDate) : noteDate;

    const subtotal  = dto.lines.reduce((s, l) => s + (l.lineTotal - (l.taxAmount ?? 0)), 0);
    const vatAmount = dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
    const total     = dto.lines.reduce((s, l) => s + l.lineTotal, 0);

    return this.prisma.$transaction(async (tx) => {
      const noteNumber = await this.numbering.next(tenantId, 'AP_CREDIT_NOTE', null, tx);

      return tx.vendorCreditNote.create({
        data: {
          tenantId,
          branchId:        dto.branchId ?? null,
          noteNumber,
          vendorNoteRef:   dto.vendorNoteRef,
          vendorId:        dto.vendorId,
          noteDate,
          postingDate,
          reason:          dto.reason ?? 'OTHER',
          reasonNotes:     dto.reasonNotes,
          relatedBillId:   dto.relatedBillId,
          subtotal:        new Prisma.Decimal(subtotal),
          vatAmount:       new Prisma.Decimal(vatAmount),
          totalAmount:     new Prisma.Decimal(total),
          appliedAmount:   new Prisma.Decimal(0),
          unappliedAmount: new Prisma.Decimal(total),
          status:          'DRAFT',
          description:     dto.description,
          notes:           dto.notes,
          createdById:     userId,
          lines: {
            create: dto.lines.map((l) => ({
              accountId:   l.accountId,
              description: l.description,
              quantity:    new Prisma.Decimal(l.quantity ?? 1),
              unitPrice:   new Prisma.Decimal(l.unitPrice),
              taxAmount:   new Prisma.Decimal(l.taxAmount ?? 0),
              lineTotal:   new Prisma.Decimal(l.lineTotal),
            })),
          },
        },
        include: { lines: true, vendor: { select: { id: true, name: true } } },
      });
    });
  }

  async update(tenantId: string, noteId: string, userId: string, dto: UpdateVendorCreditNoteDto) {
    const note = await this.prisma.vendorCreditNote.findFirst({
      where:  { id: noteId, tenantId },
      select: { id: true, status: true, vendorId: true },
    });
    if (!note) throw new NotFoundException('Vendor credit note not found.');
    if (note.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot update vendor credit note in status ${note.status}.`);
    }

    if (dto.lines) {
      if (dto.lines.length === 0) {
        throw new BadRequestException('Vendor credit note must have at least one line.');
      }
      const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
      const validAccounts = await this.prisma.account.count({
        where: { id: { in: accountIds }, tenantId, isActive: true },
      });
      if (validAccounts !== accountIds.length) {
        throw new BadRequestException('One or more line accounts are invalid for this tenant.');
      }
    }
    if (dto.relatedBillId) {
      const bill = await this.prisma.aPBill.findFirst({
        where:  { id: dto.relatedBillId, tenantId, vendorId: note.vendorId },
        select: { id: true },
      });
      if (!bill) throw new BadRequestException('relatedBillId is not a valid bill for this vendor.');
    }

    return this.prisma.$transaction(async (tx) => {
      const patch: Prisma.VendorCreditNoteUpdateInput = {};
      if (dto.noteDate)      patch.noteDate    = new Date(dto.noteDate);
      if (dto.postingDate)   patch.postingDate = new Date(dto.postingDate);
      if (dto.vendorNoteRef !== undefined) patch.vendorNoteRef = dto.vendorNoteRef;
      if (dto.reason)        patch.reason = dto.reason;
      if (dto.reasonNotes !== undefined)  patch.reasonNotes = dto.reasonNotes;
      if (dto.relatedBillId !== undefined) patch.relatedBillId = dto.relatedBillId;
      if (dto.description !== undefined)  patch.description = dto.description;
      if (dto.notes !== undefined)        patch.notes = dto.notes;

      if (dto.lines) {
        const subtotal  = dto.lines.reduce((s, l) => s + (l.lineTotal - (l.taxAmount ?? 0)), 0);
        const vatAmount = dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
        const total     = dto.lines.reduce((s, l) => s + l.lineTotal, 0);
        patch.subtotal        = new Prisma.Decimal(subtotal);
        patch.vatAmount       = new Prisma.Decimal(vatAmount);
        patch.totalAmount     = new Prisma.Decimal(total);
        patch.unappliedAmount = new Prisma.Decimal(total);

        await tx.vendorCreditNoteLine.deleteMany({ where: { noteId } });
        patch.lines = {
          create: dto.lines.map((l) => ({
            accountId:   l.accountId,
            description: l.description,
            quantity:    new Prisma.Decimal(l.quantity ?? 1),
            unitPrice:   new Prisma.Decimal(l.unitPrice),
            taxAmount:   new Prisma.Decimal(l.taxAmount ?? 0),
            lineTotal:   new Prisma.Decimal(l.lineTotal),
          })),
        };
      }

      const guard = await tx.vendorCreditNote.updateMany({
        where: { id: noteId, tenantId, status: 'DRAFT' },
        data:  { updatedAt: new Date() },
      });
      if (guard.count === 0) {
        throw new ConflictException('Vendor credit note is no longer in DRAFT status.');
      }
      return tx.vendorCreditNote.update({
        where: { id: noteId },
        data:  patch,
        include: { lines: true, vendor: { select: { id: true, name: true } } },
      });
    });
  }

  async post(tenantId: string, noteId: string, userId: string, callerRole?: string) {
    const note = await this.prisma.vendorCreditNote.findFirst({
      where:   { id: noteId, tenantId },
      include: { lines: true, vendor: { select: { name: true } } },
    });
    if (!note) throw new NotFoundException('Vendor credit note not found.');
    if (note.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot post vendor credit note in status ${note.status}.`);
    }

    // SOD mirror of ap-bills.service.post().
    if (callerRole === 'AP_ACCOUNTANT' && note.createdById === userId) {
      throw new ForbiddenException(
        'You cannot post a vendor credit note that you created. Ask the owner or accountant to post it.',
      );
    }

    await this.periods.assertDateIsOpen(tenantId, note.postingDate);

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId }, select: { taxStatus: true },
    });
    const isVatRegistered = (tenant.taxStatus as TaxStatus) === 'VAT';

    const apAccountId = await this.findApPayablesAccount(tenantId);
    const vatAccount  = isVatRegistered ? await this.findInputVatAccount(tenantId) : null;
    if (isVatRegistered && Number(note.vatAmount) > 0 && !vatAccount) {
      throw new BadRequestException('VAT-registered tenant has no Input VAT account in COA.');
    }

    return this.prisma.$transaction(async (tx) => {
      const total     = Number(note.totalAmount);
      const vatAmount = Number(note.vatAmount);
      const lines: Array<{ accountId: string; debit?: number; credit?: number; description?: string }> = [];

      // Debit AP for the gross total (we owe vendor less now).
      lines.push({
        accountId:   apAccountId,
        debit:       total,
        description: `${note.vendor.name} - ${note.noteNumber}`,
      });

      // Credit each expense/inventory account on the lines (net of VAT — reverses the original bill expense).
      for (const line of note.lines) {
        const lineNet = Number(line.lineTotal) - Number(line.taxAmount);
        if (lineNet > 0) {
          lines.push({
            accountId:   line.accountId,
            credit:      lineNet,
            description: line.description ?? `Vendor credit ${note.noteNumber}`,
          });
        }
      }
      // Credit Input VAT contra (reverses the original bill's input VAT we claimed).
      if (vatAccount && vatAmount > 0) {
        lines.push({
          accountId:   vatAccount.id,
          credit:      vatAmount,
          description: `Input VAT reversal — ${note.noteNumber}`,
        });
      }

      const je = await this.journal.create(
        tenantId,
        {
          date:        note.noteDate.toISOString(),
          postingDate: note.postingDate.toISOString(),
          description: `AP Vendor Credit Note ${note.noteNumber} — ${note.vendor.name}`,
          reference:   note.vendorNoteRef ?? note.noteNumber,
          saveDraft:   false,
          lines,
        },
        userId,
        'AP',
      );

      const claim = await tx.vendorCreditNote.updateMany({
        where: { id: note.id, tenantId, status: 'DRAFT' },
        data: {
          status:         'POSTED',
          postedById:     userId,
          postedAt:       new Date(),
          journalEntryId: je.id,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Vendor credit note was already posted concurrently.');
      }

      void this.audit.log({
        tenantId,
        action:      'AP_BILL_POSTED',
        entityType:  'VendorCreditNote',
        entityId:    note.id,
        performedBy: userId,
        description: `AP vendor credit note ${note.noteNumber} posted (vendor ${note.vendor.name}, ₱${Number(note.totalAmount).toFixed(2)})`,
        before:      { status: 'DRAFT' },
        after:       {
          status:         'POSTED',
          noteNumber:     note.noteNumber,
          totalAmount:    Number(note.totalAmount),
          journalEntryId: je.id,
        },
      });

      return tx.vendorCreditNote.findFirstOrThrow({
        where: { id: note.id, tenantId },
        include: {
          lines:        true,
          vendor:       { select: { id: true, name: true } },
          journalEntry: { select: { id: true, entryNumber: true } },
        },
      });
    }, { timeout: 30_000 });
  }

  async apply(tenantId: string, noteId: string, userId: string, dto: ApplyVendorCreditNoteDto) {
    if (dto.amount <= 0) throw new BadRequestException('amount must be > 0.');

    const note = await this.prisma.vendorCreditNote.findFirst({
      where: { id: noteId, tenantId },
    });
    if (!note) throw new NotFoundException('Vendor credit note not found.');
    if (note.status !== 'POSTED' && note.status !== 'APPLIED') {
      throw new BadRequestException(`Cannot apply vendor credit note in status ${note.status}.`);
    }

    const remaining = Number(note.unappliedAmount);
    if (dto.amount > remaining + 0.01) {
      throw new BadRequestException(
        `Cannot apply ${dto.amount.toFixed(2)} — only ${remaining.toFixed(2)} unapplied on this note.`,
      );
    }

    const bill = await this.prisma.aPBill.findFirst({
      where:  { id: dto.billId, tenantId, vendorId: note.vendorId },
      select: { id: true, status: true, balanceAmount: true, totalAmount: true, paidAmount: true, whtAmount: true, billNumber: true },
    });
    if (!bill) throw new BadRequestException(`Bill ${dto.billId} not found for this vendor.`);
    if (!['OPEN', 'PARTIALLY_PAID'].includes(bill.status)) {
      throw new BadRequestException(`Bill ${bill.billNumber} is in status ${bill.status} — cannot apply credit.`);
    }
    if (dto.amount > Number(bill.balanceAmount) + 0.01) {
      throw new BadRequestException(
        `Cannot apply ${dto.amount.toFixed(2)} to ${bill.billNumber} — balance is only ${Number(bill.balanceAmount).toFixed(2)}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.vendorCreditNoteApplication.create({
        data: {
          noteId:        note.id,
          billId:        bill.id,
          appliedAmount: new Prisma.Decimal(dto.amount),
          appliedById:   userId,
        },
      });

      // Recompute note applied/unapplied + status
      const sumNote = await tx.vendorCreditNoteApplication.aggregate({
        where: { noteId: note.id },
        _sum:  { appliedAmount: true },
      });
      const totalAppliedOnNote = Number(sumNote._sum.appliedAmount ?? 0);
      const noteTotal          = Number(note.totalAmount);
      const noteUnapplied      = Math.max(0, noteTotal - totalAppliedOnNote);
      const noteStatus: VendorCreditNoteStatus =
        noteUnapplied <= 0.01 ? 'APPLIED' : 'POSTED';

      await tx.vendorCreditNote.update({
        where: { id: note.id },
        data: {
          appliedAmount:   new Prisma.Decimal(totalAppliedOnNote),
          unappliedAmount: new Prisma.Decimal(noteUnapplied),
          status:          noteStatus,
        },
      });

      // Bill subledger update — bill net payable basis = totalAmount - whtAmount.
      const billNet    = Number(bill.totalAmount) - Number(bill.whtAmount);
      const newBalance = Math.max(0, Number(bill.balanceAmount) - dto.amount);
      const newPaid    = billNet - newBalance;
      const newStatus =
        newBalance <= 0.01     ? 'PAID' :
        newPaid    >  0.01     ? 'PARTIALLY_PAID' :
                                 bill.status;

      await tx.aPBill.update({
        where: { id: bill.id },
        data: {
          paidAmount:    new Prisma.Decimal(newPaid),
          balanceAmount: new Prisma.Decimal(newBalance),
          status:        newStatus,
        },
      });

      void this.audit.log({
        tenantId,
        action:      'AP_BILL_POSTED',
        entityType:  'VendorCreditNoteApplication',
        entityId:    note.id,
        performedBy: userId,
        description: `Vendor credit note ${note.noteNumber} applied ₱${dto.amount.toFixed(2)} to bill ${bill.billNumber}`,
        after: {
          noteId: note.id, billId: bill.id, amount: dto.amount,
          noteStatus, billStatus: newStatus,
        },
      });

      return tx.vendorCreditNote.findFirstOrThrow({
        where: { id: note.id, tenantId },
        include: {
          applications: { include: { bill: { select: { id: true, billNumber: true, balanceAmount: true, status: true } } } },
        },
      });
    }, { timeout: 30_000 });
  }

  async void(tenantId: string, noteId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Void reason is required (>= 5 characters).');
    }

    const note = await this.prisma.vendorCreditNote.findFirst({
      where:   { id: noteId, tenantId },
      include: { applications: { select: { billId: true, appliedAmount: true } } },
    });
    if (!note) throw new NotFoundException('Vendor credit note not found.');
    if (note.status === 'VOIDED') {
      throw new BadRequestException('Vendor credit note is already voided.');
    }
    if (note.status === 'DRAFT') {
      throw new BadRequestException('Cannot void a DRAFT vendor credit note — delete or cancel it instead.');
    }
    if (!note.journalEntryId) {
      throw new BadRequestException('Vendor credit note has no posted JE to reverse.');
    }

    await this.periods.assertDateIsOpen(tenantId, new Date());

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.vendorCreditNote.updateMany({
        where: { id: note.id, tenantId, status: { in: ['POSTED', 'APPLIED'] } },
        data: {
          status:          'VOIDED',
          voidedById:      userId,
          voidedAt:        new Date(),
          voidReason:      reason.trim(),
          appliedAmount:   new Prisma.Decimal(0),
          unappliedAmount: note.totalAmount,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Vendor credit note was already voided concurrently.');
      }

      await this.journal.reverse(tenantId, note.journalEntryId!, userId);

      for (const app of note.applications) {
        const bill = await tx.aPBill.findUnique({
          where:  { id: app.billId },
          select: { totalAmount: true, whtAmount: true, paidAmount: true, balanceAmount: true, status: true },
        });
        if (!bill) continue;
        const amt        = Number(app.appliedAmount);
        const billNet    = Number(bill.totalAmount) - Number(bill.whtAmount);
        const newBalance = Math.min(billNet, Number(bill.balanceAmount) + amt);
        const newPaid    = Math.max(0, Number(bill.paidAmount) - amt);
        const newStatus  =
          bill.status === 'VOIDED' || bill.status === 'CANCELLED' ? bill.status :
          newBalance >= billNet - 0.01                             ? 'OPEN' :
          newPaid    >  0.01                                        ? 'PARTIALLY_PAID' :
                                                                     'OPEN';
        await tx.aPBill.update({
          where: { id: app.billId },
          data: {
            paidAmount:    new Prisma.Decimal(newPaid),
            balanceAmount: new Prisma.Decimal(newBalance),
            status:        newStatus,
          },
        });
      }
      await tx.vendorCreditNoteApplication.deleteMany({ where: { noteId: note.id } });

      void this.audit.log({
        tenantId,
        action:      'AP_BILL_VOIDED',
        entityType:  'VendorCreditNote',
        entityId:    note.id,
        performedBy: userId,
        description: `AP vendor credit note ${note.noteNumber} voided: ${reason.trim().slice(0, 200)}`,
        before:      { status: note.status },
        after:       { status: 'VOIDED', voidReason: reason.trim() },
      });

      return tx.vendorCreditNote.findFirstOrThrow({ where: { id: note.id, tenantId } });
    }, { timeout: 30_000 });
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    opts: {
      page?:     number;
      pageSize?: number;
      vendorId?: string;
      status?:   VendorCreditNoteStatus | VendorCreditNoteStatus[];
      from?:     string;
      to?:       string;
    },
  ) {
    const page     = opts.page     ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.VendorCreditNoteWhereInput = { tenantId };
    if (opts.vendorId) where.vendorId = opts.vendorId;
    if (opts.status) where.status = Array.isArray(opts.status) ? { in: opts.status } : opts.status;
    if (opts.from || opts.to) {
      where.postingDate = {};
      if (opts.from) (where.postingDate as { gte?: Date }).gte = new Date(opts.from);
      if (opts.to)   (where.postingDate as { lte?: Date }).lte = new Date(opts.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.vendorCreditNote.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { noteNumber: 'desc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          vendor: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.vendorCreditNote.count({ where }),
    ]);
    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, noteId: string) {
    const note = await this.prisma.vendorCreditNote.findFirst({
      where: { id: noteId, tenantId },
      include: {
        lines:    { include: { account: { select: { code: true, name: true } } } },
        vendor:   true,
        branch:   { select: { id: true, name: true } },
        applications: {
          include: { bill: { select: { id: true, billNumber: true, balanceAmount: true, status: true } } },
          orderBy: { appliedAt: 'asc' },
        },
        journalEntry: { select: { id: true, entryNumber: true, status: true } },
      },
    });
    if (!note) throw new NotFoundException('Vendor credit note not found.');
    return note;
  }
}

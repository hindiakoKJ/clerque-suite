import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { AccountsService } from '../accounting/accounts.service';
import { TaxCalculatorService } from '../tax/tax.service';
import type { TaxStatus } from '../tax/tax.service';

/**
 * Equipment rentals for the courts / sports-facility vertical — paddles,
 * shoes, ball tubes hired at the counter and RETURNED.
 *
 * Distinct from the DME `rentals` module (medical equipment, serial-tracked,
 * RentalAgreement/SerializedUnit). This one is built for named, tracked
 * returnable units with a rent-fee-as-income + refundable-deposit-as-liability
 * split. See RentableItem / RentalTransaction / RentalLine.
 */

/** Integer centavos → peso number for the Decimal ledger. Exact, never a float op. */
const pesos = (centavos: number): number => Math.round(centavos) / 100;

type Tender = 'CASH' | 'GCASH_BUSINESS' | 'MAYA_BUSINESS' | 'QR_PH';

interface RentOutDto {
  customerName:    string;
  customerMobile?: string;
  customerId?:     string;
  itemIds:         string[];
  tenderMethod?:   Tender;
  dueAt?:          string;
  notes?:          string;
}

@Injectable()
export class EquipmentRentalsService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly journal:  JournalService,
    private readonly accounts: AccountsService,
    private readonly tax:      TaxCalculatorService,
  ) {}

  // ─── Catalog ─────────────────────────────────────────────────────────────

  async createItem(tenantId: string, dto: {
    name: string; category?: string; assetTag?: string;
    rentFeeCentavos?: number; depositCentavos?: number; branchId?: string;
  }) {
    if (!dto.name?.trim()) throw new BadRequestException('Item name is required.');
    return this.prisma.rentableItem.create({
      data: {
        tenantId,
        branchId:        dto.branchId ?? null,
        name:            dto.name.trim(),
        category:        dto.category ?? null,
        assetTag:        dto.assetTag ?? null,
        rentFeeCentavos: Math.max(0, Math.round(dto.rentFeeCentavos ?? 0)),
        depositCentavos: Math.max(0, Math.round(dto.depositCentavos ?? 0)),
      },
    });
  }

  async listItems(tenantId: string, opts: { status?: string; includeInactive?: boolean } = {}) {
    return this.prisma.rentableItem.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: opts.status as Prisma.EnumRentableItemStatusFilter } : {}),
        ...(opts.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
  }

  async updateItem(tenantId: string, id: string, dto: {
    name?: string; category?: string; assetTag?: string;
    rentFeeCentavos?: number; depositCentavos?: number; isActive?: boolean;
  }) {
    await this.getItem(tenantId, id);
    const data: Prisma.RentableItemUpdateInput = {};
    if (dto.name !== undefined)            data.name = dto.name.trim();
    if (dto.category !== undefined)        data.category = dto.category;
    if (dto.assetTag !== undefined)        data.assetTag = dto.assetTag;
    if (dto.rentFeeCentavos !== undefined) data.rentFeeCentavos = Math.max(0, Math.round(dto.rentFeeCentavos));
    if (dto.depositCentavos !== undefined) data.depositCentavos = Math.max(0, Math.round(dto.depositCentavos));
    if (dto.isActive !== undefined)        data.isActive = dto.isActive;
    return this.prisma.rentableItem.update({ where: { id }, data });
  }

  /** Who has my paddle right now — the OUT rentals holding this item. */
  async whoHasItem(tenantId: string, id: string) {
    await this.getItem(tenantId, id);
    const lines = await this.prisma.rentalLine.findMany({
      where: {
        itemId: id, returned: false, forfeited: false,
        rental: { tenantId, status: { in: ['OUT', 'OVERDUE'] } },
      },
      include: { rental: { select: { rentalNumber: true, customerName: true, customerMobile: true, timeOut: true, dueAt: true } } },
    });
    return lines.map((l) => l.rental);
  }

  // ─── Rent out ────────────────────────────────────────────────────────────

  async rentOut(tenantId: string, createdById: string | null, dto: RentOutDto) {
    if (!dto.customerName?.trim()) throw new BadRequestException('Customer name is required.');
    if (!dto.itemIds?.length)      throw new BadRequestException('At least one item is required.');

    const items = await this.prisma.rentableItem.findMany({
      where: { id: { in: dto.itemIds }, tenantId },
    });
    if (items.length !== new Set(dto.itemIds).size) {
      throw new BadRequestException('One or more items do not belong to your club.');
    }
    const unavailable = items.filter((i) => i.status !== 'AVAILABLE' || !i.isActive);
    if (unavailable.length) {
      throw new BadRequestException(
        `Not available: ${unavailable.map((i) => i.name).join(', ')}. Mark returned first.`,
      );
    }

    const rentFeeCentavos = items.reduce((s, i) => s + i.rentFeeCentavos, 0);
    const depositCentavos = items.reduce((s, i) => s + i.depositCentavos, 0);
    const taxStatus = await this.tenantTaxStatus(tenantId);
    const tender: Tender = dto.tenderMethod ?? 'CASH';

    const rental = await this.prisma.$transaction(async (tx) => {
      const rentalNumber = await this.nextRentalNumber(tx, tenantId);
      const created = await tx.rentalTransaction.create({
        data: {
          tenantId,
          branchId:        items[0].branchId ?? null,
          rentalNumber,
          customerName:    dto.customerName.trim(),
          customerMobile:  dto.customerMobile ?? null,
          customerId:      dto.customerId ?? null,
          status:          'OUT',
          rentFeeCentavos,
          depositHeldCentavos: depositCentavos,
          dueAt:           dto.dueAt ? new Date(dto.dueAt) : null,
          notes:           dto.notes ?? null,
          createdById,
          lines: {
            create: items.map((i) => ({
              itemId:          i.id,
              rentFeeCentavos: i.rentFeeCentavos,
              depositCentavos: i.depositCentavos,
            })),
          },
        },
        include: { lines: true },
      });
      await tx.rentableItem.updateMany({
        where: { id: { in: dto.itemIds } }, data: { status: 'RENTED' },
      });
      return created;
    });

    // Rent fee is INCOME now (never refunded); the deposit is a LIABILITY we
    // hold and owe back. Strictly separate — see the two credit lines.
    await this.postRentOut(tenantId, rental.rentalNumber, rentFeeCentavos, depositCentavos, taxStatus, tender);
    return rental;
  }

  // ─── Return / forfeit ────────────────────────────────────────────────────

  async returnRental(tenantId: string, rentalId: string, dto: {
    lineIds?: string[]; condition: 'good' | 'loss'; tenderMethod?: Tender;
  }) {
    const rental = await this.prisma.rentalTransaction.findFirst({
      where: { id: rentalId, tenantId }, include: { lines: true },
    });
    if (!rental) throw new NotFoundException('Rental not found.');

    const openLines = rental.lines.filter((l) => !l.returned && !l.forfeited);
    const target = dto.lineIds?.length
      ? openLines.filter((l) => dto.lineIds!.includes(l.id))
      : openLines;
    if (!target.length) throw new BadRequestException('No open lines to settle.');

    const tender: Tender = dto.tenderMethod ?? 'CASH';
    const isLoss = dto.condition === 'loss';
    const depositMoved = target.reduce((s, l) => s + l.depositCentavos, 0);

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      for (const l of target) {
        await tx.rentalLine.update({
          where: { id: l.id },
          data:  { returned: !isLoss, forfeited: isLoss, returnedAt: now },
        });
        await tx.rentableItem.update({
          where: { id: l.itemId },
          data:  { status: isLoss ? 'RETIRED' : 'AVAILABLE', ...(isLoss ? { isActive: false } : {}) },
        });
      }
      const after = await tx.rentalLine.findMany({ where: { rentalId } });
      const allSettled  = after.every((l) => l.returned || l.forfeited);
      const anyForfeited = after.some((l) => l.forfeited);
      await tx.rentalTransaction.update({
        where: { id: rentalId },
        data: {
          depositRefundedCentavos:  isLoss ? rental.depositRefundedCentavos  : rental.depositRefundedCentavos + depositMoved,
          depositForfeitedCentavos: isLoss ? rental.depositForfeitedCentavos + depositMoved : rental.depositForfeitedCentavos,
          status: allSettled ? (anyForfeited ? 'LOST' : 'RETURNED') : rental.status,
          timeIn: allSettled ? now : null,
        },
      });
    });

    if (depositMoved > 0) {
      if (isLoss) await this.postForfeit(tenantId, rental.rentalNumber, depositMoved);
      else        await this.postDepositRefund(tenantId, rental.rentalNumber, depositMoved, tender);
    }

    return this.prisma.rentalTransaction.findFirst({
      where: { id: rentalId, tenantId }, include: { lines: true },
    });
  }

  async listRentals(tenantId: string, opts: { status?: string } = {}) {
    return this.prisma.rentalTransaction.findMany({
      where: { tenantId, ...(opts.status ? { status: opts.status as Prisma.EnumEquipmentRentalStatusFilter } : {}) },
      include: { lines: { include: { item: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // ─── Postings ────────────────────────────────────────────────────────────

  private async postRentOut(
    tenantId: string, rentalNumber: string,
    rentFeeCentavos: number, depositCentavos: number,
    taxStatus: TaxStatus, tender: Tender,
  ) {
    const rentFee = pesos(rentFeeCentavos);
    const deposit = pesos(depositCentavos);
    if (rentFee <= 0 && deposit <= 0) return;

    const brk = this.tax.computeTaxBreakdown(rentFee, taxStatus);
    const tenderCode = tender === 'CASH' ? '1010' : '1031';
    const [tenderAcct, income, vat, depositLiab] = await Promise.all([
      this.acct(tenantId, tenderCode),
      this.acct(tenantId, '4113'),
      this.acct(tenantId, '2020'),
      this.acct(tenantId, '2078'),
    ]);

    const lines: Array<{ accountId: string; debit?: number; credit?: number; description?: string }> = [
      { accountId: tenderAcct, debit: round2(rentFee + deposit), description: 'Rental collected (fee + deposit)' },
    ];
    if (brk.netAmount > 0) lines.push({ accountId: income,      credit: brk.netAmount, description: 'Equipment rental income' });
    if (brk.vatAmount > 0) lines.push({ accountId: vat,         credit: brk.vatAmount, description: 'Output VAT 12%' });
    if (deposit > 0)       lines.push({ accountId: depositLiab, credit: deposit,       description: 'Refundable deposit held' });

    await this.journal.create(
      tenantId,
      { date: new Date().toISOString(), description: `Equipment rental ${rentalNumber} — pickup`, reference: rentalNumber, lines },
      'RENTALS', 'SYSTEM',
    );
  }

  private async postDepositRefund(tenantId: string, rentalNumber: string, depositCentavos: number, tender: Tender) {
    const deposit = pesos(depositCentavos);
    const tenderCode = tender === 'CASH' ? '1010' : '1031';
    const [depositLiab, tenderAcct] = await Promise.all([this.acct(tenantId, '2078'), this.acct(tenantId, tenderCode)]);
    await this.journal.create(
      tenantId,
      {
        date: new Date().toISOString(),
        description: `Equipment rental ${rentalNumber} — deposit refunded (good return)`,
        reference: rentalNumber,
        lines: [
          { accountId: depositLiab, debit:  deposit, description: 'Clear deposit liability' },
          { accountId: tenderAcct,  credit: deposit, description: 'Deposit returned to customer' },
        ],
      },
      'RENTALS', 'SYSTEM',
    );
  }

  private async postForfeit(tenantId: string, rentalNumber: string, depositCentavos: number) {
    const deposit = pesos(depositCentavos);
    const [depositLiab, forfeitIncome] = await Promise.all([this.acct(tenantId, '2078'), this.acct(tenantId, '4114')]);
    await this.journal.create(
      tenantId,
      {
        date: new Date().toISOString(),
        description: `Equipment rental ${rentalNumber} — deposit forfeited (loss/damage)`,
        reference: rentalNumber,
        lines: [
          { accountId: depositLiab,   debit:  deposit, description: 'Clear deposit liability' },
          { accountId: forfeitIncome, credit: deposit, description: 'Forfeited deposit / damage recovery' },
        ],
      },
      'RENTALS', 'SYSTEM',
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async getItem(tenantId: string, id: string) {
    const item = await this.prisma.rentableItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Rentable item not found.');
    return item;
  }

  private async tenantTaxStatus(tenantId: string): Promise<TaxStatus> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { taxStatus: true } });
    return (t?.taxStatus ?? 'UNREGISTERED') as TaxStatus;
  }

  private async acct(tenantId: string, code: string): Promise<string> {
    const a = await this.accounts.findByCode(tenantId, code);
    if (!a) throw new BadRequestException(`Account ${code} not found in your chart of accounts.`);
    return a.id;
  }

  /** Sequential rental number, race-safe via the @@unique([tenantId, rentalNumber]) backstop. */
  private async nextRentalNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const count = await tx.rentalTransaction.count({ where: { tenantId } });
    return `RENT-${String(count + 1).padStart(5, '0')}`;
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

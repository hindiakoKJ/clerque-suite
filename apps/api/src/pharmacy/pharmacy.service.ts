import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

/**
 * Compliance-Engine — Pharmacy.
 *
 * Three primary surfaces:
 *
 * 1. **Prescription** CRUD — pharmacy POS attaches an Rx to OrderItems whose
 *    Product.isRxRequired is true. Refills countdown enforced server-side.
 * 2. **ProductLot** management — FDA-required lot/expiry tracking. FEFO
 *    (first-expiry-first-out) lot allocation at sale time.
 * 3. **ControlledSubstanceLog** — RA 9165 DDB register entry written
 *    automatically when a controlled drug is dispensed. 1:1 with OrderItem.
 *
 * No COGS / GL postings happen here — those flow through the universal
 * AccountingEvent → JE engine path (see accounting/journal-entry.service.ts).
 * This service is policy + compliance only.
 */
@Injectable()
export class PharmacyService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Prescriptions ─────────────────────────────────────────────────────────

  async createPrescription(
    tenantId: string,
    dto: CreatePrescriptionDto,
  ) {
    if (!dto.rxNumber?.trim()) {
      throw new BadRequestException('rxNumber is required.');
    }
    if (!dto.patientName?.trim()) {
      throw new BadRequestException('patientName is required.');
    }
    if (!dto.prescribingDoctor?.trim() || !dto.doctorPrcLicense?.trim()) {
      throw new BadRequestException('Prescribing doctor + PRC license are required.');
    }
    if (dto.refillsRemaining != null && dto.refillsRemaining < 0) {
      throw new BadRequestException('refillsRemaining cannot be negative.');
    }

    return this.prisma.prescription.create({
      data: {
        tenantId,
        customerId:        dto.customerId ?? null,
        rxNumber:          dto.rxNumber.trim(),
        patientName:       dto.patientName.trim(),
        patientIdType:     dto.patientIdType ?? null,
        patientIdNumber:   dto.patientIdNumber ?? null,
        prescribingDoctor: dto.prescribingDoctor.trim(),
        doctorPrcLicense:  dto.doctorPrcLicense.trim(),
        doctorS2License:   dto.doctorS2License ?? null,
        doctorClinic:      dto.doctorClinic ?? null,
        issuedAt:          new Date(dto.issuedAt),
        refillsRemaining:  dto.refillsRemaining ?? 0,
        notes:             dto.notes ?? null,
      },
    });
  }

  listPrescriptions(tenantId: string, q: ListPrescriptionsQuery = {}) {
    const where: Prisma.PrescriptionWhereInput = { tenantId };
    if (q.customerId) where.customerId = q.customerId;
    if (q.search) {
      where.OR = [
        { rxNumber:    { contains: q.search, mode: 'insensitive' } },
        { patientName: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.prescription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    q.take ? Math.min(q.take, 200) : 50,
      skip:    q.skip ?? 0,
      include: { customer: { select: { id: true, name: true } } },
    });
  }

  async getPrescription(tenantId: string, id: string) {
    const rx = await this.prisma.prescription.findFirst({
      where:   { id, tenantId },
      include: {
        customer:               { select: { id: true, name: true } },
        controlledSubstanceLogs: { orderBy: { dispensedAt: 'desc' } },
      },
    });
    if (!rx) throw new NotFoundException('Prescription not found.');
    return rx;
  }

  /**
   * Decrement refill counter when an Rx is dispensed. Atomic — uses
   * `updateMany` with refillsRemaining > 0 guard so concurrent dispenses
   * cannot oversell. Returns true on success, false if Rx is exhausted.
   */
  async consumeRefill(tenantId: string, prescriptionId: string): Promise<boolean> {
    const result = await this.prisma.prescription.updateMany({
      where: { id: prescriptionId, tenantId, refillsRemaining: { gt: 0 } },
      data:  { refillsRemaining: { decrement: 1 } },
    });
    return result.count === 1;
  }

  // ─── ProductLots ──────────────────────────────────────────────────────────

  async createLot(tenantId: string, dto: CreateLotDto) {
    if (!dto.productId || !dto.branchId || !dto.lotNumber?.trim()) {
      throw new BadRequestException('productId, branchId, lotNumber are required.');
    }
    if (Number(dto.quantity) <= 0) {
      throw new BadRequestException('quantity must be > 0.');
    }
    const expiresAt = new Date(dto.expiresAt);
    if (Number.isNaN(expiresAt.valueOf())) {
      throw new BadRequestException('expiresAt is invalid.');
    }
    if (expiresAt.valueOf() < Date.now()) {
      throw new BadRequestException('Cannot create a lot that is already expired.');
    }

    // tenant-scope guard: product + branch must belong to this tenant
    const [product, branch] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: dto.productId, tenantId } }),
      this.prisma.branch.findFirst({  where: { id: dto.branchId,  tenantId } }),
    ]);
    if (!product) throw new NotFoundException('Product not found.');
    if (!branch)  throw new NotFoundException('Branch not found.');

    return this.prisma.productLot.create({
      data: {
        tenantId,
        productId:   dto.productId,
        branchId:    dto.branchId,
        lotNumber:   dto.lotNumber.trim(),
        expiresAt,
        quantity:    dto.quantity as any,
        costPrice:   dto.costPrice as any,
        supplierRef: dto.supplierRef ?? null,
      },
    });
  }

  /**
   * FEFO lot listing — earliest-expiry first, only active + non-zero qty.
   * Pharmacy POS uses this to suggest the next lot to dispense from.
   */
  listAvailableLots(
    tenantId: string,
    productId: string,
    branchId: string,
  ) {
    return this.prisma.productLot.findMany({
      where: {
        tenantId, productId, branchId,
        isActive: true,
        quantity: { gt: 0 },
      },
      orderBy: [{ expiresAt: 'asc' }, { receivedAt: 'asc' }],
    });
  }

  /**
   * Decrement lot quantity atomically when dispensed. Returns true on success.
   * Caller must already have validated tenantId via the lot picker.
   */
  async consumeLotQuantity(
    tenantId: string,
    lotId: string,
    quantity: number,
  ): Promise<boolean> {
    if (quantity <= 0) throw new BadRequestException('quantity must be > 0.');
    const result = await this.prisma.productLot.updateMany({
      where: {
        id: lotId, tenantId,
        isActive: true,
        quantity: { gte: quantity },
      },
      data: { quantity: { decrement: quantity } },
    });
    return result.count === 1;
  }

  // ─── Controlled Substance Log (DDB register) ──────────────────────────────

  /**
   * Record a single DDB-controlled dispense. Called by the POS sale path
   * when an OrderItem references a Product with isControlledDrug=true.
   */
  async recordControlledDispense(
    tenantId: string,
    dto: RecordControlledDispenseDto,
  ) {
    if (!dto.orderItemId)         throw new BadRequestException('orderItemId is required.');
    if (!dto.patientName?.trim()) throw new BadRequestException('patientName is required.');
    if (!dto.patientIdType?.trim() || !dto.patientIdNumber?.trim()) {
      throw new BadRequestException('Patient government ID is required for controlled substances (RA 9165).');
    }
    if (!dto.doctorPrcLicense?.trim() || !dto.doctorS2License?.trim()) {
      throw new BadRequestException('Doctor PRC + S2 license are required for controlled substances.');
    }
    if (!dto.pharmacistPrc?.trim()) {
      throw new BadRequestException('Dispensing pharmacist PRC license is required.');
    }
    if (Number(dto.quantityDispensed) <= 0) {
      throw new BadRequestException('quantityDispensed must be > 0.');
    }

    // Tenant-scope guard: the OrderItem must belong to an Order owned by this
    // tenant. Without this check a malicious caller could pass an OrderItem
    // ID from another tenant and have a DDB log written against it (audit
    // pollution + potential RA-9165 register tampering).
    const orderItem = await this.prisma.orderItem.findFirst({
      where:  { id: dto.orderItemId, order: { tenantId } },
      select: { id: true },
    });
    if (!orderItem) {
      throw new NotFoundException('Order item not found for this tenant.');
    }
    // Optional: tenant-scope guard on prescription, when provided.
    if (dto.prescriptionId) {
      const rx = await this.prisma.prescription.findFirst({
        where:  { id: dto.prescriptionId, tenantId },
        select: { id: true },
      });
      if (!rx) throw new NotFoundException('Prescription not found.');
    }

    return this.prisma.controlledSubstanceLog.create({
      data: {
        tenantId,
        orderItemId:       dto.orderItemId,
        prescriptionId:    dto.prescriptionId ?? null,
        patientName:       dto.patientName.trim(),
        patientIdType:     dto.patientIdType.trim(),
        patientIdNumber:   dto.patientIdNumber.trim(),
        doctorName:        dto.doctorName.trim(),
        doctorPrcLicense:  dto.doctorPrcLicense.trim(),
        doctorS2License:   dto.doctorS2License.trim(),
        pharmacistPrc:     dto.pharmacistPrc.trim(),
        drugName:          dto.drugName.trim(),
        drugStrength:      dto.drugStrength ?? null,
        quantityDispensed: dto.quantityDispensed as any,
      },
    });
  }

  listControlledRegister(tenantId: string, q: ListControlledQuery = {}) {
    const where: Prisma.ControlledSubstanceLogWhereInput = { tenantId };
    if (q.from || q.to) {
      where.dispensedAt = {};
      if (q.from) (where.dispensedAt as any).gte = new Date(q.from);
      if (q.to)   (where.dispensedAt as any).lte = new Date(q.to);
    }
    return this.prisma.controlledSubstanceLog.findMany({
      where,
      orderBy: { dispensedAt: 'desc' },
      take:    q.take ? Math.min(q.take, 500) : 100,
      skip:    q.skip ?? 0,
    });
  }
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreatePrescriptionDto {
  customerId?:       string;
  rxNumber:          string;
  patientName:       string;
  patientIdType?:    string;
  patientIdNumber?:  string;
  prescribingDoctor: string;
  doctorPrcLicense:  string;
  doctorS2License?:  string;
  doctorClinic?:     string;
  issuedAt:          string; // ISO
  refillsRemaining?: number;
  notes?:            string;
}

export interface ListPrescriptionsQuery {
  customerId?: string;
  search?:     string;
  take?:       number;
  skip?:       number;
}

export interface CreateLotDto {
  productId:   string;
  branchId:    string;
  lotNumber:   string;
  expiresAt:   string;       // ISO
  quantity:    number | string;
  costPrice:   number | string;
  supplierRef?: string;
}

export interface RecordControlledDispenseDto {
  orderItemId:        string;
  prescriptionId?:    string;
  patientName:        string;
  patientIdType:      string;
  patientIdNumber:    string;
  doctorName:         string;
  doctorPrcLicense:   string;
  doctorS2License:    string;
  pharmacistPrc:      string;
  drugName:           string;
  drugStrength?:      string;
  quantityDispensed:  number | string;
}

export interface ListControlledQuery {
  from?: string;
  to?:   string;
  take?: number;
  skip?: number;
}

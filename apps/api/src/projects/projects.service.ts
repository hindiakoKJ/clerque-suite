import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ProjectStatus } from '@prisma/client';

export interface CreateProjectDto {
  name:          string;
  customerId?:   string;
  branchId?:     string;
  budgetAmount?: number;
  startDate?:    string;
  endDate?:      string;
  notes?:        string;
}

export interface CreateIssuanceDto {
  branchId: string;
  notes?:   string;
  lines: Array<{ rawMaterialId: string; quantity: number; notes?: string }>;
}

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  // ── Numbering ──────────────────────────────────────────────────────────
  private async nextProjectCode(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `PRJ-${year}-`;
    const last = await tx.project.findFirst({
      where:   { tenantId, projectCode: { startsWith: prefix } },
      orderBy: { projectCode: 'desc' },
      select:  { projectCode: true },
    });
    const seq = (last ? parseInt(last.projectCode.slice(prefix.length), 10) : 0) + 1;
    return `${prefix}${String(seq).padStart(6, '0')}`;
  }

  private async nextIssuanceNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `ISS-${year}-`;
    const last = await tx.materialIssuance.findFirst({
      where:   { tenantId, issuanceNumber: { startsWith: prefix } },
      orderBy: { issuanceNumber: 'desc' },
      select:  { issuanceNumber: true },
    });
    const seq = (last ? parseInt(last.issuanceNumber.slice(prefix.length), 10) : 0) + 1;
    return `${prefix}${String(seq).padStart(6, '0')}`;
  }

  // ── Project CRUD ───────────────────────────────────────────────────────

  async list(tenantId: string, status?: ProjectStatus) {
    return this.prisma.project.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        branch:   { select: { id: true, name: true } },
        _count:   { select: { issuances: true } },
      },
    });
  }

  async getOne(tenantId: string, id: string) {
    const p = await this.prisma.project.findFirst({
      where: { id, tenantId },
      include: {
        customer:  { select: { id: true, name: true } },
        branch:    { select: { id: true, name: true } },
        issuances: {
          orderBy: { createdAt: 'desc' },
          include: {
            branch: { select: { id: true, name: true } },
            lines:  { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Project not found.');
    return p;
  }

  async create(tenantId: string, userId: string, dto: CreateProjectDto) {
    return this.prisma.$transaction(async (tx) => {
      const projectCode = await this.nextProjectCode(tx, tenantId);
      return tx.project.create({
        data: {
          tenantId, projectCode,
          name:        dto.name,
          customerId:  dto.customerId ?? null,
          branchId:    dto.branchId ?? null,
          status:      'PLANNING',
          budgetAmount: dto.budgetAmount != null ? new Prisma.Decimal(dto.budgetAmount) : null,
          startDate:   dto.startDate ? new Date(dto.startDate) : null,
          endDate:     dto.endDate   ? new Date(dto.endDate)   : null,
          notes:       dto.notes ?? null,
          createdById: userId,
        },
      });
    });
  }

  async setStatus(tenantId: string, id: string, status: ProjectStatus) {
    const p = await this.prisma.project.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('Project not found.');
    return this.prisma.project.update({ where: { id }, data: { status } });
  }

  // ── Material Issuance ──────────────────────────────────────────────────

  /**
   * Issues raw materials from a branch's inventory to a project.
   * Decrements RawMaterialInventory at the source branch, locks unit cost
   * to the current WAC, and creates the issuance record. JE posting (Dr
   * Project-WIP / Cr Inventory) is currently a TODO marker — recorded in
   * the issuance row but not yet pushed through AccountingEvent.
   */
  async issueMaterials(tenantId: string, projectId: string, userId: string, dto: CreateIssuanceDto) {
    if (!dto.lines.length) throw new BadRequestException('At least one line required.');

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, tenantId },
      });
      if (!project) throw new NotFoundException('Project not found.');
      if (project.status === 'CANCELLED' || project.status === 'COMPLETED') {
        throw new BadRequestException(`Cannot issue materials to a ${project.status.toLowerCase()} project.`);
      }

      const branch = await tx.branch.findFirst({ where: { id: dto.branchId, tenantId } });
      if (!branch) throw new BadRequestException('Branch not found.');

      // Resolve current cost prices.
      const rmIds = dto.lines.map((l) => l.rawMaterialId);
      const rms = await tx.rawMaterial.findMany({
        where:  { id: { in: rmIds }, tenantId },
        select: { id: true, costPrice: true, name: true },
      });
      if (rms.length !== rmIds.length) {
        throw new BadRequestException('One or more raw materials not found.');
      }
      const costByRm = new Map(rms.map((r) => [r.id, Number(r.costPrice ?? 0)]));

      // Verify stock + decrement.
      // NOTE: full Dr Project-WIP / Cr Inventory journal posting is deferred
      // to a follow-up sprint that adds a MATERIAL_ISSUANCE AccountingEventType
      // and a Project-WIP COA account. For now, the inventory decrement is
      // reflected in RawMaterialInventory.quantity and the issuance row +
      // line history serves as the audit trail. The cash-out cost is
      // captured in MaterialIssuanceLine.unitCost × quantity (used for
      // project P&L) but is NOT yet reconciled into the GL. Reports will
      // show project P&L correctly; trial balance will not reflect WIP
      // movement until the GL wiring lands.
      for (const l of dto.lines) {
        const inv = await tx.rawMaterialInventory.findUnique({
          where: { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId: l.rawMaterialId } },
        });
        const onHand = Number(inv?.quantity ?? 0);
        if (onHand < l.quantity) {
          throw new BadRequestException(
            `Insufficient stock for ${rms.find((r) => r.id === l.rawMaterialId)?.name ?? l.rawMaterialId}: have ${onHand}, need ${l.quantity}.`,
          );
        }
        await tx.rawMaterialInventory.update({
          where: { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId: l.rawMaterialId } },
          data:  { quantity: { decrement: l.quantity } },
        });
      }

      const issuanceNumber = await this.nextIssuanceNumber(tx, tenantId);
      return tx.materialIssuance.create({
        data: {
          tenantId, projectId, issuanceNumber,
          branchId:   dto.branchId,
          issuedById: userId,
          notes:      dto.notes ?? null,
          lines: {
            create: dto.lines.map((l) => ({
              rawMaterialId: l.rawMaterialId,
              quantity:      new Prisma.Decimal(l.quantity),
              unitCost:      new Prisma.Decimal(costByRm.get(l.rawMaterialId) ?? 0),
              notes:         l.notes ?? null,
            })),
          },
        },
        include: { lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      });
    });
  }

  // ── Project P&L (basic) ────────────────────────────────────────────────
  async getPL(tenantId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, tenantId },
      select: {
        id: true, projectCode: true, name: true, status: true, budgetAmount: true,
        issuances: {
          select: {
            createdAt: true,
            lines: { select: { quantity: true, unitCost: true } },
          },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found.');

    const totalIssuedCost = project.issuances.reduce(
      (sum, iss) => sum + iss.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0),
      0,
    );
    const budget = project.budgetAmount ? Number(project.budgetAmount) : null;

    return {
      projectId:        project.id,
      projectCode:      project.projectCode,
      name:             project.name,
      status:           project.status,
      budgetAmount:     budget,
      totalIssuedCost:  Math.round(totalIssuedCost * 100) / 100,
      remainingBudget:  budget != null ? Math.round((budget - totalIssuedCost) * 100) / 100 : null,
      issuanceCount:    project.issuances.length,
    };
  }
}

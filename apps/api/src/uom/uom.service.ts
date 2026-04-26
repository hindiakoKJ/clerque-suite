import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateUomDto {
  name:             string;
  abbreviation:     string;
  baseUnit?:        string;
  conversionFactor?: number;
}

export interface UpdateUomDto {
  name?:             string;
  abbreviation?:     string;
  baseUnit?:         string;
  conversionFactor?: number;
  isActive?:         boolean;
}

/**
 * Standard UoM seed — applied on first GET if the tenant has no UoMs yet.
 *
 * Split into two groups:
 *   - General retail/trade units (always seeded)
 *   - Construction/weight/volume extras (seeded alongside general)
 *
 * Abbreviation uniqueness is enforced per-tenant by a DB unique index.
 */
const STANDARD_UOMS: Omit<CreateUomDto, never>[] = [
  // ── Count ──────────────────────────────────────────────────────────────────
  { name: 'Piece',      abbreviation: 'PC'   },
  { name: 'Dozen',      abbreviation: 'DZ',  baseUnit: 'PC', conversionFactor: 12  },
  { name: 'Box',        abbreviation: 'BOX'  },
  { name: 'Pack',       abbreviation: 'PACK' },
  { name: 'Set',        abbreviation: 'SET'  },
  { name: 'Pair',       abbreviation: 'PR',  baseUnit: 'PC', conversionFactor: 2   },
  { name: 'Bundle',     abbreviation: 'BDL'  },
  // ── Mass ───────────────────────────────────────────────────────────────────
  { name: 'Kilogram',   abbreviation: 'KG'   },
  { name: 'Gram',       abbreviation: 'G',   baseUnit: 'KG', conversionFactor: 0.001 },
  { name: 'Pound',      abbreviation: 'LB',  baseUnit: 'KG', conversionFactor: 0.453592 },
  { name: 'Metric Ton', abbreviation: 'MT',  baseUnit: 'KG', conversionFactor: 1000 },
  // ── Volume ─────────────────────────────────────────────────────────────────
  { name: 'Liter',      abbreviation: 'L'    },
  { name: 'Milliliter', abbreviation: 'ML',  baseUnit: 'L',  conversionFactor: 0.001 },
  { name: 'Gallon',     abbreviation: 'GAL', baseUnit: 'L',  conversionFactor: 3.78541 },
  // ── Length ─────────────────────────────────────────────────────────────────
  { name: 'Meter',      abbreviation: 'M'    },
  { name: 'Centimeter', abbreviation: 'CM',  baseUnit: 'M',  conversionFactor: 0.01  },
  { name: 'Foot',       abbreviation: 'FT',  baseUnit: 'M',  conversionFactor: 0.3048 },
  // ── Area ───────────────────────────────────────────────────────────────────
  { name: 'Square Meter', abbreviation: 'SQM' },
  // ── Time / Service ─────────────────────────────────────────────────────────
  { name: 'Hour',       abbreviation: 'HR'   },
  { name: 'Day',        abbreviation: 'DAY', baseUnit: 'HR', conversionFactor: 8    },
];

@Injectable()
export class UomService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  async findAll(tenantId: string) {
    // Auto-seed standard UoMs on first access if tenant has none
    const count = await this.prisma.unitOfMeasure.count({ where: { tenantId } });
    if (count === 0) {
      await this.seedDefaults(tenantId);
    }

    return this.prisma.unitOfMeasure.findMany({
      where:   { tenantId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateUomDto) {
    if (!dto.name?.trim())         throw new BadRequestException('Name is required.');
    if (!dto.abbreviation?.trim()) throw new BadRequestException('Abbreviation is required.');

    const abbrev = dto.abbreviation.trim().toUpperCase();

    const conflict = await this.prisma.unitOfMeasure.findUnique({
      where: { tenantId_abbreviation: { tenantId, abbreviation: abbrev } },
    });
    if (conflict) {
      throw new ConflictException(`Abbreviation "${abbrev}" is already in use.`);
    }

    return this.prisma.unitOfMeasure.create({
      data: {
        tenantId,
        name:             dto.name.trim(),
        abbreviation:     abbrev,
        baseUnit:         dto.baseUnit?.trim()  ?? null,
        conversionFactor: dto.conversionFactor  ?? null,
      },
    });
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  async update(tenantId: string, id: string, dto: UpdateUomDto) {
    await this.findOne(tenantId, id);

    if (dto.abbreviation) {
      const abbrev = dto.abbreviation.trim().toUpperCase();
      const conflict = await this.prisma.unitOfMeasure.findFirst({
        where: { tenantId, abbreviation: abbrev, NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(`Abbreviation "${abbrev}" is already in use.`);
      }
    }

    const result = await this.prisma.unitOfMeasure.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.name             !== undefined ? { name:             dto.name.trim()           } : {}),
        ...(dto.abbreviation     !== undefined ? { abbreviation:     dto.abbreviation.trim().toUpperCase() } : {}),
        ...(dto.baseUnit         !== undefined ? { baseUnit:         dto.baseUnit              } : {}),
        ...(dto.conversionFactor !== undefined ? { conversionFactor: dto.conversionFactor      } : {}),
        ...(dto.isActive         !== undefined ? { isActive:         dto.isActive              } : {}),
      },
    });
    if (result.count === 0) throw new NotFoundException('Unit of measure not found.');
    return this.findOne(tenantId, id);
  }

  // ─── Delete (deactivate) ───────────────────────────────────────────────────

  async deactivate(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const result = await this.prisma.unitOfMeasure.updateMany({
      where: { id, tenantId },
      data:  { isActive: false },
    });
    if (result.count === 0) throw new NotFoundException('Unit of measure not found.');
    return { message: 'Unit of measure deactivated.' };
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private async findOne(tenantId: string, id: string) {
    const uom = await this.prisma.unitOfMeasure.findFirst({
      where: { id, tenantId },
    });
    if (!uom) throw new NotFoundException('Unit of measure not found.');
    return uom;
  }

  private async seedDefaults(tenantId: string) {
    // Use createMany with skipDuplicates so concurrent requests don't race-fault
    await this.prisma.unitOfMeasure.createMany({
      data: STANDARD_UOMS.map((u) => ({
        tenantId,
        name:             u.name,
        abbreviation:     u.abbreviation,
        baseUnit:         u.baseUnit         ?? null,
        conversionFactor: u.conversionFactor ?? null,
      })),
      skipDuplicates: true,
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformConfig, TaxStatus } from '@prisma/client';

/**
 * Sprint 15 — Singleton platform configuration.
 *
 * One row in `platform_config` (id="platform"). Holds HNS Corp PH's master
 * data and per-environment toggles for the subscription-billing flow.
 *
 * Lazy-init: first read creates the row with defaults if missing, so a
 * fresh DB doesn't need a separate seed step.
 */
@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);
  private static readonly SINGLETON_ID = 'platform';

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformConfig> {
    const existing = await this.prisma.platformConfig.findUnique({
      where: { id: PlatformService.SINGLETON_ID },
    });
    if (existing) return existing;

    // Lazy-init the singleton with defaults.
    return this.prisma.platformConfig.upsert({
      where:  { id: PlatformService.SINGLETON_ID },
      create: { id: PlatformService.SINGLETON_ID },
      update: {},
    });
  }

  async update(dto: UpdatePlatformConfigDto): Promise<PlatformConfig> {
    // Ensure row exists, then patch.
    await this.get();
    return this.prisma.platformConfig.update({
      where: { id: PlatformService.SINGLETON_ID },
      data: this.cleanUndefined({
        companyName:           dto.companyName,
        tin:                   dto.tin,
        address:               dto.address,
        contactPhone:          dto.contactPhone,
        contactEmail:          dto.contactEmail,
        taxStatus:             dto.taxStatus,
        isBirRegistered:       dto.isBirRegistered,
        subscriptionAutoIssue: dto.subscriptionAutoIssue,
        subscriptionDueDays:   dto.subscriptionDueDays,
        hnsTenantId:           dto.hnsTenantId,
      }),
    });
  }

  /** Set the HNS tenant link after bootstrap-hns-corp creates it. */
  async setHnsTenantId(hnsTenantId: string): Promise<PlatformConfig> {
    await this.get();
    return this.prisma.platformConfig.update({
      where: { id: PlatformService.SINGLETON_ID },
      data:  { hnsTenantId },
    });
  }

  private cleanUndefined<T extends object>(obj: T): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = v;
    }
    return out as Partial<T>;
  }
}

export interface UpdatePlatformConfigDto {
  companyName?:           string;
  tin?:                   string | null;
  address?:               string | null;
  contactPhone?:          string | null;
  contactEmail?:          string | null;
  taxStatus?:             TaxStatus;
  isBirRegistered?:       boolean;
  subscriptionAutoIssue?: boolean;
  subscriptionDueDays?:   number;
  hnsTenantId?:           string | null;
}

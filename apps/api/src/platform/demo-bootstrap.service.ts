import {
  Injectable, Logger, BadRequestException, NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounting/accounts.service';
import { DEMO_SCENARIOS, type ScenarioKey } from '../admin/demo-scenarios';
import { DEFAULT_APP_ACCESS } from '@repo/shared-types';
import type { Prisma } from '@prisma/client';

/**
 * Sprint 15 — Generic demo-tenant provisioning.
 *
 * Provisions a complete demo tenant for any of the 12 scenarios in
 * DEMO_SCENARIOS. Idempotent — re-running on an existing slug just
 * re-seeds catalog (delegates to AdminService.resetDemoData externally),
 * doesn't duplicate users.
 *
 * Returns credentials for the freshly-created owner so the SUPER_ADMIN
 * can hand them to the test user.
 */
@Injectable()
export class DemoBootstrapService {
  private readonly logger = new Logger(DemoBootstrapService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Per-scenario provisioning config — what slug, plan, and modules each
   * demo tenant gets. Drives variety so testers can see different plan
   * tiers + module combos in action.
   */
  private static readonly DEMO_CONFIG: Record<ScenarioKey, DemoConfig> = {
    COFFEE_SHOP: {
      slug: 'demo-coffee', tenantName: 'Brew & Co. (Demo)',
      ownerName: 'Cafe Owner',
      planCode: 'PAIR_T2', taxStatus: 'VAT',
      modulePos: true, moduleLedger: true, modulePayroll: false,
      staffSeatQuota: 5, branchQuota: 2,
    },
    BAKERY: {
      slug: 'demo-bakery', tenantName: 'The Daily Loaf (Demo)',
      ownerName: 'Bakery Owner',
      planCode: 'STD_TEAM', taxStatus: 'NON_VAT',
      modulePos: true, moduleLedger: false, modulePayroll: false,
      staffSeatQuota: 5, branchQuota: 2,
    },
    RESTAURANT: {
      slug: 'demo-restaurant', tenantName: 'Tita\'s Kitchen (Demo)',
      ownerName: 'Restaurant Owner',
      planCode: 'PAIR_T2', taxStatus: 'VAT',
      modulePos: true, moduleLedger: false, modulePayroll: true,
      staffSeatQuota: 8, branchQuota: 2,
    },
    SARI_SARI: {
      slug: 'demo-sarisari', tenantName: 'Aling Nena\'s Store (Demo)',
      ownerName: 'Tindera Owner',
      planCode: 'STD_DUO', taxStatus: 'UNREGISTERED',
      modulePos: true, moduleLedger: false, modulePayroll: false,
      staffSeatQuota: 2, branchQuota: 1,
    },
    BOUTIQUE: {
      slug: 'demo-boutique', tenantName: 'Manila Linen Boutique (Demo)',
      ownerName: 'Boutique Owner',
      planCode: 'STD_TEAM', taxStatus: 'VAT',
      modulePos: true, moduleLedger: false, modulePayroll: false,
      staffSeatQuota: 4, branchQuota: 2,
    },
    HARDWARE: {
      slug: 'demo-hardware', tenantName: 'Roque Hardware (Demo)',
      ownerName: 'Hardware Owner',
      planCode: 'PAIR_T1', taxStatus: 'VAT',
      modulePos: true, moduleLedger: true, modulePayroll: false,
      staffSeatQuota: 5, branchQuota: 1,
    },
    LAUNDRY: {
      slug: 'demo-laundry-2', tenantName: 'WashHaven Laundry (Demo)',
      ownerName: 'Laundromat Owner',
      planCode: 'STD_TEAM', taxStatus: 'NON_VAT',
      modulePos: true, moduleLedger: false, modulePayroll: false,
      staffSeatQuota: 5, branchQuota: 2,
    },
    AUTO_REPAIR: {
      slug: 'demo-autorepair', tenantName: 'Manila Auto Care (Demo)',
      ownerName: 'Shop Owner',
      planCode: 'PAIR_T2', taxStatus: 'VAT',
      modulePos: true, moduleLedger: true, modulePayroll: false,
      staffSeatQuota: 6, branchQuota: 2,
    },
    MANUFACTURING: {
      slug: 'demo-mfg', tenantName: 'Pacific Foods Manufacturing (Demo)',
      ownerName: 'Plant Manager',
      planCode: 'SUITE_T2', taxStatus: 'VAT',
      modulePos: true, moduleLedger: true, modulePayroll: true,
      staffSeatQuota: 12, branchQuota: 3,
    },
    CONSTRUCTION: {
      slug: 'demo-construction', tenantName: 'Bayanihan Construction (Demo)',
      ownerName: 'Project Director',
      planCode: 'SUITE_T1', taxStatus: 'VAT',
      modulePos: true, moduleLedger: true, modulePayroll: true,
      staffSeatQuota: 8, branchQuota: 1,
    },
    PHARMACY: {
      slug: 'demo-pharmacy', tenantName: 'MediCare Drugstore (Demo)',
      ownerName: 'Pharmacy Owner',
      planCode: 'PAIR_T1', taxStatus: 'VAT',
      modulePos: true, moduleLedger: true, modulePayroll: false,
      staffSeatQuota: 4, branchQuota: 1,
    },
    TRUCKING: {
      slug: 'demo-trucking', tenantName: 'Cargo Express PH (Demo)',
      ownerName: 'Fleet Manager',
      planCode: 'SUITE_T1', taxStatus: 'VAT',
      modulePos: true, moduleLedger: true, modulePayroll: true,
      staffSeatQuota: 8, branchQuota: 1,
    },
  };

  /**
   * Provision (or return existing) demo tenant for a scenario. Catalog
   * seeding is delegated — caller should follow up with
   * AdminService.resetDemoData() if they want fresh catalog data.
   */
  async provision(scenarioKey: ScenarioKey): Promise<ProvisionResult> {
    const cfg = DemoBootstrapService.DEMO_CONFIG[scenarioKey];
    if (!cfg) {
      throw new BadRequestException(`Unknown scenario: ${scenarioKey}`);
    }
    const scenario = DEMO_SCENARIOS[scenarioKey];
    if (!scenario) {
      throw new NotFoundException(`No catalog data for scenario ${scenarioKey}.`);
    }

    const ownerEmail = `demo.${cfg.slug.replace(/^demo-/, '')}@clerque.test`;

    let tenant = await this.prisma.tenant.findUnique({ where: { slug: cfg.slug } });
    let generatedPassword: string | null = null;

    if (!tenant) {
      generatedPassword = this.generatePassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 12);

      tenant = await this.prisma.$transaction(async (tx) => {
        const t = await tx.tenant.create({
          data: {
            name:            cfg.tenantName,
            slug:            cfg.slug,
            businessType:    scenario.businessType as Prisma.TenantCreateInput['businessType'],
            tier:            'TIER_3' as Prisma.TenantCreateInput['tier'],
            planCode:        cfg.planCode,
            modulePos:       cfg.modulePos,
            moduleLedger:    cfg.moduleLedger,
            modulePayroll:   cfg.modulePayroll,
            staffSeatQuota:  cfg.staffSeatQuota,
            staffSeatAddons: 0,
            branchQuota:     cfg.branchQuota,
            taxStatus:       scenario.taxStatus as Prisma.TenantCreateInput['taxStatus'],
            isDemoTenant:    true,
            contactEmail:    ownerEmail,
            status:          'ACTIVE',
          },
        });
        const branch = await tx.branch.create({
          data: { tenantId: t.id, name: 'Main Branch', isActive: true },
        });

        // Owner.
        const ownerAccess = DEFAULT_APP_ACCESS['BUSINESS_OWNER'] ?? [];
        await tx.user.create({
          data: {
            tenantId:     t.id, branchId: branch.id, name: cfg.ownerName,
            email:        ownerEmail.toLowerCase(),
            passwordHash, role: 'BUSINESS_OWNER', isActive: true,
            appAccess: { create: ownerAccess.map((a) => ({
              appCode: a.app as Prisma.UserAppAccessCreateWithoutUserInput['appCode'],
              level:   a.level as Prisma.UserAppAccessCreateWithoutUserInput['level'],
            })) },
          },
        });

        // Cashier (or front-desk equivalent).
        const cashierAccess = DEFAULT_APP_ACCESS['CASHIER'] ?? [];
        await tx.user.create({
          data: {
            tenantId: t.id, branchId: branch.id, name: 'Demo Cashier',
            email:   `cashier.${cfg.slug}@clerque.test`,
            passwordHash, role: 'CASHIER', isActive: true,
            appAccess: { create: cashierAccess.map((a) => ({
              appCode: a.app as Prisma.UserAppAccessCreateWithoutUserInput['appCode'],
              level:   a.level as Prisma.UserAppAccessCreateWithoutUserInput['level'],
            })) },
          },
        });

        return t;
      });
    }

    await this.accounts.seedDefaultAccounts(tenant.id);

    return {
      tenantId:    tenant.id,
      slug:        tenant.slug,
      tenantName:  tenant.name,
      ownerEmail,
      ownerPassword: generatedPassword,  // null on subsequent calls
      created:     generatedPassword !== null,
      planCode:    cfg.planCode,
      businessType: scenario.businessType,
    };
  }

  /** Returns the list of available scenarios for the Console UI. */
  listScenarios(): Array<{ key: ScenarioKey; label: string; tenantName: string; planCode: string; businessType: string }> {
    return (Object.keys(DemoBootstrapService.DEMO_CONFIG) as ScenarioKey[])
      .map((key) => {
        const cfg = DemoBootstrapService.DEMO_CONFIG[key];
        const sc  = DEMO_SCENARIOS[key];
        return {
          key,
          label:        sc.label,
          tenantName:   cfg.tenantName,
          planCode:     cfg.planCode,
          businessType: sc.businessType,
        };
      });
  }

  private generatePassword(): string {
    // 16-char human-readable password (no I/1/O/0).
    const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
    return Array.from({ length: 16 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
  }
}

interface DemoConfig {
  slug:            string;
  tenantName:      string;
  ownerName:       string;
  planCode:        string;
  taxStatus:       'VAT' | 'NON_VAT' | 'UNREGISTERED';
  modulePos:       boolean;
  moduleLedger:    boolean;
  modulePayroll:   boolean;
  staffSeatQuota:  number;
  branchQuota:     number;
}

export interface ProvisionResult {
  tenantId:      string;
  slug:          string;
  tenantName:    string;
  ownerEmail:    string;
  ownerPassword: string | null; // null when tenant already existed
  created:       boolean;
  planCode:      string;
  businessType:  string;
}

/**
 * Cross-tenant FK validation helpers.
 *
 * Multi-tenant SaaS has a recurring pattern: services that accept a
 * `branchId`, `vendorId`, `customerId`, etc. from a DTO must verify the
 * ID actually belongs to the caller's tenant. Without that check, a
 * user from Tenant A can submit Tenant B's branchId / vendorId — silently
 * planting a cross-tenant FK on their own invoice, expense, or payment.
 * Branch-filtered reports in Tenant B will then include the foreign row;
 * BIR sales books, AR aging, and branch P&L silently corrupt.
 *
 * The 13 AR/AP services flagged in Security Audit 2026-05 (T2) each had
 * their own bespoke check — or none at all. This module consolidates the
 * pattern so it's impossible to forget.
 *
 * Usage:
 *   await assertBranchInTenant(this.prisma, tenantId, dto.branchId);
 *   await assertVendorInTenant(this.prisma, tenantId, dto.vendorId);
 *   await assertCustomerInTenant(this.prisma, tenantId, dto.customerId);
 *
 * Each helper returns void on success and throws ForbiddenException with
 * a defensive (non-leaking) message on failure. They pass through `null /
 * undefined` IDs without erroring — DTO branchId is often optional.
 */
import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Assert that the given branchId belongs to the given tenant.
 * Null / undefined IDs are accepted (branch is optional on most DTOs).
 */
export async function assertBranchInTenant(
  prisma: PrismaService,
  tenantId: string,
  branchId: string | null | undefined,
): Promise<void> {
  if (!branchId) return;
  const found = await prisma.branch.findFirst({
    where: { id: branchId, tenantId },
    select: { id: true },
  });
  if (!found) {
    throw new ForbiddenException(
      'The provided branchId does not belong to your organization.',
    );
  }
}

/**
 * Assert that the given vendorId belongs to the given tenant.
 */
export async function assertVendorInTenant(
  prisma: PrismaService,
  tenantId: string,
  vendorId: string | null | undefined,
): Promise<void> {
  if (!vendorId) return;
  const found = await prisma.vendor.findFirst({
    where: { id: vendorId, tenantId },
    select: { id: true },
  });
  if (!found) {
    throw new ForbiddenException(
      'The provided vendorId does not belong to your organization.',
    );
  }
}

/**
 * Assert that the given customerId belongs to the given tenant.
 */
export async function assertCustomerInTenant(
  prisma: PrismaService,
  tenantId: string,
  customerId: string | null | undefined,
): Promise<void> {
  if (!customerId) return;
  const found = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true },
  });
  if (!found) {
    throw new ForbiddenException(
      'The provided customerId does not belong to your organization.',
    );
  }
}

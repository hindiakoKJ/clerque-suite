/**
 * AuditLogService — immutable audit trail for BIR compliance.
 *
 * Audit logs are INSERT-only. Records are never updated or deleted.
 * This ensures a tamper-evident trail that satisfies BIR CAS accreditation
 * requirements for tax setting changes and price adjustments.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

export interface LogParams {
  tenantId:     string;
  action:       AuditAction;
  entityType:   string;
  entityId:     string;
  before?:      object | null;
  after?:       object | null;
  description?: string;
  performedBy?: string;
  ipAddress?:   string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Write an immutable audit record. Fire-and-forget — callers should not
   * await this unless they need confirmation the log was written.
   */
  async log(params: LogParams): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId:    params.tenantId,
        action:      params.action,
        entityType:  params.entityType,
        entityId:    params.entityId,
        before:      params.before ?? undefined,
        after:       params.after  ?? undefined,
        description: params.description,
        performedBy: params.performedBy,
        ipAddress:   params.ipAddress,
      },
    });
  }

  /** Convenience: log a tax-status change on a Tenant. */
  async logTaxStatusChange(
    tenantId:    string,
    before:      object,
    after:       object,
    performedBy: string,
    ipAddress?:  string,
  ): Promise<void> {
    return this.log({
      tenantId,
      action:      AuditAction.TAX_STATUS_CHANGED,
      entityType:  'Tenant',
      entityId:    tenantId,
      before,
      after,
      description: 'Tax status / registration flags changed',
      performedBy,
      ipAddress,
    });
  }

  /** Convenience: log a TIN number update. */
  async logTinUpdate(
    tenantId:    string,
    oldTin:      string | null,
    newTin:      string,
    performedBy: string,
    ipAddress?:  string,
  ): Promise<void> {
    return this.log({
      tenantId,
      action:      AuditAction.TIN_UPDATED,
      entityType:  'Tenant',
      entityId:    tenantId,
      before:      { tinNumber: oldTin },
      after:       { tinNumber: newTin },
      description: 'BIR TIN number updated',
      performedBy,
      ipAddress,
    });
  }

  /** Convenience: log a void/cancellation of an order. */
  async logVoid(
    tenantId:    string,
    orderId:     string,
    orderNumber: string,
    reason:      string,
    performedBy: string,
    ipAddress?:  string,
  ): Promise<void> {
    return this.log({
      tenantId,
      action:      AuditAction.VOID_PROCESSED,
      entityType:  'Order',
      entityId:    orderId,
      after:       { orderNumber, status: 'VOIDED', reason },
      description: `Order ${orderNumber} voided: ${reason}`,
      performedBy,
      ipAddress,
    });
  }

  /**
   * Log an SOD warning override — owner explicitly accepted a yellow warning
   * when assigning permissions that violate Segregation of Duties.
   * The full set of overrides is also stored on User.sodOverrides for the
   * staff-edit screen to render; this AuditLog row is the immutable copy.
   */
  async logSodOverride(
    tenantId:     string,
    targetUserId: string,
    ruleId:       string,
    reason:       string,
    permissions:  string[],
    performedBy:  string,
    ipAddress?:   string,
  ): Promise<void> {
    return this.log({
      tenantId,
      action:      AuditAction.SOD_OVERRIDE_GRANTED,
      entityType:  'User',
      entityId:    targetUserId,
      after:       { ruleId, reason, permissions },
      description: `SOD override accepted for rule ${ruleId}: ${reason}`,
      performedBy,
      ipAddress,
    });
  }

  /** Retrieve audit log for a tenant, paginated. */
  async findAll(tenantId: string, opts: { page?: number; action?: AuditAction; entityType?: string }) {
    const { page = 1, action, entityType } = opts;
    const take = 50;
    const skip = (page - 1) * take;

    const where = {
      tenantId,
      ...(action     ? { action }     : {}),
      ...(entityType ? { entityType } : {}),
    };

    const [total, records] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    return { data: records, total, page, pages: Math.ceil(total / take) };
  }
}

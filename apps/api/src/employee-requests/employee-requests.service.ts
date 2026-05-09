import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, EmployeeRequestKind, EmployeeRequestStatus } from '@prisma/client';

export interface CreateEmployeeRequestDto {
  kind:    EmployeeRequestKind;
  forDate: string;             // ISO date "YYYY-MM-DD"
  reason:  string;
  payload?: Record<string, unknown>;
}

export interface ListQuery {
  kind?:   EmployeeRequestKind;
  status?: EmployeeRequestStatus;
  userId?: string;             // approver inbox can filter by employee
  take?:   number;
  skip?:   number;
}

@Injectable()
export class EmployeeRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Employee submits a new request. */
  async create(tenantId: string, userId: string, dto: CreateEmployeeRequestDto) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('reason is required.');
    }
    if (!dto.forDate) {
      throw new BadRequestException('forDate is required.');
    }
    const forDate = new Date(dto.forDate);
    if (isNaN(forDate.getTime())) {
      throw new BadRequestException('forDate is not a valid date.');
    }

    // Light kind-specific payload validation. We keep this loose to make it
    // easy to evolve fields without migrating the table — but enforce the
    // minimum so junk requests can't be submitted.
    this.validatePayload(dto.kind, dto.payload ?? {});

    return this.prisma.employeeRequest.create({
      data: {
        tenantId,
        userId,
        kind:    dto.kind,
        forDate,
        reason:  dto.reason.trim(),
        payload: (dto.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /** Owner / manager view: list requests across the tenant. */
  list(tenantId: string, q: ListQuery = {}) {
    return this.prisma.employeeRequest.findMany({
      where: {
        tenantId,
        ...(q.kind   ? { kind:   q.kind }   : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: q.take ? Math.min(q.take, 200) : 50,
      skip: q.skip ?? 0,
      include: {
        user:     { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true } },
      },
    });
  }

  /** Self-service: requests submitted by the current user. */
  listMine(tenantId: string, userId: string, q: Pick<ListQuery, 'kind' | 'status'> = {}) {
    return this.prisma.employeeRequest.findMany({
      where: {
        tenantId,
        userId,
        ...(q.kind   ? { kind:   q.kind }   : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        approver: { select: { id: true, name: true } },
      },
    });
  }

  async getOne(tenantId: string, id: string, userId: string, isManager: boolean) {
    const req = await this.prisma.employeeRequest.findFirst({
      where: { id, tenantId },
      include: {
        user:     { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true } },
      },
    });
    if (!req) throw new NotFoundException('Request not found.');
    // Employees can only see their own requests; managers see all.
    if (!isManager && req.userId !== userId) {
      throw new ForbiddenException('You can only view your own requests.');
    }
    return req;
  }

  async approve(tenantId: string, id: string, approverId: string) {
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.employeeRequest.findFirst({ where: { id, tenantId } });
      if (!req) throw new NotFoundException('Request not found.');
      if (req.status !== 'PENDING') {
        throw new BadRequestException(`Request is already ${req.status}.`);
      }
      if (req.userId === approverId) {
        throw new ForbiddenException('You cannot approve your own request.');
      }
      return tx.employeeRequest.update({
        where: { id },
        data:  { status: 'APPROVED', approvedBy: approverId, approvedAt: new Date() },
      });
    });
  }

  async reject(tenantId: string, id: string, approverId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('rejectionReason is required.');
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.employeeRequest.findFirst({ where: { id, tenantId } });
      if (!req) throw new NotFoundException('Request not found.');
      if (req.status !== 'PENDING') {
        throw new BadRequestException(`Request is already ${req.status}.`);
      }
      if (req.userId === approverId) {
        throw new ForbiddenException('You cannot reject your own request.');
      }
      return tx.employeeRequest.update({
        where: { id },
        data:  {
          status:          'REJECTED',
          approvedBy:      approverId,
          approvedAt:      new Date(),
          rejectionReason: reason.trim(),
        },
      });
    });
  }

  /** Self-cancel — only the requester can cancel, only while PENDING. */
  async cancel(tenantId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.employeeRequest.findFirst({ where: { id, tenantId } });
      if (!req) throw new NotFoundException('Request not found.');
      if (req.userId !== userId) {
        throw new ForbiddenException('You can only cancel your own requests.');
      }
      if (req.status !== 'PENDING') {
        throw new BadRequestException(`Cannot cancel a ${req.status} request.`);
      }
      return tx.employeeRequest.update({
        where: { id }, data: { status: 'CANCELLED' },
      });
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private validatePayload(kind: EmployeeRequestKind, p: Record<string, unknown>) {
    switch (kind) {
      case 'COA':
        // Need either clockIn or clockOut (or both).
        if (!p.clockIn && !p.clockOut) {
          throw new BadRequestException('COA requires at least one of clockIn or clockOut.');
        }
        break;
      case 'SCHEDULE':
        if (!p.newStart || !p.newEnd) {
          throw new BadRequestException('Schedule adjustment requires newStart and newEnd.');
        }
        break;
      case 'OB':
        if (!p.startTime || !p.endTime || !p.location) {
          throw new BadRequestException('Official business requires startTime, endTime, and location.');
        }
        break;
      case 'OT':
        if (!p.startTime || !p.endTime) {
          throw new BadRequestException('Overtime requires startTime and endTime.');
        }
        if (p.hoursClaimed != null && Number(p.hoursClaimed) <= 0) {
          throw new BadRequestException('Overtime hoursClaimed must be greater than 0.');
        }
        break;
      case 'UT':
        if (!p.earlyOutAt) {
          throw new BadRequestException('Undertime requires earlyOutAt.');
        }
        break;
    }
  }
}

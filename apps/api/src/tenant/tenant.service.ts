import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantService {
  constructor(private prisma: PrismaService) {}

  async getAndValidate(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'SUSPENDED') {
      throw new ForbiddenException('Subscription suspended. Contact support.');
    }
    return tenant;
  }

  async assertBranchBelongsToTenant(branchId: string, tenantId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
    });
    if (!branch) throw new ForbiddenException('Branch not found in this tenant');
    return branch;
  }
}

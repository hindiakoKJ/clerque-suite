import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard }   from '../auth/guards/roles.guard';
import { Roles }        from '../auth/decorators/roles.decorator';
import { CurrentUser }  from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import type { ProjectStatus } from '@prisma/client';
import { ProjectsService, CreateProjectDto, CreateIssuanceDto } from './projects.service';

@ApiTags('Projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}

  // Construction is mostly an Owner / Branch Manager surface; allow MDM and
  // Warehouse Staff to participate in material issuance.
  private static readonly PROJECT_OPS = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM', 'WAREHOUSE_STAFF',
  ] as const;

  @ApiOperation({ summary: 'List projects (optional status filter)' })
  @Roles(...ProjectsController.PROJECT_OPS)
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: ProjectStatus,
  ) {
    return this.svc.list(user.tenantId!, status);
  }

  @ApiOperation({ summary: 'Get one project with issuances' })
  @Roles(...ProjectsController.PROJECT_OPS)
  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getOne(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Create a project' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateProjectDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  @ApiOperation({ summary: 'Update project status' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  setStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: ProjectStatus },
  ) {
    return this.svc.setStatus(user.tenantId!, id, body.status);
  }

  @ApiOperation({ summary: 'Issue materials to a project (decrements branch inventory)' })
  @Roles(...ProjectsController.PROJECT_OPS)
  @Post(':id/issuances')
  @HttpCode(HttpStatus.CREATED)
  issue(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateIssuanceDto,
  ) {
    return this.svc.issueMaterials(user.tenantId!, id, user.sub, dto);
  }

  @ApiOperation({ summary: 'Project profitability (budget vs issued cost)' })
  @Roles(...ProjectsController.PROJECT_OPS)
  @Get(':id/pl')
  getPL(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getPL(user.tenantId!, id);
  }
}

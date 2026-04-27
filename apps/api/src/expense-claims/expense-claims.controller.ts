import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ExpenseClaimStatus } from '@prisma/client';
import { ExpenseClaimsService } from './expense-claims.service';
import {
  CreateExpenseClaimDto,
  ReviewExpenseClaimDto,
  MarkPaidDto,
} from './dto/expense-claim.dto';

@ApiTags('Expense Claims')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('expense-claims')
export class ExpenseClaimsController {
  constructor(private readonly service: ExpenseClaimsService) {}

  // ── GET /expense-claims ─────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List expense claims (own or all, based on role)' })
  @ApiQuery({ name: 'status', required: false, enum: ExpenseClaimStatus })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: ExpenseClaimStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(
      user.tenantId!,
      user.sub,
      user.role ?? '',
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ── GET /expense-claims/:id ─────────────────────────────────────────────────

  @ApiOperation({ summary: 'Get expense claim detail with items' })
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.findOne(user.tenantId!, id, user.sub, user.role ?? '');
  }

  // ── POST /expense-claims ────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Create a new expense claim (saved as DRAFT)' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateExpenseClaimDto) {
    return this.service.create(
      user.tenantId!,
      user.branchId ?? null,
      user.sub,
      dto,
    );
  }

  // ── POST /expense-claims/:id/submit ────────────────────────────────────────

  @ApiOperation({ summary: 'Submit a DRAFT claim for approval' })
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.submit(user.tenantId!, id, user.sub);
  }

  // ── POST /expense-claims/:id/retract ───────────────────────────────────────

  @ApiOperation({ summary: 'Retract a SUBMITTED claim back to DRAFT' })
  @Post(':id/retract')
  @HttpCode(HttpStatus.OK)
  retract(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.retract(user.tenantId!, id, user.sub);
  }

  // ── POST /expense-claims/:id/review ────────────────────────────────────────

  @ApiOperation({ summary: 'Approve or reject a submitted claim (manager roles)' })
  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  review(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReviewExpenseClaimDto,
  ) {
    return this.service.review(
      user.tenantId!,
      id,
      user.sub,
      user.role ?? '',
      dto,
    );
  }

  // ── POST /expense-claims/:id/pay ────────────────────────────────────────────

  @ApiOperation({ summary: 'Mark an approved claim as paid (BUSINESS_OWNER / FINANCE_LEAD)' })
  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  markPaid(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.service.markPaid(user.tenantId!, id, user.role ?? '', dto);
  }

  // ── DELETE /expense-claims/:id ──────────────────────────────────────────────

  @ApiOperation({ summary: 'Delete a DRAFT claim (submitter only)' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deleteDraft(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.deleteDraft(user.tenantId!, id, user.sub);
  }
}

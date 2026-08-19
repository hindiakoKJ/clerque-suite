import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { effectiveBranchId } from '../common/branch-scope';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { RequireApiKeyLevel } from '../auth/decorators/use-api-key.decorator';
import { actorUserId, isServicePrincipal } from '../auth/strategies/api-key.strategy';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RequireIdempotency } from '../common/decorators/require-idempotency.decorator';
import { OrdersService } from './orders.service';
import { OrderQuoteService, type QuoteRequest } from './order-quote.service';
import { OfflineOrder } from '@repo/shared-types';

interface CreateOrderBody {
  order: OfflineOrder;
  /**
   * The consumer app's own id for this sale (a booking reference, say).
   * Unique per tenant: replaying it returns the original order instead of
   * creating a second one, so a retry after a timeout is always safe.
   */
  externalRef?: string;
}

interface VoidOrderBody {
  reason: string;
  /**
   * Required when the caller role is CASHIER.
   * Must be the UUID of a SALES_LEAD or BUSINESS_OWNER in the same tenant.
   * Implements the dual-authorization SOD rule: cashiers cannot self-authorize voids.
   */
  supervisorId?: string;
}

interface BulkSyncBody {
  orders: OfflineOrder[];
}

@ApiTags('Orders')
@ApiBearerAuth('access-token')
// Dual auth: the POS UI signs in with a JWT, an ecosystem app presents an
// API key, and both reach the SAME handlers — one implementation of the
// commerce invariants (VAT, period locks, OR numbering, inventory) rather
// than two that drift apart.
//
// Authentication is not authorization: RolesGuard rejects a key on every
// route that does not name 'SERVICE' in @Roles, including any route added
// later with no @Roles at all. Today only quote + create are open to keys.
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private ordersService: OrdersService,
    private quoteService:  OrderQuoteService,
  ) {}

  /**
   * Price a cart. Read-only: nothing is created, nothing is reserved.
   *
   * This is how a consumer app is meant to work — it describes what the
   * customer is buying and Clerque returns the money. The app never
   * computes VAT or picks a price itself, so a booking app and the till
   * can never disagree about what a sale is worth.
   *
   * Send the result to POST /orders to actually make the sale.
   */
  @Roles(
    'CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM',
    'SERVICE',
  )
  @RequireApiKeyLevel('read')
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(@CurrentUser() user: JwtPayload, @Body() body: QuoteRequest) {
    return this.quoteService.quote(user.tenantId!, body);
  }

  /**
   * List orders for this tenant's branch.
   * Read access: all operational + management roles; External Auditor gets read-only view.
   * Excluded: GENERAL_EMPLOYEE, WAREHOUSE_STAFF, BOOKKEEPER (no business need for order history).
   */
  @Roles(
    'CASHIER', 'SALES_LEAD',
    'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN',
    'MDM', 'FINANCE_LEAD', 'ACCOUNTANT', 'PAYROLL_MASTER',
    'EXTERNAL_AUDITOR',
  )
  @Get()
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('shiftId') shiftId?: string,
    @Query('take')     take?:     string,
    @Query('skip')     skip?:     string,
  ) {
    try {
      // Branch-scoped roles (CASHIER, SALES_LEAD, BRANCH_MANAGER, etc.) are
      // forced to their own branchId — owners/accountants see whatever they ask for.
      const scoped = effectiveBranchId(user, branchId);
      return await this.ordersService.findAll(
        user.tenantId!, scoped, shiftId,
        take ? Number(take) : undefined,
        skip ? Number(skip) : undefined,
      );
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if (err instanceof ForbiddenException) throw err;
      throw new InternalServerErrorException('Failed to retrieve orders');
    }
  }

  /**
   * Get a single order by ID.
   * Same read-access set as the list endpoint.
   */
  @Roles(
    'CASHIER', 'SALES_LEAD',
    'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN',
    'MDM', 'FINANCE_LEAD', 'ACCOUNTANT', 'PAYROLL_MASTER',
    'EXTERNAL_AUDITOR',
  )
  @Get(':id')
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    try {
      // CRITICAL: branch scope MUST flow through so branch-scoped roles
      // (CASHIER, SALES_LEAD, BRANCH_MANAGER, MDM, WAREHOUSE_STAFF) cannot
      // read another branch's order details. Pre-fix, a Branch-A cashier
      // could GET /orders/<branch-B-order-id> and see PWD/SC IDs, customer
      // TIN, payment amounts, and pharmacist PRC.
      const branchScope = effectiveBranchId(user, undefined);
      return await this.ordersService.findOne(user.tenantId!, id, branchScope);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if (err instanceof ForbiddenException) throw err;
      throw new InternalServerErrorException('Failed to retrieve order');
    }
  }

  /**
   * Create a sale. Reachable by a cashier at the till and by an ecosystem
   * app with a readwrite key — same handler, same invariants.
   *
   * The two callers are trusted differently. A cashier is a person acting
   * inside the business, so the POS keeps its existing behaviour: it sends
   * the totals it displayed and the server checks them for consistency. An
   * external app is not, so its totals are recomputed from the catalog and
   * the sale is rejected on any disagreement — see enforceServerTotals.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SERVICE')
  @RequireApiKeyLevel('readwrite')
  @RequireIdempotency()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateOrderBody) {
    const service = isServicePrincipal(user);
    return this.ordersService.create(
      user.tenantId!,
      // Null for a service call — there is no cashier. The sale is
      // attributed by createdByApiKeyId instead.
      actorUserId(user),
      body.order,
      {
        channel:             service ? 'API' : 'POS',
        createdByApiKeyId:   service ? user.apiKeyId : null,
        externalRef:         body.externalRef ?? null,
        enforceServerTotals: service,
      },
    );
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  bulkSync(@CurrentUser() user: JwtPayload, @Body() body: BulkSyncBody) {
    return this.ordersService.bulkSync(user.tenantId!, user.sub, body.orders);
  }

  /**
   * Void an order.
   *
   * SOD Rule — Dual Authorization:
   *   SALES_LEAD / BRANCH_MANAGER / BUSINESS_OWNER → void directly (no co-auth needed).
   *   CASHIER → must provide `supervisorId` (UUID of a SALES_LEAD or OWNER in same tenant).
   *             Backend validates the supervisor's role before proceeding.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: VoidOrderBody,
  ) {
    return this.ordersService.void(
      user.tenantId!, id, user.sub, user.role, body.reason, body.supervisorId,
    );
  }

  /**
   * Item-level refund — refund N units of a single OrderItem.
   * Same SOD rules as void: cashiers need supervisor PIN.
   *
   * Body: { quantity, reason, refundMethod, restock, supervisorId? }
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @RequireIdempotency()
  @Post(':orderId/items/:itemId/refund')
  @HttpCode(HttpStatus.OK)
  refundItem(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Param('itemId')  itemId:  string,
    @Body() body: {
      quantity:      number;
      reason:        string;
      refundMethod:  string;
      restock?:      boolean;
      supervisorId?: string;
    },
  ) {
    // Same SOD as void — cashier must provide supervisorId
    const VOID_DIRECT_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD', 'SUPER_ADMIN'];
    if (!VOID_DIRECT_ROLES.includes(user.role) && !body.supervisorId) {
      throw new BadRequestException('Cashiers must provide a supervisorId to authorise an item refund.');
    }
    return this.ordersService.refundItem({
      tenantId:     user.tenantId!,
      orderId,
      orderItemId:  itemId,
      quantity:     body.quantity,
      reason:       body.reason,
      refundMethod: body.refundMethod,
      restock:      body.restock ?? true,
      refundedById: body.supervisorId ?? user.sub,
      callerRole:   user.role,
    });
  }
}

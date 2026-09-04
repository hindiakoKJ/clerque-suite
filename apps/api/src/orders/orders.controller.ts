import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
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
  /**
   * True when the till is replaying a sale it took while offline.
   *
   * That sale already physically happened -- the drink is in the customer's
   * hand -- so the stock ceiling must not refuse it now. The bulk /orders/sync
   * route always knew this; the Counter's outbox replays one order at a time
   * through THIS route and did not, so a sale could be refused after the fact
   * because a later sale had used the last of the milk.
   */
  replayedOffline?: boolean;
}

interface VoidOrderBody {
  reason: string;
  /**
   * Required when the caller role is CASHIER: the PIN of a SALES_LEAD,
   * BRANCH_MANAGER or BUSINESS_OWNER in the same tenant, verified against
   * that supervisor's hash inside the service. Implements the
   * dual-authorization SOD rule — cashiers cannot self-authorize voids.
   */
  supervisorPin?: string;
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
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateOrderBody,
    // Sent by the till when it is draining its offline queue. A header, so it
    // stays out of the idempotency hash of the body; the body field is still
    // read for rows queued by an older build of the app.
    @Headers('x-replayed-offline') replayedHeader?: string,
  ) {
    const service = isServicePrincipal(user);
    const replayed = replayedHeader === '1' || body.replayedOffline === true;
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
        // A cashier replaying an offline sale is recording something that
        // already happened. A machine caller never gets this flag: it prices
        // through the catalog and is not a till.
        skipStockCeiling:    !service && replayed,
        // SOD: the service checks discount authority against the real caller.
        // Service principals price through the catalog already, so their
        // totals are authoritative and the role check does not apply.
        callerRole:              service ? null : user.role,
        callerCustomPermissions: service ? null : user.customPermissions,
      },
    );
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  bulkSync(@CurrentUser() user: JwtPayload, @Body() body: BulkSyncBody) {
    return this.ordersService.bulkSync(user.tenantId!, user.sub, body.orders, {
      role:              user.role,
      customPermissions: user.customPermissions,
    });
  }

  /**
   * Void an order.
   *
   * SOD Rule — Dual Authorization:
   *   SALES_LEAD / BRANCH_MANAGER / BUSINESS_OWNER → void directly (no co-auth needed).
   *   CASHIER → must provide `supervisorPin`; the service bcrypt-verifies it
   *             against supervisors in the tenant and records whoever matched.
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
      user.tenantId!, id, user.sub, user.role, body.reason, body.supervisorPin,
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
      quantity:       number;
      reason:         string;
      refundMethod:   string;
      restock?:       boolean;
      supervisorPin?: string;
    },
  ) {
    // Same SOD as void — a cashier needs a supervisor's PIN, verified inside
    // the service against that supervisor's hash. The old contract took a
    // `supervisorId` from the body and merely checked it was present, so a
    // cashier could pass their own id (or one harvested from a previous
    // void) and self-approve a cash refund.
    const VOID_DIRECT_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD', 'SUPER_ADMIN'];
    if (!VOID_DIRECT_ROLES.includes(user.role) && !body.supervisorPin) {
      throw new BadRequestException('Cashiers must provide a supervisor PIN to authorise an item refund.');
    }
    return this.ordersService.refundItem({
      tenantId:     user.tenantId!,
      orderId,
      orderItemId:  itemId,
      quantity:     body.quantity,
      reason:       body.reason,
      refundMethod: body.refundMethod,
      restock:      body.restock ?? true,
      refundedById: user.sub,
      supervisorPin: body.supervisorPin,
      callerRole:   user.role,
    });
  }
}

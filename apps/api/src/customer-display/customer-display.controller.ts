import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { CustomerDisplayService, type CartSnapshot } from './customer-display.service';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CartLineDto {
  @IsString() productName: string;
  @IsNumber() quantity: number;
  @IsNumber() unitPrice: number;
  @IsNumber() lineTotal: number;
  @IsOptional() @IsArray() @IsString({ each: true }) modifiers?: string[];
}

class PublishSnapshotDto {
  @IsIn(['WELCOME', 'CART_UPDATE', 'PAYMENT_PENDING', 'PAYMENT_COMPLETE', 'CLEAR'])
  type: CartSnapshot['type'];

  @IsArray() @ValidateNested({ each: true }) @Type(() => CartLineDto)
  lines: CartLineDto[];

  @IsNumber() subtotal: number;
  @IsNumber() discount: number;
  @IsNumber() vatAmount: number;
  @IsNumber() total: number;

  @IsOptional() @IsNumber() amountTendered?: number;
  @IsOptional() @IsNumber() changeDue?:      number;
  @IsOptional() @IsString() cashierName?:    string;
  @IsOptional() @IsString() branchName?:     string;
  @IsOptional() @IsString() businessName?:   string;

  /**
   * Optional — when omitted, the JWT user.sub is used as the cashier key.
   * Allows a customer-display tablet to subscribe to a different terminal's
   * feed if needed (e.g. a wall-mounted screen showing whichever cashier
   * is currently active).
   */
  @IsOptional() @IsString() cashierId?: string;
}

/**
 * Customer-facing display sync endpoints.
 *
 * Use case: cashier and customer screens are on different devices (two
 * tablets, or different Chrome profiles on one device). BroadcastChannel
 * can't span those boundaries — these endpoints provide the relay.
 *
 * Same-browser dual-monitor setups continue to use BroadcastChannel
 * (no network round-trip, instant sync). Cross-device falls back to
 * polling here.
 */
@UseGuards(JwtAuthGuard)
@Controller('customer-display')
export class CustomerDisplayController {
  constructor(private svc: CustomerDisplayService) {}

  /** Cashier publishes a fresh cart snapshot. */
  @Post('state')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentUser() user: JwtPayload, @Body() dto: PublishSnapshotDto) {
    const cashierId = dto.cashierId ?? user.sub;
    const { cashierId: _ignore, ...snapshot } = dto;
    return this.svc.publish(user.tenantId!, cashierId, snapshot as CartSnapshot);
  }

  /** Customer-display screen polls for the current cart snapshot. */
  @Get('state')
  read(
    @CurrentUser() user: JwtPayload,
    @Query('cashierId') cashierId?: string,
  ) {
    const id = cashierId ?? user.sub;
    const stored = this.svc.read(user.tenantId!, id);
    if (!stored) return { exists: false };
    return { exists: true, ...stored };
  }

  /** Clear the cashier's snapshot — called on shift close. */
  @Post('clear')
  @HttpCode(HttpStatus.OK)
  clear(@CurrentUser() user: JwtPayload) {
    this.svc.clear(user.tenantId!, user.sub);
    return { cleared: true };
  }
}

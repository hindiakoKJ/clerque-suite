/**
 * Customers (POS-scope)
 *
 * Light-weight customer CRUD that does NOT require the Ledger module. Used by
 * laundry intake, POS charge-tab orders, project-cost flow, and any POS-side
 * surface that needs to attach a customer to a transaction without going
 * through the formal AR (invoice / credit term / payment) workflow.
 *
 * The deeper AR features (credit terms, AR invoices, payments, statements)
 * still live under /ar/customers — those endpoints require @RequireApp('LEDGER').
 *
 * The two surfaces share the underlying Customer table; this module just
 * exposes a smaller, plan-friendly subset.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { ShiftsModule } from './shifts/shifts.module';
import { InventoryModule } from './inventory/inventory.module';
import { ReportsModule } from './reports/reports.module';
import { UsersModule } from './users/users.module';
import { AccountingModule } from './accounting/accounting.module';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    TenantModule,
    CategoriesModule,
    ProductsModule,
    OrdersModule,
    ShiftsModule,
    InventoryModule,
    ReportsModule,
    UsersModule,
    AccountingModule,
  ],
})
export class AppModule {}

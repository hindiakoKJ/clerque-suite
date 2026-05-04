import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { ModifiersModule } from './modifiers/modifiers.module';
import { SettlementModule } from './settlement/settlement.module';
import { AccountingPeriodsModule } from './accounting-periods/accounting-periods.module';
import { ExportModule } from './export/export.module';
import { BirModule } from './bir/bir.module';
import { TaxModule } from './tax/tax.module';
import { AuditModule } from './audit/audit.module';
import { UomModule } from './uom/uom.module';
import { PayrollModule } from './payroll/payroll.module';
import { ApModule } from './ap/ap.module';
import { ArModule } from './ar/ar.module';
import { PromotionsModule } from './promotions/promotions.module';
import { ImportModule } from './import/import.module';
import { MailModule } from './mail/mail.module';
import { DocumentsModule } from './documents/documents.module';
import { ExpenseClaimsModule } from './expense-claims/expense-claims.module';
import { NumberingModule } from './numbering/numbering.module';
import { AiModule } from './ai/ai.module';
import { LedgerMetricsModule } from './ledger-metrics/ledger-metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BankReconciliationModule } from './bank-recon/bank-recon.module';
import { JournalTemplatesModule } from './journal-templates/journal-templates.module';
import { AdminModule } from './admin/admin.module';
import { LayoutsModule } from './layouts/layouts.module';
import { CustomerDisplayModule } from './customer-display/customer-display.module';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
    ModifiersModule,
    SettlementModule,
    AccountingPeriodsModule,
    ExportModule,
    BirModule,
    TaxModule,
    AuditModule,
    UomModule,
    PayrollModule,
    ApModule,
    ArModule,
    PromotionsModule,
    ImportModule,
    MailModule,
    DocumentsModule,
    ExpenseClaimsModule,
    NumberingModule,
    AiModule,
    LedgerMetricsModule,
    NotificationsModule,
    BankReconciliationModule,
    JournalTemplatesModule,
    AdminModule,
    LayoutsModule,
    CustomerDisplayModule,
  ],
})
export class AppModule {}

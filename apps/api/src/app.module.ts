import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { PreOrdersModule } from './pre-orders/pre-orders.module';
import { CloseAndPlanModule } from './close-and-plan/close-and-plan.module';
import { PriceListsModule } from './price-lists/price-lists.module';
import { RentalsModule } from './rentals/rentals.module';
import { FuelModule } from './fuel/fuel.module';
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
import { SimpleEntriesModule } from './simple-entries/simple-entries.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BankReconciliationModule } from './bank-recon/bank-recon.module';
import { JournalTemplatesModule } from './journal-templates/journal-templates.module';
import { AdminModule } from './admin/admin.module';
import { LayoutsModule } from './layouts/layouts.module';
import { CustomerDisplayModule } from './customer-display/customer-display.module';
import { KdsModule } from './kds/kds.module';
import { IngredientReportsModule } from './ingredient-reports/ingredient-reports.module';
import { LaundryModule } from './laundry/laundry.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { ProjectsModule } from './projects/projects.module';
import { CustomersModule } from './customers/customers.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { TruckingModule } from './trucking/trucking.module';
import { ConstructionModule } from './construction/construction.module';
import { JobOrdersModule } from './job-orders/job-orders.module';
import { PlatformModule } from './platform/platform.module';
import { EmployeeRequestsModule } from './employee-requests/employee-requests.module';
import { BackupModule } from './backup/backup.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { LoyaltyProModule } from './loyalty-pro/loyalty-pro.module';
import { AutoBackupModule } from './auto-backup/auto-backup.module';
import { KioskModule } from './payroll/kiosk/kiosk.module';
import { StorageModule } from './storage/storage.module';
import { SubscriptionPaymentsModule } from './subscription-payments/subscription-payments.module';
import { VoidApprovalsModule } from './void-approvals/void-approvals.module';
import { DisplayPairingModule } from './display-pairing/display-pairing.module';
import { ReportsAdvancedModule } from './reports-advanced/reports-advanced.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PublicApiModule } from './public-api/public-api.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { InventoryReportsModule } from './inventory-reports/inventory-reports.module';
import { HealthController } from './health/health.controller';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { CleanupScheduler } from './common/cleanup.scheduler';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // SECURITY D5-03 — global API rate limiter.
    // Defaults: 100 requests / minute per IP. Authenticated endpoints can
    // override via @Throttle on the controller for tighter or looser limits
    // (e.g., login is already throttled per-account in auth.service). The
    // limiter uses an in-memory LRU; acceptable for single-instance Railway,
    // swap for the Redis storage adapter (`@nestjs/throttler/storage-redis`)
    // before enabling horizontal scaling.
    ThrottlerModule.forRoot([
      { name: 'short',  ttl: 1000,    limit: 30 },   // 30 req / 1s
      { name: 'medium', ttl: 10_000,  limit: 100 },  // 100 req / 10s
      { name: 'long',   ttl: 60_000,  limit: 600 },  // 600 req / min
    ]),
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
    PreOrdersModule,
    CloseAndPlanModule,
    PriceListsModule,
    RentalsModule,
    FuelModule,
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
    SimpleEntriesModule,
    NotificationsModule,
    BankReconciliationModule,
    JournalTemplatesModule,
    AdminModule,
    LayoutsModule,
    CustomerDisplayModule,
    KdsModule,
    IngredientReportsModule,
    LaundryModule,
    WarehouseModule,
    ProjectsModule,
    CustomersModule,
    PharmacyModule,
    TruckingModule,
    ConstructionModule,
    JobOrdersModule,
    PlatformModule,
    EmployeeRequestsModule,
    BackupModule,
    LoyaltyModule,
    LoyaltyProModule,
    AutoBackupModule,
    KioskModule,
    StorageModule,
    SubscriptionPaymentsModule,
    VoidApprovalsModule,
    DisplayPairingModule,
    ReportsAdvancedModule,
    ApiKeysModule,
    PublicApiModule,
    PurchaseOrdersModule,
    InventoryReportsModule,
  ],
  providers: [
    // SECURITY D5-03 — apply ThrottlerGuard globally. Controllers can opt out
    // with @SkipThrottle() (e.g., the webhook endpoints) or tighten limits
    // with @Throttle(...).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // SECURITY D5-06 — Idempotency-Key replay protection. Acts only on routes
    // decorated with @RequireIdempotency() (financial mutations). Pass-through
    // for every other route, so the cost is one Reflector lookup per request.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    // Nightly purge of expired IdempotencyKey rows (24h TTL).
    CleanupScheduler,
  ],
})
export class AppModule {}

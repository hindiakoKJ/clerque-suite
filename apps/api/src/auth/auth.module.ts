import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { TierQuotaGuard } from './guards/tier-quota.guard';
import { TwoFactorService } from './two-factor.service';
import { AccountingModule } from '../accounting/accounting.module';
import { SubscriptionPaymentsModule } from '../subscription-payments/subscription-payments.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    // Sprint 21 — public Ledger self-signup endpoint needs to seed CoA on
    // tenant create. AccountingModule exports AccountsService.
    AccountingModule,
    // Sprint 24 — POS self-signup creates a PendingPayment for first-month
    // billing. SubscriptionPaymentsModule exports SubscriptionPaymentsService.
    SubscriptionPaymentsModule,
  ],
  providers: [AuthService, JwtStrategy, LocalStrategy, TierQuotaGuard, TwoFactorService],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, TierQuotaGuard, TwoFactorService],
})
export class AuthModule {}

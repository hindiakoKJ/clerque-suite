import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The login token's businessName is the receipt header. It must never be
 * empty for a business that has a name.
 *
 * It was `tenant.businessName ?? null`, the BIR "business name as on COR"
 * alone, which stays null until the owner opens Settings > BIR & Tax. Cafe
 * Carolina never did, so the receipt fell through to its last-resort text and
 * customers were handed slips headed "DEMO STORE". The Settings preview,
 * meanwhile, showed the tenant name, so the owner never saw the problem.
 */
describe('AuthService.login — businessName in the token falls back to the tenant name', () => {
  async function tokenFor(tenantRow: Record<string, unknown>) {
    const prisma: any = {
      userSession:   { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
      userAppAccess: { findMany: jest.fn().mockResolvedValue([]) },
      tenant:        { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', planCode: 'CLERQUE', ...tenantRow }) },
      user:          { findUnique: jest.fn().mockResolvedValue({ personaKey: null, customPermissions: [] }) },
      loginLog:      { create: jest.fn().mockResolvedValue({}) },
    };
    const jwt = { sign: jest.fn().mockReturnValue('signed'), verify: jest.fn(), decode: jest.fn() };

    const { MailService } = await import('../mail/mail.service');
    const { AccountsService } = await import('../accounting/accounts.service');
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,   useValue: prisma },
        { provide: JwtService,      useValue: jwt },
        { provide: MailService,     useValue: {} },
        { provide: AccountsService, useValue: {} },
      ],
    }).compile();

    await moduleRef.get(AuthService).login('user-1', 'tenant-1', 'branch-1', 'CASHIER', 'Maria');
    return { payload: jwt.sign.mock.calls[0][0], select: prisma.tenant.findUnique.mock.calls[0][0].select };
  }

  it('asks the database for the tenant name, not only the BIR field', async () => {
    const { select } = await tokenFor({ name: 'Cafe Carolina', businessName: null });
    expect(select).toMatchObject({ name: true, businessName: true });
  });

  it('BIR & Tax never filled in: the receipt is headed with the name the business was created with', async () => {
    const { payload } = await tokenFor({ name: 'Cafe Carolina', businessName: null });
    expect(payload.businessName).toBe('Cafe Carolina');
  });

  it('the BIR "business name as on COR" still wins once the owner has filled it in', async () => {
    const { payload } = await tokenFor({ name: 'Cafe Carolina', businessName: 'Carolina Food Ventures' });
    expect(payload.businessName).toBe('Carolina Food Ventures');
  });

  it('a BIR field saved as spaces counts as blank', async () => {
    const { payload } = await tokenFor({ name: 'Cafe Carolina', businessName: '   ' });
    expect(payload.businessName).toBe('Cafe Carolina');
  });
});

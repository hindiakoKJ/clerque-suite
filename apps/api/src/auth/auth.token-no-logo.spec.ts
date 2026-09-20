import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The login token must never carry the business logo.
 *
 * It did, and the logo could be an inline image of up to 256 KB. The web app
 * stores the whole token in the app-session cookie; a browser silently drops a
 * cookie over about 4 KB, so the middleware saw no session and every user of
 * that business was sent back to the login page, over and over. Screens now
 * read the logo from GET /tenant/branding.
 */
describe('AuthService.login — no logo in the token', () => {
  it('neither reads the logo nor puts it in the token, even when one is saved inline', async () => {
    const inlineLogo = `data:image/png;base64,${'A'.repeat(300_000)}`;
    const prisma: any = {
      userSession:   { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
      userAppAccess: { findMany: jest.fn().mockResolvedValue([]) },
      tenant:        {
        // Returns the logo even if not asked for, so a regression that copies
        // any tenant field into the token would show up here.
        findUnique: jest.fn().mockResolvedValue({
          taxStatus: 'UNREGISTERED', businessName: 'Kape Tayo', planCode: 'CLERQUE',
          receiptHeaderNote: 'Open 7am', receiptFooterNote: 'Salamat!', receiptLogoUrl: inlineLogo,
        }),
      },
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

    const select = prisma.tenant.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('receiptLogoUrl');

    const accessPayload = jwt.sign.mock.calls[0][0];
    expect(accessPayload).not.toHaveProperty('receiptLogoUrl');
    expect(JSON.stringify(accessPayload)).not.toContain('data:image');
    // The receipt notes still travel; only the logo moved out.
    expect(accessPayload).toMatchObject({ businessName: 'Kape Tayo', receiptHeaderNote: 'Open 7am', receiptFooterNote: 'Salamat!' });
  });
});

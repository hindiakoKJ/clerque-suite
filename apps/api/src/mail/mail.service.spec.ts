/**
 * Tests for MailService.sendInvoice (Sprint 22).
 *
 * RESEND_API_KEY is intentionally absent — the service silently skips
 * delivery. We still want to verify the method runs cleanly with a buffer
 * attachment and a valid recipient. When the key IS set, we assert Resend
 * sees the attachment.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { DEFAULT_MAIL_FROM } from './support';

describe('MailService.sendInvoice', () => {
  it('runs without crashing when RESEND_API_KEY is not configured', async () => {
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    const svc = module.get(MailService);

    await expect(svc.sendInvoice({
      to:             'customer@example.com',
      customerName:   'Test Customer',
      tenantName:     'Acme PH',
      invoiceNumber:  'INV-00042',
      invoiceTotal:   '₱ 11,200.00',
      dueDate:        '31 May 2026',
      pdfBuffer:      Buffer.from('%PDF-1.7\n%%EOF\n'),
    })).resolves.toBeUndefined();
  });

  it('passes attachments through to Resend when an API key is set', async () => {
    // Build a fake Resend with a captured spy
    const sendSpy = jest.fn().mockResolvedValue({ error: null });

    // Stub the Resend SDK on require — fully isolated, no real network
    jest.resetModules();
    jest.doMock('resend', () => ({
      Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendSpy } })),
    }));
    const { MailService: FreshMailService } = await import('./mail.service');

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'RESEND_API_KEY') return 'test-key';
        if (key === 'MAIL_FROM')      return 'noreply@test';
        if (key === 'APP_URL')        return 'http://localhost:3000';
        return undefined;
      }),
    } as unknown as ConfigService;

    const svc = new FreshMailService(config);
    const pdf = Buffer.from('%PDF-1.7 stub');
    await svc.sendInvoice({
      to:             'customer@example.com',
      customerName:   'Test Customer',
      tenantName:     'Acme PH',
      invoiceNumber:  'INV-00042',
      invoiceTotal:   '₱ 11,200.00',
      dueDate:        '31 May 2026',
      pdfBuffer:      pdf,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const arg = sendSpy.mock.calls[0][0];
    expect(arg.to).toBe('customer@example.com');
    expect(arg.subject).toContain('INV-00042');
    expect(arg.subject).toContain('Acme PH');
    expect(arg.attachments).toEqual([{ filename: 'INV-00042.pdf', content: pdf }]);

    jest.dontMock('resend');
  });
});

/**
 * Every email must reach a real support contact.
 *
 * The admin-reset notice told the owner to "contact support immediately at
 * <APP_URL>/help": a page that does not exist, behind the sign-in redirect,
 * in the one email that warns of a possibly compromised account. And with
 * MAIL_FROM unset the sender was noreply@clerque.app, a domain nobody owns.
 */
describe('MailService — support contact in every email', () => {
  async function freshService(env: Record<string, string>) {
    const sendSpy = jest.fn().mockResolvedValue({ error: null });
    jest.resetModules();
    jest.doMock('resend', () => ({
      Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendSpy } })),
    }));
    const { MailService: FreshMailService } = await import('./mail.service');
    const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
    const svc = new FreshMailService(config);
    return { svc, sendSpy };
  }
  afterEach(() => { jest.dontMock('resend'); });

  it('the admin-reset notice links to the support mailbox, never to a /help page', async () => {
    const { svc, sendSpy } = await freshService({ RESEND_API_KEY: 'test-key', APP_URL: 'https://clerque.cc' });
    await svc.sendAdminPasswordResetNotice({
      to: 'anne@example.com', name: 'Anne', actorEmail: 'kj@hnscorpph.com', when: new Date('2026-09-22T09:00:00+08:00'), tenantSlug: 'cafe-carolina',
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const html: string = sendSpy.mock.calls[0][0].html;
    expect(html).toContain('href="mailto:devsupport@hnscorpph.com');
    expect(html).toContain('>devsupport@hnscorpph.com<');
    expect(html).not.toContain('/help');
    expect(html).not.toContain('clerque.cc/help');
  });

  it('with MAIL_FROM unset, the sender is the same default the env schema gives (never clerque.app)', async () => {
    const { svc, sendSpy } = await freshService({ RESEND_API_KEY: 'test-key' });
    await svc.sendPasswordReset({ to: 'anne@example.com', name: 'Anne', token: 't', tenantSlug: 'cafe-carolina' });
    expect(sendSpy.mock.calls[0][0].from).toBe('Clerque <noreply@clerque.cc>');
    expect(sendSpy.mock.calls[0][0].from).not.toContain('clerque.app');
    // The running API reads MAIL_FROM through the validated config, whose
    // default wins over the service's own fallback. The two must agree.
    const { envValidationSchema } = await import('../common/config/env.validation');
    expect(envValidationSchema.describe().keys.MAIL_FROM.flags.default).toBe(DEFAULT_MAIL_FROM);
  });

  it('every email replies to the support mailbox and names it in the footer', async () => {
    const { svc, sendSpy } = await freshService({ RESEND_API_KEY: 'test-key' });
    await svc.sendPasswordReset({ to: 'anne@example.com', name: 'Anne', token: 't', tenantSlug: 'cafe-carolina' });
    const arg = sendSpy.mock.calls[0][0];
    expect(arg.replyTo).toBe('devsupport@hnscorpph.com');
    expect(arg.html).toContain('href="mailto:devsupport@hnscorpph.com"');
  });

  it('a configured MAIL_FROM still wins', async () => {
    const { svc, sendSpy } = await freshService({ RESEND_API_KEY: 'test-key', MAIL_FROM: 'Clerque <noreply@clerque.cc>' });
    await svc.sendPasswordReset({ to: 'anne@example.com', name: 'Anne', token: 't', tenantSlug: 'cafe-carolina' });
    expect(sendSpy.mock.calls[0][0].from).toBe('Clerque <noreply@clerque.cc>');
  });
});

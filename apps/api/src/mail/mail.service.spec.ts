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

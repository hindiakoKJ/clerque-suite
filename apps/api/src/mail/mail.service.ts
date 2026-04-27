import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(private config: ConfigService) {
    this.resend  = new Resend(this.config.get<string>('RESEND_API_KEY') ?? '');
    this.from    = this.config.get<string>('MAIL_FROM')    ?? 'noreply@clerque.app';
    this.appUrl  = this.config.get<string>('APP_URL')      ?? 'http://localhost:3000';
  }

  // ── Forgot Password ────────────────────────────────────────────────────────

  async sendPasswordReset(opts: {
    to:         string;
    name:       string;
    token:      string;
    tenantSlug: string;
  }): Promise<void> {
    const resetUrl = `${this.appUrl}/reset-password?token=${opts.token}&slug=${opts.tenantSlug}`;

    await this.send({
      to:      opts.to,
      subject: 'Reset your Clerque password',
      html:    this.layout(`
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">
          Password Reset Request
        </h2>
        <p style="margin:0 0 16px;color:#555;line-height:1.6;">
          Hi <strong>${this.escape(opts.name)}</strong>,
        </p>
        <p style="margin:0 0 24px;color:#555;line-height:1.6;">
          We received a request to reset your Clerque password.
          Click the button below — this link expires in <strong>1 hour</strong>.
        </p>
        <a href="${resetUrl}"
           style="display:inline-block;background:#2AA198;color:#fff;text-decoration:none;
                  padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">
          Reset Password
        </a>
        <p style="margin:24px 0 0;color:#888;font-size:13px;line-height:1.6;">
          If you didn't request this, you can safely ignore this email.
          Your password will not change.
        </p>
        <p style="margin:8px 0 0;color:#aaa;font-size:12px;">
          Or paste this link in your browser:<br/>
          <a href="${resetUrl}" style="color:#2AA198;word-break:break-all;">${resetUrl}</a>
        </p>
      `),
    });
  }

  // ── Welcome / New Staff Account ────────────────────────────────────────────

  async sendWelcome(opts: {
    to:          string;
    name:        string;
    tenantName:  string;
    tenantSlug:  string;
    tempPassword: string;
    appName:     string;
  }): Promise<void> {
    const loginUrl = `${this.appUrl}/login?app=${opts.appName.toLowerCase()}`;

    await this.send({
      to:      opts.to,
      subject: `Welcome to ${opts.tenantName} on Clerque`,
      html:    this.layout(`
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">
          Welcome to Clerque, ${this.escape(opts.name)}!
        </h2>
        <p style="margin:0 0 16px;color:#555;line-height:1.6;">
          Your account has been created for <strong>${this.escape(opts.tenantName)}</strong>.
          Here are your login credentials:
        </p>
        <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
          <tr>
            <td style="padding:8px 12px;background:#f5f5f5;font-weight:600;font-size:13px;color:#555;width:140px;border-radius:4px 0 0 4px;">Company Code</td>
            <td style="padding:8px 12px;background:#fafafa;font-family:monospace;font-size:14px;color:#1a1a1a;">${this.escape(opts.tenantSlug)}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f5f5f5;font-weight:600;font-size:13px;color:#555;">Email</td>
            <td style="padding:8px 12px;background:#fafafa;font-family:monospace;font-size:14px;color:#1a1a1a;">${this.escape(opts.to)}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f5f5f5;font-weight:600;font-size:13px;color:#555;">Temp Password</td>
            <td style="padding:8px 12px;background:#fafafa;font-family:monospace;font-size:14px;color:#1a1a1a;">${this.escape(opts.tempPassword)}</td>
          </tr>
        </table>
        <a href="${loginUrl}"
           style="display:inline-block;background:#2AA198;color:#fff;text-decoration:none;
                  padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">
          Log In Now
        </a>
        <p style="margin:24px 0 0;color:#888;font-size:13px;line-height:1.6;">
          Please change your password after your first login
          via <strong>Settings → Security → Change My Password</strong>.
        </p>
      `),
    });
  }

  // ── Payslip Ready ─────────────────────────────────────────────────────────

  async sendPayslipReady(opts: {
    to:          string;
    name:        string;
    periodLabel: string;
    appUrl:      string;
  }): Promise<void> {
    const payslipUrl = `${this.appUrl}/payroll/payslips`;

    await this.send({
      to:      opts.to,
      subject: `Your payslip for ${opts.periodLabel} is ready`,
      html:    this.layout(`
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">
          Payslip Ready
        </h2>
        <p style="margin:0 0 16px;color:#555;line-height:1.6;">
          Hi <strong>${this.escape(opts.name)}</strong>,
        </p>
        <p style="margin:0 0 24px;color:#555;line-height:1.6;">
          Your payslip for <strong>${this.escape(opts.periodLabel)}</strong> has been
          processed and is now available in the Clerque Payroll app.
        </p>
        <a href="${payslipUrl}"
           style="display:inline-block;background:#2AA198;color:#fff;text-decoration:none;
                  padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">
          View My Payslip
        </a>
      `),
    });
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async send(opts: { to: string; subject: string; html: string }) {
    try {
      const { error } = await this.resend.emails.send({
        from:    this.from,
        to:      opts.to,
        subject: opts.subject,
        html:    opts.html,
      });
      if (error) {
        this.logger.warn(`Resend delivery error to ${opts.to}: ${error.message}`);
      }
    } catch (err) {
      // Never crash the calling request over a mail failure — log and continue
      this.logger.error(`Mail send failed to ${opts.to}: ${(err as Error).message}`);
    }
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Minimal branded HTML wrapper — works in all email clients */
  private layout(body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1a1a1a;padding:20px 32px;">
            <span style="color:#2AA198;font-weight:800;font-size:20px;letter-spacing:-0.5px;">Clerque</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;color:#bbb;font-size:12px;line-height:1.6;">
              This email was sent by Clerque on behalf of your employer.<br/>
              If you have questions, contact your Business Owner or manager.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}

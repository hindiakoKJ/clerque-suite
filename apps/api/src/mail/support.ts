/**
 * The ONE support mailbox, for every email Clerque sends.
 *
 * The web app has the same constant in apps/web/lib/support.ts. Keep the two
 * equal: the security-awareness page tells owners which sender domains to
 * trust, and an email that names a different address undoes that.
 *
 * It had drifted here too: the admin-reset notice told a possibly-compromised
 * owner to "contact support immediately" at APP_URL/help, a page that does
 * not exist, and the default sender was noreply@clerque.app, a domain nobody
 * owns.
 */
export const SUPPORT_EMAIL = 'devsupport@hnscorpph.com';

/** A mailto: link to support, with an optional subject line. */
export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}

/**
 * The sender used when MAIL_FROM is not set: a no-reply address on the domain
 * Clerque runs on, the one DEPLOY.md says to verify in Resend. It MUST equal
 * the MAIL_FROM default in common/config/env.validation.ts (that default is
 * what the running API actually sees; this only matters where the config
 * schema is not loaded). mail.service.spec.ts pins the two together.
 *
 * Replies never go to this address: every email carries Reply-To:
 * SUPPORT_EMAIL, so "reply to this email" reaches a person.
 */
export const DEFAULT_MAIL_FROM = 'Clerque <noreply@clerque.cc>';

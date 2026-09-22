/**
 * The ONE support mailbox. Every page that tells someone to write to us uses
 * this, so the address can never drift again.
 *
 * It had drifted: pages pointed at support@clerque.ph, support@example.com and
 * a clerque.app sender, none of which is a mailbox anyone reads. An owner
 * following the "URGENT — restore from backup" steps would have written to
 * nobody. lib/support.spec.mjs fails if any of those addresses comes back.
 *
 * Free of React and 'use client' so server pages (legal, welcome) can import it.
 */
export const SUPPORT_EMAIL = 'devsupport@hnscorpph.com';

/** A mailto: link to support, with an optional subject line. */
export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}

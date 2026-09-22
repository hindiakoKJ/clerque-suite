/**
 * Where a notification may take the person who taps it.
 *
 * Alerts are often broadcast to a whole business (userId null): "orders stuck
 * in the kitchen" links into Counter, "overdue bills" and "close the period"
 * link into Ledger. The cook and the barista see those alerts too, from the
 * bell in Procure, and their sign-in cannot open Counter or Ledger. Tapping
 * one sent them through the edge guard (middleware.ts) and out of Procure to
 * the app picker with an error. So a link is only offered when this person's
 * role can enter the app it points into; otherwise the alert is read-only.
 *
 * The role table is the same one the edge guard uses (lib/app-roles.ts), so
 * the two cannot disagree. Relative import on purpose: notification-link.spec.mjs
 * runs this under plain Node, which does not know the "@/" alias.
 */
import { canEnterApp } from '../../lib/app-roles';

export type LinkApp = 'pos' | 'ledger' | 'procure' | 'payroll';

/** The app a link points into, or null for links outside the four apps (Settings, an external page). */
export function appForLink(link: string | null | undefined): LinkApp | null {
  if (!link) return null;
  const path = link.split(/[?#]/)[0];
  const inside = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (inside('/pos'))     return 'pos';
  if (inside('/ledger'))  return 'ledger';
  if (inside('/procure')) return 'procure';
  if (inside('/payroll')) return 'payroll';
  return null;
}

/**
 * The link to open for this person, or null when there is nothing safe to
 * open: no link at all, or a link into an app their role cannot enter.
 */
export function notificationHref(link: string | null | undefined, role: string | null | undefined): string | null {
  if (!link) return null;
  const app = appForLink(link);
  if (!app) return link;
  if (role === 'SUPER_ADMIN') return link; // the edge guard lets a super admin in everywhere
  return role && canEnterApp(app, role) ? link : null;
}

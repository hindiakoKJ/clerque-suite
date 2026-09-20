/**
 * Clerque Counter — tenant branding (business logo + initials)
 *
 * The logo used to ride inside the login token. A logo saved as an inline
 * image made the token too big to keep, so the token no longer carries it.
 * Screens now read GET /tenant/branding instead, which answers both a
 * signed-in user (JWT) and a paired display (device token):
 *
 *   { name, businessName, logoUrl, initials }
 *
 * Kept free of React Native / Expo imports so these helpers stay pure.
 * The hooks live in `@/api/queries`; the logo link is built with
 * `resolveAssetUrl` in `@/api/client`.
 */

export interface TenantBranding {
  name: string;
  businessName: string | null;
  /** Short link to the stored logo, or null when the business has none. */
  logoUrl: string | null;
  /** Up to 2 letters, from businessName, else name. */
  initials: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// Built lazily inside try/catch: a `\p{..}` literal the JS engine can't
// parse would throw when this module loads and take the whole app down.
let letterOrDigitRe: RegExp | null | undefined;
function isLetterOrDigit(c: string): boolean {
  if (letterOrDigitRe === undefined) {
    try {
      letterOrDigitRe = new RegExp('[\\p{L}\\p{N}]', 'u');
    } catch {
      letterOrDigitRe = null;
    }
  }
  if (letterOrDigitRe) return letterOrDigitRe.test(c);
  return c.toLowerCase() !== c.toUpperCase() || (c >= '0' && c <= '9');
}

/**
 * Up to two letters for the placeholder circle. Same rule as the API's
 * brandingInitials (apps/api/src/tenant/logo-link.ts), so the circle does not
 * change letters when the server's answer arrives: take the first name given
 * that has any letters or digits; two or more words give the first letter of
 * the first two ("Kape Tayo" -> "KT"), one word gives its first two letters
 * ("Magnet" -> "MA"). Punctuation is ignored.
 *
 * Callers pass businessName before name. Used until the server's `initials`
 * arrive (first boot, offline) and whenever it sends none.
 */
export function initialsFrom(...names: Array<string | null | undefined>): string {
  for (const source of names) {
    const words = (source ?? '')
      .split(/\s+/)
      .map((w) => Array.from(w).filter(isLetterOrDigit).join(''))
      .filter((w) => w.length > 0);
    if (words.length === 0) continue;
    const letters = words.length >= 2
      ? [Array.from(words[0])[0], Array.from(words[1])[0]]
      : Array.from(words[0]).slice(0, 2);
    return letters.join('').toUpperCase();
  }
  return '';
}

/**
 * Normalise a /tenant/branding response defensively: an older API or a
 * proxy error page must degrade to "no logo, initials from the name"
 * instead of crashing the top bar.
 */
export function normalizeBranding(raw: unknown): TenantBranding {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = str(o.name) ?? '';
  const businessName = str(o.businessName);
  const logo = str(o.logoUrl);
  const initials = (str(o.initials) ?? '').trim();
  return {
    name,
    businessName,
    // The server already maps an old inline data: logo to null. Do the same
    // here so a data: URL is never handed to the image loader.
    logoUrl: logo && !/^data:/i.test(logo.trim()) ? logo : null,
    initials: initials || initialsFrom(businessName, name),
  };
}

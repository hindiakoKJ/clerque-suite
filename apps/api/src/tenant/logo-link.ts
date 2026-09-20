/**
 * What may be stored in Tenant.receiptLogoUrl, and what may be handed to a
 * screen as a logo.
 *
 * Only a short link. The column used to take inline `data:` images up to
 * 256 KB, and that value was copied into the login token, which is also the
 * browser cookie. A cookie over about 4 KB is silently dropped, so one logo
 * could send every user of a business back to the login page forever.
 *
 * The three link shapes are exactly what StorageService.getPublicUrl hands
 * out (S3/R2 public URL, the DB-driver photo route, the local-disk static
 * route), plus any https:// link an owner pastes. Nothing else: no data:,
 * no http:, no javascript:.
 */
export const LOGO_LINK_MAX_LENGTH = 512;

export const LOGO_LINK_PATTERN =
  /^(?:https:\/\/[^\s"'<>\\]+|\/(?:api\/v1|uploads\/public)\/(?!.*\.\.)[A-Za-z0-9._~/-]+)$/;

export function isAllowedLogoLink(value: unknown): boolean {
  return typeof value === 'string'
    && value.length <= LOGO_LINK_MAX_LENGTH
    && LOGO_LINK_PATTERN.test(value);
}

/**
 * How a logo value is written into the audit trail. A short link is logged
 * as is; anything else (an old inline image can be hundreds of KB) is
 * described, never copied, so one save cannot bloat AuditLog.
 */
export function describeLogoForAudit(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (isAllowedLogoLink(value)) return value;
  if (/^data:/i.test(value)) return `inline image (${value.length} characters, not shown)`;
  return `link not shown (${value.length} characters)`;
}

/**
 * Up to two letters for the placeholder circle when there is no logo. From
 * the business name when it has any letters or digits, else the tenant name.
 * Two words give their first letters ("Kape Tayo" -> "KT"); one word gives
 * its first two ("Magnet" -> "MA").
 */
export function brandingInitials(businessName: string | null | undefined, name: string | null | undefined): string {
  for (const source of [businessName, name]) {
    const words = (source ?? '')
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean);
    if (words.length === 0) continue;
    const letters = words.length >= 2
      ? [Array.from(words[0])[0], Array.from(words[1])[0]]
      : Array.from(words[0]).slice(0, 2);
    return letters.join('').toUpperCase();
  }
  return '';
}

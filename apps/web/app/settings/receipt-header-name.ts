/**
 * The name the Settings receipt preview shows, by the SAME rule the receipt
 * prints with (apps/api/src/auth/receipt-business-name.ts builds the login
 * token's businessName this way, and the receipt reads that token):
 *
 *   1. "Business name (as on COR)" from BIR & Tax, when filled in;
 *   2. else the business name on the Business Profile.
 *
 * The preview used to show the profile name only, so it promised a header the
 * printed receipt did not have. Whitespace-only counts as blank. Upper-cased
 * because the receipt prints it that way.
 */
export function receiptHeaderName(
  profile: { businessName?: string | null; name?: string | null } | null | undefined,
): string {
  const registered = profile?.businessName?.trim();
  const name = registered || profile?.name?.trim() || '';
  return name.toUpperCase();
}

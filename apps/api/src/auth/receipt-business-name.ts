/**
 * The name at the top of a receipt, as carried in the login token.
 *
 * Tenant.businessName is the BIR field ("Business name as on COR") and is
 * blank until the owner opens Settings > BIR & Tax. Tenant.name is what the
 * business was created with and is never blank. The token used to carry the
 * BIR field alone, so a shop that had not filled it in printed the receipt's
 * last-resort text ("DEMO STORE") on every customer slip.
 *
 * Whitespace-only counts as blank. Returns null only when there is no tenant
 * at all (a super admin's token).
 */
export function receiptBusinessName(
  tenant: { businessName?: string | null; name?: string | null } | null | undefined,
): string | null {
  const registered = tenant?.businessName?.trim();
  if (registered) return registered;
  const name = tenant?.name?.trim();
  return name || null;
}

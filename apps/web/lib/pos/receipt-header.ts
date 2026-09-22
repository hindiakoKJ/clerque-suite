/**
 * The name printed at the top of a receipt.
 *
 * It used to be `businessName ?? branchName ?? 'DEMO STORE'`, where
 * businessName is only the "Business name (as on COR)" box in Settings >
 * BIR & Tax. An owner who never filled that box handed customers a slip headed
 * DEMO STORE, while the Settings preview showed her real shop name, so nobody
 * noticed until a customer did.
 *
 * Order, first one that has text wins:
 *   1. the COR business name (what BIR wants on an official document)
 *   2. the name from GET /tenant/branding (COR name, else the name the account
 *      was created with): the same one the Settings preview shows
 *   3. the name this device remembered at the last sign-in, so a till that
 *      came up offline still prints the shop's name
 *   4. the branch name
 *
 * There is no placeholder. With nothing known the answer is '' and the caller
 * leaves the line out: a slip with no heading is a setup gap, a slip headed
 * with a made-up name is a lie to the customer.
 */
export interface ReceiptNameSources {
  corBusinessName?: string | null;
  brandingName?:    string | null;
  rememberedName?:  string | null;
  branchName?:      string | null;
}

export function receiptBusinessName(src: ReceiptNameSources): string {
  for (const candidate of [src.corBusinessName, src.brandingName, src.rememberedName, src.branchName]) {
    const name = typeof candidate === 'string' ? candidate.trim() : '';
    if (name) return name;
  }
  return '';
}

/**
 * The branch line under the heading: shown only when it adds something, i.e.
 * there is a heading and the branch name is not that same text.
 */
export function receiptBranchLine(heading: string, branchName?: string | null): string {
  const branch = typeof branchName === 'string' ? branchName.trim() : '';
  if (!branch || !heading) return '';
  return branch.toLowerCase() === heading.trim().toLowerCase() ? '' : branch;
}

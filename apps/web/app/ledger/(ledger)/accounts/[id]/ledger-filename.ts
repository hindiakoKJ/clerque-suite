/**
 * The name of the account-ledger .xlsx the owner downloads and sends to her
 * bookkeeper. It used to carry the database id ("ledger-cmti5lpkw00uw…xlsx"),
 * which tells nobody which account is inside.
 */
export function ledgerExportFilename(
  account: { code?: string | null; name?: string | null } | null | undefined,
  from: string,
  to: string,
): string {
  const slug = `${account?.code ?? ''} ${account?.name ?? ''}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // accents off: "Café" -> "Cafe"
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')       // anything a filesystem might dislike
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `ledger-${slug || 'account'}-${from}_to_${to}.xlsx`;
}

/**
 * The copies of a buy list Clerque files against the request itself.
 *
 * Kept apart from the PDF drawing so the documents module can guard these
 * labels without loading the PDF library. The labels are reserved: the PDF
 * route hands the as-sent copy to the kitchen without the purchase-cost
 * check, which is safe only because nobody but Clerque can file a document
 * under that label.
 */
export type BuyListCopy = 'sent' | 'booked';

export const BUY_LIST_PDF_LABEL: Record<BuyListCopy, string> = {
  sent:   'Buy list — as sent',
  booked: 'Buy list — as booked',
};

/** True for a label only Clerque may file a document under. */
export function isReservedDocumentLabel(label: string | null | undefined): boolean {
  if (label == null) return false;
  const typed = label.trim().toLowerCase();
  return Object.values(BUY_LIST_PDF_LABEL).some((l) => l.toLowerCase() === typed);
}

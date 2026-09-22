/**
 * What to tell someone the edge guard (middleware.ts) sent back to the app
 * picker, by the ?reason= it puts on the address.
 *
 * There are three reasons and the picker used to know two. A cook who tapped
 * something that led into Counter or Ledger, or an accountant who followed a
 * link into Procure, landed here with no word of why. The old messages also
 * named apps the reader may not have ("Use Ledger or Sync"): these say only
 * what happened and what to do next.
 *
 * Pure, so restricted-reason.spec.mjs can pin it against the middleware.
 */
const APP_NAME = {
  'pos-restricted':     'Counter',
  'procure-restricted': 'Procure',
  'ledger-restricted':  'Ledger',
} as const;

export type RestrictedReason = keyof typeof APP_NAME;
export const RESTRICTED_REASONS = Object.keys(APP_NAME) as RestrictedReason[];

/**
 * The message for a ?reason= value, or null when there is nothing to say.
 *
 * `onlyAppName`: someone with a single app never sees the picker (it forwards
 * them straight to that app), so "pick one below" would be wrong for them.
 */
export function restrictedMessage(
  reason: string | null | undefined,
  onlyAppName?: string | null,
): string | null {
  if (!reason || !Object.prototype.hasOwnProperty.call(APP_NAME, reason)) return null;
  const app = APP_NAME[reason as RestrictedReason];
  const next = onlyAppName
    ? `We brought you back to ${onlyAppName}.`
    : 'Pick one of your apps below.';
  return `That page is part of ${app}, which your sign-in cannot open. ${next}`;
}

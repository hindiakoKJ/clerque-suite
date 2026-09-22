/**
 * /welcome/ledger — public welcome page, reached from the sign-in screen.
 *
 * The page itself lives in ../SuiteWelcome.tsx, shared with /welcome/pos:
 * Clerque is sold as one suite with a bookkeeper included, so there is one
 * message, no price list, and "Talk to us" as the call to action.
 */
import { SuiteWelcome } from '../SuiteWelcome';

export const metadata = {
  title: 'Clerque — books that keep themselves, with a bookkeeper included',
  description:
    'Clerque is the full suite for a small business (POS, Procure and Ledger) with a bookkeeper included. For owners who do not have a bookkeeper yet.',
};

export default function LedgerLandingPage() {
  return <SuiteWelcome focus="books" />;
}

/**
 * /welcome/pos — public welcome page, reached from the payment page and from
 * anyone who types the address.
 *
 * The page itself lives in ../SuiteWelcome.tsx, shared with /welcome/ledger:
 * Clerque is sold as one suite with a bookkeeper included, so there is one
 * message, no price list, and "Talk to us" as the call to action.
 */
import { SuiteWelcome } from '../SuiteWelcome';

export const metadata = {
  title: 'Clerque — POS, stock and books for small businesses, with a bookkeeper included',
  description:
    'One system for a small business: a POS for the counter, Procure for stock and buying, and Ledger for the books, with a bookkeeper included. For owners who do not have a bookkeeper yet.',
};

export default function CounterWelcomePage() {
  return <SuiteWelcome focus="counter" />;
}

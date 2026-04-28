/**
 * Demo App Layout — wraps all /demo/(app)/* pages in the DemoShell.
 *
 * The /(app)/ route group lets us share the DemoShell across the three
 * app sections (POS / Ledger / Sync) while keeping the /demo welcome
 * page on its own bare layout.
 */

import { DemoShell } from '../_components/DemoShell';

export default function DemoAppLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell>{children}</DemoShell>;
}

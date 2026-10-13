import { House, Tag, ScanSearch, HandCoins, Printer, ListChecks, ClipboardCheck, Undo2 } from 'lucide-react';

/**
 * The Inventory screens and who may open each, in one list the layout (nav and
 * gate) and the home tiles both read, so a tile is never offered to someone
 * the page then turns away. The role lists match the tag API's own
 * (apps/api/src/tags/tags.controller.ts); SUPER_ADMIN passes every API role
 * check, so it is let in wherever the owner is.
 */

/** Everyone who tags parts: in a small shop the seller is also the receiver. */
export const TAG_ROLES = [
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM',
  'CASHIER', 'WAREHOUSE_STAFF', 'SALES_LEAD',
];
/** Printing labels and the full list (with cost, for the owner). */
export const LABEL_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM'];
/** Only the owner puts a part in stock, by setting its cost. */
export const OWNER_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN'];

export interface InventoryPage {
  href: string;
  title: string;
  desc: string;
  Icon: React.ElementType;
  roles: string[];
}

export const INVENTORY_PAGES: InventoryPage[] = [
  {
    href: '/inventory',
    title: 'Home',
    desc: 'Everything in Inventory, one tap away.',
    Icon: House,
    roles: TAG_ROLES,
  },
  {
    href: '/inventory/tag',
    title: 'Tag a part',
    desc: 'Scan a new label, pick what the part is, take its photos.',
    Icon: Tag,
    roles: TAG_ROLES,
  },
  {
    href: '/inventory/find',
    title: 'Find a tag',
    desc: 'Type or scan a number to see the part, its photos and its price.',
    Icon: ScanSearch,
    roles: TAG_ROLES,
  },
  {
    href: '/inventory/return',
    title: 'Return a part',
    desc: 'A customer brought a part back? Scan its label first.',
    Icon: Undo2,
    roles: TAG_ROLES,
  },
  {
    href: '/inventory/roll-call',
    title: 'Roll call',
    desc: 'Scan every tagged part on the shelves, then send the count.',
    Icon: ClipboardCheck,
    roles: TAG_ROLES,
  },
  {
    href: '/inventory/cost',
    title: 'Waiting for cost',
    desc: 'Check the photos and set each new part\'s cost. Only then can it be sold.',
    Icon: HandCoins,
    roles: OWNER_ROLES,
  },
  {
    href: '/inventory/labels',
    title: 'Print labels',
    desc: 'Get the next label numbers and print them on 40 x 30 mm labels.',
    Icon: Printer,
    roles: LABEL_ROLES,
  },
  {
    href: '/inventory/tags',
    title: 'All tags',
    desc: 'Every tagged part: waiting for cost, in stock, sold or written off.',
    Icon: ListChecks,
    roles: LABEL_ROLES,
  },
];

/** Who may open this path: the page it is, or under. Home is matched exactly. */
export function rolesFor(pathname: string): string[] {
  const page = INVENTORY_PAGES
    .filter((p) => p.href !== '/inventory')
    .find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
  return page ? page.roles : TAG_ROLES;
}

/** The pages this role can open, in nav order. */
export function pagesFor(role: string | null | undefined): InventoryPage[] {
  if (!role) return [];
  return INVENTORY_PAGES.filter((p) => p.roles.includes(role));
}

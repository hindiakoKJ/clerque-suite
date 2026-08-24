import { CustomerDisplayService, type CartSnapshot } from './customer-display.service';

/**
 * The customer display must be universal within the shop.
 *
 * The failure this pins: the display tablet was signed in as the OWNER while
 * the cashier rang sales from her own account. Reads were keyed to the
 * caller's account, so the screen polled the owner's (empty) feed forever and
 * never showed a single product. A wall-mounted screen must mirror whichever
 * till is ringing — the account that happens to be signed in on it is
 * irrelevant.
 */
describe('CustomerDisplayService — universal tenant feed', () => {
  const TENANT = 't-carolina';
  const OTHER_TENANT = 't-someone-else';

  const snap = (total: number): CartSnapshot => ({
    type: 'CART_UPDATE',
    lines: [{ productName: 'Latte', quantity: 1, unitPrice: total, lineTotal: total }],
    subtotal: total, discount: 0, vatAmount: 0, total,
  });

  let svc: CustomerDisplayService;
  beforeEach(() => { svc = new CustomerDisplayService(); });

  it('returns the cashier’s sale to a display holding a DIFFERENT account', async () => {
    // Cashier rings a sale under her id; nobody publishes under the owner's.
    svc.publish(TENANT, 'cashier-anna', snap(139));

    // The universal read finds it without knowing who rang it.
    const seen = svc.readLatestForTenant(TENANT);
    expect(seen?.total).toBe(139);
    expect(seen?.cashierId).toBe('cashier-anna');

    // The old behaviour, for contrast: keyed to the owner, sees nothing.
    expect(svc.read(TENANT, 'owner-kj')).toBeNull();
  });

  it('follows whichever till published most recently', async () => {
    svc.publish(TENANT, 'cashier-anna', snap(100));
    await new Promise((r) => setTimeout(r, 5)); // ensure storedAt advances
    svc.publish(TENANT, 'cashier-ben', snap(250));

    expect(svc.readLatestForTenant(TENANT)?.total).toBe(250);

    await new Promise((r) => setTimeout(r, 5));
    svc.publish(TENANT, 'cashier-anna', snap(310));
    expect(svc.readLatestForTenant(TENANT)?.total).toBe(310);
  });

  it('never leaks another business’s cart', async () => {
    svc.publish(OTHER_TENANT, 'their-cashier', snap(999));

    expect(svc.readLatestForTenant(TENANT)).toBeNull();
  });

  it('still supports narrowing to one till for multi-till shops', async () => {
    svc.publish(TENANT, 'till-1', snap(100));
    svc.publish(TENANT, 'till-2', snap(200));

    expect(svc.read(TENANT, 'till-1')?.total).toBe(100);
    expect(svc.read(TENANT, 'till-2')?.total).toBe(200);
  });

  it('expires stale snapshots so yesterday’s order never greets a customer', async () => {
    svc.publish(TENANT, 'cashier-anna', snap(100));
    const entry = (svc as unknown as { store: Map<string, { storedAt: number }> }).store;
    for (const v of entry.values()) v.storedAt -= 120_000;   // age past the 60s TTL

    expect(svc.readLatestForTenant(TENANT)).toBeNull();
  });
});

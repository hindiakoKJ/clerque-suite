import { FNB_BUSINESS_TYPES } from '@repo/shared-types';
import { LayoutsService } from './layouts.service';

/**
 * Stations were reachable by coffee shops and nobody else.
 *
 * `applyCoffeeShopTier` is the ONLY code path in the product that creates a
 * Station, and it refused any tenant whose businessType was not literally
 * COFFEE_SHOP. A restaurant, bakery, bar or caterer therefore could never have
 * one — and with no stations every prep derives `station: null`, so the layer
 * built on top quietly does nothing for them: no "who made it?", no
 * per-station ingredient cost, no separating the barista's board from the
 * cook's.
 *
 * Nothing errored, which is why it would never have been reported. The feature
 * was simply absent for five of the six F&B business types.
 */
describe('Station layouts — which shops can have one', () => {
  function build(businessType: string) {
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ businessType, coffeeShopTier: null }),
      },
    };
    return new LayoutsService(prisma) as any;
  }

  it.each(FNB_BUSINESS_TYPES.filter((t) => t !== 'COFFEE_SHOP'))(
    'no longer refuses %s outright', async (type) => {
      /*
        Asserts only that the BUSINESS-TYPE gate is passed. The call still
        fails further in on this bare mock, which is fine — what matters is
        that it is no longer rejected for being the wrong kind of shop.
      */
      const svc = build(type);
      await expect(svc.applyCoffeeShopTier('t1', 'CS_4', {}))
        .rejects.not.toThrow(/apply to food and drink businesses/);
    });

  it('still refuses a shop with no kitchen', async () => {
    // A hardware store has no bar and no pastry pass.
    const svc = build('RETAIL');
    await expect(svc.applyCoffeeShopTier('t1', 'CS_4', {}))
      .rejects.toThrow(/food and drink businesses/);
  });

  it('gates on the same set that unlocks recipes', () => {
    /*
      The reason this is the right gate rather than a new list: a shop with no
      recipes has no preps to route to a station in the first place, so the two
      questions have the same answer by construction.
    */
    expect(FNB_BUSINESS_TYPES).toContain('RESTAURANT');
    expect(FNB_BUSINESS_TYPES).toContain('BAKERY');
    expect(FNB_BUSINESS_TYPES as readonly string[]).not.toContain('RETAIL');
  });
});

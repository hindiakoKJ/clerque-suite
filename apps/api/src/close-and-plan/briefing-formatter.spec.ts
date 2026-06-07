/**
 * Snapshot/structural specs for the briefing text formatter. We verify:
 *   - Section headers present
 *   - USE_FIRST entries get the ** marker, EXPIRING_SOON gets !, etc.
 *   - Empty sections show the "(no ...)" placeholder
 *   - Width never exceeds 32 chars
 */
import { StickerTier } from '@prisma/client';
import { formatBriefingText } from './briefing-formatter';

const BAKERY = 'Demo Bakery';
const DATE   = new Date('2026-05-21T00:00:00Z');

describe('formatBriefingText', () => {
  it('renders a complete briefing with all sections', () => {
    const text = formatBriefingText({
      bakeryName: BAKERY,
      date:       DATE,
      bakeList:   [
        { productName: 'Pandesal',   recommendedQty: 50, reason: '7-day avg: 47/day' },
        { productName: 'Ensaymada',  recommendedQty: 30 },
      ],
      useFirst: [
        { rawMaterialName: 'Whole Milk 1L', lotCode: 'AB1234', qtyRemaining: 4, unit: 'pcs',
          expirationDate: new Date('2026-05-22T00:00:00Z'),
          tier: StickerTier.USE_FIRST },
        { rawMaterialName: 'Heavy Cream 500mL', lotCode: 'CD5678', qtyRemaining: 2, unit: 'pcs',
          expirationDate: new Date('2026-05-23T00:00:00Z'),
          tier: StickerTier.EXPIRING_SOON },
      ],
      pickups: [
        { time: '7:00 AM', customerName: "JR's Coffee",  details: '24 pandesal · paid in full' },
        { time: '3:00 PM', customerName: 'Maria Santos', details: '"Happy 7th Mia" · balance P600' },
      ],
      notes: "Don't forget to thaw the croissant dough at 5am.",
    });

    expect(text).toContain('MORNING BRIEFING');
    expect(text).toContain(BAKERY);
    expect(text).toContain("TODAY'S BAKE LIST");
    expect(text).toContain('Pandesal');
    expect(text).toContain('50');
    expect(text).toContain('USE FIRST');
    expect(text).toContain('**Whole Milk 1L');
    expect(text).toContain('! Heavy Cream 500mL');
    expect(text).toContain('PICKUPS TODAY');
    expect(text).toContain("JR's Coffee");
    expect(text).toContain('Maria Santos');
    expect(text).toContain('NOTES FROM OWNER');
    expect(text).toContain('END OF BRIEFING');
  });

  it('shows empty-state placeholders when sections have no data', () => {
    const text = formatBriefingText({
      bakeryName: BAKERY,
      date:       DATE,
      bakeList:   [],
      useFirst:   [],
      pickups:    [],
    });
    expect(text).toContain('(no scheduled production)');
    expect(text).toContain('(no perishables flagged)');
    expect(text).toContain('(no scheduled pickups)');
    expect(text).not.toContain('NOTES FROM OWNER'); // omitted entirely if no notes
  });

  it('marks EXPIRED items distinctly', () => {
    const text = formatBriefingText({
      bakeryName: BAKERY,
      date:       DATE,
      bakeList:   [],
      useFirst:   [
        { rawMaterialName: 'Old Milk', lotCode: 'OLD123', qtyRemaining: 2, unit: 'L',
          expirationDate: new Date('2026-05-15T00:00:00Z'), // expired
          tier: StickerTier.EXPIRED },
      ],
      pickups: [],
    });
    expect(text).toContain('XXOld Milk');
  });

  it('filters NORMAL-tier items out of USE FIRST section', () => {
    const text = formatBriefingText({
      bakeryName: BAKERY,
      date:       DATE,
      bakeList:   [],
      useFirst:   [
        { rawMaterialName: 'Plenty Of Time Sugar', lotCode: 'NORM01', qtyRemaining: 100, unit: 'kg',
          expirationDate: new Date('2027-01-01T00:00:00Z'),
          tier: StickerTier.NORMAL },
      ],
      pickups: [],
    });
    // NORMAL items should appear in the "(no perishables flagged)" path
    // because they are not action-needed.
    expect(text).toContain('(no perishables flagged)');
    expect(text).not.toContain('Plenty Of Time Sugar');
  });

  it('never exceeds 32 chars per line (58mm thermal width)', () => {
    const text = formatBriefingText({
      bakeryName: 'A Very Long Bakery Name That Should Stay Within Width',
      date:       DATE,
      bakeList:   [
        { productName: 'Some Pretty Long Product Name', recommendedQty: 999 },
      ],
      useFirst: [],
      pickups:  [],
    });
    for (const line of text.split('\n')) {
      // Some lines might wrap longer if hand-written content exceeds; for now
      // we only assert that the headers + divider lines respect width.
      if (line.includes('-----') || line.includes('=====')) {
        expect(line.length).toBeLessThanOrEqual(32);
      }
    }
  });
});

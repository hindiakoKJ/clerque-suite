import { appendNote, hasTag, plainNotes, readTag, withTag } from './procure-notes';

/**
 * PurchaseRequest.notes carries tags and a person's line. The receipt path's
 * replay lookup is a startsWith on its [RCPT:] tag, so that one must stay
 * first whatever else is added later.
 */
describe('Procure notes grammar', () => {
  it('keeps the receipt key first when more tags are added', () => {
    const n1 = withTag('[RCPT:abc] Puregold · OR 4471', 'ONTHEWAY', '2026-09-04');
    expect(n1).toBe('[RCPT:abc] [ONTHEWAY:2026-09-04] Puregold · OR 4471');
    expect(n1.startsWith('[RCPT:abc]')).toBe(true);
    expect(readTag(n1, 'ONTHEWAY')).toBe('2026-09-04');
    expect(readTag(n1, 'RCPT')).toBe('abc');
  });

  it('replaces a tag of the same name rather than stacking it', () => {
    const n = withTag(withTag(null, 'ONTHEWAY', '2026-09-01'), 'ONTHEWAY', '2026-09-04');
    expect(n).toBe('[ONTHEWAY:2026-09-04]');
    expect(hasTag(n, 'ONTHEWAY')).toBe(true);
    expect(hasTag(n, 'RCPT')).toBe(false);
  });

  it('appends a human line after the tags and keeps the tags readable', () => {
    const n = appendNote('[ONTHEWAY:2026-09-04] Shopee order 123', 'Chicken Wings: bought 3, 2 arrived, 1 refunded');
    expect(n).toBe('[ONTHEWAY:2026-09-04] Shopee order 123 · Chicken Wings: bought 3, 2 arrived, 1 refunded');
    expect(plainNotes(n)).toBe('Shopee order 123 · Chicken Wings: bought 3, 2 arrived, 1 refunded');
    expect(appendNote(null, '   ')).toBe('');
  });

  it('never lets a value break the grammar', () => {
    expect(withTag(null, 'BALANCEOF', 'REQ-1] [RCPT:x')).toBe('[BALANCEOF:REQ-1 RCPT:x]');
  });
});

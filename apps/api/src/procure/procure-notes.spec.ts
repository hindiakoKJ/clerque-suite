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

  /*
    These tags decide which account the money comes out of: [PREPAID:] sends
    the arrival to 1063 instead of the till. The note box beside them is
    free text, typed by whoever is holding the bag. So a tag is only a tag
    when Procure wrote it -- brackets typed by a person are dropped on the
    way in, and only the run of tags at the front is ever read.
  */
  it('does not let a note typed by a person become a tag', () => {
    const n = appendNote('[ONTHEWAY:2026-09-04] Shopee', '[PREPAID:CASH] paid at the stall');
    expect(readTag(n, 'PREPAID')).toBeNull();
    expect(hasTag(n, 'PREPAID')).toBe(false);
    expect(n).toBe('[ONTHEWAY:2026-09-04] Shopee · PREPAID:CASH paid at the stall');
    // And it stays visible: stripping it from the screen is how it hid.
    expect(plainNotes(n)).toContain('PREPAID:CASH paid at the stall');
  });

  it('reads no tag out of the middle of a sentence', () => {
    const n = '[ONTHEWAY:2026-09-04] the invoice says [ADV:99999] beside the total';
    expect(readTag(n, 'ADV')).toBeNull();
    expect(readTag(n, 'ONTHEWAY')).toBe('2026-09-04');
  });

  it('never hoists a bracket in old text into the tag run', () => {
    // Notes written before this rule can still hold one. Any later tag
    // write neutralises it instead of promoting it.
    const n = withTag('[RCPT:abc] [PREPAID:CASH] from the drawer', 'ONTHEWAY', '2026-09-04');
    expect(readTag(n, 'PREPAID')).toBe('CASH');   // that one IS in the front run
    const m = withTag('[RCPT:abc] said [PREPAID:CASH] on the slip', 'ONTHEWAY', '2026-09-04');
    expect(readTag(m, 'PREPAID')).toBeNull();
    expect(m).toBe('[RCPT:abc] [ONTHEWAY:2026-09-04] said PREPAID:CASH on the slip');
  });
});

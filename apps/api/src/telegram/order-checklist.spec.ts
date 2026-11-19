import {
  MAX_ITEMS, MAX_QTY, applyTap, buildKeyboard, orderItems, readCounts, readNeed, readTap,
} from './order-checklist';

/**
 * The staff supplies checklist keeps its counts in its own buttons, so these
 * prove the round trip: what is drawn is what is read back after a tap.
 */
describe('order checklist', () => {
  const id = (n: number) => `cm${String(n).padStart(23, '0')}`;   // a cuid-length id
  const items = [
    { id: id(1), name: 'Tissue roll', low: false },
    { id: id(2), name: 'Bleach', low: true },
    { id: id(3), name: 'Garbage bags', low: false },
  ];

  it('shows what is low first, then by name', () => {
    expect(orderItems(items).map((i) => i.name)).toEqual(['Bleach', 'Garbage bags', 'Tissue roll']);
  });

  it('the counts drawn into the buttons are the counts read back', () => {
    const counts = new Map([[id(2), 2], [id(3), 1]]);
    const kb = buildKeyboard(orderItems(items), counts);
    expect(readCounts(kb)).toEqual(new Map([[id(2), 2], [id(3), 1], [id(1), 0]]));
    expect(kb.inline_keyboard[0][0].text).toBe('✅ Bleach ×2');
    expect(kb.inline_keyboard[2][0].text).toBe('▫️ Tissue roll');
    expect(kb.inline_keyboard.at(-1)![0]).toEqual({ text: '📤 Send (2)', callback_data: 'os' });
  });

  it('an untouched low item says so', () => {
    expect(buildKeyboard(orderItems(items), new Map()).inline_keyboard[0][0].text).toBe('▫️ Bleach (low)');
  });

  it('a tap adds one, − takes one off, never below nothing or above the cap, and an unknown item is ignored', () => {
    const known = new Set(items.map((i) => i.id));
    let c = applyTap(new Map(), { kind: 'add', id: id(1) }, known);
    c = applyTap(c, { kind: 'add', id: id(1) }, known);
    expect(c.get(id(1))).toBe(2);
    c = applyTap(c, { kind: 'remove', id: id(1) }, known);
    c = applyTap(c, { kind: 'remove', id: id(1) }, known);
    c = applyTap(c, { kind: 'remove', id: id(1) }, known);
    expect(c.get(id(1))).toBe(0);
    expect(applyTap(new Map([[id(1), MAX_QTY]]), { kind: 'add', id: id(1) }, known).get(id(1))).toBe(MAX_QTY);
    expect(applyTap(new Map(), { kind: 'add', id: 'someoneelse' }, known).size).toBe(0);
  });

  it('reads its own buttons and nothing else', () => {
    expect(readTap('os')).toEqual({ kind: 'send' });
    expect(readTap('ox')).toEqual({ kind: 'cancel' });
    expect(readTap(`o+:${id(1)}`)).toEqual({ kind: 'add', id: id(1) });
    expect(readTap(`o-:${id(1)}:3`)).toEqual({ kind: 'remove', id: id(1) });
    expect(readTap('o+:../../x')).toBeNull();
    expect(readTap('anything')).toBeNull();
    expect(readTap(undefined)).toBeNull();
  });

  it('stays inside Telegram\'s limits: 64 bytes a button, 100 buttons a message', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: id(i), name: `Supply number ${i} with a very long name indeed, really`, low: i % 3 === 0 }));
    const shown = orderItems(many);
    expect(shown).toHaveLength(MAX_ITEMS);
    const kb = buildKeyboard(shown, new Map(shown.map((s) => [s.id, MAX_QTY])));
    const buttons = kb.inline_keyboard.flat();
    expect(buttons.length).toBeLessThanOrEqual(100);
    for (const b of buttons) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });

  it('reads /need the ways people write it', () => {
    expect(readNeed('/need Tissue roll, 2')).toEqual({ name: 'Tissue roll', qty: 2 });
    expect(readNeed('/need tissue roll 3')).toEqual({ name: 'tissue roll', qty: 3 });
    expect(readNeed('/need Bleach x2')).toEqual({ name: 'Bleach', qty: 2 });
    expect(readNeed('/need Bleach')).toEqual({ name: 'Bleach', qty: 1 });
    expect(readNeed('/need@ClerqueBot Sponge, 4')).toEqual({ name: 'Sponge', qty: 4 });
    expect(readNeed('/need')).toBeNull();
    expect(readNeed('/need x')).toBeNull();
    expect(readNeed('/need Bleach, 500')).toBeNull();
  });
});

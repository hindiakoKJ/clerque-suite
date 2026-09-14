import {
  rotationFromBoard, rotationAction, rotationInstruction, rotationAlertTitle, rotationChip, rotationNeedsAction, rotationShareText,
  PrepBoardRow,
} from '@repo/shared-types';

/**
 * The sauce rotation read off the prep board: ready to use on the line (L1),
 * a parked batch behind it (L2), and what to do now. Carolina's real shape is
 * the fixture: Teriyaki Sauce (ready) is moved across 2,000 ml at a time from
 * Teriyaki Sauce (frozen).
 *
 * The rule only ever asks for what the board can record: whole moves and
 * whole batches.
 */
describe('sauce rotation', () => {
  const frozen = (over: Partial<PrepBoardRow> = {}): PrepBoardRow => ({
    id: 'rm-teri-frozen', name: 'Teriyaki Sauce (frozen)', unit: 'ml', onHand: 4000, parLevel: null, level: 2, kind: 'MAKE',
    serves: [], station: { id: 's1', name: 'Kitchen', kind: 'KITCHEN' }, batchesWithPrep: 5, rootLimitedBy: 'Soy sauce',
    components: [{ rawMaterialId: 'rm-soy', name: 'Soy sauce', unit: 'ml', quantity: 600, onHand: 5000, isPrep: false }],
    ...over,
  });
  const ready = (over: Partial<PrepBoardRow> = {}): PrepBoardRow => ({
    id: 'rm-teri-ready', name: 'Teriyaki Sauce (ready)', unit: 'ml', onHand: 3910, parLevel: 400, level: 1, kind: 'MOVE',
    serves: [{ productId: 'p-wings', productName: 'Teriyaki Wings', servingsLeft: 130 }, { productId: 'p-rice', productName: 'Teriyaki Rice', servingsLeft: 90 }],
    station: { id: 's1', name: 'Kitchen', kind: 'KITCHEN' }, batchesWithPrep: 2, rootLimitedBy: 'Soy sauce',
    components: [{ rawMaterialId: 'rm-teri-frozen', name: 'Teriyaki Sauce (frozen)', unit: 'ml', quantity: 2000, onHand: 4000, isPrep: true }],
    ...over,
  });
  const one = (rows: PrepBoardRow[]) => {
    const out = rotationFromBoard(rows);
    expect(out).toHaveLength(1);
    return out[0];
  };

  it('only the ready-to-use prep is a row, paired with the parked stage behind it', () => {
    const r = one([frozen(), ready()]);
    expect(r).toMatchObject({
      prepId: 'rm-teri-ready', state: 'OK', out: false, perBatch: 2000, canDoNow: true, blockedBy: null,
      ready: { onHand: 3910, par: 400 },
      backup: { id: 'rm-teri-frozen', name: 'Teriyaki Sauce (frozen)', onHand: 4000, par: null, level: 2 },
    });
    expect(r.serves.map((s) => s.productName)).toEqual(['Teriyaki Rice', 'Teriyaki Wings']);   // tightest first
    expect(rotationNeedsAction(r)).toBe(false);
    expect(rotationAction(r)).toBeNull();
  });

  it('at or below par with a whole batch parked: move one across', () => {
    const r = one([frozen(), ready({ onHand: 400 })]);
    expect(r.state).toBe('TOP_UP');
    expect(rotationChip(r)).toBe('Move one across');
    expect(rotationAction(r)).toBe('Teriyaki Sauce (ready) is down to 400 ml. Move one batch across from Teriyaki Sauce (frozen).');
    expect(rotationAlertTitle(r)).toBe('Teriyaki Sauce (ready): move one across');
  });

  it('less than a whole batch parked is not a move the board can record: cook the backup', () => {
    // 1,650 ml against a 2,000 ml move: the Move button is disabled, and the server refuses a part move.
    const r = one([frozen({ onHand: 1650 }), ready({ onHand: 300 })]);
    expect([r.state, r.canDoNow]).toEqual(['COOK_NOW', false]);
    expect(rotationChip(r)).toBe('Cook now');
    expect(rotationInstruction(r)).toBe('Teriyaki Sauce (frozen) is short of a full batch. Cook a batch of it now.');
    expect(rotationAlertTitle(r)).toBe('Teriyaki Sauce (ready): cook a batch now');
  });

  it('nothing parked: cook now, and louder when the line is out', () => {
    const r = one([frozen({ onHand: 0 }), ready({ onHand: 0 })]);
    expect([r.state, r.out]).toEqual(['COOK_NOW', true]);
    expect(rotationChip(r)).toBe('Out');
    expect(rotationAction(r)).toBe('Teriyaki Sauce (ready) is out. Teriyaki Sauce (frozen) is empty. Cook a batch of it now.');
    expect(rotationAlertTitle(r, ' (Main)')).toBe('Teriyaki Sauce (ready) (Main) is out: cook a batch now');
  });

  it('when the raw material has run out, it says to buy it rather than to cook', () => {
    // Nothing can be made even after making the stages underneath (the board's batchesWithPrep = 0).
    const r = one([frozen({ onHand: 0, batchesWithPrep: 0 }), ready({ onHand: 0, batchesWithPrep: 0, rootLimitedBy: 'Soy sauce' })]);
    expect([r.state, r.blockedBy]).toEqual(['COOK_NOW', 'Soy sauce']);
    expect(rotationChip(r)).toBe('Out');
    expect(rotationInstruction(r)).toBe('Out of Soy sauce. Buy it before the next batch.');
    expect(rotationAlertTitle(r)).toBe('Teriyaki Sauce (ready) is out: buy Soy sauce');
  });

  it('a prep made straight from raw ingredients says make a batch, or buy what is short', () => {
    const breve = (milk: number): PrepBoardRow => ({
      id: 'rm-breve', name: 'Breve Milk', unit: 'ml', onHand: 380, parLevel: 400, level: 1, kind: 'MAKE', serves: [], station: null,
      components: [{ rawMaterialId: 'rm-milk', name: 'Fresh Milk', unit: 'ml', quantity: 1000, onHand: milk, isPrep: false }],
    });
    const can = one([breve(9000)]);
    expect([can.state, can.backup]).toEqual(['TOP_UP', null]);
    expect(rotationAction(can)).toBe('Breve Milk is down to 380 ml. Make a batch now.');
    const cannot = one([breve(0)]);
    expect([cannot.state, cannot.blockedBy, rotationChip(cannot)]).toEqual(['COOK_NOW', 'Fresh Milk', 'Buy first']);
    expect(rotationInstruction(cannot)).toBe('Out of Fresh Milk. Buy it before the next batch.');
  });

  it('a cooked prep made from two preps talks about the one that runs short first', () => {
    const breading = frozen({ id: 'rm-breading', name: 'Breading', unit: 'portion', onHand: 500 });
    const marinade = frozen({ id: 'rm-marinade', name: 'Marinade', unit: 'ml', onHand: 10, parLevel: 500 });
    const wings: PrepBoardRow = {
      ...ready({ id: 'rm-wings', name: 'Marinated Chicken Wings', unit: 'pc', onHand: 10, parLevel: 20, kind: 'MAKE' }),
      components: [
        { rawMaterialId: 'rm-breading', name: 'Breading', unit: 'portion', quantity: 86, onHand: 500, isPrep: true },
        { rawMaterialId: 'rm-marinade', name: 'Marinade', unit: 'ml', quantity: 200, onHand: 10, isPrep: true },
        { rawMaterialId: 'rm-chicken', name: 'Chicken Wings', unit: 'pc', quantity: 86, onHand: 500, isPrep: false },
      ],
    };
    const r = one([breading, marinade, wings]);
    expect([r.state, r.backup?.name]).toEqual(['COOK_NOW', 'Marinade']);
    expect(rotationInstruction(r)).toBe('Marinade is short of a full batch. Make Marinade first, then a batch.');
  });

  it('the line is fine but a parked stage is at or below its own par: cook the next batch today', () => {
    const r = one([frozen({ onHand: 1000, parLevel: 2000 }), ready()]);
    expect(r.state).toBe('REFILL_BACKUP');
    expect(r.refill?.name).toBe('Teriyaki Sauce (frozen)');
    expect(rotationInstruction(r)).toBe('Teriyaki Sauce (frozen) is at or below its par. Cook the next batch today.');
    expect(rotationAlertTitle(r)).toBe('Teriyaki Sauce (frozen): cook the next batch today');
  });

  it('a backup at zero is not news on its own: without its own par it is just the rotation', () => {
    expect(one([frozen({ onHand: 0 }), ready()]).state).toBe('OK');
  });

  it('a stage that is itself ready to use has its own row and alert, so it is not called a low backup', () => {
    const base: PrepBoardRow = { ...frozen({ id: 'rm-base', name: 'Tomato Base', level: 1, parLevel: 1000, onHand: 800 }),
      serves: [{ productId: 'p-soup', productName: 'Tomato Soup', servingsLeft: 3 }] };
    const pasta: PrepBoardRow = {
      ...ready({ id: 'rm-pasta', name: 'Pasta Sauce', kind: 'MAKE', onHand: 2000, parLevel: 500 }),
      components: [{ rawMaterialId: 'rm-base', name: 'Tomato Base', unit: 'ml', quantity: 500, onHand: 800, isPrep: true }],
    };
    const rows = rotationFromBoard([base, pasta]);
    expect(rows.map((r) => [r.name, r.state])).toEqual([['Tomato Base', 'TOP_UP'], ['Pasta Sauce', 'OK']]);
    expect(rows[1].backup?.level).toBe(1);
  });

  it('no par on the ready-to-use prep: shown, never acted on, however empty', () => {
    const r = one([frozen({ onHand: 0 }), ready({ onHand: 0, parLevel: null })]);
    expect([r.state, r.out, rotationNeedsAction(r), rotationAction(r)]).toEqual(['NO_PAR', true, false, null]);
    expect(rotationChip(r)).toBe('No par set');
  });

  it('what to do carries no live line quantity, so a sale does not make an old alert new', () => {
    const before = one([frozen(), ready({ onHand: 390 })]);
    const after  = one([frozen(), ready({ onHand: 210 })]);
    expect(rotationInstruction(before)).toBe(rotationInstruction(after));
    expect(rotationAlertTitle(before)).toBe(rotationAlertTitle(after));
    expect(rotationAction(before)).not.toBe(rotationAction(after));   // the screen may say the number
  });

  it('a three-stage chain pairs each ready prep with the stage directly behind it', () => {
    const base = frozen({ id: 'rm-base', name: 'Tomato Base', level: 2, onHand: 5000 });
    const mother: PrepBoardRow = {
      ...frozen({ id: 'rm-mother', name: 'Mother Sauce', level: 2, onHand: 0 }),
      components: [{ rawMaterialId: 'rm-base', name: 'Tomato Base', unit: 'ml', quantity: 1000, onHand: 5000, isPrep: true }],
    };
    const finishing: PrepBoardRow = {
      ...ready({ id: 'rm-finish', name: 'Finishing Sauce', kind: 'MAKE', onHand: 100, parLevel: 500 }),
      components: [{ rawMaterialId: 'rm-mother', name: 'Mother Sauce', unit: 'ml', quantity: 800, onHand: 0, isPrep: true }],
    };
    const r = one([base, mother, finishing]);
    expect(r.backup?.id).toBe('rm-mother');
    expect(r.state).toBe('COOK_NOW');
    expect(rotationInstruction(r)).toBe('Mother Sauce is empty. Make Mother Sauce first, then a batch.');
  });

  it('an empty line that needs doing sorts first, then what needs doing, then how far into the par', () => {
    const frozenFor = (id: string) => ({ rawMaterialId: 'rm-teri-frozen', name: 'Teriyaki Sauce (frozen)', unit: 'ml', quantity: 2000, onHand: 4000, isPrep: true, id });
    const rows = rotationFromBoard([
      frozen(),
      ready({ id: 'a', name: 'Adobo (ready)', onHand: 399, components: [frozenFor('a')] }),
      ready({ id: 'z', name: 'Zesty (ready)', onHand: 5, components: [frozenFor('z')] }),
      ready({ id: 'e', name: 'Empty (ready)', onHand: 0, components: [frozenFor('e')] }),
      { id: 'b', name: 'Breve Milk', unit: 'ml', onHand: 400, parLevel: 400, level: 1, kind: 'MAKE', serves: [], station: null,
        components: [{ rawMaterialId: 'rm-milk', name: 'Fresh Milk', unit: 'ml', quantity: 1000, onHand: 0, isPrep: false }] },
      ready({ id: 'g', name: 'Garlic Sauce', parLevel: null, components: [frozenFor('g')] }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Empty (ready)', 'Breve Milk', 'Zesty (ready)', 'Adobo (ready)', 'Garlic Sauce']);
  });

  it('the group-chat message says each sauce with a par once, what to do first', () => {
    const rows = rotationFromBoard([
      frozen(), ready(),
      ready({ id: 'rm-bbq', name: 'BBQ Sauce (ready)', onHand: 100 }),
      ready({ id: 'rm-garlic', name: 'Garlic Sauce', parLevel: null }),
    ]);
    const text = rotationShareText(rows, 'Sauce levels — Main');
    expect(text.split('\n')[0]).toBe('Sauce levels — Main');
    expect(text).toContain('• BBQ Sauce (ready) — Ready 100 ml · Teriyaki Sauce (frozen) 4,000 ml · enough for 90 Teriyaki Rice\n  BBQ Sauce (ready) is down to 100 ml. Move one batch across from Teriyaki Sauce (frozen).');
    expect(text).toContain('• Teriyaki Sauce (ready) — Ready 3,910 ml · Teriyaki Sauce (frozen) 4,000 ml · enough for 90 Teriyaki Rice · OK');
    expect(text).not.toContain('Garlic Sauce');
  });
});

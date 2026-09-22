import { chainsFromBoard, makerOf, type BoardComponent, type BoardRow, type PrepChain } from './prep-chain';

/**
 * Prep level chains: one sauce read from Level 1 (what plates are served from)
 * down to Level 3 (what the frozen batch is made from), and the ONE thing the
 * kitchen should do next. The fixture is Carolina's shape: a ready tub on the
 * line, a frozen tub behind it, a base the frozen tub is cooked from.
 */
describe('prep level chains', () => {
  const KITCHEN = { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' };
  const row = (over: Partial<BoardRow> & { id: string; name: string }): BoardRow => ({
    unit: 'g', onHand: 0, parLevel: null, level: null, kind: 'MAKE', station: KITCHEN, serves: [], components: [], ...over,
  });
  const raw = (id: string, name: string, quantity: number, onHand: number, unit = 'g'): BoardComponent =>
    ({ rawMaterialId: id, name, unit, quantity, onHand, isPrep: false });
  const prep = (id: string, name: string, quantity: number): BoardComponent =>
    // The component line's own onHand is ignored for a prep: its row is the fresher read.
    ({ rawMaterialId: id, name, unit: 'g', quantity, onHand: -1, isPrep: true });

  const ready = (onHand: number, over: Partial<BoardRow> = {}) => row({
    id: 'ready', name: 'Sauce ready', level: 1, depth: 1, kind: 'MOVE', onHand, parLevel: 600, batchYield: 2000,
    serves: [{ productName: 'Spaghetti', perServing: 150, servingsLeft: Math.floor(onHand / 150) }],
    components: [prep('frozen', 'Sauce frozen', 2000)], ...over,
  });
  const frozen = (onHand: number, over: Partial<BoardRow> = {}) => row({
    id: 'frozen', name: 'Sauce frozen', level: 2, depth: 2, onHand, parLevel: null, batchYield: 2000,
    components: [prep('base', 'Tomato base', 2000)], ...over,
  });
  const base = (onHand: number, sugar = 5000, over: Partial<BoardRow> = {}) => row({
    id: 'base', name: 'Tomato base', level: 2, depth: 3, onHand, parLevel: null, batchYield: 2500,
    components: [raw('tom', 'Tomato', 1000, 9000), raw('sugar', 'Sugar', 500, sugar)], ...over,
  });
  const only = (board: BoardRow[]): PrepChain => {
    const chains = chainsFromBoard(board);
    expect(chains).toHaveLength(1);
    return chains[0];
  };

  it('one stage made straight from raw: make a batch now', () => {
    const milk = row({
      id: 'breve', name: 'Breve Milk', unit: 'ml', level: 1, onHand: 300, parLevel: 400,
      components: [raw('milk', 'Fresh Milk', 1000, 9000, 'ml')],
    });
    const c = only([milk]);
    expect(c).toMatchObject({
      id: 'breve', severity: 'NOW', headline: 'Level 1: 300 ml left — make a batch now.', blockedBy: null,
      action: { rawMaterialId: 'breve', label: 'Made a batch', uses: 'Uses 1,000 ml Fresh Milk', enabled: true },
      alertTitle: 'Breve Milk: make a batch', alertBody: 'Make a batch of Breve Milk.', alertable: true,
    });
    expect(c.stages.map((s) => [s.level, s.dot, s.perRefill])).toEqual([[1, 'RED', null]]);
  });

  it('two servings left with a full batch parked behind: refill Level 1 from Level 2', () => {
    const c = only([ready(300), frozen(2000), base(5000)]);
    expect(c.severity).toBe('NOW');
    expect(c.headline).toBe('Level 1: 2 servings left — refill from Level 2 (Sauce frozen).');
    // `makes` is what the one batch records, said on the button before the second tap.
    expect(c.action).toEqual({ rawMaterialId: 'ready', label: 'Refilled Level 1', uses: 'Uses 2,000 g Sauce frozen', makes: '2,000 g', enabled: true });
    expect(c.alertTitle).toBe('Sauce ready: refill from Level 2');
    expect(c.alertBody).toBe('Refill Level 1 from Level 2 (Sauce frozen).');
    expect(c.stages.map((s) => s.line)).toEqual([
      'Level 1 · Sauce ready · 300 g · about 2 Spaghetti',
      'Level 2 · Sauce frozen · 2,000 g',
      'Level 3 · Tomato base · 5,000 g',
    ]);
    expect(c.stages.map((s) => s.perRefill)).toEqual([null, 2000, 2000]);
  });

  it('Level 1 needs refilling but Level 2 cannot cover one refill: make Level 2 from Level 3, said with Level 1 first', () => {
    const c = only([ready(300), frozen(1000), base(5000)]);
    expect(c.headline).toBe('Level 1: 2 servings left. Level 2 (Sauce frozen) is low — make it now from Level 3 (Tomato base).');
    expect(c.action).toMatchObject({ rawMaterialId: 'frozen', label: 'Made Level 2', uses: 'Uses 2,000 g Tomato base', enabled: true });
    expect(c.stages.map((s) => s.dot)).toEqual(['RED', 'AMBER', 'GREY']);
    expect(c.alertTitle).toBe('Sauce ready: make Level 2 now');
    expect(c.alertBody).toBe('Make Level 2 (Sauce frozen) from Level 3 (Tomato base).');
  });

  it('down to Level 3 and short of raw sugar: buy it, with the button disabled on the stage that needs doing', () => {
    const c = only([ready(300), frozen(0), base(0, 100)]);
    expect(c.headline).toBe('Out of Sugar. Buy it now.');
    expect(c.blockedBy).toBe('Sugar');
    expect(c.action).toEqual({
      rawMaterialId: 'ready', label: 'Refilled Level 1', uses: 'Uses 2,000 g Sauce frozen', makes: '2,000 g', enabled: false, disabledReason: 'Buy Sugar first',
    });
    expect(c.stages.map((s) => s.dot)).toEqual(['RED', 'AMBER', 'AMBER']);
    expect(c.alertTitle).toBe('Sauce ready: buy Sugar');
    expect(c.alertBody).toBe('Out of Sugar. Buy it before the next batch.');
  });

  it('a raw component short on Level 1 itself means buy it, not make Level 2', () => {
    const l1 = ready(300, { kind: 'MAKE', components: [prep('frozen', 'Sauce frozen', 1000), raw('cream', 'Cream', 200, 50)] });
    const c = only([l1, frozen(0), base(5000)]);
    expect(c.headline).toBe('Out of Cream. Buy it now.');
    expect(c.action).toMatchObject({ rawMaterialId: 'ready', enabled: false, disabledReason: 'Buy Cream first' });
  });

  it('Level 1 fine and Level 2 at its par: next, in amber, with no Level 1 prefix', () => {
    const c = only([ready(3000), frozen(2000, { parLevel: 2000 }), base(5000)]);
    expect(c.severity).toBe('NEXT');
    expect(c.headline).toBe('Level 2 (Sauce frozen) is low — make it now from Level 3 (Tomato base).');
    expect(c.stages.map((s) => s.dot)).toEqual(['GREEN', 'AMBER', 'GREY']);
    expect(c.action).toMatchObject({ rawMaterialId: 'frozen', enabled: true });
  });

  it('a MOVE into Level 2 is worded as moving a batch across', () => {
    const c = only([ready(3000), frozen(2000, { parLevel: 2000, kind: 'MOVE' }), base(5000)]);
    expect(c.headline).toBe('Level 2 (Sauce frozen) is low — move a batch across from Level 3 (Tomato base).');
    expect(c.action!.label).toBe('Moved to Level 2');
    expect(c.alertBody).toBe('Move a batch of Tomato base across to Level 2 (Sauce frozen).');
  });

  it('no par and no servings: grey dots and nothing to say', () => {
    const c = only([ready(0, { parLevel: null, serves: [] }), frozen(0)]);
    expect(c).toMatchObject({ severity: 'OK', headline: null, action: null, alertTitle: null, alertBody: null, alertable: false });
    expect(c.stages.map((s) => s.dot)).toEqual(['GREY', 'GREY']);
  });

  it('above par everywhere: fine, green where a par or servings are known', () => {
    const c = only([ready(3000), frozen(4000, { parLevel: 2000 }), base(5000)]);
    expect(c.headline).toBeNull();
    expect(c.stages.map((s) => s.dot)).toEqual(['GREEN', 'GREEN', 'GREY']);
  });

  it('follows the tighter of two prep components', () => {
    const l1 = row({
      id: 'l1', name: 'Pasta sauce', level: 1, onHand: 100, parLevel: 500, kind: 'MAKE',
      components: [prep('roux', 'Roux', 1000), prep('stock', 'Stock', 500)],
    });
    const roux = row({ id: 'roux', name: 'Roux', level: 2, onHand: 5000, components: [raw('flour', 'Flour', 100, 900)] });
    const stock = row({ id: 'stock', name: 'Stock', level: 2, onHand: 1000, components: [raw('bones', 'Bones', 100, 900)] });
    const c = only([l1, roux, stock]);
    expect(c.stages.map((s) => [s.name, s.perRefill])).toEqual([['Pasta sauce', null], ['Stock', 500]]);
  });

  it('stops at three stages, and says what the third needs when it is short of a fourth', () => {
    const deep = row({ id: 'deep', name: 'Deep stock', level: 2, onHand: 0, components: [raw('bones', 'Bones', 100, 900)] });
    const c = only([ready(300), frozen(0), base(0, 5000, { components: [prep('deep', 'Deep stock', 1000)] }), deep]);
    expect(c.stages.map((s) => s.id)).toEqual(['ready', 'frozen', 'base']);
    expect(c.headline).toBe('Tomato base needs Deep stock first.');
    expect(c.action).toMatchObject({ rawMaterialId: 'ready', enabled: false, disabledReason: 'Level 4 first' });
  });

  it('stops on a loop in old data instead of walking it forever', () => {
    const a = row({ id: 'a', name: 'A', level: 1, onHand: 10, parLevel: 100, components: [prep('b', 'B', 50)] });
    const b = row({ id: 'b', name: 'B', level: 2, onHand: 10, components: [prep('a', 'A', 50)] });
    const chains = chainsFromBoard([a, b]);
    expect(chains).toHaveLength(1);
    expect(chains[0].stages.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('puts no stock amount or servings count in the bell words, so a sale never makes a repeat look new', () => {
    const boards: BoardRow[][] = [
      [ready(1234, { parLevel: 1500 }), frozen(8760), base(5000)],
      [ready(1234, { parLevel: 1500 }), frozen(876), base(5432)],
      [ready(1234, { parLevel: 1500 }), frozen(876), base(987, 123)],
      [ready(3700), frozen(876, { parLevel: 2000 }), base(5432)],
    ];
    for (const board of boards) {
      const c = only(board);
      expect(c.alertTitle).not.toBeNull();
      for (const said of [c.alertTitle!, c.alertBody!]) {
        for (const n of ['1,234', '1234', '8,760', '876', '5,432', '987', '123', '3,700', ' 8 ', ' 24 ', ' 5 ']) {
          expect(said).not.toContain(n);
        }
      }
    }
  });

  it('is not worth a bell without a par anywhere in the chain, even when the screen says to act', () => {
    const c = only([ready(300, { parLevel: null }), frozen(2000), base(5000)]);
    expect(c.headline).toBe('Level 1: 2 servings left — refill from Level 2 (Sauce frozen).');
    expect(c.alertable).toBe(false);
  });

  it('only Level 1 items start a chain', () => {
    expect(chainsFromBoard([frozen(0), base(0)])).toEqual([]);
  });

  /*
    One prep used both ways: the bar pours Simple syrup into drinks (so it is
    the bar's), and the kitchen cooks its Glaze from it. The kitchen's Glaze
    chain has the bar's syrup as Level 2, and the Made route refuses a stage
    routed to another station -- so the kitchen screen must not offer it.
  */
  describe('a stage another station makes', () => {
    const BAR = { id: 's-bar', name: 'Bar', kind: 'BAR' };
    const glaze = (over: Partial<BoardRow> = {}) => row({
      id: 'glaze', name: 'Glaze', level: 1, depth: 1, onHand: 400, parLevel: 500,
      components: [prep('syrup', 'Simple syrup', 500), raw('butter', 'Butter', 100, 9000)], ...over,
    });
    const syrup = (onHand: number, over: Partial<BoardRow> = {}) => row({
      id: 'syrup', name: 'Simple syrup', unit: 'ml', level: 1, depth: 1, onHand, parLevel: 200, station: BAR,
      components: [raw('sugar', 'Sugar', 500, 9000), raw('water', 'Water', 500, 9000)], ...over,
    });
    const glazeOf = (chains: PrepChain[]) => chains.find((c) => c.id === 'glaze')!;

    it('on the kitchen screen: the button is off, says the bar makes it, and the headline names the bar', () => {
      const c = glazeOf(chainsFromBoard([glaze(), syrup(300)], KITCHEN));
      expect(c.severity).toBe('NOW');
      expect(c.headline).toBe('Level 1: 400 g left. Level 2 (Simple syrup) is low — ask Bar for a batch.');
      expect(c.action).toEqual({
        // No batch yield set on the syrup: the button then just says one batch.
        rawMaterialId: 'syrup', label: 'Made Level 2', uses: 'Uses 500 g Sugar · 500 g Water', makes: null, enabled: false, disabledReason: 'Bar makes this',
      });
    });

    it('read for the bell (no station), the words and button stay as they were, for the bar to act on', () => {
      const c = glazeOf(chainsFromBoard([glaze(), syrup(300)]));
      expect(c.headline).toBe('Level 1: 400 g left. Level 2 (Simple syrup) is low — make a batch now.');
      expect(c.action).toMatchObject({ rawMaterialId: 'syrup', enabled: true });
      expect(c.alertTitle).toBe('Glaze: make Level 2 now');
      expect(makerOf(c, [glaze(), syrup(300)])).toEqual(BAR);
    });

    it('when only Level 2 needs doing (next, not now), the headline names the bar too', () => {
      const c = glazeOf(chainsFromBoard([glaze({ onHand: 3000 }), syrup(300, { parLevel: 300 })], KITCHEN));
      expect(c.severity).toBe('NEXT');
      expect(c.headline).toBe('Level 2 (Simple syrup) is low — ask Bar for a batch.');
      expect(c.action).toMatchObject({ enabled: false, disabledReason: 'Bar makes this' });
    });

    it('on the screen of the station that makes it, the button works as usual', () => {
      // Glaze routed to no station is shown on the bar screen too.
      const c = glazeOf(chainsFromBoard([glaze({ station: null }), syrup(300)], BAR));
      expect(c.headline).toBe('Level 1: 400 g left. Level 2 (Simple syrup) is low — make a batch now.');
      expect(c.action).toMatchObject({ rawMaterialId: 'syrup', enabled: true });
      expect(c.action!.disabledReason).toBeUndefined();
    });

    it('a stage routed to no station stays recordable here, as the Made route allows', () => {
      const c = glazeOf(chainsFromBoard([glaze(), syrup(300, { station: null })], KITCHEN));
      expect(c.action).toMatchObject({ rawMaterialId: 'syrup', enabled: true });
      expect(makerOf(c, [glaze(), syrup(300, { station: null })])).toBeNull();
    });

    it('short of a raw ingredient with the button on the bar\'s stage: the headline still says buy it, the button says whose stage it is', () => {
      const board = [glaze({ onHand: 3000 }), syrup(300, { parLevel: 300, components: [raw('sugar', 'Sugar', 500, 100)] })];
      const c = glazeOf(chainsFromBoard(board, KITCHEN));
      expect(c.headline).toBe('Out of Sugar. Buy it now.');
      expect(c.action).toMatchObject({ rawMaterialId: 'syrup', enabled: false, disabledReason: 'Bar makes this' });
      expect(makerOf(c, board)).toEqual(BAR);
    });

    it('short of a raw ingredient with the button on the kitchen\'s own Level 1: it keeps its reason', () => {
      const board = [glaze(), syrup(300, { components: [raw('sugar', 'Sugar', 500, 100)] })];
      const c = glazeOf(chainsFromBoard(board, KITCHEN));
      expect(c.headline).toBe('Out of Sugar. Buy it now.');
      expect(c.action).toMatchObject({ rawMaterialId: 'glaze', enabled: false, disabledReason: 'Buy Sugar first' });
      expect(makerOf(c, board)).toEqual(KITCHEN);
    });

    it('the kitchen\'s own stages are untouched on the kitchen screen', () => {
      const c = only([ready(300), frozen(1000), base(5000)]);
      const here = chainsFromBoard([ready(300), frozen(1000), base(5000)], KITCHEN)[0];
      expect(here).toEqual(c);
    });

    it('a batch made ahead: the kitchen gets a small button for its own stage only, the bar for the bar\'s', () => {
      const board = [glaze({ onHand: 3000, station: null }), syrup(900)];
      const onKitchen = glazeOf(chainsFromBoard(board, KITCHEN));
      expect(onKitchen.severity).toBe('OK');
      expect(onKitchen.stages.map((s) => [s.id, s.made])).toEqual([
        ['glaze', { label: 'Made a batch', uses: 'Uses 500 g Simple syrup · 100 g Butter', makes: null }],
        // The bar's syrup: the Made route refuses it from the kitchen, so no button here.
        ['syrup', null],
      ]);
      const onBar = glazeOf(chainsFromBoard(board, BAR));
      expect(onBar.stages.map((s) => [s.id, s.made?.label ?? null])).toEqual([['glaze', 'Made a batch'], ['syrup', 'Made Level 2']]);
    });
  });

  /*
    A batch made ahead -- wings marinated overnight, a sauce cooked before the
    rush -- has to be recordable when it is made. The main button only appears
    when a stage needs doing, so each stage that can be made gets its own small
    one.
  */
  describe('a batch made ahead', () => {
    it('with nothing to do, every stage that can be made still offers one batch, in the main button\'s words', () => {
      const c = chainsFromBoard([ready(3000), frozen(4000), base(5000)], KITCHEN)[0];
      expect(c).toMatchObject({ severity: 'OK', action: null, headline: null });
      expect(c.stages.map((s) => s.made)).toEqual([
        { label: 'Refilled Level 1', uses: 'Uses 2,000 g Sauce frozen', makes: '2,000 g' },
        { label: 'Made Level 2', uses: 'Uses 2,000 g Tomato base', makes: '2,000 g' },
        { label: 'Made Level 3', uses: 'Uses 1,000 g Tomato · 500 g Sugar', makes: '2,500 g' },
      ]);
    });

    it('when a stage needs doing, the main button is for it and the other stages keep their small ones', () => {
      const c = chainsFromBoard([ready(300), frozen(2000), base(5000)], KITCHEN)[0];
      expect(c.action).toMatchObject({ rawMaterialId: 'ready', enabled: true });
      expect(c.stages.map((s) => s.made?.label ?? null)).toEqual([null, 'Made Level 2', 'Made Level 3']);
    });

    it('a stage short of what it is made from offers nothing: the server would refuse the batch', () => {
      const c = chainsFromBoard([ready(3000), frozen(1000), base(0, 100)], KITCHEN)[0];
      expect(c.severity).toBe('OK');
      expect(c.stages.map((s) => s.made)).toEqual([null, null, null]);
    });

    it('when the main button is off (buy something first), a deeper stage that can be made still offers its batch', () => {
      // Level 1 needs refilling and Level 2 is empty for want of spice; the base can still be cooked ahead.
      const spicy = frozen(0, { components: [prep('base', 'Tomato base', 2000), raw('spice', 'Spice', 10, 0)] });
      const c = chainsFromBoard([ready(300), spicy, base(5000)], KITCHEN)[0];
      expect(c.headline).toBe('Out of Spice. Buy it now.');
      expect(c.action).toMatchObject({ rawMaterialId: 'ready', enabled: false, disabledReason: 'Buy Spice first' });
      expect(c.stages.map((s) => s.made?.label ?? null)).toEqual([null, null, 'Made Level 3']);
    });
  });
});

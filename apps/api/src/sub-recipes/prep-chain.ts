/**
 * Prep level chains: what the kitchen or bar should do next about one dish's
 * sauce, read from Level 1 down.
 *
 * Carolina's kitchen runs each sauce in stages. Level 1 is the tub on the line
 * that plates are served from; Level 2 is the batch parked behind it (usually
 * frozen) that refills it; Level 3 is what Level 2 is made from. The station
 * screen showed each stage as its own tile with its own status, so the cook had
 * to read three tiles and work out the order themselves -- "the ready tub is
 * low, but the frozen one is empty too, so first I cook the base". This reads
 * the stages together and says ONE thing to do.
 *
 * Deliberately no pace, no sales rate and no horizons: a stage needs action at
 * or below its own par, Level 1 also at two servings or fewer, and a deeper
 * stage also when it cannot cover one more refill of the stage above while that
 * stage needs one. A backup at zero is not news on its own (prep-rotation.ts in
 * shared-types says why): in a rotation it is empty for half its life.
 *
 * Pure, so the station screen and the bell alerts say the same thing from the
 * same rows. No costs anywhere: this goes to kitchen and bar screens.
 */

/** Level 1 needs action at this many servings left, even with no par set. */
export const L1_MIN_SERVINGS = 2;
/** A chain stops at Level 3 -- the deepest shape any shop has described. */
export const MAX_STAGES = 3;

/** A component line of a board row (SubRecipesService.list). */
export interface BoardComponent {
  rawMaterialId: string;
  name: string;
  unit: string;
  /** How much ONE batch of the row takes. */
  quantity: number;
  onHand: number;
  isPrep: boolean;
}

/** The fields of a prep-board row (SubRecipesService.list) the chains read. */
export interface BoardRow {
  id: string;
  name: string;
  unit: string;
  onHand: number;
  parLevel: number | null;
  /** 1 when a dish, a size or an add-on uses it directly. */
  level: 1 | 2 | null;
  kind: 'MAKE' | 'MOVE';
  batchYield?: number | null;
  depth?: number | null;
  station?: { id: string; name: string; kind: string } | null;
  rootLimitedBy?: string | null;
  /** Tightest first, as list() sorts them. */
  serves: Array<{ productName: string; perServing?: number; servingsLeft: number }>;
  components: BoardComponent[];
}

export type ChainSeverity = 'NOW' | 'NEXT' | 'OK';
export type ChainDot = 'RED' | 'AMBER' | 'GREEN' | 'GREY';

export interface ChainStage {
  level: number;
  id: string;
  name: string;
  unit: string;
  kind: 'MAKE' | 'MOVE';
  onHand: number;
  parLevel: number | null;
  /** Level 1 only: servings of its tightest dish left. */
  servingsLeft: number | null;
  servesName: string | null;
  /** How much of this stage one batch of the stage above takes. Null for Level 1. */
  perRefill: number | null;
  /** Every ingredient covers one batch right now. */
  canMakeNow: boolean;
  dot: ChainDot;
  /** "Level 1 · Tomato Sauce (ready) · 300 g · about 2 Spaghetti" */
  line: string;
  /**
   * A batch of this stage can be recorded from this screen although the
   * chain's main button is not for it: a batch made ahead, before anything
   * runs low. Null when it cannot be made now, another station makes it, or
   * the main button already records it.
   */
  made: StageMade | null;
}

/** A stage's own small button: the words and the one batch the main button would use for that stage. */
export interface StageMade {
  label: string;
  uses: string;
}

export interface ChainAction {
  /** The stage the button records a batch of. */
  rawMaterialId: string;
  label: string;
  /** "Uses 2,000 g Tomato Sauce (frozen)": one batch, no costs. */
  uses: string;
  enabled: boolean;
  disabledReason?: string;
}

export interface PrepChain {
  /** The Level 1 item's id. */
  id: string;
  name: string;
  station: { id: string; name: string; kind: string } | null;
  stages: ChainStage[];
  /** The one instruction; null when nothing needs doing. */
  headline: string | null;
  severity: ChainSeverity;
  action: ChainAction | null;
  /** The raw ingredient that has to be bought before anything can be made. */
  blockedBy: string | null;
  /** Bell words. No quantity or servings count, so a sale never makes a repeat look new. */
  alertTitle: string | null;
  alertBody: string | null;
  /** Worth a bell: something needs doing, and the shop set a par somewhere in the chain. */
  alertable: boolean;
}

/** Formatted like the station tiles' amounts (StationPrepLevels.tsx). */
function amount(n: number, unit: string): string {
  return `${Math.max(0, n).toLocaleString('en-PH', { maximumFractionDigits: 1 })} ${unit}`;
}

/**
 * Every Level 1 item's chain. Given `at` (the station whose screen draws them),
 * a button for a stage another station makes is turned off and the headline
 * names that station: the Made route refuses such a stage, so an enabled button
 * there could only fail on every tap. Left out for the bell alerts, which go to
 * the station that makes the stage instead (prep-rotation.scheduler.ts).
 */
export function chainsFromBoard(board: BoardRow[], at?: { id: string } | null): PrepChain[] {
  const byId = new Map(board.map((r) => [r.id, r]));
  return board.filter((r) => r.level === 1).map((r) => chainOf(r, byId, at ?? null));
}

/**
 * The station that makes the stage a chain's button records, when it has one.
 * The same station the Made route checks (row.station), so the screen, the
 * route and the alerts agree about whose job the batch is.
 */
export function makerOf(chain: PrepChain, board: BoardRow[]): { id: string; name: string; kind: string } | null {
  if (!chain.action) return null;
  return board.find((r) => r.id === chain.action!.rawMaterialId)?.station ?? null;
}

/**
 * The prep component that runs short first: the smallest stock / per-batch
 * among components that are themselves preps (the same rule the rotation uses).
 */
function tightestPrep(row: BoardRow, byId: Map<string, BoardRow>): { row: BoardRow; quantity: number } | null {
  let best: { row: BoardRow; quantity: number; ratio: number } | null = null;
  for (const c of row.components) {
    if (!c.isPrep || !(c.quantity > 0)) continue;
    const stage = byId.get(c.rawMaterialId);
    if (!stage) continue;
    const ratio = stage.onHand / c.quantity;
    if (!best || ratio < best.ratio) best = { row: stage, quantity: c.quantity, ratio };
  }
  return best ? { row: best.row, quantity: best.quantity } : null;
}

function chainOf(l1: BoardRow, byId: Map<string, BoardRow>, at: { id: string } | null): PrepChain {
  // Walk down: each stage is refilled from its tightest prep component.
  const walk: Array<{ row: BoardRow; perRefill: number | null }> = [{ row: l1, perRefill: null }];
  const seen = new Set([l1.id]);
  while (walk.length < MAX_STAGES) {
    const next = tightestPrep(walk[walk.length - 1].row, byId);
    // A cycle cannot be saved through setRecipe; guarded so old data cannot loop here.
    if (!next || seen.has(next.row.id)) break;
    seen.add(next.row.id);
    walk.push({ row: next.row, perRefill: next.quantity });
  }
  const n = walk.length;

  // A prep component's own row is the fresher read of its stock.
  const stockOf = (c: BoardComponent) => (c.isPrep ? (byId.get(c.rawMaterialId)?.onHand ?? c.onHand) : c.onHand);
  const servingsLeft = l1.serves[0]?.servingsLeft ?? null;
  const servesName = l1.serves[0]?.productName ?? null;

  const needs: boolean[] = [];
  const facts = walk.map(({ row, perRefill }, i) => {
    const used = row.components.filter((c) => c.quantity > 0);
    // The same test makeBatch applies, so the button is offered exactly when the server will record it.
    const canMakeNow = used.every((c) => stockOf(c) >= c.quantity);
    const shortRaw = used.find((c) => !c.isPrep && c.onHand < c.quantity) ?? null;
    const atPar = row.parLevel != null && row.onHand <= row.parLevel;
    const need = i === 0
      ? atPar || (servingsLeft != null && servingsLeft <= L1_MIN_SERVINGS)
      : atPar || (needs[i - 1] && perRefill != null && row.onHand < perRefill);
    needs.push(need);
    // Of the prep components that are short, the tightest: what has to be made first.
    const shortPrep = used
      .filter((c) => c.isPrep && stockOf(c) < c.quantity)
      .sort((a, b) => stockOf(a) / a.quantity - stockOf(b) / b.quantity)[0] ?? null;
    return { row, perRefill, used, canMakeNow, shortRaw, shortPrep, need };
  });

  const stages: ChainStage[] = facts.map((f, i) => {
    const known = f.row.parLevel != null || (i === 0 && servingsLeft != null);
    const dot: ChainDot = f.need ? (i === 0 ? 'RED' : 'AMBER') : known ? 'GREEN' : 'GREY';
    const level = i + 1;
    return {
      level,
      id:           f.row.id,
      name:         f.row.name,
      unit:         f.row.unit,
      kind:         f.row.kind,
      onHand:       f.row.onHand,
      parLevel:     f.row.parLevel,
      servingsLeft: i === 0 ? servingsLeft : null,
      servesName:   i === 0 ? servesName : null,
      perRefill:    f.perRefill,
      canMakeNow:   f.canMakeNow,
      dot,
      line: `Level ${level} · ${f.row.name} · ${amount(f.row.onHand, f.row.unit)}`
        + (i === 0 && servingsLeft != null ? ` · about ${servingsLeft.toLocaleString('en-PH')} ${servesName}` : ''),
      made: null,
    };
  });

  const names = walk.map((w) => w.row.name);
  const [L1, L2, L3] = names;
  // MOVE wording only when the stage it moves from is actually in the chain.
  const movesFromBelow = (i: number) => facts[i].row.kind === 'MOVE' && i + 1 < n;
  const makesFromBelow = (i: number) => i + 1 < n;
  const label = (i: number): string => {
    if (i === 0) return movesFromBelow(0) ? 'Refilled Level 1' : 'Made a batch';
    if (i === 1) return movesFromBelow(1) ? 'Moved to Level 2' : 'Made Level 2';
    return 'Made Level 3';
  };
  const uses = (i: number): string =>
    `Uses ${facts[i].used.map((c) => `${amount(c.quantity, c.unit)} ${c.name}`).join(' · ')}`;

  /*
    A batch made ahead -- wings marinated overnight, a sauce cooked before the
    rush -- has to be recordable when it is made, not only once the tub runs
    low: until the tap the raw stock stays too high on the books and the day's
    sheet is wrong. So each stage that can be made right now and that this
    screen may record (the Made route's rule: this station's, or routed to
    none) gets a small button of its own, unless the main button is for it.
    Read for the bell alerts (no station), who makes it is not judged; the
    alerts draw no buttons.
  */
  const withMade = (action: ChainAction | null): ChainStage[] => stages.map((s, i) => {
    const maker = facts[i].row.station ?? null;
    const mayRecordHere = !at || !maker || maker.id === at.id;
    const isMain = !!action?.enabled && action.rawMaterialId === facts[i].row.id;
    return { ...s, made: facts[i].canMakeNow && mayRecordHere && !isMain ? { label: label(i), uses: uses(i) } : null };
  });

  const base = { id: l1.id, name: l1.name, station: l1.station ?? null };
  const k = needs.indexOf(true);
  if (k < 0) {
    return { ...base, stages: withMade(null), headline: null, severity: 'OK', action: null, blockedBy: null, alertTitle: null, alertBody: null, alertable: false };
  }
  const severity: ChainSeverity = needs[0] ? 'NOW' : 'NEXT';

  // From the first stage that needs action downward: make the first one that can be made.
  let actionAt: number | null = null;
  let blockedRaw: string | null = null;
  let blockedPrep: { at: number; name: string } | null = null;
  for (let i = k; i < n; i += 1) {
    const f = facts[i];
    if (f.canMakeNow) { actionAt = i; break; }
    if (f.shortRaw) { blockedRaw = f.shortRaw.name; break; }
    // The short component is the next stage down, so look there.
    if (i < n - 1) continue;
    // Short on a prep past the last stage shown (the three-stage cap, or a loop in old data).
    blockedPrep = { at: i, name: f.shortPrep?.name ?? 'another item' };
  }

  const prefix = servingsLeft != null
    ? `Level 1: ${servingsLeft.toLocaleString('en-PH')} serving${servingsLeft === 1 ? '' : 's'} left`
    : `Level 1: ${amount(l1.onHand, l1.unit)} left`;
  const sentence = (i: number): string => {
    if (i === 0) {
      if (movesFromBelow(0)) return `${prefix} — refill from Level 2 (${L2}).`;
      if (makesFromBelow(0)) return `${prefix} — make a batch from Level 2 (${L2}).`;
      return `${prefix} — make a batch now.`;
    }
    if (i === 1) {
      if (movesFromBelow(1)) return `Level 2 (${L2}) is low — move a batch across from Level 3 (${L3}).`;
      if (makesFromBelow(1)) return `Level 2 (${L2}) is low — make it now from Level 3 (${L3}).`;
      return `Level 2 (${L2}) is low — make a batch now.`;
    }
    return `Level 3 (${L3}) is low — make a batch now.`;
  };
  let headline: string;
  let alertTitle: string;
  let alertBody: string;
  let action: ChainAction;
  if (actionAt != null) {
    headline = severity === 'NOW' && actionAt >= 1 ? `${prefix}. ${sentence(actionAt)}` : sentence(actionAt);
    action = { rawMaterialId: facts[actionAt].row.id, label: label(actionAt), uses: uses(actionAt), enabled: true };
    if (actionAt === 0) {
      alertTitle = movesFromBelow(0) ? `${L1}: refill from Level 2` : `${L1}: make a batch`;
      alertBody = movesFromBelow(0) ? `Refill Level 1 from Level 2 (${L2}).`
        : makesFromBelow(0) ? `Make a batch of ${L1} from Level 2 (${L2}).`
        : `Make a batch of ${L1}.`;
    } else if (actionAt === 1) {
      alertTitle = `${L1}: make Level 2 now`;
      alertBody = movesFromBelow(1) ? `Move a batch of ${L3} across to Level 2 (${L2}).`
        : makesFromBelow(1) ? `Make Level 2 (${L2}) from Level 3 (${L3}).`
        : `Make a batch of Level 2 (${L2}).`;
    } else {
      alertTitle = `${L1}: make Level 3 now`;
      alertBody = `Make a batch of Level 3 (${L3}).`;
    }
  } else {
    // Nothing can be made yet: the button stays on the stage that needs action, disabled, saying why.
    const reason = blockedRaw ? `Buy ${blockedRaw} first` : `Level ${blockedPrep!.at + 2} first`;
    action = { rawMaterialId: facts[k].row.id, label: label(k), uses: uses(k), enabled: false, disabledReason: reason };
    if (blockedRaw) {
      headline = `Out of ${blockedRaw}. Buy it now.`;
      alertTitle = `${L1}: buy ${blockedRaw}`;
      alertBody = `Out of ${blockedRaw}. Buy it before the next batch.`;
    } else {
      headline = `${names[blockedPrep!.at]} needs ${blockedPrep!.name} first.`;
      alertTitle = `${L1}: make ${blockedPrep!.name} first`;
      alertBody = headline;
    }
  }

  /*
    The stage to make belongs to another station: a kitchen glaze made from the
    bar's simple syrup. The Made route refuses a stage routed elsewhere, so an
    enabled button here would fail on every tap and the card would never
    change. The button goes off and says whose job it is, and the headline
    points at that station instead of telling this one to make it. A stage
    routed to no station stays recordable anywhere, as the route allows.
    A headline about buying something stays as it is: that is not one
    station's job.
  */
  const maker = at ? (byId.get(action.rawMaterialId)?.station ?? null) : null;
  if (at && maker && maker.id !== at.id) {
    action = { ...action, enabled: false, disabledReason: `${maker.name} makes this` };
    if (actionAt != null) {
      const ask = actionAt === 0
        ? `${prefix} — ask ${maker.name} for a batch.`
        : `Level ${actionAt + 1} (${names[actionAt]}) is low — ask ${maker.name} for a batch.`;
      headline = severity === 'NOW' && actionAt >= 1 ? `${prefix}. ${ask}` : ask;
    }
  }

  return {
    ...base,
    stages: withMade(action),
    headline,
    severity,
    action,
    blockedBy: blockedRaw,
    alertTitle,
    alertBody,
    alertable: stages.some((s) => s.parLevel != null),
  };
}

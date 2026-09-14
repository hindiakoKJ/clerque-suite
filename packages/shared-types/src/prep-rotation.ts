/**
 * The sauce rotation, read off the prep board.
 *
 * A kitchen that preps ahead keeps each sauce in two places: READY TO USE on
 * the line (level 1), and a PARKED backup behind it, usually frozen (level
 * 2). When the line runs low the backup is moved across -- thawed, decanted --
 * and the next batch is cooked to refill the backup. The prep board already
 * knows every number; nothing turned them into "what to do now" for the
 * owner, and nothing said it during service.
 *
 * Pure, so the API (alerts, the owner's card) and the web (the cook's board)
 * decide the same thing from the same rows.
 *
 * Only what the app can actually record is ever asked for. A move or a batch
 * takes whole batches, so "move one across" is said only when every
 * ingredient covers one; otherwise it says what has to happen first -- cook
 * the backup, or buy the raw material that ran out.
 *
 * Nothing is decided without a par level on the ready-to-use item, because a
 * warning nobody configured is a warning everyone learns to ignore. A backup
 * at zero is not, by itself, news: in a rotation it is empty for half its
 * life. It is only called low against its OWN par.
 */

/** The fields of a prep-board row (GET /inventory/sub-recipes) this reads. */
export interface PrepBoardRow {
  id: string;
  name: string;
  unit: string;
  onHand: number;
  parLevel: number | null;
  /** 1 ready to use, 2 parked, null neither. */
  level: 1 | 2 | null;
  /** MOVE: the same thing in another state (thawed). MAKE: cooked from components. */
  kind: 'MAKE' | 'MOVE';
  serves: Array<{ productId: string; productName: string; servingsLeft: number }>;
  components: Array<{ rawMaterialId: string; name: string; unit: string; quantity: number; onHand: number; isPrep: boolean }>;
  station?: { id: string; name: string; kind: string } | null;
  /** Batches once the stages underneath are made first. 0 means something has to be bought. */
  batchesWithPrep?: number;
  /** The raw material that finally runs out, however deep it sits. */
  rootLimitedBy?: string | null;
}

/**
 *   TOP_UP         the line is at or below par, and one move or batch can be recorded now
 *   COOK_NOW       the line is at or below par, and something has to be cooked or bought first
 *   REFILL_BACKUP  the line is fine but a parked stage behind it is at or below its own par
 *   OK             nothing to do
 *   NO_PAR         no par level on the ready-to-use item: shown, never alerted
 */
export type RotationState = 'TOP_UP' | 'COOK_NOW' | 'REFILL_BACKUP' | 'OK' | 'NO_PAR';

export interface RotationStage { id: string; name: string; unit: string; onHand: number; par: number | null; level: 1 | 2 | null }

export interface RotationRow {
  prepId: string;
  name: string;
  unit: string;
  kind: 'MAKE' | 'MOVE';
  ready: { onHand: number; par: number | null };
  /**
   * The prep stage this one is moved or made from -- of several, the one that
   * runs short first. Null when it is made straight from raw ingredients.
   */
  backup: RotationStage | null;
  /** How much of the backup one move or batch takes, in the backup's unit. */
  perBatch: number | null;
  /** Every ingredient covers one move or batch, so the board can record it now. */
  canDoNow: boolean;
  /** The raw material that has to be bought before anything more can be made. */
  blockedBy: string | null;
  /** The parked stage at or below its own par, when that is what needs doing. */
  refill: RotationStage | null;
  /** The line is empty. */
  out: boolean;
  state: RotationState;
  /** Servings left on the line, tightest first. */
  serves: Array<{ productName: string; servingsLeft: number }>;
  station: { id: string; name: string; kind: string } | null;
}

function qty(n: number, unit: string): string {
  return `${Math.max(0, n).toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${unit}`;
}

export function rotationFromBoard(rows: PrepBoardRow[]): RotationRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows
    .filter((r) => r.level === 1)
    .map((r) => {
      const used = r.components.filter((c) => c.quantity > 0);
      // A prep component's own row is the fresher read of its stock and carries its par and level.
      const stage = (c: PrepBoardRow['components'][number]): RotationStage => {
        const row = byId.get(c.rawMaterialId);
        return { id: c.rawMaterialId, name: c.name, unit: c.unit, onHand: row ? row.onHand : c.onHand, par: row ? row.parLevel : null, level: row ? row.level : null };
      };
      const preps = used.filter((c) => c.isPrep).map((c) => ({ c, s: stage(c) }));
      // Of several prep stages, the one that runs short first is the one to talk about.
      const tightest = preps.length === 0 ? null
        : preps.reduce((a, b) => (b.s.onHand / b.c.quantity < a.s.onHand / a.c.quantity ? b : a));
      const backup = tightest ? tightest.s : null;
      const stockOf = (c: PrepBoardRow['components'][number]) => (c.isPrep ? stage(c).onHand : c.onHand);
      const canDoNow = used.length > 0 && used.every((c) => stockOf(c) >= c.quantity);
      const rawShort = used.find((c) => !c.isPrep && c.onHand < c.quantity);
      const blockedBy = canDoNow ? null
        : r.batchesWithPrep === 0 && r.rootLimitedBy ? r.rootLimitedBy
        : rawShort ? rawShort.name
        : null;
      // A stage that is itself ready to use has its own row, and its own alert.
      const refill = preps
        .map((p) => p.s)
        .filter((s) => s.level !== 1 && s.par != null && s.onHand <= s.par)
        .sort((a, b) => a.onHand / Math.max(a.par!, 1e-9) - b.onHand / Math.max(b.par!, 1e-9))[0] ?? null;

      const par = r.parLevel;
      let state: RotationState;
      if (par == null) state = 'NO_PAR';
      else if (r.onHand <= par) state = canDoNow ? 'TOP_UP' : 'COOK_NOW';
      else if (refill) state = 'REFILL_BACKUP';
      else state = 'OK';
      return {
        prepId:   r.id,
        name:     r.name,
        unit:     r.unit,
        kind:     r.kind,
        ready:    { onHand: r.onHand, par },
        backup,
        perBatch: tightest ? tightest.c.quantity : null,
        canDoNow,
        blockedBy,
        refill:   state === 'REFILL_BACKUP' ? refill : null,
        out:      r.onHand <= 0,
        state,
        serves:   [...r.serves].sort((a, b) => a.servingsLeft - b.servingsLeft)
          .map((s) => ({ productName: s.productName, servingsLeft: s.servingsLeft })),
        station:  r.station ?? null,
      };
    })
    .sort((a, b) =>
      // An empty line that needs doing goes first; then what needs doing; then how far into the par.
      Number(!(rotationNeedsAction(a) && a.out)) - Number(!(rotationNeedsAction(b) && b.out))
      || STATE_ORDER[a.state] - STATE_ORDER[b.state]
      || fill(a) - fill(b)
      || a.name.localeCompare(b.name));
}

const STATE_ORDER: Record<RotationState, number> = { COOK_NOW: 0, TOP_UP: 1, REFILL_BACKUP: 2, OK: 3, NO_PAR: 4 };
const fill = (r: RotationRow) => (r.ready.par ? r.ready.onHand / r.ready.par : Number.POSITIVE_INFINITY);

/** Alerted states: the ones that ask someone to do something. */
export function rotationNeedsAction(r: RotationRow): boolean {
  return r.state === 'TOP_UP' || r.state === 'COOK_NOW' || r.state === 'REFILL_BACKUP';
}

/** The chip on a card: two or three words. */
export function rotationChip(r: RotationRow): string {
  if (r.state === 'NO_PAR') return 'No par set';
  if (r.state === 'OK') return 'OK';
  if (r.state === 'REFILL_BACKUP') return 'Backup low';
  if (r.out) return 'Out';
  if (r.state === 'TOP_UP') return r.kind === 'MOVE' ? 'Move one across' : 'Make a batch';
  return r.blockedBy ? 'Buy first' : 'Cook now';
}

/**
 * What to do, without the line's live quantity: the same words until someone
 * moves, cooks or buys something. An alert repeated every half hour because a
 * sale turned "down to 380 ml" into "down to 360 ml" is how an alert gets
 * ignored.
 */
export function rotationInstruction(r: RotationRow): string | null {
  const b = r.backup;
  switch (r.state) {
    case 'TOP_UP':
      return r.kind === 'MOVE' && b ? `Move one batch across from ${b.name}.` : 'Make a batch now.';
    case 'COOK_NOW': {
      if (r.blockedBy) return `Out of ${r.blockedBy}. Buy it before the next batch.`;
      if (b && r.perBatch != null && b.onHand < r.perBatch) {
        const short = b.onHand > 0 ? 'is short of a full batch' : 'is empty';
        return r.kind === 'MOVE'
          ? `${b.name} ${short}. Cook a batch of it now.`
          : `${b.name} ${short}. Make ${b.name} first, then a batch.`;
      }
      return 'Make a batch now.';
    }
    case 'REFILL_BACKUP':
      return r.refill ? `${r.refill.name} is at or below its par. Cook the next batch today.` : null;
    default:
      return null;
  }
}

/** What to do, in one sentence, with where the line stands. Null when nothing is. */
export function rotationAction(r: RotationRow): string | null {
  const instruction = rotationInstruction(r);
  if (!instruction) return null;
  if (r.state === 'REFILL_BACKUP') return instruction;
  const onLine = r.out ? `${r.name} is out.` : `${r.name} is down to ${qty(r.ready.onHand, r.unit)}.`;
  return `${onLine} ${instruction}`;
}

/** The title of the bell alert. Changes only when what to do changes, or the line runs out. */
export function rotationAlertTitle(r: RotationRow, where = ''): string {
  if (r.state === 'REFILL_BACKUP') return `${r.refill?.name ?? r.name}${where}: cook the next batch today`;
  const what = r.state === 'TOP_UP'
    ? (r.kind === 'MOVE' ? 'move one across' : 'make a batch')
    : r.blockedBy ? `buy ${r.blockedBy}` : 'cook a batch now';
  return r.out ? `${r.name}${where} is out: ${what}` : `${r.name}${where}: ${what}`;
}

/**
 * The owner's message for the group chat: one line per sauce with a par, the
 * ones that need doing first.
 */
export function rotationShareText(rows: RotationRow[], heading: string): string {
  const lines = rows
    .filter((r) => r.state !== 'NO_PAR')
    .map((r) => {
      const parts = [`Ready ${qty(r.ready.onHand, r.unit)}`];
      if (r.backup && r.backup.level !== 1) parts.push(`${r.backup.name} ${qty(r.backup.onHand, r.backup.unit)}`);
      if (r.serves[0]) parts.push(`enough for ${r.serves[0].servingsLeft.toLocaleString('en-PH')} ${r.serves[0].productName}`);
      const action = rotationAction(r);
      return `• ${r.name} — ${parts.join(' · ')}${action ? `\n  ${action}` : ' · OK'}`;
    });
  return [heading, ...(lines.length ? lines : ['No sauce has a par level set yet.'])].join('\n');
}

/**
 * Every call the weekly count makes, in one place: the kitchen and bar
 * screens' count (kds/stations/:id/count) and the owner's review of a
 * recorded count (procure/weekly-counts/:id).
 *
 * The responses are read field by field into the shapes below, with a safe
 * default for anything missing, so a renamed field is fixed here and nowhere
 * else, and an older server never crashes a screen.
 *
 * A count is a RECORD: the station's Send freezes it (status RECORDED) and
 * nothing moves. Only the owner's "Adjust the books to match" moves stock.
 * The station shapes never carry a book figure, an expected amount, a
 * difference or a cost -- the count is blind, and the kitchen does not see
 * what the shop pays.
 */
import { api } from '@/lib/api';
import type { OtherCount } from '@/components/pos/station-count';

// ─── Shared reading ──────────────────────────────────────────────────────────

type Raw = Record<string, any>;
const obj = (x: unknown): Raw => (x && typeof x === 'object' ? (x as Raw) : {});
const str = (x: unknown): string => (typeof x === 'string' ? x : x == null ? '' : String(x));
const strOrNull = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
/** Prisma decimals arrive as strings. */
const num = (x: unknown): number | null => {
  if (x == null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const list = (x: unknown): any[] => (Array.isArray(x) ? x : []);
const names = (x: unknown): string[] => list(x).map((v) => (typeof v === 'string' ? v : str(obj(v).name))).filter(Boolean);

/** The server's own words for a refusal, or a plain line when the device never reached it. */
export function countErrorText(e: unknown, fallback: string): string {
  const r = (e as { response?: { data?: { message?: string | string[] } } })?.response;
  if (!r) return 'Could not reach Clerque. Check the connection and try again.';
  const m = r.data?.message;
  return (Array.isArray(m) ? m.join(' ') : m) || fallback;
}

// ─── Station: GET kds/stations/:id/count ─────────────────────────────────────

export interface StationCountRow {
  rawMaterialId: string;
  name: string;
  unit: string;
  packSize: number | null;
  alsoOn: string[];
  /** This station's figure: in its running count, or (no count running) in the count it sent last. */
  counted: number | null;
  countedWords: string | null;
  countedBy: string | null;
  countedAt: string | null;
  /** The owner asked for this item again. */
  recount: boolean;
  /** Another station counted it in the last 3 days (the server's `countedElsewhere`). */
  otherCount: OtherCount | null;
}

export interface StationCountView {
  station: { id: string; name: string };
  branch: { id: string; name: string };
  /**
   * NEW: nothing counted since the last Send. COUNTING: a count is running.
   * SENT: this station sent today and has not started again -- the rows carry
   * the figures it sent.
   */
  state: 'NEW' | 'COUNTING' | 'SENT';
  /** This station's running (OPEN) count; null until the first save after a Send. */
  count: { countNumber: string; startedOn: string } | null;
  due: { isDue: boolean; lastSentOn: string | null; daysSince: number | null; message: string | null };
  /** When this station last sent a count, and who sent it. */
  sentAt: string | null;
  sentBy: string | null;
  stillWaiting: number;
  recount: { askedFor: string[]; message: string } | null;
  /** Items in the running count that answered the owner's recount: when that is all it holds, Send is a recount. */
  recounted: string[];
  progress: { counted: number; total: number };
  sections: Array<{ key: string; title: string; rows: StationCountRow[] }>;
}

/** { station, words, on, at, label }: the label is the whole chip ("Kitchen counted: 2 pk + 100 ml (Sep 21)"). */
function readOther(x: unknown): OtherCount | null {
  const o = obj(x);
  if (!x || !o.station) return null;
  return { station: str(o.station), words: str(o.words), at: strOrNull(o.at), message: strOrNull(o.label) };
}

function readRow(x: unknown): StationCountRow {
  const r = obj(x);
  return {
    rawMaterialId: str(r.rawMaterialId),
    name:          str(r.name),
    unit:          str(r.unit),
    packSize:      num(r.packSize),
    alsoOn:        names(r.alsoOn),
    counted:       num(r.counted),
    countedWords:  strOrNull(r.countedWords),
    countedBy:     strOrNull(r.countedBy),
    countedAt:     strOrNull(r.countedAt),
    recount:       !!r.recount,
    otherCount:    readOther(r.countedElsewhere),
  };
}

const readProgress = (x: unknown) => ({ counted: num(obj(x).counted) ?? 0, total: num(obj(x).total) ?? 0 });

function readStationView(x: unknown): StationCountView {
  const v = obj(x);
  const due = obj(v.due);
  const recount = v.recount ? obj(v.recount) : null;
  const state: StationCountView['state'] = v.state === 'SENT' || v.state === 'COUNTING' ? v.state : v.count ? 'COUNTING' : 'NEW';
  // The server names the record it sent today as `count` too; here `count` is only a count still running.
  const count = v.count && state !== 'SENT' ? obj(v.count) : null;
  return {
    station:      { id: str(obj(v.station).id), name: str(obj(v.station).name) },
    branch:       { id: str(obj(v.branch).id), name: str(obj(v.branch).name) },
    state,
    count:        count ? { countNumber: str(count.countNumber), startedOn: str(count.startedOn) } : null,
    due:          { isDue: !!due.isDue, lastSentOn: strOrNull(due.lastSentOn), daysSince: num(due.daysSince), message: strOrNull(due.message) },
    sentAt:       strOrNull(v.sentAt),
    sentBy:       strOrNull(v.sentBy),
    stillWaiting: num(v.stillWaiting) ?? 0,
    recount:      recount ? { askedFor: list(recount.askedFor).map(str), message: str(recount.message) } : null,
    recounted:    list(v.recounted).map(str).filter(Boolean),
    progress:     readProgress(v.progress),
    sections:     list(v.sections).map((s) => ({ key: str(obj(s).key), title: str(obj(s).title), rows: list(obj(s).rows).map(readRow) })),
  };
}

export const stationCountKey = (stationId: string) => ['station-count', stationId] as const;

export const getStationCount = (stationId: string): Promise<StationCountView> =>
  api.get(`/kds/stations/${stationId}/count`).then((r) => readStationView(r.data));

// ─── Station: POST kds/stations/:id/count/lines ──────────────────────────────

export interface SavedCount {
  rawMaterialId: string;
  counted: number;
  countedWords: string | null;
  countedBy: string | null;
  countedAt: string | null;
  progress: { counted: number; total: number };
  /** "Saved: Fresh Milk 2 pk + 100 ml." */
  message: string;
}

/** Body: { rawMaterialId, qty, by? }. An upsert, so a retry saves the same figure again. */
export const saveStationCount = (stationId: string, body: { rawMaterialId: string; qty: number; by?: string }): Promise<SavedCount> =>
  api.post(`/kds/stations/${stationId}/count/lines`, body).then((r) => {
    const d = obj(r.data);
    return {
      rawMaterialId: str(d.rawMaterialId) || body.rawMaterialId,
      counted:       num(d.counted) ?? body.qty,
      countedWords:  strOrNull(d.countedWords),
      countedBy:     strOrNull(d.countedBy),
      countedAt:     strOrNull(d.countedAt),
      progress:      readProgress(d.progress),
      message:       str(d.message),
    };
  });

// ─── Station: POST kds/stations/:id/count/send ───────────────────────────────

export interface SentCount {
  outcome: 'SENT' | 'ALREADY_SENT';
  /** "Sent to Anne and Mia. ..." */
  message: string;
  sentTo: string[];
  progress: { counted: number; total: number };
  notCounted: string[];
}

/** Body: { by? }. Freezes this station's count as a record (RECORDED); nothing in stock moves. */
export const sendStationCount = (stationId: string, body: { by?: string }): Promise<SentCount> =>
  api.post(`/kds/stations/${stationId}/count/send`, body).then((r) => {
    const d = obj(r.data);
    return {
      outcome:    d.outcome === 'ALREADY_SENT' ? 'ALREADY_SENT' : 'SENT',
      message:    str(d.message),
      sentTo:     names(d.sentTo),
      progress:   readProgress(d.progress),
      notCounted: names(d.notCounted),
    };
  });

// ─── Owner: GET procure/weekly-counts/:id ────────────────────────────────────

/** CycleCountStatus. RECORDED = sent from a station, stock and books untouched. Anything else the server adds is shown as it comes. */
export type CountStatus = 'OPEN' | 'RECORDED' | 'POSTED' | 'CANCELLED' | (string & {});

export interface WeeklyReviewLine {
  lineId: string;
  rawMaterialId: string;
  name: string;
  unit: string;
  counted: number;
  /** What the books said at the moment this line was saved. */
  book: number;
  /** Counted minus book. */
  difference: number;
  /** "Milk: counted 2.1 L, book 3.4 L, short 1.3 L". */
  words: string;
  inPacks: string | null;
  countedBy: string | null;
  countedAt: string | null;
  /** "2 pk + 100 ml · Kitchen screen (Joy) · Sep 21 9:05 PM", as the server words it. */
  detail: string | null;
  /** Other OPEN counts in the branch holding the same item. */
  alsoOpenIn: string[];
  /** "Counted again later (Bar, Sep 22). Not adjusted from this record." Null when this line still stands. */
  superseded: string | null;
}

export interface WeeklyReviewStation {
  id: string;
  name: string;
  sentAt: string | null;
  countedBy: string | null;
  counted: number;
  total: number;
  notCounted: string[];
}

export interface WeeklyReview {
  id: string;
  countNumber: string;
  status: CountStatus;
  /** "Recorded Sep 21 9:12 PM by Joy (Kitchen). Stock and the books have not changed." Null from an older server. */
  statusLine: string | null;
  branch: { id: string; name: string };
  startedOn: string;
  stations: WeeklyReviewStation[];
  lines: WeeklyReviewLine[];
  summary: { lines: number; differ: number; short: number; over: number };
  /** Items the owner asked to be counted again (ids). */
  recountAsked: string[];
  notes: string | null;
  /** When and by whom the books were adjusted, once they were. */
  postedAt: string | null;
  postedBy: string | null;
}

const SUPERSEDED_TEXT = 'Counted again later. Not adjusted from this record.';

function readSuperseded(x: unknown): string | null {
  if (!x) return null;
  if (typeof x === 'string') return x;
  const o = obj(x);
  if (o.message) return str(o.message);
  if (o.station || o.by) return `Counted again later (${[str(o.station ?? o.by), str(o.on ?? o.day)].filter(Boolean).join(', ')}). Not adjusted from this record.`;
  return SUPERSEDED_TEXT;
}

function readReview(x: unknown): WeeklyReview {
  const v = obj(x);
  const lines = list(v.lines).map((l): WeeklyReviewLine => {
    const o = obj(l);
    const counted = num(o.counted) ?? 0;
    const book = num(o.book) ?? 0;
    return {
      lineId:        str(o.lineId ?? o.id),
      rawMaterialId: str(o.rawMaterialId),
      name:          str(o.name),
      unit:          str(o.unit),
      counted,
      book,
      difference:    num(o.difference) ?? Math.round((counted - book) * 1000) / 1000,
      words:         str(o.words) || `${str(o.name)}: counted ${counted} ${str(o.unit)}`,
      inPacks:       strOrNull(o.inPacks),
      countedBy:     strOrNull(o.countedBy),
      countedAt:     strOrNull(o.countedAt),
      detail:        strOrNull(o.detail),
      alsoOpenIn:    names(o.alsoOpenIn),
      superseded:    readSuperseded(o.superseded),
    };
  });
  const s = obj(v.summary);
  const differ = lines.filter((l) => Math.abs(l.difference) >= 0.001);
  return {
    id:          str(v.id),
    countNumber: str(v.countNumber),
    status:      str(v.status) || 'OPEN',
    statusLine:  strOrNull(v.statusLine),
    branch:      { id: str(obj(v.branch).id), name: str(obj(v.branch).name) },
    startedOn:   str(v.startedOn),
    stations:    list(v.stations).map((st) => {
      const o = obj(st);
      return {
        id: str(o.id), name: str(o.name), sentAt: strOrNull(o.sentAt), countedBy: strOrNull(o.countedBy),
        counted: num(o.counted) ?? 0, total: num(o.total) ?? 0, notCounted: names(o.notCounted),
      };
    }),
    lines,
    summary: {
      lines:  num(s.lines) ?? lines.length,
      differ: num(s.differ) ?? differ.length,
      short:  num(s.short) ?? differ.filter((l) => l.difference < 0).length,
      over:   num(s.over) ?? differ.filter((l) => l.difference > 0).length,
    },
    recountAsked: list(v.recountAsked).map((r) => (typeof r === 'string' ? r : str(obj(r).rawMaterialId))).filter(Boolean),
    notes:        strOrNull(v.notes),
    postedAt:     strOrNull(v.postedAt),
    postedBy:     strOrNull(v.postedBy),
  };
}

export const weeklyReviewKey = (id: string) => ['weekly-count', id] as const;

export const getWeeklyReview = (id: string): Promise<WeeklyReview> =>
  api.get(`/procure/weekly-counts/${id}`).then((r) => readReview(r.data));

// ─── Owner: POST procure/weekly-counts/:id/recount ───────────────────────────

/** Body: { rawMaterialIds (1..40), note? }. Marks the items on the record; no line is ever deleted. */
export const askWeeklyRecount = (id: string, body: { rawMaterialIds: string[]; note?: string }): Promise<WeeklyReview> =>
  api.post(`/procure/weekly-counts/${id}/recount`, body).then((r) => readReview(r.data));

// ─── Owner: POST procure/weekly-counts/:id/adjust ────────────────────────────

export interface AdjustResult extends WeeklyReview {
  /** Lines that moved stock. */
  adjusted: number;
  /** Items left alone because they were counted again later. */
  skipped: string[];
  /** Items with no cost on file: the shelf moved, the books could not. */
  warnings: string[];
}

/** Body: { isOpeningBalance }. "Adjust the books to match": stock moves by the recorded difference, on top of live stock. */
export const adjustWeeklyCount = (id: string, body: { isOpeningBalance: boolean }): Promise<AdjustResult> =>
  api.post(`/procure/weekly-counts/${id}/adjust`, body).then((r) => {
    const d = obj(r.data);
    return { ...readReview(d), adjusted: num(d.adjusted) ?? 0, skipped: names(d.skipped), warnings: list(d.warnings).map(str) };
  });

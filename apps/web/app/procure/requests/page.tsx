'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Send, ShoppingCart, PackageCheck, Loader2, Trash2, Sparkles, Check, AlertTriangle, Paperclip,
  Camera, Copy, Truck, Sparkle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';

/**
 * The whole of Procure on one screen.
 *
 * A request moves OPEN -> SENT -> BOUGHT -> RECEIVED, and each state needs a
 * different thing from a different person, so the screen shows only that.
 * Nobody navigates; the request tells you what it wants next.
 *
 * Two people, two halves. Whoever is holding the bag RECORDS what came: tick
 * it, check the packs and price that were filled in from last time, add a
 * photo of the paper. The owner or manager POSTS it: which pocket the money
 * came from, which day, and it is in stock and in the books.
 */

type Status = 'OPEN' | 'SENT' | 'BOUGHT' | 'RECEIVED' | 'CANCELLED';
type Pocket = 'CASH' | 'OWNER_FUNDED' | 'BANK';
type Outcome = 'STILL_COMING' | 'REFUNDED' | 'LOST' | 'NOT_COMING';
type PhotoLabel = 'Receipt' | 'Order' | 'Delivery receipt' | 'Sales invoice';
type ChargeKind = 'FREIGHT' | 'TRANSPORT' | 'OTHER';

interface LastPack { packSize: number; packCost: number | null; brandNote: string | null; receivedAt: string | null }
interface Line {
  id: string;
  lineNumber: string;
  rawMaterialId: string;
  qtyRequested: string | number;
  shortBy: string | number | null;
  packsBought: string | number | null;
  packSize: string | number | null;
  packCost: string | number | null;
  brandNote: string | null;
  receivedAt: string | null;
  rawMaterial: { id: string; name: string; unit: string; costPrice: string | number | null };
  /** What this ingredient held and cost the last time it was received. */
  lastPack?: LastPack | null;
  /** What Clerque says is on the shelf at this branch, in the ingredient's unit. */
  onHand?: number;
  /** What somebody counted while building the list, waiting for the owner to post it. */
  counted?: { qty: number; expected: number; countId: string; countNumber: string } | null;
}
interface PackMemory { rawMaterialId: string; packSize: number; packCost: number | null; brandNote: string | null }

/**
 * How a quantity is asked for. Staff count in containers -- "2 bottles",
 * "10 boxes" -- so when Clerque remembers the pack it asks in packs; a
 * gram- or millilitre-counted ingredient can also be asked in kilos or
 * litres. The line always holds the ingredient's own unit.
 */
type AskMode = 'packs' | 'unit' | 'big';
const toBase = (n: number, mode: AskMode, packSize: number | null | undefined) =>
  mode === 'packs' && packSize ? n * packSize : mode === 'big' ? n * 1000 : n;
/** A quantity as whole-ish packs, or null when it does not divide cleanly. */
const inPacks = (qty: number, packSize?: number | null): number | null => {
  if (!packSize || packSize <= 0) return null;
  const p = Math.round((qty / packSize) * 100) / 100;
  return Math.abs(p * packSize - qty) < 1e-6 ? p : null;
};
interface Request {
  id: string;
  requestNumber: string;
  status: Status;
  lines: Line[];
  branch?: { id: string; name: string } | null;
  sentAt?: string | null;
  boughtAt?: string | null;
  notes?: string | null;
  /**
   * Set by the server when this viewer may not see what the delivery cost.
   * The costs are already stripped from the lines by then — this only tells
   * the screen to drop the money furniture instead of rendering empty boxes.
   */
  costsHidden?: boolean;
}
interface Ingredient { id: string; name: string; unit: string }
interface Charge { description: string; amount: string; category: ChargeKind }

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const peso = formatPeso;

const STEPS: Array<{ key: Status; label: string }> = [
  { key: 'OPEN',     label: 'Building' },
  { key: 'SENT',     label: 'Sent' },
  { key: 'BOUGHT',   label: 'Bought' },
  { key: 'RECEIVED', label: 'In stock' },
];

/*
  The request's notes carry tags the server writes ([ONTHEWAY:date],
  [BALANCEOF:REQ-...]) in front of the person's own line. Read apart here the
  same way the server writes them.
*/
const TAG = /\[([A-Z]+):([^\]]*)\]/g;
const readTag = (notes: string | null | undefined, name: string): string | null => {
  for (const m of (notes ?? '').matchAll(TAG)) if (m[1] === name) return m[2];
  return null;
};
const plainNotes = (notes: string | null | undefined) => (notes ?? '').replace(TAG, '').replace(/\s{2,}/g, ' ').trim();
const onTheWay = (r: Request) => readTag(r.notes, 'ONTHEWAY');

const manilaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** The bigger unit a pack is usually sold in, for a gram- or millilitre-counted ingredient. */
const BIG_UNIT: Record<string, string> = { g: 'kg', ml: 'L' };

const POCKETS: Array<{ v: Pocket; label: string; sub: string }> = [
  { v: 'OWNER_FUNDED', label: 'Owner paid',        sub: 'Out of their own pocket' },
  { v: 'CASH',         label: 'From the till',     sub: 'Cash taken from the drawer' },
  { v: 'BANK',         label: 'Shop bank / GCash', sub: 'The business account' },
];
const pocketLabel = (p: string | null | undefined) => POCKETS.find((x) => x.v === p)?.label ?? p ?? '';

/** Shipping, a platform fee, parking: charges that are not stock. */
function ChargeRows({ rows, onChange, first }: { rows: Charge[]; onChange: (rows: Charge[]) => void; first: string }) {
  const inputCls = 'mt-0.5 w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]';
  return (
    <div className="mt-3">
      {rows.map((c, i) => (
        <div key={i} className="mb-1.5 grid grid-cols-[1fr_5.5rem_7.5rem_auto] items-end gap-1.5">
          <label className="text-[11px] text-muted-foreground">
            {i === 0 ? first : ''}
            <input value={c.description} placeholder="Shipping fee"
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
              className={inputCls} />
          </label>
          <label className="text-[11px] text-muted-foreground">
            {i === 0 ? 'Amount' : ''}
            <input inputMode="decimal" value={c.amount} placeholder="0"
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
              className={inputCls} />
          </label>
          <label className="text-[11px] text-muted-foreground">
            {i === 0 ? 'Kind' : ''}
            <select value={c.category}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, category: e.target.value as ChargeKind } : x)))}
              className="mt-0.5 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              <option value="FREIGHT">Shipping / freight</option>
              <option value="TRANSPORT">Transport, parking</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <button type="button" aria-label="Remove this charge"
            onClick={() => onChange(rows.filter((_x, j) => j !== i))}
            className="mb-1 rounded p-1 text-red-600 hover:bg-red-500/10">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { description: '', amount: '', category: 'FREIGHT' }])}
        className="text-[11px] text-[var(--accent)] hover:underline"
      >
        + Shipping, delivery fee or another charge
      </button>
    </div>
  );
}
const chargeRows = (rows: Charge[]) => rows
  .filter((c) => c.description.trim() && parseFloat(c.amount) > 0)
  .map((c) => ({ description: c.description.trim(), amount: parseFloat(c.amount), category: c.category }));
const OUTCOMES: Array<{ v: Outcome; label: string }> = [
  { v: 'STILL_COMING', label: 'Still coming' },
  { v: 'REFUNDED',     label: 'Refunded' },
  { v: 'LOST',         label: 'Lost — expense it' },
  { v: 'NOT_COMING',   label: 'Not coming' },
];
const PHOTO_LABELS: PhotoLabel[] = ['Receipt', 'Order', 'Delivery receipt', 'Sales invoice'];

/** A phone photo, made small enough to file: longest side 1600 px, JPEG. */
async function shrink(file: File): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that photo.'));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not read that photo.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ProcurePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? undefined;

  const [picking, setPicking]   = useState(false);
  const [search, setSearch]     = useState('');
  /*
    Picking an ingredient and saying how much are two different questions, and
    the second one used to be answered by the code: every tap posted
    qtyRequested: 1, which nothing on screen showed. The owner got a buy list
    reading "Biscoff Topping" with no amount, and the database read one GRAM.
    So the tap now selects, and the amount is asked for -- once, in the
    ingredient's own unit, with the field already focused.
  */
  const [pending, setPending]   = useState<Ingredient | null>(null);
  const [qty, setQty]           = useState('');
  const [editing, setEditing]   = useState<string | null>(null);
  const [editQty, setEditQty]   = useState('');
  const [askMode, setAskMode]   = useState<AskMode>('unit');
  const [editMode, setEditMode] = useState<AskMode>('unit');
  /** Per line: "remaining" as typed, and in which mode. */
  const [remaining, setRemaining] = useState<Record<string, string>>({});
  const [remainMode, setRemainMode] = useState<Record<string, AskMode>>({});
  /*
    Who actually paid. The three answers post to DIFFERENT accounts: the till
    credits 1010 Cash on Hand, the owner's own money credits 3010 Owner's
    Capital, the shop's bank or GCash credits 1020 Cash in Bank. Asked, not
    assumed -- a delivery booked against the wrong pocket is a till that
    reads short tonight or a bank balance nobody can reconcile.
  */
  const [paidBy, setPaidBy] = useState<Pocket>('OWNER_FUNDED');
  const [receivedAt, setReceivedAt] = useState(manilaToday());
  const [note, setNote] = useState('');
  const [charges, setCharges] = useState<Charge[]>([]);
  const [acceptCost, setAcceptCost] = useState(false);

  /*
    Sending and posting to stock are owner/manager actions at the API.
    Recording what was bought is open to whoever is holding the bag -- when
    the shop shows purchase costs to its staff. The server strips the costs
    and sets costsHidden when it does not, so that one flag answers both
    "may I see the price" and "may I type it".
  */
  const canDecide = !!user && ['BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN', 'MDM'].includes(user.role);
  const [bought, setBought]     = useState<Record<string, { packs: string; size: string; cost: string; brand: string; source?: 'line' | 'last' | 'none' }>>({});
  /** Per line: it is here. Doubles as "post this line now" once the request is bought. */
  const [ticked, setTicked]     = useState<Record<string, boolean>>({});
  /** Per line: the pack count is typed in the bigger unit (kg for a gram-counted ingredient). */
  const [sizeBig, setSizeBig]   = useState<Record<string, boolean>>({});
  /** Per line: how many packs actually came, when fewer than were bought. */
  const [arrived, setArrived]   = useState<Record<string, string>>({});
  const [outcome, setOutcome]   = useState<Record<string, Outcome>>({});
  const [boughtNote, setBoughtNote] = useState('');
  const [boughtDate, setBoughtDate] = useState('');
  const [ordered, setOrdered]   = useState(false);
  /** Paid on order day, from this pocket -- the money leaves now and waits for the goods. */
  const [paidFrom, setPaidFrom] = useState<Pocket | ''>('');
  const [orderCharges, setOrderCharges] = useState<Charge[]>([]);
  const [photoLabel, setPhotoLabel] = useState<PhotoLabel>('Receipt');
  const fileInput = useRef<HTMLInputElement | null>(null);

  /*
    Which request this screen is showing.

    It used to be whatever POST /procure/requests/open returned -- and that
    endpoint CREATES an open request when the branch has none. So the moment
    you sent a list, there was no OPEN request any more, the next fetch made a
    brand new empty one, and the request you had just sent disappeared from the
    app entirely. Everything after SENT -- recording what was bought, posting
    it to stock -- was unreachable. Procure could ask for things and never
    receive them.

    So: fetch the branch's requests and show the one that needs a person next.
    A delivery waiting to be posted outranks shopping waiting to be recorded,
    which outranks a list still being built -- except an order that is still
    on the way, which would otherwise sit in front of today's list for days.
    Only when nothing is outstanding do we open a fresh one.
  */
  const [viewing, setViewing] = useState<string | null>(null);

  const { data: all = [], isLoading: listLoading, isError, error, refetch, isFetching } =
    useQuery<Request[]>({
      queryKey: ['procure-requests', branchId],
      queryFn:  () => api.get('/procure/requests', { params: { branchId } }).then((r) => r.data),
      enabled:  !!user,
    });

  /*
    ?view=REQ-20260902-001 -- the books link here from a stock receipt's
    reference. Honoured once, when the list first has the request, so a
    refetch later does not yank the person back to it.
  */
  const viewParamHandled = useRef(false);
  useEffect(() => {
    if (viewParamHandled.current || all.length === 0 || typeof window === 'undefined') return;
    const wanted = new URLSearchParams(window.location.search).get('view');
    if (!wanted) { viewParamHandled.current = true; return; }
    const hit = all.find((r) => r.requestNumber === wanted);
    viewParamHandled.current = true;
    if (hit) setViewing(hit.id);
    else toast.error(`${wanted} is not in this branch's list.`);
  }, [all]);

  const live = all.filter((r) => r.status !== 'RECEIVED' && r.status !== 'CANCELLED');
  const byNeed =
    live.find((r) => r.status === 'BOUGHT' && !onTheWay(r)) ??
    live.find((r) => r.status === 'SENT') ??
    live.find((r) => r.status === 'OPEN') ??
    live.find((r) => r.status === 'BOUGHT') ??
    null;

  // Nothing outstanding at all -- open one so the branch always has somewhere
  // to put the next shortage. Runs only when the list came back empty-handed.
  const { data: opened, isLoading: openLoading } = useQuery<Request>({
    queryKey: ['procure-open', branchId],
    queryFn:  () => api.post('/procure/requests/open', { branchId }).then((r) => r.data),
    enabled:  !!user && !listLoading && !isError && byNeed === null,
  });

  const req = (viewing ? all.find((r) => r.id === viewing) : null) ?? byNeed ?? opened;
  const isLoading = listLoading || (byNeed === null && openLoading);

  /*
    The paper behind a request: the receipt, the order screen, the delivery
    slip. Filed as Documents against the request, so the number, the lines
    and the paper they came from live together.
  */
  const { data: receiptDocs = [] } = useQuery<Array<{ id: string; filename: string; label: string | null }>>({
    queryKey: ['request-docs', req?.id],
    queryFn:  () => api.get('/documents', { params: { entityType: 'PurchaseRequest', entityId: req!.id } }).then((r) => r.data),
    enabled:  !!req?.id && !req.costsHidden,   // a photo of the receipt is a photo of the prices
    staleTime: 60_000,
  });
  const openDoc = async (id: string, filename: string) => {
    try {
      const res = await api.get(`/documents/${id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { toast.error(`Could not open ${filename}.`); }
  };

  const { data: ingredients = [], isLoading: ingLoading } = useQuery<Ingredient[]>({
    queryKey: ['raw-materials-procure'],
    queryFn:  () => api.get('/inventory/raw-materials').then((r) => r.data),
    enabled:  picking,
    staleTime: 300_000,
  });
  // What one pack of each ingredient held last time -- for the picker, which
  // asks before a line exists.
  const { data: packMemory = [] } = useQuery<PackMemory[]>({
    queryKey: ['procure-pack-memory'],
    queryFn:  () => api.get('/procure/requests/pack-memory').then((r) => r.data),
    enabled:  !!user,
    staleTime: 120_000,
  });
  const memoryOf = (rawMaterialId: string): PackMemory | undefined => packMemory.find((m) => m.rawMaterialId === rawMaterialId);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['procure-requests'] });
    qc.invalidateQueries({ queryKey: ['procure-open'] });
  };
  const fail = (e: unknown, fallback: string) =>
    toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback);

  const pull = useMutation({
    mutationFn: () => api.post('/procure/requests/pull-low-stock', { branchId }).then((r) => r.data),
    onSuccess: (d: { added: number; unmonitored?: number; toMake?: Array<{ name: string }> }) => {
      refresh();
      // An ingredient with no reorder level can never appear on this list, so
      // "nothing is below its reorder level" was being said in two very
      // different situations: everything is stocked, and nobody is watching.
      // Say which one it is.
      const blind = d.unmonitored ?? 0;
      const blindNote = blind > 0
        ? ` ${blind} ingredient${blind === 1 ? ' has' : 's have'} no reorder level, so ${blind === 1 ? 'it' : 'they'} can never show up here.`
        : '';
      if (d.added) {
        toast.success(`Added ${d.added} item${d.added === 1 ? '' : 's'} that are below their reorder level.${blindNote}`);
      } else if (blind > 0) {
        toast.warning(`Nothing is below its reorder level.${blindNote}`);
      } else {
        toast.success('Nothing is below its reorder level right now.');
      }

      /*
        Things that are short but cannot be BOUGHT.

        A prepared item -- a syrup, a sauce, a thawed tub -- used to land on
        this list next to the milk, sending someone to a supplier for something
        the shop's own bar produces. It is filtered out now, and silently
        dropping it would be its own bug: the shortage is real, only the remedy
        is different. Said out loud, with somewhere to go.
      */
      const make = d.toMake ?? [];
      if (make.length) {
        toast.warning(
          `${make.map((m) => m.name).slice(0, 3).join(', ')}` +
          (make.length > 3 ? ` and ${make.length - 3} more` : '') +
          ' need making, not buying.',
          {
            duration: 8000,
            action: { label: 'Open prep', onClick: () => router.push('/procure/batches') },
          },
        );
      }
    },
    onError: (e) => fail(e, 'Could not check stock levels.'),
  });

  // Posting an ingredient that is already on the list SETS its quantity rather
  // than adding a second line, so this one mutation serves both "add" and
  // "change how much".
  const addLine = useMutation({
    mutationFn: (v: { rawMaterialId: string; qtyRequested: number }) =>
      api.post(`/procure/requests/${req!.id}/lines`, v),
    onSuccess: (_d, v) => {
      refresh();
      // The picker stays open on purpose: a stock check finds several things
      // at once, and reopening it between each one is the difference between
      // a shortage round taking four taps and taking twelve. The item drops
      // out of the grid as soon as it lands, so the list is its own receipt.
      const name = ingredients.find((i) => i.id === v.rawMaterialId)?.name;
      if (name) toast.success(`${name} added.`);
      setSearch(''); setPending(null); setQty('');
      setEditing(null); setEditQty('');
    },
    onError: (e) => fail(e, 'Could not add that item.'),
  });

  /*
    "Remaining: 1 bottle" -- what is left on the shelf, said while building
    the list. It lands on a cycle count for the branch; the owner posts it
    from the counts screen, and only then does stock move.
  */
  const countLine = useMutation({
    mutationFn: (v: { lineId: string; countedQty: number }) =>
      api.post(`/procure/requests/${req!.id}/lines/${v.lineId}/count`, { countedQty: v.countedQty }).then((r) => r.data),
    onSuccess: (d: { name: string; unit: string; countedQty: number; expectedQty: number; countNumber: string }) => {
      refresh();
      const diff = d.countedQty - d.expectedQty;
      toast.success(
        `${d.name}: counted ${d.countedQty.toLocaleString()} ${d.unit}`
        + (Math.abs(diff) > 1e-6 ? ` (Clerque had ${d.expectedQty.toLocaleString()} ${d.unit})` : ' — same as Clerque')
        + `. On count ${d.countNumber}, for the owner to post.`,
        { duration: 7000 },
      );
    },
    onError: (e) => fail(e, 'Could not record the count.'),
  });

  const removeLine = useMutation({
    mutationFn: (lineId: string) => api.delete(`/procure/requests/${req!.id}/lines/${lineId}`),
    onSuccess: refresh,
    onError: (e) => fail(e, 'Could not remove that line.'),
  });

  const send = useMutation({
    mutationFn: () => api.post(`/procure/requests/${req!.id}/send`).then((r) => r.data),
    onSuccess: (d: { empty: boolean }) => {
      refresh();
      toast.success(d.empty
        ? 'Sent — nothing hit the warning level today.'
        : 'Sent to the owners.');
    },
    onError: (e) => fail(e, 'Could not send the request.'),
  });

  /*
    What the boxes show for a line, in priority: what is stored on the line,
    else what this ingredient held and cost LAST time (packs worked out from
    what was asked for), else blank. The source is shown beside the boxes so
    a one-off 5 kg sack is visible before it becomes next time's default.
  */
  const defaultsFor = (l: Line) => {
    if (l.packsBought != null) {
      return {
        packs: String(num(l.packsBought)),
        size:  l.packSize != null ? String(num(l.packSize)) : '',
        cost:  l.packCost != null ? String(num(l.packCost)) : '',
        brand: l.brandNote ?? '',
        source: 'line' as const,
      };
    }
    const lp = l.lastPack;
    if (lp && lp.packSize > 0) {
      return {
        packs: String(Math.max(1, Math.ceil(num(l.qtyRequested) / lp.packSize))),
        size:  String(lp.packSize),
        cost:  lp.packCost != null ? String(lp.packCost) : '',
        brand: lp.brandNote ?? '',
        source: 'last' as const,
      };
    }
    return { packs: '', size: '', cost: '', brand: '', source: 'none' as const };
  };
  const valuesFor = (l: Line) => bought[l.id] ?? defaultsFor(l);
  const isTicked  = (l: Line) => ticked[l.id] ?? (l.packsBought != null);

  const saveBought = useMutation({
    mutationFn: () => {
      if (!req) throw new Error('No request.');
      const rows = req.lines
        .filter((l) => !l.receivedAt && isTicked(l))
        // Staff get one go at a line; a filled line is the deciders' to change.
        .filter((l) => canDecide || l.packsBought == null)
        .map((l) => {
          const b = valuesFor(l);
          return {
            lineId: l.id, name: l.rawMaterial.name,
            packsBought: parseFloat(b.packs), packSize: parseFloat(b.size), packCost: parseFloat(b.cost),
            brandNote: b.brand.trim() || undefined,
          };
        });
      const half = rows.find((r) => !(r.packsBought > 0) || !(r.packSize > 0) || !(r.packCost > 0));
      if (half) throw new Error(`${half.name}: fill in packs, what one holds, and the price.`);
      if (rows.length === 0) throw new Error('Tick what you bought first.');
      return api.post(`/procure/requests/${req.id}/bought`, {
        lines: rows.map(({ name: _n, ...r }) => r),
        ...(boughtNote.trim() ? { note: boughtNote.trim() } : {}),
        ...(boughtDate ? { boughtAt: boughtDate } : {}),
        ...(ordered ? { onTheWay: true } : {}),
        ...(ordered && paidFrom ? { paidFrom, charges: chargeRows(orderCharges) } : {}),
      }).then((r) => r.data as { paidAhead?: { pocket: Pocket; total: number; posted: number; entries: Array<{ error?: string }> } });
    },
    onSuccess: (d) => {
      refresh(); setBoughtNote(''); setBoughtDate(''); setOrdered(false); setPaidFrom(''); setOrderCharges([]);
      if (d?.paidAhead) {
        const bad = d.paidAhead.entries.find((e) => e.error);
        toast.success(`Recorded. ${peso(Math.abs(d.paidAhead.posted))} ${d.paidAhead.posted < 0 ? 'refunded to' : 'paid ahead from'} ${pocketLabel(d.paidAhead.pocket)}. Nothing more to pay when it arrives.`, { duration: 8000 });
        if (bad) toast.warning(bad.error as string, { duration: 10000 });
      } else {
        toast.success(ordered ? 'Recorded — marked as on the way.' : 'Shopping recorded.');
      }
    },
    onError: (e) => {
      if (e instanceof Error && !('response' in e)) { toast.error(e.message); return; }
      fail(e, 'Could not save what was bought.');
    },
  });

  interface ReceiveResult {
    posted: Array<{ name: string; warning?: string | null }>;
    skipped: unknown[];
    failed: Array<{ name: string; reason: string }>;
    carried: Array<{ name: string; to: string; alreadyThere: boolean }>;
    followUp: { requestNumber: string; lines: number } | null;
    charges: Array<{ description: string; entryNumber?: string; error?: string }>;
    short: Array<{ name: string; packsBought: number; packsArrived: number; outcome: Outcome }>;
  }
  const receive = useMutation({
    mutationFn: (closeRest: boolean) => {
      if (!req) throw new Error('No request.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) throw new Error('Pick the day the goods came.');
      const lines = req.lines
        .filter((l) => !l.receivedAt && l.packsBought != null && isTicked(l))
        .map((l) => {
          const packs = num(l.packsBought);
          const a = arrived[l.id];
          const came = a != null && a !== '' ? parseFloat(a) : NaN;
          const packsArrived = Number.isFinite(came) && came < packs ? came : undefined;
          return { lineId: l.id, ...(packsArrived != null ? { packsArrived } : {}) };
        });
      if (lines.length === 0 && !closeRest) throw new Error('Tick what arrived first.');
      const closeShort = lines
        .filter((x) => x.packsArrived != null && (outcome[x.lineId] ?? 'STILL_COMING') !== 'STILL_COMING')
        .map((x) => ({ lineId: x.lineId, outcome: outcome[x.lineId] }));
      const chargeRowsNow = chargeRows(charges);
      return api.post(`/procure/requests/${req.id}/receive`, {
        paymentMethod: paidBy,
        ...(acceptCost ? { acceptCostChange: true } : {}),
        receivedAt,
        ...(note.trim() ? { note: note.trim() } : {}),
        lines,
        ...(closeShort.length ? { closeShort } : {}),
        ...(chargeRowsNow.length ? { charges: chargeRowsNow } : {}),
        ...(closeRest ? { closeRest: true } : {}),
      }).then((r) => r.data as ReceiveResult);
    },
    onSuccess: (d) => {
      refresh();
      setCharges([]); setArrived({}); setOutcome({}); setNote(''); setAcceptCost(false);
      const bits: string[] = [];
      if (d.posted.length) bits.push(`${d.posted.length} item${d.posted.length === 1 ? '' : 's'} added to stock`);
      if (d.carried?.length) bits.push(`${d.carried.map((c) => c.name).join(', ')} back on the list`);
      if (d.followUp) bits.push(`${d.followUp.requestNumber} holds what is still coming`);
      if (d.failed.length) {
        toast.warning(`${d.posted.length} posted, ${d.failed.length} could not: ${d.failed[0].reason}`, { duration: 10000 });
      } else {
        toast.success(bits.join(' · ') || 'Nothing to post.', { duration: 8000 });
      }
      const chargeError = (d.charges ?? []).find((c) => c.error);
      if (chargeError) toast.warning(`${chargeError.description}: ${chargeError.error}`, { duration: 10000 });
      // Stock that moved without reaching the books. Said now, not found later.
      const unvalued = d.posted.filter((p) => p.warning);
      if (unvalued.length) toast.warning(unvalued[0].warning as string, { duration: 10000 });
    },
    onError: (e) => {
      if (e instanceof Error && !('response' in e)) { toast.error(e.message); return; }
      fail(e, 'Could not post to stock.');
    },
  });

  const attachPhoto = useMutation({
    mutationFn: async (file: File) => {
      const { base64, mediaType } = await shrink(file);
      return api.post(`/procure/requests/${req!.id}/photo`, { imageBase64: base64, mediaType, label: photoLabel }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['request-docs', req?.id] });
      toast.success(`${photoLabel} filed with ${req?.requestNumber}.`);
    },
    onError: (e) => {
      if (e instanceof Error && !('response' in e)) { toast.error(e.message); return; }
      fail(e, 'Could not file the photo.');
    },
  });

  /*
    A list started by mistake, or shopping that never happened, had no way
    out: the request sat OPEN or SENT for good, and because the page always
    opens the oldest live request, it sat in everyone's way. The server
    refuses to cancel a RECEIVED request (its stock is on the shelf).
  */
  const cancelReq = useMutation({
    mutationFn: () => api.post(`/procure/requests/${req!.id}/cancel`).then((r) => r.data),
    onSuccess: () => { setViewing(null); refresh(); toast.success('Request cancelled.'); },
    onError: (e) => fail(e, 'Could not cancel this request.'),
  });

  /** "2 packs · 1,500 ml" when the pack is known and it divides; else the plain amount. */
  const packsLabel = (l: Line) => {
    const qty = num(l.qtyRequested);
    const packs = inPacks(qty, l.lastPack?.packSize);
    return packs != null
      ? `${packs.toLocaleString()} pack${packs === 1 ? '' : 's'} · ${qty.toLocaleString()} ${l.rawMaterial.unit}`
      : `${qty.toLocaleString()} ${l.rawMaterial.unit}`;
  };
  const shelfLabel = (qty: number, l: Line) => {
    const packs = inPacks(qty, l.lastPack?.packSize);
    return packs != null && packs > 0
      ? `${packs.toLocaleString()} pack${packs === 1 ? '' : 's'} (${qty.toLocaleString()} ${l.rawMaterial.unit})`
      : `${qty.toLocaleString()} ${l.rawMaterial.unit}`;
  };

  /* The list as a message, for an order placed over Viber or Messenger. */
  const copyList = async () => {
    if (!req) return;
    const text = [
      `${req.requestNumber}${req.branch?.name ? ` — ${req.branch.name}` : ''}`,
      ...req.lines.map((l) =>
        `• ${l.rawMaterial.name} — ${packsLabel(l)}`
        + (l.counted ? ` · left: ${shelfLabel(l.counted.qty, l)}` : '')),
    ].join('\n');
    // On a phone the share sheet opens Messenger or Viber directly; elsewhere, the clipboard.
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try { await navigator.share({ title: req.requestNumber, text }); return; }
      catch (err) { if ((err as { name?: string })?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast.success('Copied. Paste it into Viber or Messenger.'); }
    catch { toast.error('Could not copy the list.'); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  /*
    A failed load used to fall through the same `isLoading || !req` branch as a
    pending one, so a dead API, a closed period or a 403 all rendered a spinner
    that never stopped. Someone standing at the bar has no way to tell "still
    loading" from "this is never going to work", and no way to try again short
    of reloading the tab.
  */
  if (isError || !req) {
    const message =
      (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message ??
      'Could not load the request. Check the connection and try again.';
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <AlertTriangle className="mx-auto h-5 w-5 text-amber-500" />
        <h2 className="mt-2 text-sm font-semibold">Could not open the buy list</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="mt-4 inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted disabled:opacity-50"
        >
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Try again
        </button>
      </div>
    );
  }

  // Whoever is holding the bag may record what came, unless the shop hides
  // prices from them -- in which case the server has already blanked them.
  const canRecord = canDecide || (!!user && !req.costsHidden);
  const recording = canRecord && (req.status === 'SENT' || req.status === 'BOUGHT');
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === req.status));
  const alreadyIn = new Set(req.lines.map((l) => l.rawMaterialId));
  // Everything not already on the request, alphabetical, filtered only if the
  // person chose to narrow it. No arbitrary cap -- a hidden ingredient is one
  // somebody has to hunt for.
  const matches = ingredients
    .filter((i) => !alreadyIn.has(i.id) && i.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const estimate = req.lines.reduce(
    (s, l) => s + num(l.packsBought) * num(l.packCost), 0);
  const orderedOn  = onTheWay(req);
  const balanceOf  = readTag(req.notes, 'BALANCEOF');
  const prepaid    = readTag(req.notes, 'PREPAID') as Pocket | null;
  const advance    = Number(readTag(req.notes, 'ADV') ?? 0) || 0;
  const humanNotes = plainNotes(req.notes);
  const unposted   = req.lines.filter((l) => !l.receivedAt);
  const postable   = unposted.filter((l) => l.packsBought != null);
  const tickedNow  = postable.filter((l) => isTicked(l));
  const inputCls   = 'mt-0.5 w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]';

  return (
    <div className="space-y-5">
      {/* where this request is up to */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold">{req.requestNumber}</div>
            <div className="text-xs text-muted-foreground">
              {req.branch?.name ?? 'This branch'} · {req.lines.length} item{req.lines.length === 1 ? '' : 's'}
            </div>
            {(receiptDocs.length > 0 || (canRecord && req.status !== 'OPEN' && req.status !== 'CANCELLED')) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {receiptDocs.map((d) => (
                  <button key={d.id} type="button" onClick={() => openDoc(d.id, d.filename)}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Paperclip className="h-3 w-3" /> {d.label ?? 'Receipt'}
                  </button>
                ))}
                {canRecord && req.status !== 'OPEN' && req.status !== 'CANCELLED' && (
                  <>
                    <select
                      value={photoLabel}
                      onChange={(e) => setPhotoLabel(e.target.value as PhotoLabel)}
                      aria-label="What the photo is of"
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {PHOTO_LABELS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      disabled={attachPhoto.isPending}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      {attachPhoto.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                      Add photo
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) attachPhoto.mutate(f);
                      }}
                    />
                  </>
                )}
              </div>
            )}
            {humanNotes && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{humanNotes}</p>
            )}
          </div>
          {estimate > 0 && !req.costsHidden && (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Spent</div>
              <div className="font-mono text-lg font-semibold">{peso(estimate)}</div>
            </div>
          )}
        </div>

        <ol className="mt-4 flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex flex-1 items-center gap-1.5">
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= stepIndex ? 'bg-[var(--accent)]' : 'bg-muted'}`} />
              <span className={`hidden text-[11px] sm:inline ${
                i === stepIndex ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {req.status === 'BOUGHT' && (orderedOn || balanceOf) && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--accent)]/10 px-3 py-2 text-xs leading-relaxed">
            <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {balanceOf
                ? <>Balance of <span className="font-mono">{balanceOf}</span> — still coming.</>
                : <>Ordered {orderedOn} — on the way.</>}
              {prepaid && (
                <> {advance > 0 && !req.costsHidden ? `${peso(advance)} paid ahead` : 'Paid ahead'} from {pocketLabel(prepaid)}; nothing more to pay.</>
              )}
              {' '}When it arrives, tick what is in the box and add it to stock.
            </span>
          </p>
        )}
      </div>

      {/*
        Everything else that is still open, plus the last few finished ones.
        Without this the only reachable request is whichever one the rule above
        picked, and a second branch's list -- or yesterday's delivery that was
        never posted -- would have no way back.
      */}
      {all.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {all.slice(0, 8).map((r) => {
            const active = r.id === req.id;
            return (
              <button
                key={r.id}
                onClick={() => setViewing(r.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                  active ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-border hover:bg-muted'
                }`}
              >
                <span className="block font-mono text-[11px]">{r.requestNumber}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {r.status === 'BOUGHT' && onTheWay(r) ? 'On the way' : (STEPS.find((x) => x.key === r.status)?.label ?? r.status.toLowerCase())}
                  {' · '}{r.lines.length} item{r.lines.length === 1 ? '' : 's'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* the list */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">What to buy</h2>
          {req.status === 'OPEN' && (
            <div className="flex gap-2">
              <button
                onClick={() => pull.mutate()}
                disabled={pull.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                {pull.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Check stock
              </button>
              <button
                onClick={() => setPicking((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          )}
          {(req.status === 'SENT' || req.status === 'BOUGHT') && (
            <div className="flex gap-2">
              {req.status === 'SENT' && req.lines.length > 0 && (
                <button
                  type="button"
                  onClick={() => void copyList()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                  title="Copy the list as a message, for an order over Viber or Messenger"
                >
                  <Copy className="h-3.5 w-3.5" /> Send as message
                </button>
              )}
              {canDecide && (
                <button
                  type="button"
                  onClick={() => router.push(`/procure/receipts?request=${req.id}`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                  title="Let the reader fill the lines from a photo of the receipt -- onto this request"
                >
                  <Sparkle className="h-3.5 w-3.5" /> Read the receipt
                </button>
              )}
            </div>
          )}
        </div>

        {picking && req.status === 'OPEN' && (
          <div className="border-b border-border bg-muted/30 p-3">
            {pending ? (
              /*
                Step two. Asked here rather than left to a default, because a
                buy list without amounts sends someone to the market to guess,
                and a default nobody sees is worse than no default at all.
              */
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = parseFloat(qty);
                  if (!(n > 0)) { toast.error('Enter how much is needed.'); return; }
                  addLine.mutate({ rawMaterialId: pending.id, qtyRequested: toBase(n, askMode, memoryOf(pending.id)?.packSize) });
                }}
              >
                <div className="text-sm font-medium">{pending.name}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">How much do you need?</p>
                {(() => {
                  const mem = memoryOf(pending.id);
                  const big = BIG_UNIT[pending.unit];
                  const modes: Array<{ m: AskMode; label: string }> = [
                    ...(mem ? [{ m: 'packs' as const, label: 'packs' }] : []),
                    { m: 'unit', label: pending.unit },
                    ...(big ? [{ m: 'big' as const, label: big }] : []),
                  ];
                  const n = parseFloat(qty);
                  return (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {modes.length > 1 && (
                        <span className="inline-flex overflow-hidden rounded border border-border">
                          {modes.map((o) => (
                            <button key={o.m} type="button" onClick={() => setAskMode(o.m)}
                              className={`px-2 py-0.5 ${askMode === o.m ? 'bg-[var(--accent)] text-white' : 'bg-background'}`}>
                              {o.label}
                            </button>
                          ))}
                        </span>
                      )}
                      {mem && <span>1 pack = {mem.packSize.toLocaleString()} {pending.unit}{mem.brandNote ? ` · ${mem.brandNote}` : ''} (last time)</span>}
                      {n > 0 && askMode !== 'unit' && <span>= {toBase(n, askMode, mem?.packSize).toLocaleString()} {pending.unit}</span>}
                    </div>
                  );
                })()}
                <div className="mt-2 flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      autoFocus
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-lg border border-border py-2.5 pl-3 pr-16 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      {askMode === 'packs' ? 'packs' : askMode === 'big' ? BIG_UNIT[pending.unit] : pending.unit}
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={addLine.isPending}
                    className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  >
                    {addLine.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPending(null); setQty(''); }}
                    className="min-h-[2.75rem] rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
                  >
                    Back
                  </button>
                </div>
              </form>
            ) : (
              <>
                {/*
                  Tap, do not type. A barista adding sugar to the list is
                  standing at the bar with one hand free; making them spell an
                  ingredient they can see on the shelf is the kind of friction
                  that sends people back to messaging the owner. Search stays,
                  but only as a way to shorten a long list -- never as the way in.
                */}
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter…"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                {ingLoading ? (
                  <div className="flex items-center gap-2 px-1 py-6 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading ingredients…
                  </div>
                ) : matches.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                    {search ? 'Nothing matches that.' : 'Everything is already on the list.'}
                  </p>
                ) : (
                  <div className="mt-2 max-h-72 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {matches.map((i) => (
                        <button
                          key={i.id}
                          onClick={() => { setPending(i); setQty(''); setAskMode(memoryOf(i.id) ? 'packs' : 'unit'); }}
                          className="flex min-h-[3.25rem] flex-col justify-center rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:border-[var(--accent)]/60 hover:bg-muted active:scale-[0.98]"
                        >
                          <span className="line-clamp-2 text-xs font-medium leading-tight">{i.name}</span>
                          <span className="mt-0.5 text-[10px] text-muted-foreground">{i.unit}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {req.lines.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing on the list yet. <strong className="font-medium text-foreground">Check stock</strong> pulls
            in anything below its reorder level.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {req.lines.map((l) => {
              const b = valuesFor(l);
              const set = (k: 'packs' | 'size' | 'cost' | 'brand', v: string) =>
                setBought((prev) => ({ ...prev, [l.id]: { ...b, [k]: v } }));
              const lineTotal = (parseFloat(b.packs) || 0) * (parseFloat(b.cost) || 0);
              const big = BIG_UNIT[l.rawMaterial.unit];
              const showBig = !!big && !!sizeBig[l.id];
              // The box shows the size in the chosen unit; the line always holds the base unit.
              const sizeShown = showBig && b.size !== '' ? String(parseFloat(b.size) / 1000) : b.size;
              const setSize = (v: string) => {
                if (!showBig || v === '') { set('size', v); return; }
                const n = parseFloat(v);
                set('size', Number.isFinite(n) ? String(+(n * 1000).toFixed(4)) : v);
              };
              /*
                How much of what was asked for actually came. Read from the
                stored line, never from the form being typed into, so it
                reports the delivery rather than the keystrokes -- and so it
                keeps reporting once the request is closed and the form is
                gone. Null until somebody has recorded a buy against it.
              */
              const came = l.packsBought != null && l.packSize != null
                ? num(l.packsBought) * num(l.packSize)
                : null;
              const short = came != null && came < num(l.qtyRequested);
              const tick = isTicked(l);
              const staffLocked = !canDecide && l.packsBought != null;   // staff had their go
              const arrivedNow = arrived[l.id] ?? '';
              const cameShort = arrivedNow !== '' && parseFloat(arrivedNow) < num(l.packsBought);

              return (
                <li key={l.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      {recording && !l.receivedAt && (
                        <input
                          type="checkbox"
                          checked={tick}
                          disabled={staffLocked}
                          onChange={(e) => setTicked((prev) => ({ ...prev, [l.id]: e.target.checked }))}
                          aria-label={`${l.rawMaterial.name} is here`}
                          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{l.rawMaterial.name}</div>
                        {/*
                          The amount, in the ingredient's own unit, on the line
                          itself. This is the whole content of the request -- an
                          owner reading it in the grocery needs the number more
                          than the control number, so it leads.
                        */}
                        {editing === l.id ? (
                          <form
                            className="mt-1 flex flex-wrap items-center gap-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const n = parseFloat(editQty);
                              if (!(n > 0)) { toast.error('Enter how much is needed.'); return; }
                              addLine.mutate({ rawMaterialId: l.rawMaterialId, qtyRequested: toBase(n, editMode, l.lastPack?.packSize) });
                            }}
                          >
                            <div className="relative w-32">
                              <input
                                autoFocus
                                inputMode="decimal"
                                value={editQty}
                                onChange={(e) => setEditQty(e.target.value)}
                                className="w-full rounded-lg border border-border py-1.5 pl-2.5 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                              />
                              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                                {editMode === 'packs' ? 'packs' : editMode === 'big' ? BIG_UNIT[l.rawMaterial.unit] : l.rawMaterial.unit}
                              </span>
                            </div>
                            {(l.lastPack || BIG_UNIT[l.rawMaterial.unit]) && (
                              <span className="inline-flex overflow-hidden rounded border border-border text-[10px]">
                                {([
                                  ...(l.lastPack ? [{ m: 'packs' as const, label: 'packs' }] : []),
                                  { m: 'unit' as const, label: l.rawMaterial.unit },
                                  ...(BIG_UNIT[l.rawMaterial.unit] ? [{ m: 'big' as const, label: BIG_UNIT[l.rawMaterial.unit] }] : []),
                                ]).map((o) => (
                                  <button key={o.m} type="button" onClick={() => setEditMode(o.m)}
                                    className={`px-1.5 py-0.5 ${editMode === o.m ? 'bg-[var(--accent)] text-white' : 'bg-background'}`}>
                                    {o.label}
                                  </button>
                                ))}
                              </span>
                            )}
                            <button type="submit" disabled={addLine.isPending}
                              className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                              {addLine.isPending ? '…' : 'Save'}
                            </button>
                            <button type="button" onClick={() => { setEditing(null); setEditQty(''); }}
                              className="px-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                              Cancel
                            </button>
                          </form>
                        ) : req.status === 'OPEN' ? (
                          <button
                            onClick={() => {
                              const packs = inPacks(num(l.qtyRequested), l.lastPack?.packSize);
                              setEditing(l.id);
                              setEditMode(packs != null ? 'packs' : 'unit');
                              setEditQty(String(packs ?? num(l.qtyRequested)));
                            }}
                            className="mt-0.5 rounded text-sm font-semibold tabular-nums text-[var(--accent)] hover:underline"
                            aria-label={`Change how much ${l.rawMaterial.name} to buy`}
                          >
                            {packsLabel(l)}
                          </button>
                        ) : (
                          <div className="mt-0.5 text-sm font-semibold tabular-nums">
                            {packsLabel(l)}
                          </div>
                        )}
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {l.lineNumber}
                          {num(l.shortBy) > 0 && (
                            <span className="ml-2 font-sans">
                              short by {num(l.shortBy).toLocaleString()} {l.rawMaterial.unit}
                            </span>
                          )}
                        </div>
                        {/*
                          What is left on the shelf. Clerque's number first; the
                          person's count beside it once they have said one --
                          the "remaining: 7 boxes" every list has always carried.
                        */}
                        {(req.status === 'OPEN' || req.status === 'SENT') && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                            <span>
                              {l.counted
                                ? <>counted <strong className="text-foreground">{shelfLabel(l.counted.qty, l)}</strong>{Math.abs(l.counted.qty - (l.onHand ?? 0)) > 1e-6 ? ` · Clerque says ${shelfLabel(l.onHand ?? 0, l)}` : ' · same as Clerque'}</>
                                : <>on hand: {shelfLabel(l.onHand ?? 0, l)}</>}
                            </span>
                            {canRecord && (
                              <form
                                className="inline-flex items-center gap-1"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const n = parseFloat(remaining[l.id] ?? '');
                                  if (!(n >= 0)) { toast.error('How much is left? Zero is an answer.'); return; }
                                  const mode = remainMode[l.id] ?? (l.lastPack ? 'packs' : 'unit');
                                  countLine.mutate({ lineId: l.id, countedQty: toBase(n, mode, l.lastPack?.packSize) });
                                  setRemaining((prev) => ({ ...prev, [l.id]: '' }));
                                }}
                              >
                                <input
                                  inputMode="decimal"
                                  value={remaining[l.id] ?? ''}
                                  onChange={(e) => setRemaining((prev) => ({ ...prev, [l.id]: e.target.value }))}
                                  placeholder={l.counted ? 'recount' : 'remaining?'}
                                  aria-label={`How much ${l.rawMaterial.name} is left`}
                                  className="w-24 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                                />
                                {l.lastPack ? (
                                  <span className="inline-flex overflow-hidden rounded border border-border">
                                    {(['packs', 'unit'] as const).map((m) => (
                                      <button key={m} type="button" onClick={() => setRemainMode((prev) => ({ ...prev, [l.id]: m }))}
                                        className={`px-1.5 py-0.5 ${(remainMode[l.id] ?? 'packs') === m ? 'bg-[var(--accent)] text-white' : 'bg-background'}`}>
                                        {m === 'packs' ? 'packs' : l.rawMaterial.unit}
                                      </button>
                                    ))}
                                  </span>
                                ) : <span>{l.rawMaterial.unit}</span>}
                                <button type="submit" disabled={countLine.isPending || !(remaining[l.id] ?? '').trim()}
                                  className="rounded border border-border px-1.5 py-0.5 hover:bg-muted disabled:opacity-40">
                                  {countLine.isPending ? '…' : 'count'}
                                </button>
                              </form>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {req.status === 'OPEN' ? (
                      <button
                        onClick={() => removeLine.mutate(l.id)}
                        className="rounded p-1 text-red-600 transition-colors hover:bg-red-500/10"
                        aria-label={`Remove ${l.rawMaterial.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : l.receivedAt ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3 w-3" /> In stock
                      </span>
                    ) : null}
                  </div>

                  {/*
                    What was bought, once the request is out. Shown to whoever
                    may record: the boxes come filled from last time, so on a
                    repeat buy the only typing is a price that moved.
                  */}
                  {recording && !l.receivedAt && (
                    <div className={`mt-2 ${tick ? '' : 'opacity-60'}`}>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <label className="text-[11px] text-muted-foreground">
                          Packs
                          <input inputMode="decimal" value={b.packs} disabled={staffLocked} onChange={(e) => set('packs', e.target.value)} className={inputCls} />
                        </label>
                        <label className="text-[11px] text-muted-foreground">
                          <span className="flex items-center justify-between">
                            <span>One pack holds</span>
                            {big ? (
                              <span className="inline-flex overflow-hidden rounded border border-border text-[10px]">
                                {[l.rawMaterial.unit, big].map((u, i) => (
                                  <button key={u} type="button"
                                    onClick={() => setSizeBig((prev) => ({ ...prev, [l.id]: i === 1 }))}
                                    className={`px-1.5 py-0.5 ${showBig === (i === 1) ? 'bg-[var(--accent)] text-white' : 'bg-background'}`}>
                                    {u}
                                  </button>
                                ))}
                              </span>
                            ) : <span>({l.rawMaterial.unit})</span>}
                          </span>
                          <input inputMode="decimal" value={sizeShown} disabled={staffLocked} onChange={(e) => setSize(e.target.value)} className={inputCls} />
                        </label>
                        <label className="text-[11px] text-muted-foreground">
                          Price per pack
                          <input inputMode="decimal" value={b.cost} disabled={staffLocked} onChange={(e) => set('cost', e.target.value)} className={inputCls} />
                        </label>
                        <label className="text-[11px] text-muted-foreground">
                          Brand (optional)
                          <input value={b.brand} disabled={staffLocked} onChange={(e) => set('brand', e.target.value)}
                            placeholder="Monin" className={inputCls} />
                        </label>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {b.source === 'last' && !bought[l.id] && l.lastPack && (
                          <span>
                            last time: {l.lastPack.packSize.toLocaleString()} {l.rawMaterial.unit}
                            {l.lastPack.packCost != null ? ` at ${peso(l.lastPack.packCost)}` : ''}
                            {l.lastPack.brandNote ? ` · ${l.lastPack.brandNote}` : ''}
                          </span>
                        )}
                        {b.source === 'none' && !bought[l.id] && <span>first time buying this — fill it in once</span>}
                        {staffLocked && <span>recorded — the owner or manager can change it</span>}
                        {lineTotal > 0 && (
                          <span>
                            {b.packs} × {peso(parseFloat(b.cost) || 0)} = <strong className="font-mono text-foreground">{peso(lineTotal)}</strong>
                            {b.size && <> · {(parseFloat(b.packs) || 0) * (parseFloat(b.size) || 0)} {l.rawMaterial.unit} into stock</>}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/*
                    Once bought: how many packs are actually in the box. Only
                    asked when it differs -- a full delivery is a tick and
                    nothing else. Short, and the rest is one of four things.
                  */}
                  {canDecide && req.status === 'BOUGHT' && !l.receivedAt && l.packsBought != null && tick && (
                    <div className="mt-2 flex flex-wrap items-end gap-2 text-[11px] text-muted-foreground">
                      <label>
                        Packs arrived
                        <input
                          inputMode="decimal"
                          value={arrivedNow}
                          placeholder={String(num(l.packsBought))}
                          onChange={(e) => setArrived((prev) => ({ ...prev, [l.id]: e.target.value }))}
                          className="mt-0.5 w-24 rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                        />
                      </label>
                      {cameShort && (
                        <label>
                          The rest is…
                          <select
                            value={outcome[l.id] ?? 'STILL_COMING'}
                            onChange={(e) => setOutcome((prev) => ({ ...prev, [l.id]: e.target.value as Outcome }))}
                            className="mt-0.5 block rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                          >
                            {OUTCOMES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                          </select>
                        </label>
                      )}
                      {cameShort && (
                        <span className="pb-2">
                          {num(l.packsBought) - parseFloat(arrivedNow)} pack{num(l.packsBought) - parseFloat(arrivedNow) === 1 ? '' : 's'} short
                          {(outcome[l.id] ?? 'STILL_COMING') === 'STILL_COMING' && ' — a follow-up request will hold them'}
                          {outcome[l.id] === 'LOST' && (prepaid ? ' — written off from what was paid ahead' : ' — expensed at the pack price')}
                          {outcome[l.id] === 'REFUNDED' && (prepaid ? ` — money back to ${pocketLabel(prepaid)}` : ' — nothing more posts')}
                          {outcome[l.id] === 'NOT_COMING' && prepaid && ' — written off from what was paid ahead'}
                        </span>
                      )}
                    </div>
                  )}

                  {/*
                    Asked for, against what came — for everyone, at every
                    status, including after the request closes. Both numbers
                    have always been on the line and were simply never
                    subtracted, so the delivered quantity was written to the
                    database and then vanished from the only screen the shop
                    uses. This is the staff's half of Procure: not what it
                    cost, but whether the right amount turned up.
                  */}
                  {came != null && (
                    <p className={`mt-1.5 text-[11px] ${short ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                      Asked for {num(l.qtyRequested).toLocaleString()} {l.rawMaterial.unit}
                      {' · '}{came.toLocaleString()} {l.rawMaterial.unit} {l.receivedAt ? 'in stock' : 'bought'}
                      {short && <> · {(num(l.qtyRequested) - came).toLocaleString()} {l.rawMaterial.unit} short</>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* the recorder's footer: where it came from, and when */}
        {recording && postable.length + unposted.length > 0 && (
          <div className="border-t border-border bg-muted/20 px-4 py-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-[11px] text-muted-foreground sm:col-span-2">
                Where from / order no. (optional)
                <input value={boughtNote} onChange={(e) => setBoughtNote(e.target.value)}
                  placeholder="Aling Nena's stall · Shopee order 2609041234 · DR 4471" className={inputCls} />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Bought or ordered on
                <input type="date" value={boughtDate} onChange={(e) => setBoughtDate(e.target.value)} className={inputCls} />
              </label>
            </div>
            <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={ordered} onChange={(e) => { setOrdered(e.target.checked); if (!e.target.checked) { setPaidFrom(''); setOrderCharges([]); } }} className="mt-0.5 accent-[var(--accent)]" />
              <span>
                <strong className="font-medium text-foreground">Ordered — on the way.</strong>{' '}
                Not here yet. Stock waits for the parcel.
              </span>
            </label>
            {/*
              Money and goods are two events. A Shopee order is paid days
              before the parcel: say which pocket paid, and the books show it
              today -- waiting in "paid ahead" until the goods take it onto
              the shelf. A refund comes back to the same pocket.
            */}
            {ordered && canDecide && !prepaid && (
              <div className="mt-2">
                <p className="text-[11px] text-muted-foreground">Already paid? The money leaves the books today, from:</p>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <button type="button" onClick={() => setPaidFrom('')}
                    className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${paidFrom === '' ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-border hover:bg-muted'}`}>
                    <span className="block font-semibold">Not paid yet</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">Pay when it arrives</span>
                  </button>
                  {POCKETS.map((o) => (
                    <button key={o.v} type="button" onClick={() => setPaidFrom(o.v)}
                      className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${paidFrom === o.v ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-border hover:bg-muted'}`}>
                      <span className="block font-semibold">{o.label}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{o.sub}</span>
                    </button>
                  ))}
                </div>
                {paidFrom && <ChargeRows rows={orderCharges} onChange={setOrderCharges} first="Shipping or fees paid with the order" />}
              </div>
            )}
            {ordered && prepaid && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Already paid ahead from {pocketLabel(prepaid)}. A changed price posts only the difference.
              </p>
            )}
          </div>
        )}
      </div>

      {/* whatever this request wants next */}
      <div className="sticky bottom-4 space-y-2">
        {!canRecord && req.status !== 'RECEIVED' && req.status !== 'CANCELLED' && (
          <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground">
            {req.status === 'OPEN'
              ? 'Keep adding what you need. The owner or manager sends this list when the shift cuts off.'
              : req.status === 'SENT'
                ? 'Sent — waiting for whoever shops to record what they bought.'
                : 'Bought — waiting for the owner or manager to add it to stock.'}
          </p>
        )}
        {canRecord && !canDecide && req.status === 'OPEN' && (
          <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground">
            Keep adding what you need. The owner or manager sends this list when the shift cuts off.
          </p>
        )}
        {req.status === 'OPEN' && canDecide && (
          <button
            onClick={() => send.mutate()}
            disabled={send.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send to the owners
          </button>
        )}
        {recording && (req.status === 'SENT' || !canDecide) && (
          <button
            onClick={() => saveBought.mutate()}
            disabled={saveBought.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saveBought.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            Save what was bought
          </button>
        )}
        {req.status === 'BOUGHT' && canDecide && (
          <div className="rounded-xl border border-border bg-card p-3">
            {prepaid ? (
              <>
                <p className="text-xs font-medium">Paid ahead from {pocketLabel(prepaid)}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  The money left on order day and has been waiting for the goods. Adding them to stock
                  costs nothing more; a fee at the door comes from the same pocket; a pack that did not
                  come is refunded to it or written off.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium">Who paid for this?</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  This decides where the money comes from in the books, so the till and the bank
                  still balance tonight.
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {POCKETS.map((o) => (
                    <button
                      key={o.v}
                      onClick={() => setPaidBy(o.v)}
                      className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        paidBy === o.v
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      <span className="block text-xs font-semibold">{o.label}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{o.sub}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-[11px] text-muted-foreground">
                <span className="flex items-center justify-between">
                  <span>The goods came on</span>
                  {receivedAt === manilaToday() && <span className="rounded-full bg-muted px-1.5 text-[10px]">today</span>}
                </span>
                <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={inputCls} />
              </label>
              <label className="text-[11px] text-muted-foreground sm:col-span-2">
                Note (optional)
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Aling Nena, no receipt · OR 4471" className={inputCls} />
              </label>
            </div>

            {/* charges that came with the goods but are not stock */}
            <ChargeRows rows={charges} onChange={setCharges} first={prepaid ? 'Fees at the door' : 'Other charges'} />
          </div>
        )}
        {req.status === 'BOUGHT' && canDecide && postable.length > 0 && (
          <label className="flex items-start gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={acceptCost} onChange={(e) => setAcceptCost(e.target.checked)} className="mt-0.5" />
            <span>
              <strong className="font-medium text-foreground">The price really changed a lot.</strong>{' '}
              A delivery costed ten times above or below what is on file is refused as a likely typo. Tick this to post it anyway.
            </span>
          </label>
        )}
        {req.status === 'BOUGHT' && canDecide && (
          <div className="flex gap-2">
            <button
              onClick={() => receive.mutate(false)}
              disabled={receive.isPending}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {receive.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              {tickedNow.length === postable.length ? 'Add it all to stock' : `Add ${tickedNow.length} of ${postable.length} to stock`}
            </button>
            <button
              onClick={() => saveBought.mutate()}
              disabled={saveBought.isPending}
              title="Save corrections to packs, size or price without posting"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-medium shadow-lg transition-colors hover:bg-muted disabled:opacity-50"
            >
              {saveBought.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
              Save
            </button>
          </div>
        )}
        {req.status === 'BOUGHT' && canDecide && unposted.length > tickedNow.length && (
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(
                'Close this request?\n\nWhat is ticked is added to stock. Everything else goes back on the shopping list, '
                + 'because it still has to be bought.')) return;
              receive.mutate(true);
            }}
            disabled={receive.isPending}
            className="w-full py-1 text-center text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Close — the rest isn&apos;t coming, put it back on the list
          </button>
        )}
        {req.status === 'RECEIVED' && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            All in stock. The next shortage starts a new request.
          </div>
        )}
        {canDecide && (req.status === 'OPEN' || req.status === 'SENT' || req.status === 'BOUGHT') && (
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(req.status === 'BOUGHT'
                ? 'Cancel this request?\n\nWhat was bought will NOT be added to stock. This cannot be undone.'
                : 'Cancel this request?\n\nIts lines are dropped. The next shortage starts a fresh one.')) return;
              cancelReq.mutate();
            }}
            disabled={cancelReq.isPending}
            className="w-full py-2 text-center text-xs text-muted-foreground hover:text-red-600 disabled:opacity-50"
          >
            {cancelReq.isPending ? 'Cancelling…' : 'Cancel this request'}
          </button>
        )}
      </div>

      {canDecide && (req.status === 'OPEN' || req.status === 'SENT') && req.lines.some((l) => l.counted) && (
        <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          What was counted here sits on count {req.lines.find((l) => l.counted)!.counted!.countNumber}.
          {' '}<a href="/procure/cycle-counts" className="text-[var(--accent)] hover:underline">Post it</a> when you have looked, and stock follows.
        </p>
      )}
      {req.status === 'SENT' && (
        <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Tick only what was actually bought. Anything left goes back on the next list
          when this one is added to stock.
        </p>
      )}
    </div>
  );
}

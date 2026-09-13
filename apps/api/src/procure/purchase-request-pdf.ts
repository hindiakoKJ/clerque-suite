import PDFDocument from 'pdfkit';
import { PH_TIMEZONE } from '@repo/shared-types';

/**
 * The buy list as paper: the PDF the shop drops into the owners' group chat,
 * and the copy Clerque files against the request.
 *
 * Two copies of one request, for two moments:
 *
 *   AS SENT    what the kitchen asked for and what was on the shelf when the
 *              list went out, with blank columns to write in what was bought.
 *              It carries NO money, for anyone. The kitchen roles are handed
 *              this copy even on a shop that hides purchase costs from them,
 *              and that is only safe while it stays price-free.
 *   AS BOOKED  what was bought, at what price, and what became of each line,
 *              once the request is in stock. Money only when the viewer may
 *              see purchase costs.
 *
 * Every row prints the line's control number exactly as stored
 * (REQ-20260913-001-04). Posting to stock uses that same string as the
 * delivery reference, so the paper in the group chat and the books can
 * always be matched line for line.
 *
 * The model is built apart from the drawing so what goes on the page can be
 * tested without reading a PDF.
 *
 * No peso sign: U+20B1 is not in Helvetica's WinAnsi encoding and vanishes
 * from the page (see reports/recipe-costing-pdf.ts). Amounts sit under PHP
 * headings instead.
 */

import { BuyListCopy, BUY_LIST_PDF_LABEL } from './buy-list-labels';

export type { BuyListCopy };
export { BUY_LIST_PDF_LABEL };

export interface BuyListSourceLine {
  lineNumber:   string;
  name:         string;
  unit:         string;
  qtyRequested: number;
  /** What Clerque says is on the shelf at the branch right now. */
  onHand:       number | null;
  /** What somebody counted while building the list, not yet posted. */
  counted:      number | null;
  /** What one pack held last time, for "2 packs (2,000 ml)". */
  lastPackSize: number | null;
  packsBought:  number | null;
  packSize:     number | null;
  packCost:     number | null;
  brandNote:    string | null;
  receivedAt:   Date | null;
}

export interface BuyListSource {
  shopName:      string;
  requestNumber: string;
  status:        string;
  branchName:    string | null;
  sentAt:        Date | null;
  sentBy:        string | null;
  receivedAt:    Date | null;
  /** The person's own words, tags already removed. */
  notes:         string | null;
  lines:         BuyListSourceLine[];
}

export interface BuyListRow {
  lineNumber: string;
  item:       string;
  unit:       string;
  need:       string;
  // as sent
  onHand?:    string;
  // as booked
  bought?:       string;
  pricePerPack?: string;
  amount?:       string;
  brand?:        string;
  result?:       string;
}

export interface BuyListModel {
  copy:          BuyListCopy;
  title:         string;
  shopName:      string;
  requestNumber: string;
  branchName:    string | null;
  /** "Sent Sep 13, 2026, 2:05 PM by Anne". */
  stamp:         string;
  /** Said when the page is not the moment it describes: a reprint, a draft. */
  caveat:        string | null;
  notes:         string | null;
  showMoney:     boolean;
  rows:          BuyListRow[];
  total:         string | null;
  footer:        string;
}

/** When the page was printed, and whether it stands in for a copy that was never filed. */
export interface BuyListBuildOpts {
  copy:      BuyListCopy;
  /** Ignored for the as-sent copy, which never carries money. */
  showMoney: boolean;
  printedAt: Date;
  /** True when this is drawn now for a request whose copy was not filed at the time. */
  reprint:   boolean;
}

function when(d: Date): string {
  return d.toLocaleString('en-PH', { timeZone: PH_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' });
}

function qty(n: number): string {
  return n.toLocaleString('en-PH', { maximumFractionDigits: 3 });
}

/** No currency symbol -- see the note above. Columns are headed PHP. */
function n2(v: number): string {
  return v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A quantity as whole-ish packs, or null when it does not divide cleanly (the screen's own rule). */
function inPacks(amount: number, packSize: number | null): number | null {
  if (!packSize || packSize <= 0) return null;
  const p = Math.round((amount / packSize) * 100) / 100;
  return Math.abs(p * packSize - amount) < 1e-6 && p > 0 ? p : null;
}

/** The number after the last dash, so line -100 sorts after -11, not before it. */
function suffixOf(lineNumber: string): number {
  const m = /-(\d+)$/.exec(lineNumber);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * What was asked for. In packs only on the copy as sent: by the time a
 * request is booked, "last pack" is the pack this very request just bought,
 * and "1.5 packs" would contradict the "2 packs" on the list that went out.
 */
function need(l: BuyListSourceLine, copy: BuyListCopy): string {
  const packs = copy === 'sent' ? inPacks(l.qtyRequested, l.lastPackSize) : null;
  return packs != null
    ? `${qty(packs)} pack${packs === 1 ? '' : 's'} (${qty(l.qtyRequested)} ${l.unit})`
    : `${qty(l.qtyRequested)} ${l.unit}`;
}

function resultOf(l: BuyListSourceLine, status: string): string {
  // Posting rewrites packs bought to the packs that arrived; zero means none came.
  if (l.receivedAt) return l.packsBought != null && l.packsBought <= 0 ? 'Nothing arrived' : 'In stock';
  // A request closes with its unposted lines put back on the branch's open list.
  if (status === 'RECEIVED') return 'Back on the list';
  if (status === 'CANCELLED') return 'Cancelled';
  return l.packsBought == null ? 'Not bought yet' : 'Bought, not in stock yet';
}

export function buildBuyListModel(src: BuyListSource, opts: BuyListBuildOpts): BuyListModel {
  const { copy } = opts;
  // The as-sent copy is price-free by construction, whoever asks for it.
  const showMoney = copy === 'booked' && opts.showMoney;
  const lines = [...src.lines].sort((a, b) => suffixOf(a.lineNumber) - suffixOf(b.lineNumber)
    || a.lineNumber.localeCompare(b.lineNumber));

  const sentBit = src.sentAt ? `Sent ${when(src.sentAt)}${src.sentBy ? ` by ${src.sentBy}` : ''}` : null;
  let stamp: string;
  let caveat: string | null = null;
  if (copy === 'sent') {
    if (!src.sentAt) {
      stamp  = `Not sent yet — printed ${when(opts.printedAt)}`;
      caveat = 'Draft. The list can still change until it is sent.';
    } else {
      stamp = sentBit!;
      if (opts.reprint) caveat = `Reprinted ${when(opts.printedAt)}. "On hand" is the stock now, not when the list was sent.`;
    }
  } else {
    stamp = [sentBit, src.receivedAt ? `In stock ${when(src.receivedAt)}` : null].filter(Boolean).join('  ·  ')
      || `Printed ${when(opts.printedAt)}`;
    if (src.status !== 'RECEIVED') caveat = `Printed ${when(opts.printedAt)}. Not everything on this list is in stock yet.`;
  }
  if (src.status === 'CANCELLED') caveat = 'This request was cancelled.';

  let total = 0;
  let anyMoney = false;
  const rows: BuyListRow[] = lines.map((l) => {
    const base = { lineNumber: l.lineNumber, item: l.name, unit: l.unit, need: need(l, copy) };
    if (copy === 'sent') {
      const onHand = l.onHand == null ? '—' : `${qty(l.onHand)} ${l.unit}`;
      return { ...base, onHand: l.counted != null ? `${onHand} · counted ${qty(l.counted)}` : onHand };
    }
    const hasPacks = l.packsBought != null && l.packSize != null;
    const row: BuyListRow = {
      ...base,
      bought: hasPacks ? `${qty(l.packsBought!)} × ${qty(l.packSize!)} ${l.unit}` : '—',
      brand:  l.brandNote ?? '',
      result: resultOf(l, src.status),
    };
    if (showMoney) {
      row.pricePerPack = l.packCost != null ? n2(l.packCost) : '—';
      // A closed or cancelled request's unposted lines were never charged: they
      // went back on the list, and are not part of what was booked.
      const neverBooked = !l.receivedAt && (src.status === 'RECEIVED' || src.status === 'CANCELLED');
      if (hasPacks && l.packCost != null && !neverBooked) {
        // To the centavo before it is printed or added, so the rows add up to the total.
        const amount = Math.round(l.packsBought! * l.packCost * 100) / 100;
        total += amount;
        anyMoney = true;
        row.amount = n2(amount);
      } else {
        row.amount = '—';
      }
    }
    return row;
  });

  return {
    copy,
    title:         BUY_LIST_PDF_LABEL[copy],
    shopName:      src.shopName,
    requestNumber: src.requestNumber,
    branchName:    src.branchName,
    stamp,
    caveat,
    notes:         src.notes?.trim() ? src.notes.trim() : null,
    showMoney,
    rows,
    total:         showMoney && anyMoney ? n2(total) : null,
    footer: copy === 'sent'
      ? 'Each item is booked into stock by its Line No. Write what was bought next to it; pack size in the unit shown.'
      : 'Each line went into stock under its Line No., the same number as on the list that was sent.',
  };
}

// ── drawing ─────────────────────────────────────────────────────────────────

const CLAY  = '#8B5E3C';
const CREAM = '#EEE9DF';
const MUTED = '#6B7280';
const RULE  = '#DDD6CA';
const INK   = '#1F2937';
const ZEBRA = '#F8F6F1';

/**
 * Only what Helvetica's WinAnsi encoding can draw. The peso sign becomes PHP,
 * the narrow and non-breaking spaces some date formats put before "PM" become
 * plain spaces, and anything else outside the encoding (an emoji in an
 * ingredient name) becomes "?" rather than a garbled glyph.
 */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function pdfSafe(s: string): string {
  let out = '';
  for (const ch of s.replace(/₱\s?/g, 'PHP ').replace(/[\u00A0\u2007\u2009\u202F]/g, ' ')) {
    const code = ch.codePointAt(0)!;
    out += code < 0x100 || WINANSI_EXTRA.has(ch) ? ch : '?';
  }
  return out;
}

interface Column {
  key:     keyof BuyListRow | 'packsIn' | 'sizeIn' | 'priceIn' | 'brandIn';
  header:  string;
  width:   number;
  align?:  'left' | 'right';
  /** A blank to write in by hand; the unit is printed at its end when set. */
  writeIn?: boolean;
  unit?:    boolean;
  mono?:    boolean;
}

function columnsFor(m: BuyListModel, W: number): Column[] {
  let cols: Column[];
  if (m.copy === 'sent') {
    cols = [
      { key: 'lineNumber', header: 'LINE NO.',         width: 108, mono: true },
      { key: 'item',       header: 'ITEM',             width: 160 },
      { key: 'need',       header: 'NEED',             width: 112 },
      { key: 'onHand',     header: 'ON HAND WHEN SENT', width: 104 },
      { key: 'packsIn',    header: 'PACKS BOUGHT',     width: 58, writeIn: true },
      { key: 'sizeIn',     header: 'PACK SIZE',        width: 78, writeIn: true, unit: true },
      { key: 'priceIn',    header: 'PRICE / PACK',     width: 64, writeIn: true },
      { key: 'brandIn',    header: 'BRAND / STORE',    width: 86, writeIn: true },
    ];
  } else if (m.showMoney) {
    cols = [
      { key: 'lineNumber',   header: 'LINE NO.',        width: 108, mono: true },
      { key: 'item',         header: 'ITEM',            width: 150 },
      { key: 'need',         header: 'NEEDED',          width: 100 },
      { key: 'bought',       header: 'BOUGHT',          width: 100 },
      { key: 'pricePerPack', header: 'PRICE/PACK PHP',  width: 72, align: 'right' },
      { key: 'amount',       header: 'AMOUNT PHP',      width: 76, align: 'right' },
      { key: 'brand',        header: 'BRAND',           width: 76 },
      { key: 'result',       header: 'RESULT',          width: 88 },
    ];
  } else {
    cols = [
      { key: 'lineNumber', header: 'LINE NO.', width: 108, mono: true },
      { key: 'item',       header: 'ITEM',     width: 190 },
      { key: 'need',       header: 'NEEDED',   width: 120 },
      { key: 'bought',     header: 'BOUGHT',   width: 130 },
      { key: 'brand',      header: 'BRAND',    width: 100 },
      { key: 'result',     header: 'RESULT',   width: 122 },
    ];
  }
  // Stretch or squeeze the item column so the table fills the page exactly.
  const used = cols.reduce((s, c) => s + c.width, 0);
  const item = cols.find((c) => c.key === 'item')!;
  item.width += W - used;
  return cols;
}

export function renderBuyListPdf(m: BuyListModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
      bufferPages: true,
      info: { Title: pdfSafe(`${m.title} ${m.requestNumber}`), Author: 'Clerque' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = doc.page.margins.left;
    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const FOOTER_H = 22;
    const bottom = () => doc.page.height - doc.page.margins.bottom - FOOTER_H;
    const cols = columnsFor(m, W);
    const PAD = 5;

    // ── header ───────────────────────────────────────────────────────────────
    let y = doc.page.margins.top;
    doc.rect(L, y, W, 62).fill(CREAM);
    // pdfkit wraps any text given a width; only a height makes the ellipsis cut
    // it to one line. A long registered business name must not run over the
    // title below it.
    const oneLine = (size: number) => ({ height: size * 1.25, ellipsis: true });
    doc.fillColor(CLAY).font('Helvetica-Bold').fontSize(16)
       .text(pdfSafe(m.shopName), L + 14, y + 10, { width: W / 2 + 40, ...oneLine(16) });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
       .text(pdfSafe(m.title), L + 14, y + 31, { width: W / 2 + 40, ...oneLine(9) });
    doc.fontSize(8)
       .text(pdfSafe(m.stamp), L + 14, y + 44, { width: W / 2 + 80, ...oneLine(8) });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(15)
       .text(pdfSafe(m.requestNumber), L + W / 2 + 60, y + 12, { width: W / 2 - 74, align: 'right', ...oneLine(15) });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
       .text(pdfSafe(`${m.branchName ?? ''}${m.branchName ? '  ·  ' : ''}${m.rows.length} item${m.rows.length === 1 ? '' : 's'}`),
             L + W / 2 + 60, y + 33, { width: W / 2 - 74, align: 'right', ...oneLine(9) });
    y += 72;

    if (m.caveat) {
      doc.fillColor('#9A6B12').font('Helvetica-Oblique').fontSize(8.5)
         .text(pdfSafe(m.caveat), L, y, { width: W });
      y = doc.y + 6;
    }
    if (m.notes) {
      doc.fillColor(INK).font('Helvetica').fontSize(9)
         .text(pdfSafe(`Note: ${m.notes}`), L, y, { width: W });
      y = doc.y + 8;
    }

    // ── the table ────────────────────────────────────────────────────────────
    // A heading that needs two lines ("PACKS BOUGHT" in a narrow column) gets them.
    doc.font('Helvetica-Bold').fontSize(7.5);
    const headH = Math.max(18, ...cols.map((c) => doc.heightOfString(c.header, { width: c.width - PAD * 2 }) + 9));
    const head = () => {
      doc.rect(L, y, W, headH).fill(CLAY);
      let x = L;
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
      for (const c of cols) {
        doc.text(c.header, x + PAD, y + 5, { width: c.width - PAD * 2, align: c.align ?? 'left' });
        x += c.width;
      }
      y += headH;
    };

    // Measured in the font it is drawn in: a bold item name wraps sooner than regular text.
    const setCellFont = (c: Column) => doc
      .font(c.mono ? 'Courier-Bold' : c.key === 'item' ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(c.mono ? 8 : 8.5);

    const textOf = (row: BuyListRow, c: Column): string => {
      if (c.writeIn) return '';
      return pdfSafe(String(row[c.key as keyof BuyListRow] ?? ''));
    };

    head();
    if (m.rows.length === 0) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9)
         .text('Nothing on this list.', L + PAD, y + 8, { width: W });
      y += 26;
    }

    m.rows.forEach((row, i) => {
      // As tall as the tallest wrapped cell, and tall enough to write in by hand.
      let h = m.copy === 'sent' ? 26 : 18;
      for (const c of cols) {
        if (c.writeIn) continue;
        const t = textOf(row, c);
        if (!t) continue;
        setCellFont(c);
        h = Math.max(h, doc.heightOfString(t, { width: c.width - PAD * 2 }) + 10);
      }
      if (y + h > bottom()) {
        doc.addPage();
        y = doc.page.margins.top;
        head();
      }
      if (i % 2 === 1) doc.rect(L, y, W, h).fill(ZEBRA);

      let x = L;
      for (const c of cols) {
        if (c.writeIn) {
          // A rule to write on, with the unit printed at its end when the
          // number has to be in the ingredient's own unit.
          const lineY = y + h - 7;
          // As wide as the unit's name ("bottles", "sachets"), up to half the box, on one line.
          doc.font('Helvetica').fontSize(8);
          const unitText = c.unit ? pdfSafe(row.unit) : '';
          const unitW = c.unit ? Math.min(doc.widthOfString(unitText) + 4, (c.width - PAD * 2) / 2) : 0;
          doc.moveTo(x + PAD, lineY).lineTo(x + c.width - PAD - unitW - 2, lineY).lineWidth(0.5).stroke('#B8AE9C');
          if (c.unit) {
            doc.fillColor(MUTED)
               .text(unitText, x + c.width - PAD - unitW, lineY - 9, { width: unitW, height: 10, ellipsis: true });
          }
        } else {
          const t = textOf(row, c);
          setCellFont(c)
             .fillColor(c.key === 'result' && t !== 'In stock' ? '#9A6B12' : INK)
             .text(t, x + PAD, y + 5, { width: c.width - PAD * 2, align: c.align ?? 'left' });
        }
        x += c.width;
      }
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).stroke(RULE);
      y += h;
    });

    if (m.total != null) {
      if (y + 22 > bottom()) { doc.addPage(); y = doc.page.margins.top; }
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5)
         .text(`Total PHP ${m.total}`, L, y + 8, { width: W, align: 'right', height: 12, ellipsis: true });
      y += 26;
    }

    // ── footer on every page ─────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      // Writing inside the bottom margin would otherwise start a new page.
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - saved - FOOTER_H + 8;
      doc.moveTo(L, fy - 4).lineTo(L + W, fy - 4).lineWidth(0.4).stroke(RULE);
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
         .text(pdfSafe(m.footer), L, fy, { width: W - 160, height: 10, ellipsis: true })
         .text(pdfSafe(`${m.requestNumber}  ·  page ${p - range.start + 1} of ${range.count}`), L + W - 160, fy, { width: 160, align: 'right', height: 10, ellipsis: true });
      doc.page.margins.bottom = saved;
    }

    doc.end();
  });
}

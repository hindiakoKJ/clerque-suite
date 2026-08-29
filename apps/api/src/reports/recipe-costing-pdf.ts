import PDFDocument from 'pdfkit';

/**
 * Recipe costing report — what each menu item costs to make, and why.
 *
 * Built for the owner rather than the accountant: the summary is ordered by
 * margin ascending, so the items earning the least are the first thing on the
 * page, and each one is followed by the ingredient lines that explain the
 * number. A cost of zero is never silently folded into a total — an
 * ingredient with no price makes the whole item's margin a lie (it drops out
 * of COGS and the drink reads as MORE profitable), so those items are marked
 * and their margin withheld rather than overstated.
 *
 * The peso sign is deliberately absent. U+20B1 is not in Helvetica's WinAnsi
 * encoding — pdfkit measures it at zero width and it vanishes from the page —
 * so amounts are labelled PHP in the column heads instead. The invoice,
 * payslip and subscription-receipt PDFs all still emit the raw glyph and lose
 * it the same way; that is a separate fix.
 */

export interface RecipeCostLine {
  ingredient: string;
  quantity:   number;
  unit:       string;
  unitCost:   number | null;   // null = no price on file
  lineCost:   number;
}

export interface RecipeCostItem {
  product:  string;
  category: string | null;
  price:    number;
  cost:     number;
  margin:   number | null;     // null when any line is unpriced
  unpriced: string[];          // ingredient names with no cost
  lines:    RecipeCostLine[];
}

export interface RecipeCostingPayload {
  tenant:      { name: string; businessName: string | null };
  generatedAt: string;         // already formatted, PH time
  generatedBy: string;   // a person's name only — the report asserts no job title
  items:       RecipeCostItem[];
}

const CLAY  = '#8B5E3C';
const CREAM = '#EEE9DF';
const MUTED = '#6B7280';
const RED   = '#B4362B';
const AMBER = '#9A6B12';
const RULE  = '#DDD6CA';
const INK   = '#1F2937';

/** No currency symbol — see the note above. Columns are headed PHP. */
function n2(v: number): string {
  return v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
function marginColor(m: number | null): string {
  if (m == null) return MUTED;
  if (m < 0.40)  return RED;
  if (m < 0.55)  return AMBER;
  return INK;
}

export function generateRecipeCostingPdf(p: RecipeCostingPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: `Recipe Costing — ${p.tenant.name}`, Author: 'Clerque' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = doc.page.margins.left;
    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    // ── Header ───────────────────────────────────────────────────────────────
    doc.rect(L, doc.page.margins.top, W, 58).fill(CREAM);
    doc.fillColor(CLAY).font('Helvetica-Bold').fontSize(18)
       .text(p.tenant.businessName ?? p.tenant.name, L + 14, doc.page.margins.top + 11);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
       .text('Recipe Costing — what each item costs to make', L + 14, doc.page.margins.top + 33);
    doc.fontSize(8)
       .text(`Prepared by ${p.generatedBy}  ·  ${p.generatedAt}`,
             L + 14, doc.page.margins.top + 45);
    let y = doc.page.margins.top + 74;

    // ── Summary band ─────────────────────────────────────────────────────────
    const priced   = p.items.filter((i) => i.margin != null);
    const unpriced = p.items.filter((i) => i.margin == null);
    const margins  = priced.map((i) => i.margin as number).sort((a, b) => a - b);
    const median   = margins.length ? margins[Math.floor(margins.length / 2)] : 0;

    const stats: Array<[string, string, boolean]> = [
      ['Menu items',      String(p.items.length),   false],
      ['Fully costed',    String(priced.length),    false],
      ['Median margin',   margins.length ? pct(median) : '—', false],
      ['Thinnest',        margins.length ? pct(margins[0]) : '—', false],
      ['Missing a price', String(unpriced.length),  unpriced.length > 0],
    ];
    const colW = W / stats.length;
    stats.forEach(([label, val, warn], i) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
         .text(label.toUpperCase(), L + i * colW, y, { width: colW, characterSpacing: 0.4 });
      doc.fillColor(warn ? RED : CLAY).font('Helvetica-Bold').fontSize(15)
         .text(val, L + i * colW, y + 11, { width: colW });
    });
    y += 42;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.7).stroke(RULE);
    y += 14;

    // ── Summary table, thinnest margin first ─────────────────────────────────
    const cName   = L;
    const cPrice  = L + W - 210;
    const cCost   = L + W - 142;
    const cMargin = L + W - 62;

    function summaryHead(): void {
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5);
      doc.text('MENU ITEM', cName, y);
      doc.text('PRICE PHP', cPrice,  y, { width: 62, align: 'right' });
      doc.text('COST PHP',  cCost,   y, { width: 62, align: 'right' });
      doc.text('MARGIN',    cMargin, y, { width: 56, align: 'right' });
      y += 13;
      doc.moveTo(L, y - 3).lineTo(L + W, y - 3).lineWidth(0.5).stroke(RULE);
    }

    doc.fillColor(CLAY).font('Helvetica-Bold').fontSize(11)
       .text('Every item, thinnest margin first', L, y);
    y += 18;
    summaryHead();

    const ordered = [...p.items].sort((a, b) => {
      if (a.margin == null && b.margin == null) return a.product.localeCompare(b.product);
      if (a.margin == null) return 1;
      if (b.margin == null) return -1;
      return a.margin - b.margin;
    });

    doc.font('Helvetica').fontSize(9);
    for (const it of ordered) {
      if (y > bottom() - 24) {
        doc.addPage();
        y = doc.page.margins.top;
        summaryHead();
        doc.font('Helvetica').fontSize(9);
      }
      doc.fillColor(INK).font('Helvetica')
         .text(it.product, cName, y, { width: W - 222, ellipsis: true });
      doc.fillColor(MUTED)
         .text(n2(it.price), cPrice, y, { width: 62, align: 'right' })
         .text(n2(it.cost),  cCost,  y, { width: 62, align: 'right' });
      doc.fillColor(marginColor(it.margin)).font('Helvetica-Bold')
         .text(it.margin == null ? 'n/a' : pct(it.margin), cMargin, y, { width: 56, align: 'right' });
      y += 14;
    }

    // ── Per-item breakdown ───────────────────────────────────────────────────
    doc.addPage();
    y = doc.page.margins.top;
    doc.fillColor(CLAY).font('Helvetica-Bold').fontSize(13)
       .text('What goes into each one', L, y);
    y += 24;

    for (const it of ordered) {
      const blockHeight = 26 + it.lines.length * 12 + (it.unpriced.length ? 12 : 0) + 17;
      if (y + blockHeight > bottom()) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      doc.rect(L, y, W, 20).fill(CREAM);
      doc.fillColor(CLAY).font('Helvetica-Bold').fontSize(10)
         .text(it.product, L + 8, y + 6, { width: W - 210, ellipsis: true });
      doc.fillColor(marginColor(it.margin)).font('Helvetica-Bold').fontSize(9)
         .text(
           it.margin == null
             ? `PHP ${n2(it.price)}   cost incomplete`
             : `PHP ${n2(it.price)}   cost ${n2(it.cost)}   ${pct(it.margin)}`,
           L + W - 202, y + 6, { width: 194, align: 'right' },
         );
      y += 26;

      for (const ln of it.lines) {
        const missing = ln.unitCost == null;
        doc.font('Helvetica').fontSize(8.5);
        doc.fillColor(missing ? RED : '#374151')
           .text(`${ln.quantity} ${ln.unit}`, L + 10, y, { width: 64 });
        doc.fillColor(INK)
           .text(ln.ingredient, L + 80, y, { width: W - 254, ellipsis: true });
        doc.fillColor(MUTED)
           .text(missing ? 'no price' : n2(ln.unitCost as number), L + W - 152, y, { width: 64, align: 'right' });
        doc.fillColor(missing ? RED : '#374151')
           .text(missing ? '—' : n2(ln.lineCost), L + W - 80, y, { width: 70, align: 'right' });
        y += 12;
      }

      if (it.unpriced.length) {
        doc.fillColor(RED).font('Helvetica-Oblique').fontSize(7.5)
           .text(
             `Margin withheld — no price yet for ${it.unpriced.join(', ')}.`,
             L + 10, y + 1, { width: W - 20 },
           );
        y += 12;
      }
      doc.moveTo(L, y + 3).lineTo(L + W, y + 3).lineWidth(0.5).stroke(RULE);
      y += 17;
    }

    doc.end();
  });
}

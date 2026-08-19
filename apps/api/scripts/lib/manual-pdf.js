/**
 * Shared PDF building blocks for the Clerque client-facing documents
 * (Onboarding Pack, Owner & Staff Manual, Admin How-To). Plain pdfkit,
 * A4, Helvetica only, ASCII-safe. Every helper keeps `doc.x` at the left
 * margin after it returns so callers never have to reset it.
 *
 * Usage:
 *   const { createDoc, finish } = require('./lib/manual-pdf');
 *   const m = createDoc({ title, subtitle, footer, outPath });
 *   m.h1('...'); m.p('...'); m.steps([...]); m.tip('...'); m.careful('...');
 *   finish(m);
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const C = {
  brand:   '#8B5E3C',
  ink:     '#1F1B16',
  muted:   '#5F564B',
  rule:    '#DDD4C2',
  zebra:   '#F7F3EE',
  tipBg:   '#E9F5EE', tipFg: '#065F46',
  careBg:  '#FCEBC9', careFg: '#92400E',
  stopBg:  '#FBD9D9', stopFg: '#991B1B',
  noteBg:  '#EEF3FB', noteFg: '#1E40AF',
};

/**
 * pdfkit's built-in Helvetica has NO glyph for the peso sign (U+20B1) or the
 * right arrow (U+2192) — they rendered as "±" and "!'" in the first drafts,
 * on every "Amount (₱)" and every "Settings → Security". Embed Arial (which
 * has both) under the same logical names the helpers use; fall back to the
 * built-ins if the font files aren't on this machine.
 */
function registerFonts(doc) {
  const candidates = [
    ['C:/Windows/Fonts/arial.ttf',   'C:/Windows/Fonts/arialbd.ttf',  'C:/Windows/Fonts/ariali.ttf'],
    ['/Library/Fonts/Arial.ttf',     '/Library/Fonts/Arial Bold.ttf', '/Library/Fonts/Arial Italic.ttf'],
    ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf'],
  ];
  for (const [reg, bold, ital] of candidates) {
    if (fs.existsSync(reg) && fs.existsSync(bold) && fs.existsSync(ital)) {
      // NOTE: pdfkit silently IGNORES registerFont() for its reserved standard
      // names ('Helvetica', 'Helvetica-Bold', ...) and keeps the built-in AFM
      // font — which is exactly why the first attempt still printed "±". So
      // register under fresh names and route every helper through F.*.
      doc.registerFont('Body',       reg);
      doc.registerFont('BodyBold',   bold);
      doc.registerFont('BodyItalic', ital);
      return { r: 'Body', b: 'BodyBold', i: 'BodyItalic' };
    }
  }
  console.warn('[manual-pdf] Arial/Liberation not found — falling back to built-in Helvetica (peso sign and arrows will not render).');
  return { r: 'Helvetica', b: 'Helvetica-Bold', i: 'Helvetica-Oblique' };
}

function createDoc({ title, subtitle, footer, outPath }) {
  const doc = new PDFDocument({
    size: 'A4', bufferPages: true,
    margins: { top: 56, bottom: 60, left: 54, right: 54 },
    info: { Title: title, Author: 'HNS Corporation Philippines' },
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  doc.pipe(fs.createWriteStream(outPath));
  const F = registerFonts(doc);
  const W = doc.page.width - 108;
  const bottom = () => doc.page.height - 60;
  const left = () => { doc.x = 54; };
  const ensure = (h) => { if (doc.y + h > bottom()) { doc.addPage(); } left(); };

  const m = { doc, W, outPath, title, footer: footer || title, sectionCount: 0, F };

  // ── cover ────────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 128).fill(C.brand);
  doc.fillColor('#FFFFFF').font(F.b).fontSize(24).text(title, 54, 40, { width: W });
  if (subtitle) doc.font(F.r).fontSize(11).text(subtitle, 54, 78, { width: W });
  doc.y = 152; left();

  // ── text blocks ──────────────────────────────────────────────────────────
  m.h1 = (t) => {
    ensure(70);
    m.sectionCount++;
    doc.moveDown(0.6).fillColor(C.brand).font(F.b).fontSize(16).text(t).moveDown(0.2);
    doc.strokeColor(C.rule).lineWidth(1).moveTo(54, doc.y).lineTo(54 + W, doc.y).stroke();
    doc.moveDown(0.6); left();
  };
  m.h2 = (t) => { ensure(40); doc.moveDown(0.35).fillColor(C.ink).font(F.b).fontSize(11.5).text(t).moveDown(0.2); left(); };
  m.p  = (t) => { ensure(30); doc.fillColor(C.ink).font(F.r).fontSize(10).text(t, { lineGap: 2 }).moveDown(0.35); left(); };
  m.small = (t) => { ensure(24); doc.fillColor(C.muted).font(F.i).fontSize(8.5).text(t, { lineGap: 1 }).moveDown(0.35); left(); };
  m.bullets = (items) => {
    items.forEach((t) => { ensure(22); doc.fillColor(C.ink).font(F.r).fontSize(10).text('  -  ' + t, { lineGap: 2, indent: 0 }).moveDown(0.1); });
    doc.moveDown(0.25); left();
  };
  /** Numbered how-to steps. Each item may be a string or { text, note }. */
  m.steps = (items) => {
    items.forEach((it, i) => {
      const text = typeof it === 'string' ? it : it.text;
      const note = typeof it === 'string' ? null : it.note;
      ensure(28);
      const y = doc.y;
      doc.circle(62, y + 7, 8).fill(C.brand);
      doc.fillColor('#FFFFFF').font(F.b).fontSize(9).text(String(i + 1), 54, y + 2.5, { width: 16, align: 'center' });
      doc.fillColor(C.ink).font(F.r).fontSize(10).text(text, 78, y, { width: W - 24, lineGap: 2 });
      if (note) { doc.fillColor(C.muted).font(F.i).fontSize(8.5).text(note, 78, doc.y + 1, { width: W - 24 }); }
      doc.moveDown(0.45);
    });
    doc.moveDown(0.2); left();
  };
  const box = (label, body, bg, fg) => {
    const th = doc.font(F.b).fontSize(9.5).heightOfString(label, { width: W - 24 });
    const bh = doc.font(F.r).fontSize(9.5).heightOfString(body, { width: W - 24 });
    const h = th + bh + 18;
    ensure(h + 6);
    const y = doc.y;
    doc.rect(54, y, W, h).fillAndStroke(bg, fg);
    doc.fillColor(fg).font(F.b).fontSize(9.5).text(label, 66, y + 6, { width: W - 24 });
    doc.fillColor(C.ink).font(F.r).fontSize(9.5).text(body, 66, y + 8 + th, { width: W - 24, lineGap: 1.5 });
    doc.y = y + h + 10; left();
  };
  m.tip     = (body) => box('TIP', body, C.tipBg, C.tipFg);
  m.careful = (body) => box('BE CAREFUL', body, C.careBg, C.careFg);
  m.stop    = (body) => box('DO NOT', body, C.stopBg, C.stopFg);
  m.note    = (body) => box('GOOD TO KNOW', body, C.noteBg, C.noteFg);

  /** Simple table. rows: string[][]; a cell starting with '**' renders bold. */
  m.table = (cols, rows, widths) => {
    const colW = widths || cols.map(() => W / cols.length);
    let y = doc.y + 2;
    const header = () => {
      doc.rect(54, y, W, 18).fill(C.brand);
      let x = 59;
      cols.forEach((c, i) => { doc.fillColor('#FFFFFF').font(F.b).fontSize(8.5).text(c, x, y + 5, { width: colW[i] - 8 }); x += colW[i]; });
      y += 18;
    };
    header();
    rows.forEach((r, ri) => {
      const hs = r.map((c, i) => doc.font(F.r).fontSize(8.5).heightOfString(String(c).replace(/^\*\*/, ''), { width: colW[i] - 8 }));
      const rh = Math.max(...hs) + 9;
      if (y + rh > bottom()) { doc.addPage(); y = 56; header(); }
      if (ri % 2 === 0) doc.rect(54, y, W, rh).fill(C.zebra);
      let x = 59;
      r.forEach((c, i) => {
        const s = String(c); const bold = s.startsWith('**');
        doc.fillColor(C.ink).font(bold ? F.b : F.r).fontSize(8.5).text(s.replace(/^\*\*/, ''), x, y + 4.5, { width: colW[i] - 8, lineGap: 1 });
        x += colW[i];
      });
      y += rh;
    });
    doc.y = y + 10; left();
  };
  /** Q&A block for an FAQ. */
  m.faq = (q, a) => {
    ensure(40);
    doc.fillColor(C.brand).font(F.b).fontSize(10).text('Q:  ' + q, { lineGap: 1.5 });
    doc.fillColor(C.ink).font(F.r).fontSize(10).text('A:  ' + a, { lineGap: 2 }).moveDown(0.5);
    left();
  };
  m.pageBreak = () => { doc.addPage(); left(); };
  return m;
}

/** Stamp the running footer on every page and close the stream. */
function finish(m) {
  const { doc } = m;
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    // The footer sits INSIDE the bottom margin. pdfkit treats any text that
    // lands below the margin as "page is full" and silently adds a NEW page
    // for it — which is how the first build grew 6 blank footer-only pages
    // after the real content. Zero the margin while stamping so it writes in
    // place, then restore it.
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(C.muted).font(m.F.r).fontSize(8)
      .text(`${m.footer}   |   page ${i - range.start + 1} of ${total}`, 54, doc.page.height - 36,
            { width: m.W, align: 'center', lineBreak: false, height: 12 });
    doc.page.margins.bottom = saved;
  }
  // Guard: stamping must never have added pages.
  const after = doc.bufferedPageRange().count;
  if (after !== total) throw new Error(`[manual-pdf] footer stamping added pages (${total} -> ${after})`);
  doc.end();
  return new Promise((res) => doc.on('end', () => res(m.outPath)));
}

module.exports = { createDoc, finish, C };

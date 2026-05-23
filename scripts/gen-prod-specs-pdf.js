/**
 * Generate "Clerque — Production Infrastructure Specs" PDF.
 * One-off: node scripts/gen-prod-specs-pdf.js
 * Output: <Desktop>/clerque-production-specs.pdf
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(os.homedir(), 'Desktop', 'clerque-production-specs.pdf');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const BROWN  = '#8B5E3C';
const CREAM  = '#EEE9DF';
const TEAL   = '#0F766E';
const SLATE  = '#475569';
const SLATE_DARK = '#1E293B';
const RED    = '#B91C1C';
const AMBER  = '#B45309';
const GREEN  = '#15803D';

const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
doc.pipe(fs.createWriteStream(OUT));

// ─── Helpers ────────────────────────────────────────────────────────────────

function newPageIfNeeded(yReserve = 100) {
  if (doc.y + yReserve > doc.page.height - doc.page.margins.bottom) doc.addPage();
}
function h1(text) {
  newPageIfNeeded(80);
  doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(20).text(text, { align: 'left' });
  doc.moveDown(0.3);
  // underline
  const x = doc.page.margins.left;
  const y = doc.y;
  doc.strokeColor(BROWN).lineWidth(1.5).moveTo(x, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
  doc.moveDown(0.6);
}
function h2(text, color = SLATE_DARK) {
  newPageIfNeeded(50);
  doc.fillColor(color).font('Helvetica-Bold').fontSize(14).text(text);
  doc.moveDown(0.3);
}
function p(text, opts = {}) {
  newPageIfNeeded(40);
  doc.fillColor(SLATE_DARK).font('Helvetica').fontSize(10).text(text, opts);
  doc.moveDown(0.4);
}
function smallNote(text) {
  newPageIfNeeded(20);
  doc.fillColor(SLATE).font('Helvetica-Oblique').fontSize(9).text(text);
  doc.moveDown(0.4);
}
function bullet(text) {
  newPageIfNeeded(20);
  const indent = doc.page.margins.left + 12;
  doc.fillColor(SLATE_DARK).font('Helvetica').fontSize(10);
  doc.text('• ' + text, indent, doc.y, { width: doc.page.width - doc.page.margins.right - indent });
  doc.moveDown(0.2);
}
function spacer(n = 0.6) { doc.moveDown(n); }

/**
 * Render a simple table with styled header. Each row: array of cells.
 * `widths`: array of column widths in points; sum should equal usable width.
 */
function table({ headers, rows, widths, headerBg = BROWN, headerFg = '#FFFFFF',
                 stripeBg = CREAM, padding = 6 }) {
  newPageIfNeeded(80);
  const startX = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const wSum = widths.reduce((s, w) => s + w, 0);
  // Scale widths to usable width if they don't already match
  const scale = usable / wSum;
  const W = widths.map((w) => w * scale);

  function drawRow(cells, isHeader = false, stripe = false) {
    const fontSz = isHeader ? 10 : 9.5;
    doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSz);
    // Compute row height by checking the tallest cell
    const heights = cells.map((c, i) =>
      doc.heightOfString(String(c), { width: W[i] - padding * 2 })
    );
    const rowH = Math.max(...heights, 14) + padding * 2;

    // bg
    if (isHeader) {
      doc.rect(startX, doc.y, usable, rowH).fill(headerBg);
    } else if (stripe) {
      doc.rect(startX, doc.y, usable, rowH).fill(stripeBg);
    }

    // text
    doc.fillColor(isHeader ? headerFg : SLATE_DARK);
    let cx = startX;
    const cy = doc.y;
    for (let i = 0; i < cells.length; i++) {
      doc.text(String(cells[i]), cx + padding, cy + padding, {
        width: W[i] - padding * 2,
        height: rowH - padding * 2,
        ellipsis: false,
      });
      cx += W[i];
    }

    // bottom border
    doc.strokeColor('#E5E7EB').lineWidth(0.5)
      .moveTo(startX, cy + rowH).lineTo(startX + usable, cy + rowH).stroke();

    doc.y = cy + rowH;
    if (doc.y > doc.page.height - doc.page.margins.bottom - 10) {
      doc.addPage();
    }
  }

  drawRow(headers, true);
  rows.forEach((r, i) => drawRow(r, false, i % 2 === 1));
  spacer(0.5);
}

function calloutBox({ title, body, color = TEAL }) {
  newPageIfNeeded(80);
  const x = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startY = doc.y;
  // measure
  doc.font('Helvetica-Bold').fontSize(11);
  const titleH = doc.heightOfString(title, { width: usable - 20 });
  doc.font('Helvetica').fontSize(10);
  const bodyH = doc.heightOfString(body, { width: usable - 20 });
  const totalH = titleH + bodyH + 24;
  // box
  doc.rect(x, startY, usable, totalH).fillAndStroke(CREAM, color);
  // accent stripe on left
  doc.rect(x, startY, 4, totalH).fill(color);
  // title
  doc.fillColor(color).font('Helvetica-Bold').fontSize(11)
    .text(title, x + 12, startY + 8, { width: usable - 20 });
  // body
  doc.fillColor(SLATE_DARK).font('Helvetica').fontSize(10)
    .text(body, x + 12, startY + 8 + titleH + 4, { width: usable - 20 });
  doc.y = startY + totalH + 8;
}

// ─── Cover ────────────────────────────────────────────────────────────────

doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(28).text('Clerque', { align: 'left' });
doc.fillColor(SLATE).font('Helvetica').fontSize(14).text('Production Infrastructure Specs', { align: 'left' });
spacer(1.5);

doc.fillColor(SLATE_DARK).font('Helvetica').fontSize(10);
doc.text(
  'Spec recommendations for hosting Clerque in production at four growth tiers, ' +
  'with realistic monthly cost estimates in PHP. All figures assume a Philippine ' +
  'SMB customer base on Railway + Vercel + Cloudflare R2.',
  { width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
);
spacer(1);

calloutBox({
  title: 'How to read this',
  body:
    'Sizing is driven by three numbers: active tenants (anyone who transacted ' +
    'this month), peak orders per minute (your busiest single minute, usually ' +
    '12pm or 6pm), and 30-day order volume (drives Postgres growth and R2 backup ' +
    'size). Pick the tier that bounds your CURRENT usage, not your target.',
  color: TEAL,
});
spacer(0.5);

// ─── Tier 1 ───────────────────────────────────────────────────────────────

h1('Tier 1 — Early Production');
smallNote('1–10 paying tenants. Where you are today.');

table({
  headers: ['Component', 'Spec', 'Cost (PHP/mo)'],
  rows: [
    ['Railway API', 'Hobby — 0.5 vCPU, 512MB RAM, 1GB disk', '~₱280'],
    ['Railway Postgres', 'Hobby — 0.5 vCPU, 1GB RAM, 1GB disk', '~₱560'],
    ['Vercel Web', 'Hobby (free)', '₱0'],
    ['Cloudflare R2', 'Pay-as-you-go (~50MB total)', '~₱5'],
    ['Resend', 'Free (3K emails/mo)', '₱0'],
    ['Anthropic API', 'Pay-as-you-go (low usage)', '~₱500'],
    ['UptimeRobot', 'Free', '₱0'],
    ['Sentry', 'Free (5K events/mo)', '₱0'],
    ['Total', '', '~₱1,400/mo'],
  ],
  widths: [180, 250, 90],
});

p('Workload assumptions for this tier:');
bullet('~10K orders/month total across all tenants');
bullet('~50 peak orders/minute');
bullet('~10GB Postgres growth/year');
bullet('~200MB R2 storage/year (uploads + backups)');
spacer(0.3);
p('When to upgrade: Railway shows >70% memory consistently, OR slow query alerts start firing.');

// ─── Tier 2 ───────────────────────────────────────────────────────────────

h1('Tier 2 — Growing');
smallNote('10–50 paying tenants.');

table({
  headers: ['Component', 'Spec', 'Cost (PHP/mo)'],
  rows: [
    ['Railway API', 'Pro — 2 vCPU, 2GB RAM, 5GB disk', '~₱1,400'],
    ['Railway Postgres', 'Pro — 2 vCPU, 4GB RAM, 10GB disk', '~₱1,700'],
    ['Vercel Web', 'Pro — analytics, edge functions', '~₱1,100'],
    ['Cloudflare R2', '~5GB storage + class-A ops', '~₱120'],
    ['Resend', 'Pro tier (50K emails/mo)', '~₱1,100'],
    ['Anthropic API', 'Mid usage', '~₱2,000'],
    ['UptimeRobot', 'Free still', '₱0'],
    ['Sentry', 'Free still works', '₱0'],
    ['Total', '', '~₱7,400/mo'],
  ],
  widths: [180, 250, 90],
});

p('Workload assumptions for this tier:');
bullet('~150K orders/month');
bullet('~300 peak orders/minute');
bullet('~50GB Postgres after 6 months');
bullet('~5GB R2 (uploads + 30 days × 50 tenants × ~50KB backup snapshot)');
spacer(0.3);
p('When to upgrade:');
bullet('Postgres p95 query > 200ms consistently → upgrade Postgres tier');
bullet('Memory > 80% → either bigger box OR introduce Redis for caching');
bullet('Background cron jobs starting to overlap → add Redis + BullMQ');

// ─── Tier 3 ───────────────────────────────────────────────────────────────

h1('Tier 3 — Scale');
smallNote('50–200 paying tenants.');

table({
  headers: ['Component', 'Spec', 'Cost (PHP/mo)'],
  rows: [
    ['Railway API', 'Pro — 4 vCPU, 4GB RAM', '~₱2,800'],
    ['Railway Postgres', 'Pro — 4 vCPU, 8GB RAM, 50GB disk', '~₱5,000'],
    ['Railway Redis', 'Add-on (BullMQ + cache)', '~₱560'],
    ['Vercel Web', 'Pro', '~₱1,100'],
    ['Cloudflare R2', '~50GB storage', '~₱700'],
    ['Resend', 'Pro (50K emails/mo)', '~₱1,100'],
    ['Anthropic API', 'Heavier usage', '~₱8,000'],
    ['UptimeRobot', 'Pro ($7/mo for SMS + 1-min checks)', '~₱400'],
    ['Sentry', 'Team ($26/mo)', '~₱1,500'],
    ['Total', '', '~₱21,200/mo'],
  ],
  widths: [180, 250, 90],
});

p('Workload assumptions:');
bullet('~750K orders/month');
bullet('~1,500 peak orders/minute (tight — needs Redis)');
bullet('~250GB Postgres after 12 months');
bullet('~50GB R2');
spacer(0.3);
p('Architectural changes at this tier:');
bullet('Add Redis — BullMQ queues for backup/journal/email crons; stops in-process cron from being a single point of failure');
bullet('Postgres read replica — reports + analytics queries off the primary');
bullet('CDN for product images — already in place via R2 pub-*.r2.dev URLs');
bullet('Connection pooling — Prisma pgBouncer mode if not already enabled');

// ─── Tier 4 ───────────────────────────────────────────────────────────────

h1('Tier 4 — Heavy');
smallNote('200+ paying tenants. Time to outgrow Railway-managed Postgres.');

table({
  headers: ['Component', 'Spec', 'Cost (PHP/mo)'],
  rows: [
    ['Railway API (×2 instances)', 'Pro — 4 vCPU, 4GB RAM × 2', '~₱5,600'],
    ['AWS RDS / Neon Postgres', '4 vCPU, 16GB RAM, 100GB disk', '~₱11,000'],
    ['Read replica', 'Same', '~₱11,000'],
    ['Railway Redis', 'Pro tier', '~₱1,400'],
    ['Vercel Web', 'Pro + Enterprise add-ons', '~₱2,800'],
    ['Cloudflare R2', '~500GB', '~₱4,200'],
    ['Resend', 'Scale tier', '~₱2,800'],
    ['Anthropic API', 'Heavy', '~₱15,000–50,000'],
    ['UptimeRobot', 'Pro', '~₱400'],
    ['Sentry', 'Team', '~₱1,500'],
    ['Total', '', '~₱55,000–90,000/mo'],
  ],
  widths: [180, 250, 90],
});

p('Architectural changes:');
bullet('2+ API instances behind Railway\'s load balancer');
bullet('Redis becomes mandatory — in-process caches no longer correct across instances');
bullet('Postgres on Neon or AWS RDS for proper backup / point-in-time recovery');
bullet('Daily backup is no longer the only safety net — rely on cloud Postgres PITR');
bullet('Consider Cloudflare Workers in front of the API for edge caching (read-heavy endpoints)');

// ─── Per-tenant rule of thumb ─────────────────────────────────────────────

h1('Per-Tenant Resource Cost (Rule of Thumb)');
p('Use these for sizing decisions. Assumes a typical SMB doing ~5K orders/month.');

table({
  headers: ['Resource', 'Per active tenant'],
  rows: [
    ['Postgres rows added', '~50K/month (orders + items + payments + JEs)'],
    ['Postgres storage', '~20MB/month'],
    ['API peak memory', '~5MB'],
    ['Daily backup size', '~30–80KB (JSON, gzipped)'],
    ['Email volume', '~50/month (resets, payslips, alerts)'],
    ['R2 uploads (images, docs)', '~50MB lifetime'],
    ['Anthropic tokens (if AI active)', '~$5–15/month at moderate use'],
  ],
  widths: [180, 340],
});

calloutBox({
  title: 'Quick math',
  body:
    '1 GB Postgres lasts ~50 tenants for one month. So Tier 2\'s 10GB lasts ' +
    '~5 months at 100 tenants, or ~10 months at 50 tenants. Plan upgrades ' +
    'around this.',
  color: TEAL,
});

// ─── Skip-until-later ──────────────────────────────────────────────────────

h1('What You DON\'T Need Until Much Later');
bullet('Multi-region deployment — until you have customers in another country, single PH region is fine');
bullet('Kubernetes — Railway handles everything you\'d want from K8s up to ~500 tenants');
bullet('Datadog / NewRelic — Sentry + Railway metrics + UptimeRobot covers 95% of what you\'d actually look at');
bullet('Dedicated Redis cluster — Railway\'s add-on Redis is plenty until ~500 tenants');
bullet('Read replicas — single-DB is fine until you start seeing slow report queries (Tier 3+)');

// ─── Specific recommendation ──────────────────────────────────────────────

h1('My Specific Recommendation');
p('You\'re at Tier 1 today. Don\'t over-provision. Specifically:');
bullet('Stay on Railway Hobby Postgres for now ($10/mo) — bigger Postgres is the most expensive line item and you don\'t need it yet');
bullet('Set up R2 today — that\'s ₱5/month and saves you from the ephemeral-disk disaster');
bullet('Set up UptimeRobot today — free, takes 5 minutes');
bullet('Skip Redis until you actually see the symptom (overlapping crons, slow background jobs) — usually Tier 2/3');
bullet('Skip Sentry Pro — free tier handles 5K events/month; only upgrade if you actually hit the cap');
spacer(0.5);

calloutBox({
  title: 'Realistic cost trajectory',
  body:
    'Month 1 production: ~₱1,400/month. Month 12 with 30 tenants: ~₱5,000/month. ' +
    'That\'s well within an SMB SaaS unit-economics envelope — at ₱500–2,000/month per ' +
    'tenant, 30 tenants = ₱15K–60K monthly revenue, which covers infra many times over.',
  color: GREEN,
});

// ─── Footer ────────────────────────────────────────────────────────────────

spacer(1.5);
doc.fillColor(SLATE).font('Helvetica-Oblique').fontSize(8)
  .text('Generated for HNScorp PH · Clerque Sprint 19 · ' + new Date().toISOString().slice(0, 10),
        { align: 'center' });

doc.end();
console.log(`✓ Wrote ${OUT}`);

#!/usr/bin/env node
/**
 * Build simulated tablet screenshots for the Play Store listing.
 *
 *   node scripts/build-tablet-screenshots.js
 *
 * Output: 1920×1080 landscape PNGs (16:9, qualifies for both 7-inch and
 * 10-inch tablet slots; 10-inch requires min 1080 on each side — we hit
 * that exactly on the short edge).
 *
 * Counter's tablet UX is the showcase surface: 3-pane terminal, full
 * Tendering modal, Z-Read closing screen, FEFO inventory list. These
 * promotional renders mirror the real UI states.
 */
const sharp = require('sharp');
const fs    = require('node:fs');
const path  = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT  = path.join(ROOT, 'play-store', 'screenshots', 'tablet');
const W    = 1920;
const H    = 1080;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const C = {
  primary:   '#8B5E3C',
  primaryDk: '#714A2D',
  cream:     '#EEE9DF',
  paper:     '#FBF8F2',
  ink:       '#2A1F18',
  muted:     '#6F5B4B',
  border:    '#E0D6C5',
  accent:    '#7C3AED',
  accentLt:  '#A78BFA',
  success:   '#2F855A',
  warn:      '#B45309',
  danger:    '#B91C1C',
  white:     '#FFFFFF',
};

// Brand mark (compact, for top-left)
const brandMark = (x, y, s = 1) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <rect width="56" height="56" rx="12" fill="${C.accent}"/>
    <text x="28" y="40" font-family="Georgia, serif" font-size="32" font-weight="700"
          fill="${C.white}" text-anchor="middle">c</text>
  </g>
`;

const topBar = (title, subtitle) => `
  <rect x="0" y="0" width="${W}" height="90" fill="${C.cream}"/>
  <rect x="0" y="90" width="${W}" height="2" fill="${C.border}"/>
  ${brandMark(28, 17, 1)}
  <text x="110" y="50" font-family="system-ui" font-size="28" font-weight="800" fill="${C.ink}">${title}</text>
  <text x="110" y="78" font-family="system-ui" font-size="20" fill="${C.muted}">${subtitle}</text>
  <rect x="${W-440}" y="22" width="240" height="48" rx="24" fill="${C.success}" opacity="0.15"/>
  <circle cx="${W-410}" cy="46" r="6" fill="${C.success}"/>
  <text x="${W-388}" y="54" font-family="system-ui" font-size="20" font-weight="700" fill="${C.success}">Shift open · Ana</text>
  <rect x="${W-180}" y="22" width="150" height="48" rx="24" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="${W-105}" y="54" font-family="system-ui" font-size="22" font-weight="600" text-anchor="middle" fill="${C.ink}">⚙ Settings</text>
`;

// ── Screen 1: Terminal (3-pane) ─────────────────────────────────
function terminal() {
  // Left sidebar: categories. Middle: product grid. Right: cart.
  const cats = ['All', 'Coffee', 'Bread', 'Cake', 'Pastry', 'Drinks', 'Add-ons'];
  const catSvg = cats.map((c, i) => `
    <rect x="30" y="${130 + i * 80}" width="240" height="64" rx="12" fill="${i === 1 ? C.primary : 'none'}"/>
    <text x="60" y="${172 + i * 80}" font-family="system-ui" font-size="24" font-weight="${i === 1 ? 700 : 500}" fill="${i === 1 ? C.white : C.ink}">${c}</text>
  `).join('');

  const products = [
    { name: 'Espresso',    price: '85',  cat: '' },
    { name: 'Americano',   price: '95',  cat: '' },
    { name: 'Cappuccino',  price: '120', cat: '' },
    { name: 'Latte',       price: '120', cat: '' },
    { name: 'Macchiato',   price: '130', cat: '' },
    { name: 'Mocha',       price: '140', cat: '' },
    { name: 'Flat White',  price: '130', cat: '' },
    { name: 'Cortado',     price: '125', cat: '' },
    { name: 'Cold Brew',   price: '150', cat: 'LOW' },
  ];
  const gw = 260, gh = 200, gap = 20;
  const grid = products.map((p, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 320 + col * (gw + gap);
    const y = 130 + row * (gh + gap);
    return `
      <rect x="${x}" y="${y}" width="${gw}" height="${gh}" rx="14" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
      <rect x="${x}" y="${y}" width="${gw}" height="100" rx="14" fill="${C.cream}"/>
      <rect x="${x}" y="${y+85}" width="${gw}" height="15" fill="${C.cream}"/>
      <text x="${x+20}" y="${y+135}" font-family="system-ui" font-size="22" font-weight="700" fill="${C.ink}">${p.name}</text>
      <text x="${x+20}" y="${y+178}" font-family="system-ui" font-size="28" font-weight="800" fill="${C.primary}">₱ ${p.price}</text>
      ${p.cat ? `<rect x="${x+gw-80}" y="${y+14}" width="68" height="32" rx="16" fill="${C.warn}"/><text x="${x+gw-46}" y="${y+36}" font-family="system-ui" font-size="18" font-weight="800" text-anchor="middle" fill="${C.white}">LOW</text>` : ''}
    `;
  }).join('');

  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  ${topBar('Terminal', 'Demo Bakery · Today · OR 042–0067')}

  <!-- Left categories pane -->
  <rect x="0" y="92" width="300" height="${H-92}" fill="${C.white}"/>
  <rect x="300" y="92" width="2" height="${H-92}" fill="${C.border}"/>
  ${catSvg}

  <!-- Middle product grid -->
  ${grid}

  <!-- Right cart pane -->
  <rect x="${W-540}" y="92" width="540" height="${H-92}" fill="${C.white}"/>
  <rect x="${W-540}" y="92" width="2" height="${H-92}" fill="${C.border}"/>

  <text x="${W-510}" y="140" font-family="system-ui" font-size="26" font-weight="800" fill="${C.ink}">Current order</text>
  <text x="${W-510}" y="170" font-family="system-ui" font-size="18" fill="${C.muted}">3 items · No customer</text>

  <!-- Cart lines -->
  <rect x="${W-520}" y="200" width="500" height="86" rx="12" fill="${C.cream}"/>
  <text x="${W-500}" y="232" font-family="system-ui" font-size="22" font-weight="700" fill="${C.ink}">Cappuccino × 2</text>
  <text x="${W-500}" y="262" font-family="system-ui" font-size="18" fill="${C.muted}">₱ 120 ea</text>
  <text x="${W-40}" y="252" font-family="system-ui" font-size="26" font-weight="800" text-anchor="end" fill="${C.ink}">₱ 240</text>

  <rect x="${W-520}" y="300" width="500" height="86" rx="12" fill="${C.cream}"/>
  <text x="${W-500}" y="332" font-family="system-ui" font-size="22" font-weight="700" fill="${C.ink}">Pandesal × 6</text>
  <text x="${W-500}" y="362" font-family="system-ui" font-size="18" fill="${C.muted}">₱ 10 ea</text>
  <text x="${W-40}" y="352" font-family="system-ui" font-size="26" font-weight="800" text-anchor="end" fill="${C.ink}">₱ 60</text>

  <rect x="${W-520}" y="400" width="500" height="86" rx="12" fill="${C.cream}"/>
  <text x="${W-500}" y="432" font-family="system-ui" font-size="22" font-weight="700" fill="${C.ink}">Ensaymada × 2</text>
  <text x="${W-500}" y="462" font-family="system-ui" font-size="18" fill="${C.muted}">₱ 45 ea</text>
  <text x="${W-40}" y="452" font-family="system-ui" font-size="26" font-weight="800" text-anchor="end" fill="${C.ink}">₱ 90</text>

  <!-- Quick actions -->
  <rect x="${W-520}" y="510" width="240" height="56" rx="10" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="${W-400}" y="546" font-family="system-ui" font-size="20" font-weight="600" text-anchor="middle" fill="${C.ink}">+ Customer</text>
  <rect x="${W-270}" y="510" width="240" height="56" rx="10" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="${W-150}" y="546" font-family="system-ui" font-size="20" font-weight="600" text-anchor="middle" fill="${C.ink}">% Discount</text>

  <!-- Totals -->
  <rect x="${W-540}" y="${H-280}" width="540" height="2" fill="${C.border}"/>
  <text x="${W-510}" y="${H-220}" font-family="system-ui" font-size="20" fill="${C.muted}">Subtotal</text>
  <text x="${W-30}" y="${H-220}" font-family="system-ui" font-size="20" text-anchor="end" fill="${C.ink}">₱ 348.21</text>
  <text x="${W-510}" y="${H-185}" font-family="system-ui" font-size="20" fill="${C.muted}">VAT 12%</text>
  <text x="${W-30}" y="${H-185}" font-family="system-ui" font-size="20" text-anchor="end" fill="${C.ink}">₱ 41.79</text>
  <text x="${W-510}" y="${H-130}" font-family="system-ui" font-size="32" font-weight="800" fill="${C.ink}">Total</text>
  <text x="${W-30}" y="${H-130}" font-family="system-ui" font-size="44" font-weight="800" text-anchor="end" fill="${C.primary}">₱ 390.00</text>

  <!-- Charge -->
  <rect x="${W-520}" y="${H-90}" width="500" height="72" rx="14" fill="${C.primary}"/>
  <text x="${W-270}" y="${H-44}" font-family="system-ui" font-size="28" font-weight="800" text-anchor="middle" fill="${C.white}">Charge ₱ 390.00 →</text>
</svg>`;
}

// ── Screen 2: Tendering modal ───────────────────────────────────
function tendering() {
  const methods = [
    { label: 'Cash',    icon: '₱',  active: true,  hint: 'Most common' },
    { label: 'GCash',   icon: 'G',  active: false, hint: 'Scan QR' },
    { label: 'PayMaya', icon: 'M',  active: false, hint: 'Scan QR' },
    { label: 'Card',    icon: '◫',  active: false, hint: 'Bluetooth terminal' },
    { label: 'Split',   icon: '⇆',  active: false, hint: 'Multiple methods' },
  ];

  const cw = 320, ch = 200, gap = 24;
  const total = methods.length * cw + (methods.length-1) * gap;
  const startX = (W - total) / 2;

  const grid = methods.map((m, i) => {
    const x = startX + i * (cw + gap);
    const y = 380;
    return `
      <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="20" fill="${m.active ? C.cream : C.white}" stroke="${m.active ? C.primary : C.border}" stroke-width="${m.active ? 4 : 2}"/>
      <circle cx="${x+70}" cy="${y+90}" r="34" fill="${C.primary}"/>
      <text x="${x+70}" y="${y+102}" font-family="system-ui" font-size="34" font-weight="800" text-anchor="middle" fill="${C.white}">${m.icon}</text>
      <text x="${x+130}" y="${y+92}" font-family="system-ui" font-size="28" font-weight="700" fill="${C.ink}">${m.label}</text>
      <text x="${x+130}" y="${y+124}" font-family="system-ui" font-size="18" fill="${C.muted}">${m.hint}</text>
      ${m.active ? `<circle cx="${x+cw-40}" cy="${y+40}" r="20" fill="${C.primary}"/><text x="${x+cw-40}" y="${y+48}" font-family="system-ui" font-size="22" font-weight="800" text-anchor="middle" fill="${C.white}">✓</text>` : ''}
    `;
  }).join('');

  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  ${topBar('Tendering', 'Step 1 of 3 — Choose payment method')}

  <!-- Amount headline -->
  <text x="${W/2}" y="220" font-family="system-ui" font-size="32" font-weight="600" text-anchor="middle" fill="${C.muted}">Total to collect</text>
  <text x="${W/2}" y="310" font-family="system-ui" font-size="92" font-weight="800" text-anchor="middle" fill="${C.primary}">₱ 358.80</text>

  ${grid}

  <!-- Progress dots -->
  <circle cx="${W/2 - 60}" cy="640" r="14" fill="${C.primary}"/>
  <rect   x="${W/2 - 44}" y="634" width="48" height="12" fill="${C.border}"/>
  <circle cx="${W/2}" cy="640" r="14" fill="${C.border}"/>
  <rect   x="${W/2 + 16}" y="634" width="48" height="12" fill="${C.border}"/>
  <circle cx="${W/2 + 60}" cy="640" r="14" fill="${C.border}"/>

  <!-- Cash amount entry hint -->
  <rect x="${W/2 - 400}" y="720" width="800" height="200" rx="20" fill="${C.cream}"/>
  <text x="${W/2}" y="780" font-family="system-ui" font-size="26" font-weight="600" text-anchor="middle" fill="${C.muted}">Cash tendered</text>
  <text x="${W/2}" y="870" font-family="system-ui" font-size="68" font-weight="800" text-anchor="middle" fill="${C.ink}">₱ 500.00</text>
  <text x="${W/2}" y="910" font-family="system-ui" font-size="22" text-anchor="middle" fill="${C.success}">Change ₱ 141.20</text>

  <!-- Continue -->
  <rect x="${W/2 - 220}" y="970" width="440" height="80" rx="16" fill="${C.primary}"/>
  <text x="${W/2}" y="1023" font-family="system-ui" font-size="28" font-weight="800" text-anchor="middle" fill="${C.white}">Continue → Confirm</text>
</svg>`;
}

// ── Screen 3: Z-Read closing ────────────────────────────────────
function zRead() {
  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  ${topBar('Z-Read · Close shift', 'Shift opened 2026-05-22 06:32 by Ana')}

  <!-- Hero summary card -->
  <rect x="40" y="130" width="900" height="280" rx="24" fill="${C.primary}"/>
  <text x="80" y="200" font-family="system-ui" font-size="24" font-weight="600" fill="${C.cream}" opacity="0.9">Gross sales</text>
  <text x="80" y="300" font-family="system-ui" font-size="80" font-weight="800" fill="${C.white}">₱ 14,820.00</text>
  <text x="80" y="350" font-family="system-ui" font-size="22" fill="${C.cream}">42 orders · OR 042–0026 to 042–0067</text>
  <rect x="80" y="370" width="180" height="34" rx="17" fill="${C.cream}" opacity="0.3"/>
  <text x="170" y="392" font-family="system-ui" font-size="18" font-weight="700" text-anchor="middle" fill="${C.white}">8h 12m shift</text>

  <!-- VAT breakdown -->
  <rect x="40" y="440" width="900" height="380" rx="20" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="70" y="490" font-family="system-ui" font-size="24" font-weight="800" fill="${C.ink}">VAT breakdown</text>
  <text x="70" y="550" font-family="system-ui" font-size="20" fill="${C.muted}">VATable sales</text>
  <text x="910" y="550" font-family="system-ui" font-size="20" text-anchor="end" fill="${C.ink}">₱ 13,232.14</text>
  <text x="70" y="600" font-family="system-ui" font-size="20" fill="${C.muted}">VAT 12%</text>
  <text x="910" y="600" font-family="system-ui" font-size="20" text-anchor="end" fill="${C.ink}">₱ 1,587.86</text>
  <text x="70" y="650" font-family="system-ui" font-size="20" fill="${C.muted}">VAT-exempt (Senior/PWD)</text>
  <text x="910" y="650" font-family="system-ui" font-size="20" text-anchor="end" fill="${C.ink}">₱ 1,420.00</text>
  <text x="70" y="700" font-family="system-ui" font-size="20" fill="${C.muted}">Zero-rated</text>
  <text x="910" y="700" font-family="system-ui" font-size="20" text-anchor="end" fill="${C.ink}">₱ 0.00</text>
  <text x="70" y="750" font-family="system-ui" font-size="20" fill="${C.muted}">Discounts</text>
  <text x="910" y="750" font-family="system-ui" font-size="20" text-anchor="end" fill="${C.danger}">−₱ 284.00</text>
  <text x="70" y="800" font-family="system-ui" font-size="20" fill="${C.muted}">Voids (3)</text>
  <text x="910" y="800" font-family="system-ui" font-size="20" text-anchor="end" fill="${C.danger}">−₱ 145.00</text>

  <!-- Tender breakdown -->
  <rect x="970" y="130" width="910" height="690" rx="20" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="1000" y="180" font-family="system-ui" font-size="24" font-weight="800" fill="${C.ink}">Tender breakdown</text>

  ${[
    { m: 'Cash',    a: '8,420.00', c: '24 orders', w: 0.57 },
    { m: 'GCash',   a: '3,260.00', c: '11 orders', w: 0.22 },
    { m: 'PayMaya', a: '1,890.00', c: '5 orders',  w: 0.13 },
    { m: 'Card',    a: '1,250.00', c: '2 orders',  w: 0.08 },
  ].map((t, i) => {
    const y = 240 + i * 130;
    return `
      <text x="1000" y="${y}" font-family="system-ui" font-size="24" font-weight="700" fill="${C.ink}">${t.m}</text>
      <text x="1850" y="${y}" font-family="system-ui" font-size="28" font-weight="800" text-anchor="end" fill="${C.ink}">₱ ${t.a}</text>
      <text x="1000" y="${y+34}" font-family="system-ui" font-size="18" fill="${C.muted}">${t.c}</text>
      <rect x="1000" y="${y+58}" width="850" height="20" rx="10" fill="${C.cream}"/>
      <rect x="1000" y="${y+58}" width="${850*t.w}" height="20" rx="10" fill="${C.primary}"/>
    `;
  }).join('')}

  <!-- Drawer reconciliation -->
  <rect x="40" y="850" width="1840" height="180" rx="20" fill="${C.cream}"/>
  <text x="80" y="900" font-family="system-ui" font-size="24" font-weight="800" fill="${C.ink}">Drawer reconciliation</text>
  <text x="80" y="950" font-family="system-ui" font-size="20" fill="${C.muted}">Expected · ₱ 9,420.00</text>
  <text x="500" y="950" font-family="system-ui" font-size="20" fill="${C.muted}">Counted · ₱ 9,420.00</text>
  <text x="920" y="950" font-family="system-ui" font-size="20" font-weight="700" fill="${C.success}">Variance · ₱ 0.00 ✓</text>

  <rect x="1500" y="870" width="340" height="80" rx="14" fill="${C.primary}"/>
  <text x="1670" y="922" font-family="system-ui" font-size="22" font-weight="800" text-anchor="middle" fill="${C.white}">Print Z-Read → Close</text>
</svg>`;
}

// ── Screen 4: FEFO inventory list ───────────────────────────────
function inventory() {
  const items = [
    { name: 'Whole Milk 1L',     batch: 'B-0142', qty: 8,  exp: '2026-05-25', status: 'expiring', days: 3 },
    { name: 'Heavy Cream 500mL', batch: 'B-0138', qty: 4,  exp: '2026-05-23', status: 'today',    days: 0 },
    { name: 'Oat Milk 1L',       batch: 'B-0156', qty: 2,  exp: '2026-06-12', status: 'low',      days: 21 },
    { name: 'AP Flour 25kg',     batch: 'B-0099', qty: 3,  exp: '2026-08-10', status: 'low',      days: 80 },
    { name: 'Cane Sugar 50kg',   batch: 'B-0102', qty: 1,  exp: '2027-01-15', status: 'low',      days: 238 },
    { name: 'Butter 500g',       batch: 'B-0144', qty: 24, exp: '2026-06-28', status: 'ok',       days: 37 },
    { name: 'Eggs (tray of 30)', batch: 'B-0151', qty: 42, exp: '2026-05-30', status: 'ok',       days: 8 },
  ];

  const rows = items.map((it, i) => {
    const y = 220 + i * 100;
    let badge = '';
    if (it.status === 'today')    badge = `<rect x="1660" y="${y+24}" width="180" height="48" rx="24" fill="${C.danger}"/><text x="1750" y="${y+56}" font-family="system-ui" font-size="22" font-weight="800" text-anchor="middle" fill="${C.white}">EXPIRES TODAY</text>`;
    if (it.status === 'expiring') badge = `<rect x="1700" y="${y+24}" width="140" height="48" rx="24" fill="${C.warn}"/><text x="1770" y="${y+56}" font-family="system-ui" font-size="22" font-weight="800" text-anchor="middle" fill="${C.white}">${it.days}d LEFT</text>`;
    if (it.status === 'low')      badge = `<rect x="1740" y="${y+24}" width="100" height="48" rx="24" fill="${C.warn}" opacity="0.85"/><text x="1790" y="${y+56}" font-family="system-ui" font-size="22" font-weight="800" text-anchor="middle" fill="${C.white}">LOW</text>`;
    return `
      <rect x="40" y="${y}" width="1840" height="90" rx="14" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
      <text x="80" y="${y+42}" font-family="system-ui" font-size="26" font-weight="700" fill="${C.ink}">${it.name}</text>
      <text x="80" y="${y+76}" font-family="system-ui" font-size="20" fill="${C.muted}">Batch ${it.batch} · FEFO position #${i+1}</text>
      <text x="900" y="${y+58}" font-family="system-ui" font-size="26" font-weight="700" text-anchor="middle" fill="${C.ink}">${it.qty}</text>
      <text x="900" y="${y+82}" font-family="system-ui" font-size="18" text-anchor="middle" fill="${C.muted}">units</text>
      <text x="1300" y="${y+58}" font-family="system-ui" font-size="24" text-anchor="middle" fill="${C.ink}">${it.exp}</text>
      <text x="1300" y="${y+82}" font-family="system-ui" font-size="18" text-anchor="middle" fill="${C.muted}">expiry</text>
      ${badge}
    `;
  }).join('');

  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  ${topBar('Inventory · FEFO', 'First-Expired-First-Out · 7 active batches')}

  <!-- Filter chips -->
  <rect x="40"  y="130" width="180" height="56" rx="28" fill="${C.primary}"/>
  <text x="130" y="167" font-family="system-ui" font-size="22" font-weight="700" text-anchor="middle" fill="${C.white}">All (7)</text>
  <rect x="240" y="130" width="220" height="56" rx="28" fill="${C.white}" stroke="${C.danger}" stroke-width="2"/>
  <text x="350" y="167" font-family="system-ui" font-size="22" font-weight="700" text-anchor="middle" fill="${C.danger}">Expiring (2)</text>
  <rect x="480" y="130" width="180" height="56" rx="28" fill="${C.white}" stroke="${C.warn}" stroke-width="2"/>
  <text x="570" y="167" font-family="system-ui" font-size="22" font-weight="700" text-anchor="middle" fill="${C.warn}">Low (3)</text>

  <text x="1860" y="167" font-family="system-ui" font-size="22" font-weight="600" text-anchor="end" fill="${C.muted}">Sorted by expiry · earliest first</text>

  ${rows}
</svg>`;
}

const screens = [
  { name: '1-terminal.png',  svg: terminal()  },
  { name: '2-tendering.png', svg: tendering() },
  { name: '3-zread.png',     svg: zRead()     },
  { name: '4-fefo.png',      svg: inventory() },
];

(async () => {
  console.log(`Generating ${screens.length} tablet screenshots @ ${W}×${H}…`);
  for (const s of screens) {
    const out = path.join(OUT, s.name);
    await sharp(Buffer.from(s.svg), { density: 144 })
      .resize(W, H)
      .png()
      .toFile(out);
    console.log(`  ✓ ${path.relative(ROOT, out)}`);
  }
  console.log('\nUpload these to BOTH 7-inch and 10-inch tablet screenshot slots.');
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Build simulated Play Store screenshots from SVG templates.
 *
 *   node scripts/build-screenshots.js
 *
 * Generates six 1080×1920 phone screenshots that mirror the real Counter
 * UI states. They are *promotional renders*, not device captures — fine
 * for the Play Store internal-testing track while real device shots are
 * being collected. Replace with native screenshots before promoting to
 * production.
 *
 * Brand palette (mirrors src/theme/tokens.ts):
 *   primary   #8B5E3C   brown
 *   cream     #EEE9DF
 *   ink       #2A1F18
 *   muted     #6F5B4B
 *   accent    #7C3AED   purple (Clerque mark only)
 *   success   #2F855A
 *   warn      #B45309
 */
const sharp = require('sharp');
const fs    = require('node:fs');
const path  = require('node:path');

const ROOT  = path.resolve(__dirname, '..');
const OUT   = path.join(ROOT, 'play-store', 'screenshots', 'phone');
const W     = 1080;
const H     = 1920;

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

// Re-usable status bar + bottom tab bar
const statusBar = `
  <rect x="0" y="0" width="${W}" height="60" fill="${C.cream}"/>
  <text x="60"  y="40" font-family="system-ui" font-size="26" font-weight="600" fill="${C.ink}">9:41</text>
  <circle cx="${W-160}" cy="32" r="10" fill="${C.ink}"/>
  <rect x="${W-130}" y="22" width="40" height="20" rx="4" fill="${C.ink}"/>
  <rect x="${W-80}"  y="18" width="50" height="24" rx="4" fill="none" stroke="${C.ink}" stroke-width="3"/>
  <rect x="${W-75}"  y="22" width="40" height="16" rx="2" fill="${C.ink}"/>
`;

const tabBar = (active) => {
  const tabs = ['Home', 'Sell', 'Inventory', 'Reports', 'More'];
  const icons = ['◉', '🛒', '📦', '📊', '⋯'];
  const w = W / tabs.length;
  return tabs.map((label, i) => {
    const cx = i * w + w / 2;
    const isActive = i === active;
    const color = isActive ? C.primary : C.muted;
    return `
      <text x="${cx}" y="${H-90}" font-size="34" text-anchor="middle" fill="${color}">${icons[i]}</text>
      <text x="${cx}" y="${H-50}" font-family="system-ui" font-size="22" font-weight="${isActive?700:500}" text-anchor="middle" fill="${color}">${label}</text>
      ${isActive ? `<rect x="${cx-30}" y="${H-138}" width="60" height="4" rx="2" fill="${C.primary}"/>` : ''}
    `;
  }).join('') + `
    <rect x="0" y="${H-160}" width="${W}" height="2" fill="${C.border}"/>
    <rect x="0" y="${H-160}" width="${W}" height="160" fill="${C.paper}" opacity="0.6"/>
  `;
};

const tabBarBg = `<rect x="0" y="${H-160}" width="${W}" height="160" fill="${C.white}"/><rect x="0" y="${H-160}" width="${W}" height="2" fill="${C.border}"/>`;

const tabBarFull = (active) => {
  const tabs = ['Home', 'Sell', 'Inventory', 'Reports', 'More'];
  const icons = ['⌂', '$', '▦', '◔', '⋯'];
  const w = W / tabs.length;
  return tabBarBg + tabs.map((label, i) => {
    const cx = i * w + w / 2;
    const isActive = i === active;
    const color = isActive ? C.primary : C.muted;
    return `
      <text x="${cx}" y="${H-92}" font-family="system-ui" font-size="42" font-weight="600" text-anchor="middle" fill="${color}">${icons[i]}</text>
      <text x="${cx}" y="${H-42}" font-family="system-ui" font-size="22" font-weight="${isActive?700:500}" text-anchor="middle" fill="${color}">${label}</text>
    `;
  }).join('');
};

const headerBar = (title, subtitle = '') => `
  <rect x="0" y="60" width="${W}" height="140" fill="${C.cream}"/>
  <text x="60" y="130" font-family="system-ui" font-size="44" font-weight="800" fill="${C.ink}">${title}</text>
  ${subtitle ? `<text x="60" y="172" font-family="system-ui" font-size="26" font-weight="500" fill="${C.muted}">${subtitle}</text>` : ''}
  <rect x="0" y="200" width="${W}" height="2" fill="${C.border}"/>
`;

// ── Screen 1: Sign in ────────────────────────────────────────────
function signIn() {
  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="${C.cream}"/>
      <stop offset="100%" stop-color="${C.paper}"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="${C.accentLt}"/>
      <stop offset="100%" stop-color="${C.accent}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${statusBar}

  <!-- Clerque logo mark -->
  <g transform="translate(${W/2-160}, 280)">
    <rect width="320" height="320" rx="64" fill="url(#mark)"/>
    <rect x="84" y="74" width="56" height="172" rx="14" fill="#F4ECFB"/>
    <text x="112" y="200" font-family="Georgia, serif" font-size="116" font-weight="700" fill="#5B21B6" text-anchor="middle">c</text>
    <rect x="160" y="74" width="56" height="172" rx="14" fill="#E9DCF7"/>
    <circle cx="188" cy="116" r="9" fill="#7C3AED"/>
    <circle cx="188" cy="160" r="9" fill="#7C3AED"/>
    <circle cx="188" cy="204" r="9" fill="#7C3AED"/>
    <rect x="236" y="74" width="56" height="172" rx="14" fill="#DCC8F2"/>
    <rect x="248" y="110" width="32" height="8" rx="4" fill="${C.accentLt}"/>
    <rect x="248" y="134" width="32" height="8" rx="4" fill="${C.accentLt}"/>
    <rect x="248" y="158" width="32" height="8" rx="4" fill="${C.accentLt}"/>
  </g>

  <text x="${W/2}" y="680" font-family="system-ui" font-size="68" font-weight="800" text-anchor="middle" fill="${C.ink}">Clerque Counter</text>
  <text x="${W/2}" y="730" font-family="system-ui" font-size="28" font-weight="500" text-anchor="middle" fill="${C.muted}">Cashier till for Philippine SMBs</text>

  <!-- Tabs: Password / PIN -->
  <rect x="80" y="820" width="920" height="80" rx="16" fill="${C.cream}"/>
  <rect x="80" y="820" width="460" height="80" rx="16" fill="${C.white}"/>
  <text x="310" y="872" font-family="system-ui" font-size="30" font-weight="700" text-anchor="middle" fill="${C.ink}">Password</text>
  <text x="770" y="872" font-family="system-ui" font-size="30" font-weight="600" text-anchor="middle" fill="${C.muted}">PIN</text>

  <!-- Inputs -->
  <text x="80" y="980" font-family="system-ui" font-size="26" font-weight="600" fill="${C.muted}">Company code</text>
  <rect x="80" y="1000" width="920" height="100" rx="14" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="110" y="1062" font-family="system-ui" font-size="32" fill="${C.ink}">demo-bakery</text>

  <text x="80" y="1160" font-family="system-ui" font-size="26" font-weight="600" fill="${C.muted}">Email</text>
  <rect x="80" y="1180" width="920" height="100" rx="14" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="110" y="1242" font-family="system-ui" font-size="32" fill="${C.ink}">owner@demo-bakery.ph</text>

  <text x="80" y="1340" font-family="system-ui" font-size="26" font-weight="600" fill="${C.muted}">Password</text>
  <rect x="80" y="1360" width="920" height="100" rx="14" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="110" y="1422" font-family="system-ui" font-size="32" fill="${C.ink}">••••••••••</text>

  <!-- CTA -->
  <rect x="80" y="1520" width="920" height="110" rx="18" fill="${C.primary}"/>
  <text x="${W/2}" y="1592" font-family="system-ui" font-size="36" font-weight="700" text-anchor="middle" fill="${C.white}">Sign in</text>

  <text x="${W/2}" y="1720" font-family="system-ui" font-size="24" text-anchor="middle" fill="${C.muted}">Subscription managed at clerque.cc</text>
</svg>`;
}

// ── Screen 2: Dashboard ─────────────────────────────────────────
function dashboard() {
  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  ${statusBar}
  ${headerBar('Good morning, Ana', 'Demo Bakery · Today')}

  <!-- Hero gross-sales card -->
  <rect x="60" y="260" width="${W-120}" height="320" rx="24" fill="${C.primary}"/>
  <text x="100" y="340" font-family="system-ui" font-size="28" font-weight="600" fill="${C.cream}" opacity="0.9">Gross sales today</text>
  <text x="100" y="450" font-family="system-ui" font-size="92" font-weight="800" fill="${C.white}">₱ 14,820.00</text>
  <text x="100" y="500" font-family="system-ui" font-size="26" fill="${C.cream}">42 orders · ₱ 352.86 avg ticket</text>
  <rect x="100" y="520" width="160" height="44" rx="22" fill="${C.cream}" opacity="0.25"/>
  <text x="180" y="551" font-family="system-ui" font-size="22" font-weight="700" text-anchor="middle" fill="${C.white}">+18% vs yest</text>

  <!-- Stat row -->
  <rect x="60"  y="620" width="305" height="220" rx="20" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="90"  y="680" font-family="system-ui" font-size="24" font-weight="600" fill="${C.muted}">Cash drawer</text>
  <text x="90"  y="750" font-family="system-ui" font-size="48" font-weight="800" fill="${C.ink}">₱ 6,420</text>
  <text x="90"  y="790" font-family="system-ui" font-size="22" fill="${C.success}">● Shift open</text>

  <rect x="388" y="620" width="305" height="220" rx="20" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="418" y="680" font-family="system-ui" font-size="24" font-weight="600" fill="${C.muted}">Low stock</text>
  <text x="418" y="750" font-family="system-ui" font-size="48" font-weight="800" fill="${C.warn}">3 items</text>
  <text x="418" y="790" font-family="system-ui" font-size="22" fill="${C.muted}">Oat milk · Flour · Sugar</text>

  <rect x="716" y="620" width="304" height="220" rx="20" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="746" y="680" font-family="system-ui" font-size="24" font-weight="600" fill="${C.muted}">Expiring soon</text>
  <text x="746" y="750" font-family="system-ui" font-size="48" font-weight="800" fill="${C.danger}">2 lots</text>
  <text x="746" y="790" font-family="system-ui" font-size="22" fill="${C.muted}">Milk · Cream</text>

  <!-- Today's pickups -->
  <text x="60" y="920" font-family="system-ui" font-size="32" font-weight="800" fill="${C.ink}">Today&apos;s pickups</text>
  <rect x="60" y="950" width="${W-120}" height="160" rx="20" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <rect x="60" y="950" width="8" height="160" rx="4" fill="${C.primary}"/>
  <text x="100" y="1010" font-family="system-ui" font-size="30" font-weight="700" fill="${C.ink}">Maria Santos · Custom cake</text>
  <text x="100" y="1050" font-family="system-ui" font-size="24" fill="${C.muted}">3:00 PM · &quot;Happy 7th Birthday Mia&quot;</text>
  <text x="100" y="1086" font-family="system-ui" font-size="22" fill="${C.success}">● Deposit paid · ₱ 600 balance</text>

  <rect x="60" y="1130" width="${W-120}" height="160" rx="20" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <rect x="60" y="1130" width="8" height="160" rx="4" fill="${C.accentLt}"/>
  <text x="100" y="1190" font-family="system-ui" font-size="30" font-weight="700" fill="${C.ink}">JR&apos;s Coffee · 24 pandesal</text>
  <text x="100" y="1230" font-family="system-ui" font-size="24" fill="${C.muted}">5:30 AM · Wholesale price list</text>
  <text x="100" y="1266" font-family="system-ui" font-size="22" fill="${C.success}">● Ready · ₱ 240.00</text>

  <!-- Bake list teaser -->
  <text x="60" y="1380" font-family="system-ui" font-size="32" font-weight="800" fill="${C.ink}">Tomorrow&apos;s bake list</text>
  <rect x="60" y="1410" width="${W-120}" height="200" rx="20" fill="${C.cream}"/>
  <text x="100" y="1470" font-family="system-ui" font-size="26" fill="${C.muted}">Recommended (7-day avg + pre-orders)</text>
  <text x="100" y="1530" font-family="system-ui" font-size="30" font-weight="700" fill="${C.ink}">Pandesal · 120 pcs</text>
  <text x="100" y="1572" font-family="system-ui" font-size="30" font-weight="700" fill="${C.ink}">Ensaymada · 40 pcs · Sliced loaf · 8</text>

  ${tabBarFull(0)}
</svg>`;
}

// ── Screen 3: Sell list ─────────────────────────────────────────
function sellList() {
  const cats = [
    { label: 'All',     active: true },
    { label: 'Coffee',  active: false },
    { label: 'Bread',   active: false },
    { label: 'Cake',    active: false },
    { label: 'Pastry',  active: false },
  ];
  const products = [
    { name: 'Espresso',         price: '85',  badge: '' },
    { name: 'Cappuccino',       price: '120', badge: '' },
    { name: 'Latte',            price: '120', badge: '' },
    { name: 'Pandesal',         price: '10',  badge: 'LOW' },
    { name: 'Ensaymada',        price: '45',  badge: '' },
    { name: 'Spanish Bread',    price: '15',  badge: '' },
    { name: 'Sliced Loaf',      price: '95',  badge: '' },
    { name: 'Chocolate Cake',   price: '650', badge: '7d' },
  ];
  let x = 60, y = 320;
  let catX = 60;
  const catSvg = cats.map(c => {
    const w = c.label.length * 22 + 80;
    const r = `
      <rect x="${catX}" y="${y - 40}" width="${w}" height="64" rx="32" fill="${c.active ? C.primary : C.white}" stroke="${c.active ? C.primary : C.border}" stroke-width="2"/>
      <text x="${catX + w/2}" y="${y + 2}" font-family="system-ui" font-size="26" font-weight="600" text-anchor="middle" fill="${c.active ? C.white : C.ink}">${c.label}</text>
    `;
    catX += w + 16;
    return r;
  }).join('');

  const cardW = 460, cardH = 240, gap = 30;
  const grid = products.map((p, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const px = 60 + col * (cardW + gap);
    const py = 440 + row * (cardH + gap);
    return `
      <rect x="${px}" y="${py}" width="${cardW}" height="${cardH}" rx="20" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
      <rect x="${px}" y="${py}" width="${cardW}" height="${cardH/2}" rx="20" fill="${C.cream}"/>
      <rect x="${px}" y="${py + cardH/2 - 20}" width="${cardW}" height="20" fill="${C.cream}"/>
      <text x="${px + 30}" y="${py + 80}" font-family="system-ui" font-size="32" font-weight="700" fill="${C.ink}">${p.name}</text>
      <text x="${px + 30}" y="${py + cardH - 40}" font-family="system-ui" font-size="40" font-weight="800" fill="${C.primary}">₱ ${p.price}</text>
      ${p.badge ? `
        <rect x="${px + cardW - 130}" y="${py + 20}" width="110" height="44" rx="22" fill="${p.badge === 'LOW' ? C.warn : C.danger}"/>
        <text x="${px + cardW - 75}" y="${py + 50}" font-family="system-ui" font-size="22" font-weight="800" text-anchor="middle" fill="${C.white}">${p.badge}</text>
      ` : ''}
    `;
  }).join('');

  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  ${statusBar}
  ${headerBar('Sell', 'Tap a product to add')}

  <!-- Search -->
  <rect x="60" y="230" width="${W-120}" height="74" rx="14" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
  <text x="90"  y="280" font-family="system-ui" font-size="28" fill="${C.muted}">⌕  Search or scan barcode</text>

  ${catSvg}
  ${grid}

  <!-- Floating cart -->
  <rect x="60" y="${H-260}" width="${W-120}" height="90" rx="22" fill="${C.primary}"/>
  <text x="100" y="${H-205}" font-family="system-ui" font-size="32" font-weight="700" fill="${C.white}">View cart · 3 items</text>
  <text x="${W-100}" y="${H-205}" font-family="system-ui" font-size="36" font-weight="800" text-anchor="end" fill="${C.white}">₱ 380.00</text>

  ${tabBarFull(1)}
</svg>`;
}

// ── Screen 4: Cart drawer ───────────────────────────────────────
function cart() {
  const lines = [
    { name: 'Cappuccino',  qty: 2, price: '120', total: '240' },
    { name: 'Pandesal',    qty: 6, price: '10',  total: '60'  },
    { name: 'Ensaymada',   qty: 2, price: '45',  total: '90'  },
  ];
  let y = 320;
  const items = lines.map(l => {
    const block = `
      <rect x="60" y="${y}" width="${W-120}" height="140" rx="18" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>
      <text x="100" y="${y+62}" font-family="system-ui" font-size="34" font-weight="700" fill="${C.ink}">${l.name}</text>
      <text x="100" y="${y+108}" font-family="system-ui" font-size="26" fill="${C.muted}">${l.qty} × ₱${l.price}</text>
      <text x="${W-100}" y="${y+90}" font-family="system-ui" font-size="40" font-weight="800" text-anchor="end" fill="${C.ink}">₱ ${l.total}</text>
    `;
    y += 160;
    return block;
  }).join('');

  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  ${statusBar}
  ${headerBar('Cart', '3 items · Shift open')}

  ${items}

  <!-- Customer + discount rows -->
  <rect x="60" y="${y+30}" width="${W-120}" height="100" rx="18" fill="${C.cream}"/>
  <text x="100" y="${y+92}" font-family="system-ui" font-size="28" font-weight="600" fill="${C.ink}">👤  Maria Santos</text>
  <text x="${W-100}" y="${y+92}" font-family="system-ui" font-size="26" text-anchor="end" fill="${C.muted}">Wholesale price list</text>

  <rect x="60" y="${y+150}" width="${W-120}" height="100" rx="18" fill="${C.cream}"/>
  <text x="100" y="${y+212}" font-family="system-ui" font-size="28" font-weight="600" fill="${C.ink}">% Senior discount (20%)</text>
  <text x="${W-100}" y="${y+212}" font-family="system-ui" font-size="26" text-anchor="end" fill="${C.danger}">−₱ 78.00</text>

  <!-- Totals -->
  <rect x="0" y="${H-440}" width="${W}" height="280" fill="${C.white}"/>
  <rect x="0" y="${H-440}" width="${W}" height="2" fill="${C.border}"/>

  <text x="60"  y="${H-380}" font-family="system-ui" font-size="28" fill="${C.muted}">Subtotal</text>
  <text x="${W-60}" y="${H-380}" font-family="system-ui" font-size="28" text-anchor="end" fill="${C.ink}">₱ 390.00</text>

  <text x="60"  y="${H-330}" font-family="system-ui" font-size="28" fill="${C.muted}">VAT (12%)</text>
  <text x="${W-60}" y="${H-330}" font-family="system-ui" font-size="28" text-anchor="end" fill="${C.ink}">₱ 46.80</text>

  <text x="60"  y="${H-280}" font-family="system-ui" font-size="28" fill="${C.muted}">Discount</text>
  <text x="${W-60}" y="${H-280}" font-family="system-ui" font-size="28" text-anchor="end" fill="${C.danger}">−₱ 78.00</text>

  <rect x="60" y="${H-250}" width="${W-120}" height="2" fill="${C.border}"/>

  <text x="60"  y="${H-180}" font-family="system-ui" font-size="34" font-weight="800" fill="${C.ink}">Total</text>
  <text x="${W-60}" y="${H-180}" font-family="system-ui" font-size="54" font-weight="800" text-anchor="end" fill="${C.primary}">₱ 358.80</text>

  <!-- Charge button -->
  <rect x="60" y="${H-110}" width="${W-120}" height="90" rx="20" fill="${C.primary}"/>
  <text x="${W/2}" y="${H-50}" font-family="system-ui" font-size="36" font-weight="800" text-anchor="middle" fill="${C.white}">Charge ₱ 358.80</text>
</svg>`;
}

// ── Screen 5: Tendering (method picker) ─────────────────────────
function tendering() {
  const methods = [
    { label: 'Cash',    icon: '₱',  active: true },
    { label: 'GCash',   icon: 'G',  active: false, hint: 'Scan QR' },
    { label: 'PayMaya', icon: 'P',  active: false, hint: 'Scan QR' },
    { label: 'Card',    icon: '◫',  active: false, hint: 'Terminal' },
    { label: 'Split',   icon: '⇆',  active: false, hint: 'Multiple' },
  ];
  let y = 380;
  const list = methods.map(m => {
    const block = `
      <rect x="60" y="${y}" width="${W-120}" height="140" rx="20" fill="${m.active ? C.cream : C.white}" stroke="${m.active ? C.primary : C.border}" stroke-width="${m.active ? 4 : 2}"/>
      <rect x="100" y="${y+30}" width="80" height="80" rx="40" fill="${C.primary}"/>
      <text x="140" y="${y+88}" font-family="system-ui" font-size="44" font-weight="800" text-anchor="middle" fill="${C.white}">${m.icon}</text>
      <text x="220" y="${y+72}" font-family="system-ui" font-size="36" font-weight="700" fill="${C.ink}">${m.label}</text>
      ${m.hint ? `<text x="220" y="${y+110}" font-family="system-ui" font-size="24" fill="${C.muted}">${m.hint}</text>` : ''}
      ${m.active ? `<circle cx="${W-130}" cy="${y+70}" r="28" fill="${C.primary}"/><text x="${W-130}" y="${y+82}" font-family="system-ui" font-size="36" font-weight="800" text-anchor="middle" fill="${C.white}">✓</text>` : `<text x="${W-110}" y="${y+82}" font-family="system-ui" font-size="40" fill="${C.muted}">›</text>`}
    `;
    y += 160;
    return block;
  }).join('');

  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  ${statusBar}

  <!-- Tendering header with progress -->
  <rect x="0" y="60" width="${W}" height="260" fill="${C.cream}"/>
  <text x="60" y="130" font-family="system-ui" font-size="32" font-weight="600" fill="${C.muted}">Step 1 of 3</text>
  <text x="60" y="190" font-family="system-ui" font-size="48" font-weight="800" fill="${C.ink}">Choose payment method</text>
  <text x="60" y="240" font-family="system-ui" font-size="36" font-weight="700" fill="${C.primary}">₱ 358.80 to collect</text>

  <!-- Progress dots -->
  <circle cx="60"  cy="290" r="14" fill="${C.primary}"/>
  <rect   x="74"  y="284" width="80" height="12" fill="${C.border}"/>
  <circle cx="170" cy="290" r="14" fill="${C.border}"/>
  <rect   x="184" y="284" width="80" height="12" fill="${C.border}"/>
  <circle cx="280" cy="290" r="14" fill="${C.border}"/>

  ${list}

  <!-- CTA -->
  <rect x="60" y="${H-260}" width="${W-120}" height="100" rx="22" fill="${C.primary}"/>
  <text x="${W/2}" y="${H-195}" font-family="system-ui" font-size="36" font-weight="800" text-anchor="middle" fill="${C.white}">Continue → Tender</text>

  ${tabBarFull(1)}
</svg>`;
}

// ── Screen 6: Receipt ───────────────────────────────────────────
function receipt() {
  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.cream}"/>
  ${statusBar}

  <!-- Header -->
  <rect x="0" y="60" width="${W}" height="200" fill="${C.success}"/>
  <circle cx="${W/2}" cy="140" r="50" fill="${C.white}"/>
  <text x="${W/2}" y="158" font-family="system-ui" font-size="56" font-weight="800" text-anchor="middle" fill="${C.success}">✓</text>
  <text x="${W/2}" y="230" font-family="system-ui" font-size="38" font-weight="800" text-anchor="middle" fill="${C.white}">Payment received</text>

  <!-- Paper receipt -->
  <rect x="60" y="300" width="${W-120}" height="1300" rx="20" fill="${C.white}" stroke="${C.border}" stroke-width="2"/>

  <text x="${W/2}" y="370" font-family="system-ui" font-size="36" font-weight="800" text-anchor="middle" fill="${C.ink}">DEMO BAKERY</text>
  <text x="${W/2}" y="408" font-family="system-ui" font-size="22" text-anchor="middle" fill="${C.muted}">123 Real St, Quezon City</text>
  <text x="${W/2}" y="438" font-family="system-ui" font-size="22" text-anchor="middle" fill="${C.muted}">VAT REG TIN 123-456-789-00000</text>

  <text x="${W/2}" y="500" font-family="system-ui" font-size="32" font-weight="800" text-anchor="middle" fill="${C.ink}">OFFICIAL RECEIPT</text>
  <text x="${W/2}" y="538" font-family="system-ui" font-size="24" text-anchor="middle" fill="${C.muted}">Pang-opisyal na Resibo</text>

  <rect x="100" y="570" width="${W-200}" height="2" fill="${C.border}" stroke-dasharray="4,4"/>

  <text x="100" y="620" font-family="monospace" font-size="24" fill="${C.muted}">OR No.</text>
  <text x="${W-100}" y="620" font-family="monospace" font-size="24" text-anchor="end" fill="${C.ink}">000042</text>
  <text x="100" y="660" font-family="monospace" font-size="24" fill="${C.muted}">Date</text>
  <text x="${W-100}" y="660" font-family="monospace" font-size="24" text-anchor="end" fill="${C.ink}">2026-05-22 14:32</text>
  <text x="100" y="700" font-family="monospace" font-size="24" fill="${C.muted}">Cashier</text>
  <text x="${W-100}" y="700" font-family="monospace" font-size="24" text-anchor="end" fill="${C.ink}">Ana</text>

  <rect x="100" y="730" width="${W-200}" height="2" fill="${C.border}" stroke-dasharray="4,4"/>

  <text x="100" y="790" font-family="monospace" font-size="26" fill="${C.ink}">2 × Cappuccino</text>
  <text x="${W-100}" y="790" font-family="monospace" font-size="26" text-anchor="end" fill="${C.ink}">240.00</text>
  <text x="100" y="830" font-family="monospace" font-size="26" fill="${C.ink}">6 × Pandesal</text>
  <text x="${W-100}" y="830" font-family="monospace" font-size="26" text-anchor="end" fill="${C.ink}">60.00</text>
  <text x="100" y="870" font-family="monospace" font-size="26" fill="${C.ink}">2 × Ensaymada</text>
  <text x="${W-100}" y="870" font-family="monospace" font-size="26" text-anchor="end" fill="${C.ink}">90.00</text>

  <rect x="100" y="910" width="${W-200}" height="2" fill="${C.border}" stroke-dasharray="4,4"/>

  <text x="100" y="970" font-family="monospace" font-size="26" fill="${C.muted}">VATable Sales</text>
  <text x="${W-100}" y="970" font-family="monospace" font-size="26" text-anchor="end" fill="${C.ink}">348.21</text>
  <text x="100" y="1010" font-family="monospace" font-size="26" fill="${C.muted}">VAT (12%)</text>
  <text x="${W-100}" y="1010" font-family="monospace" font-size="26" text-anchor="end" fill="${C.ink}">41.79</text>
  <text x="100" y="1050" font-family="monospace" font-size="26" fill="${C.muted}">Senior disc 20%</text>
  <text x="${W-100}" y="1050" font-family="monospace" font-size="26" text-anchor="end" fill="${C.danger}">-78.00</text>

  <rect x="100" y="1090" width="${W-200}" height="2" fill="${C.ink}"/>

  <text x="100" y="1160" font-family="monospace" font-size="34" font-weight="800" fill="${C.ink}">TOTAL</text>
  <text x="${W-100}" y="1160" font-family="monospace" font-size="42" font-weight="800" text-anchor="end" fill="${C.ink}">₱ 358.80</text>

  <text x="100" y="1220" font-family="monospace" font-size="26" fill="${C.muted}">Cash</text>
  <text x="${W-100}" y="1220" font-family="monospace" font-size="26" text-anchor="end" fill="${C.ink}">500.00</text>
  <text x="100" y="1260" font-family="monospace" font-size="26" fill="${C.muted}">Change</text>
  <text x="${W-100}" y="1260" font-family="monospace" font-size="26" text-anchor="end" fill="${C.ink}">141.20</text>

  <rect x="100" y="1300" width="${W-200}" height="2" fill="${C.border}" stroke-dasharray="4,4"/>

  <text x="${W/2}" y="1360" font-family="system-ui" font-size="22" text-anchor="middle" fill="${C.muted}">Salamat sa pagbili!</text>
  <text x="${W/2}" y="1400" font-family="system-ui" font-size="22" text-anchor="middle" fill="${C.muted}">BIR Acc Permit 042-2024-12345</text>
  <text x="${W/2}" y="1430" font-family="system-ui" font-size="22" text-anchor="middle" fill="${C.muted}">Valid 5 years from 2024-01-01</text>

  <!-- Actions -->
  <rect x="60"  y="${H-250}" width="460" height="100" rx="20" fill="${C.white}" stroke="${C.primary}" stroke-width="3"/>
  <text x="290" y="${H-185}" font-family="system-ui" font-size="32" font-weight="700" text-anchor="middle" fill="${C.primary}">🖨  Print</text>

  <rect x="560" y="${H-250}" width="460" height="100" rx="20" fill="${C.primary}"/>
  <text x="790" y="${H-185}" font-family="system-ui" font-size="32" font-weight="700" text-anchor="middle" fill="${C.white}">New sale →</text>
</svg>`;
}

const screens = [
  { name: '1-signin.png',     svg: signIn() },
  { name: '2-dashboard.png',  svg: dashboard() },
  { name: '3-sell-list.png',  svg: sellList() },
  { name: '4-cart.png',       svg: cart() },
  { name: '5-tendering.png',  svg: tendering() },
  { name: '6-receipt.png',    svg: receipt() },
];

(async () => {
  console.log(`Generating ${screens.length} phone screenshots @ ${W}×${H}…`);
  for (const s of screens) {
    const out = path.join(OUT, s.name);
    await sharp(Buffer.from(s.svg), { density: 144 })
      .resize(W, H)
      .png()
      .toFile(out);
    console.log(`  ✓ ${path.relative(ROOT, out)}`);
  }
  console.log('\nUpload these to Play Console > Store listing > Phone screenshots.');
  console.log('Replace with real device captures before promoting to production.');
})().catch(e => { console.error(e); process.exit(1); });

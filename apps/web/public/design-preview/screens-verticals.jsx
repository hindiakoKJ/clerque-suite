// CLERQUE COUNTER — Per-vertical POS layouts
// Tenant's business type is set on the web at signup; the Counter app boots
// straight into the right surface — cashier never sees a type-picker.

const RVert = window.React;

// =================================================================
// Shared icons + atoms
// =================================================================

const VIcon = {
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  scan: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="6" y1="12" x2="18" y2="12"/></svg>,
  menu: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  cart: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  chevR: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  user: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  phone: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  calendar: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  bell: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  warn: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  rx: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><text x="3" y="20" fontFamily="serif" fontSize="22" fontWeight="700" fontStyle="italic">℞</text></svg>,
  pill: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 20.5L3.5 13.5a4.95 4.95 0 1 1 7-7l7 7a4.95 4.95 0 1 1-7 7z"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/></svg>,
  shirt: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>,
  basket: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18M5 9l2 12h10l2-12M9 5l3-3 3 3"/></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  edit: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
};

function VStatusBar() {
  return (
    <div style={{
      height: 28, padding: "0 16px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      fontSize: 12, fontWeight: 500, color: "var(--c-ink)",
    }}>
      <span style={{fontWeight: 600}}>09:24</span>
      <div style={{display: "flex", alignItems: "center", gap: 8}}>
        <span>5G</span><span>·</span><span>87%</span>
      </div>
    </div>
  );
}

function VLogo() {
  return (
    <div style={{display: "inline-flex", alignItems: "center", gap: 10}}>
      <span style={{
        width: 32, height: 32, borderRadius: 8,
        background: "var(--c-primary)", color: "#fff",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>{VIcon.cart}</span>
      <div style={{fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700}}>
        <span style={{color: "var(--c-primary)"}}>Clerque</span>
        <span style={{color: "var(--c-rule-strong)", margin: "0 4px"}}>·</span>
        <span style={{color: "var(--c-ink)"}}>Counter</span>
      </div>
    </div>
  );
}

function VTopBar({ tenant = "HNS Corp PH", branch = "Katipunan", cashier = "MA", cashierName = "Maricar A.", typeBadge = null }) {
  return (
    <div style={{height: 60, padding: "0 24px", display: "flex", alignItems: "center", gap: 16, background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
      <button className="appbar-icon-btn">{VIcon.menu}</button>
      <VLogo />
      {typeBadge && (
        <span style={{
          marginLeft: 6,
          padding: "5px 10px",
          background: "var(--c-cream)",
          color: "var(--c-ink)",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          fontFamily: "var(--font-mono)",
        }}>{typeBadge}</span>
      )}
      <div style={{flex: "0 1 360px", marginLeft: 16}}>
        <div style={{display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 12px", background: "var(--c-cream-soft)", borderRadius: 8, border: "1px solid var(--c-cream-deep)", fontSize: 13, color: "var(--c-muted)"}}>
          {VIcon.search}<span>Search…</span>
        </div>
      </div>
      <div style={{marginLeft: "auto", display: "flex", alignItems: "center", gap: 10}}>
        <span className="sync-pill"><span className="sync-pill-dot"></span> Online</span>
        <button className="appbar-icon-btn">{VIcon.bell}</button>
        <span className="tenant-chip" style={{height: 38}}>
          <span className="tenant-chip-avatar" style={{width: 28, height: 28, borderRadius: 7}}>{cashier}</span>
          <span>
            <span style={{fontWeight: 600}}>{cashierName}</span>
            <span className="role-chip" style={{marginLeft: 8}}>OWNER</span>
          </span>
        </span>
      </div>
    </div>
  );
}

function VVerticalFooter({ label, line }) {
  return (
    <div style={{padding: "10px 24px", background: "#0B1220", color: "#94A3B8", display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: ".04em"}}>
      <span><b style={{color: "#60A5FA"}}>VERTICAL · {label}</b></span>
      <span>{line}</span>
    </div>
  );
}

// =================================================================
// 1. COFFEE / F&B — polished
// Polish: dine-in / takeout segmented, table number chip, "fire" status
// for the kitchen, modifier-rich product cards. Same canonical Terminal
// but more clearly café.
// =================================================================

window.POSCoffee = function POSCoffee() {
  const cats = [
    {n: "All", a: false}, {n: "Espresso", a: true}, {n: "Iced Coffee", a: false},
    {n: "Specialty", a: false}, {n: "Tea", a: false}, {n: "Pastry", a: false},
    {n: "Mains", a: false}, {n: "Sides", a: false},
  ];
  const prods = [
    {n: "Americano", p: 110, ini: "Am", stock: 597},
    {n: "Cappuccino", p: 140, ini: "Cp", stock: 89, mod: true},
    {n: "Café Latte", p: 145, ini: "Lt", stock: 11, low: true, mod: true},
    {n: "Spanish Latte", p: 160, ini: "SL", stock: 3, low: true, mod: true, fav: true},
    {n: "Mocha", p: 165, ini: "Mo", stock: 240, mod: true},
    {n: "Caramel Macchiato", p: 170, ini: "CM", stock: 180, mod: true, fav: true},
    {n: "Flat White", p: 150, ini: "FW", stock: 92, mod: true},
    {n: "Cortado", p: 140, ini: "Co", stock: 64, mod: true},
    {n: "Espresso · double", p: 110, ini: "E2", stock: 410},
    {n: "Vietnamese Drip", p: 155, ini: "VD", stock: 28, mod: true},
    {n: "Cubano", p: 130, ini: "Cu", stock: 45, mod: true},
    {n: "Hot Choco", p: 130, ini: "Hc", stock: 88},
  ];
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <VStatusBar />
      <VTopBar tenant="Tindahan Coffee" typeBadge="Coffee · F&B" />

      {/* Order context strip — dine-in vs takeout, table */}
      <div style={{padding: "12px 24px", display: "flex", alignItems: "center", gap: 14, background: "var(--c-cream-soft)", borderBottom: "1px solid var(--c-rule)"}}>
        <div style={{display: "inline-flex", padding: 4, background: "#fff", border: "1px solid var(--c-rule)", borderRadius: 10, gap: 2}}>
          <span style={{padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#fff", background: "var(--c-primary)", boxShadow: "0 2px 6px rgba(59,130,246,.25)"}}>Dine in</span>
          <span style={{padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "var(--c-muted)"}}>Takeout</span>
          <span style={{padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "var(--c-muted)"}}>Delivery</span>
        </div>
        <span style={{height: 28, width: 1, background: "var(--c-rule)"}}></span>
        <span style={{display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "#fff", border: "1px solid var(--c-rule)", borderRadius: 10, fontSize: 13, fontWeight: 600}}>
          <span style={{fontSize: 11, color: "var(--c-muted)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase"}}>Table</span>
          <span style={{fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "var(--c-primary)"}}>T-04</span>
          <span style={{fontSize: 11, color: "var(--c-muted)"}}>· 2 guests</span>
        </span>
        <span style={{display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#fff", border: "1px dashed var(--c-rule)", borderRadius: 10, fontSize: 12, color: "var(--c-muted)", fontWeight: 500}}>
          {VIcon.user} Walk-in
        </span>
        <div style={{marginLeft: "auto", display: "flex", gap: 14, fontSize: 12, color: "var(--c-muted)"}}>
          <span><b style={{color: "var(--c-ink)"}}>5</b> open tabs</span>
          <span><b style={{color: "var(--c-ink)"}}>12</b> tickets fired today</span>
        </div>
      </div>

      {/* Category tabs */}
      <div style={{padding: "12px 24px", display: "flex", gap: 8, overflowX: "auto", background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
        {cats.map((c, i) => (
          <span key={i} style={{
            flexShrink: 0,
            padding: "8px 18px", borderRadius: 999,
            fontSize: 14, fontWeight: 600,
            color: c.a ? "#fff" : "var(--c-ink)",
            background: c.a ? "var(--c-primary)" : "var(--c-cream-soft)",
            border: "1px solid " + (c.a ? "var(--c-primary)" : "var(--c-cream-deep)"),
          }}>{c.n}</span>
        ))}
      </div>

      <div style={{flex: 1, display: "flex", minHeight: 0}}>
        {/* Product grid */}
        <div style={{flex: 1, padding: 18, overflow: "auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, alignContent: "start"}}>
          {prods.map((p, i) => (
            <div key={i} className="product-card" style={{position: "relative"}}>
              <div className="product-card-img">
                <div className="ph-tile is-coffee" style={{fontSize: 28}}>{p.ini}</div>
                {p.low && <span style={{position: "absolute", top: 8, right: 8, padding: "3px 9px", background: "var(--c-warning-soft)", color: "var(--c-warning-deep)", borderRadius: 999, fontSize: 10, fontWeight: 700}}>Low · {p.stock}</span>}
                {p.fav && <span style={{position: "absolute", top: 8, left: 8, padding: "3px 8px", background: "#fff", color: "var(--c-primary)", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", border: "1px solid var(--c-rule)"}}>★ Bestseller</span>}
                {p.mod && <span className="product-card-mod">+</span>}
              </div>
              <div className="product-card-body">
                <div className="product-card-name">{p.n}</div>
                <div className="product-card-price tnum" style={{color: "var(--c-primary)"}}>₱{p.p}.00</div>
              </div>
            </div>
          ))}
        </div>

        {/* Order panel */}
        <div className="cart-panel" style={{width: 440}}>
          <div className="cart-head">
            <div>
              <div className="cart-head-t">Order · T-04 · Dine in</div>
              <div className="cart-head-sub">3 items · MA · started 09:18</div>
            </div>
            <span className="btn btn-ghost btn-compact">Send to kitchen</span>
          </div>
          <div className="cart-lines">
            <div className="cart-line">
              <div>
                <div className="cart-line-name">2× Iced Spanish Latte · Grande</div>
                <div className="cart-line-mods">Oat +₱20 · No sugar · Extra shot +₱30</div>
                <div style={{display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, padding: "3px 9px", background: "var(--c-success-soft)", color: "var(--c-success-deep)", borderRadius: 999, fontSize: 11, fontWeight: 600}}>
                  <span style={{width: 6, height: 6, borderRadius: 50, background: "var(--c-success)"}}></span>
                  Fired to bar · 09:19
                </div>
              </div>
              <div>
                <div className="cart-line-price tnum" style={{color: "var(--c-primary)"}}>₱360.00</div>
              </div>
            </div>
            <div className="cart-line">
              <div>
                <div className="cart-line-name">1× Pandesal · 6 pc</div>
              </div>
              <div><div className="cart-line-price tnum" style={{color: "var(--c-primary)"}}>₱48.00</div></div>
            </div>
            <div className="cart-line">
              <div>
                <div className="cart-line-name">1× Cheese ensaymada</div>
                <div style={{display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, padding: "3px 9px", background: "var(--c-warning-soft)", color: "var(--c-warning-deep)", borderRadius: 999, fontSize: 11, fontWeight: 600}}>
                  <span style={{width: 6, height: 6, borderRadius: 50, background: "var(--c-warning)"}}></span>
                  Not fired yet
                </div>
              </div>
              <div><div className="cart-line-price tnum" style={{color: "var(--c-primary)"}}>₱65.00</div></div>
            </div>
          </div>
          <div className="cart-totals">
            <div className="cart-total-row"><span>Subtotal</span><span className="tnum"><b>₱473.00</b></span></div>
            <div className="cart-total-row"><span>VAT-exempt sales</span><span className="tnum"><b>₱473.00</b></span></div>
            <div className="cart-total-row is-grand"><span>Bayaran</span><span className="tnum"><b>₱473.00</b></span></div>
          </div>
          <div className="cart-cta">
            <button className="btn btn-primary btn-cashier btn-full">Charge ₱473.00 →</button>
            <div style={{display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12, color: "var(--c-muted)", fontWeight: 500}}>
              <span>Discount</span><span>Senior · PWD</span><span>Note to kitchen</span><span>Park tab</span>
            </div>
          </div>
        </div>
      </div>

      <VVerticalFooter label="A · Coffee / F&B" line="Dine-in / takeout · table assignment · kitchen-fire status per line" />
    </div>
  );
};

// =================================================================
// 2. LAUNDRY — customer-first, per-load + per-item, claim ticket
// =================================================================

window.POSLaundry = function POSLaundry() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <VStatusBar />
      <VTopBar tenant="Linis Express" branch="Cubao branch" typeBadge="Laundry shop" />

      {/* Customer header — required for laundry */}
      <div style={{padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, background: "linear-gradient(180deg, var(--c-primary-container) 0%, transparent 100%)", borderBottom: "1px solid var(--c-rule)"}}>
        <span style={{
          width: 52, height: 52, borderRadius: 14,
          background: "var(--c-primary)", color: "#fff",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20,
          boxShadow: "0 4px 12px rgba(59,130,246,.25)",
        }}>RC</span>
        <div style={{flex: 1}}>
          <div style={{display: "flex", alignItems: "center", gap: 10}}>
            <div className="display" style={{fontSize: 22, fontWeight: 700}}>Ronaldo Cruz</div>
            <span style={{padding: "3px 8px", background: "#fff", color: "var(--c-primary-press)", border: "1px solid var(--c-primary)", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase"}}>Regular · 22 visits</span>
            <span style={{padding: "3px 8px", background: "var(--c-success-soft)", color: "var(--c-success-deep)", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase"}}>Loyalty · 8/10</span>
            <button className="btn btn-ghost btn-compact" style={{padding: "0 10px"}}>{VIcon.edit} Edit</button>
          </div>
          <div style={{display: "flex", gap: 18, marginTop: 4, fontSize: 13, color: "var(--c-muted)"}}>
            <span style={{display: "inline-flex", alignItems: "center", gap: 6}}>{VIcon.phone} +63 917 ••• 4452</span>
            <span>Customer #00428 · joined Aug 2024</span>
            <span style={{color: "var(--c-warning-deep)", fontWeight: 600}}>2 open claim tickets</span>
          </div>
        </div>
        <button className="btn btn-secondary btn-default">Change customer</button>
      </div>

      <div style={{flex: 1, display: "flex", minHeight: 0}}>
        {/* Left: service selection */}
        <div style={{flex: 1, padding: 24, overflow: "auto", minWidth: 0}}>
          {/* Service type tabs */}
          <div style={{display: "inline-flex", padding: 4, background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 10, gap: 4, marginBottom: 22}}>
            <span style={{padding: "10px 18px", borderRadius: 7, fontSize: 14, fontWeight: 700, color: "#fff", background: "var(--c-primary)", display: "inline-flex", alignItems: "center", gap: 8, boxShadow: "0 2px 6px rgba(59,130,246,.25)"}}>
              {VIcon.basket} Per-load wash
            </span>
            <span style={{padding: "10px 18px", borderRadius: 7, fontSize: 14, fontWeight: 600, color: "var(--c-muted)", display: "inline-flex", alignItems: "center", gap: 8}}>
              {VIcon.shirt} Dry cleaning · per item
            </span>
            <span style={{padding: "10px 18px", borderRadius: 7, fontSize: 14, fontWeight: 600, color: "var(--c-muted)"}}>Press only</span>
            <span style={{padding: "10px 18px", borderRadius: 7, fontSize: 14, fontWeight: 600, color: "var(--c-muted)"}}>Pickup / delivery</span>
          </div>

          {/* Per-load grid */}
          <div className="display" style={{fontSize: 20, fontWeight: 700, marginBottom: 4}}>Per-load services</div>
          <div style={{fontSize: 13, color: "var(--c-muted)", marginBottom: 18}}>Flat fee per load · standard 8kg machine</div>

          <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32}}>
            {[
              {n: "Regular Wash", d: "Wash + dry, machine fold", p: 180, eta: "Same-day · 4h", c: "var(--c-primary)"},
              {n: "Wash & Fold Premium", d: "Hand-fold, fabric softener", p: 250, eta: "Next-day · 24h", c: "#9333EA"},
              {n: "Hot Wash · Sanitize", d: "60°C cycle for towels/bedding", p: 280, eta: "Same-day · 6h", c: "var(--c-error)"},
              {n: "Comforter / Bedding", d: "Per piece · King = 1 load", p: 350, eta: "Next-day", c: "var(--c-info-deep)"},
              {n: "Delicates", d: "Cold cycle, separate", p: 220, eta: "Same-day · 5h", c: "var(--c-success)"},
              {n: "Curtains", d: "Heavy load · per pair", p: 400, eta: "2 days", c: "var(--c-warning-deep)"},
            ].map((s, i) => (
              <div key={i} style={{
                background: "#fff",
                border: "1px solid var(--c-rule)",
                borderRadius: 14,
                padding: 18,
                position: "relative",
                boxShadow: "var(--e-1)",
              }}>
                <div style={{width: 4, position: "absolute", left: 0, top: 14, bottom: 14, background: s.c, borderRadius: 2}}></div>
                <div style={{paddingLeft: 8}}>
                  <div style={{fontSize: 17, fontWeight: 700, color: "var(--c-ink)"}}>{s.n}</div>
                  <div style={{fontSize: 12, color: "var(--c-muted)", marginTop: 2, marginBottom: 12}}>{s.d}</div>
                  <div style={{display: "flex", alignItems: "baseline", justifyContent: "space-between"}}>
                    <span className="tnum" style={{fontSize: 22, fontWeight: 800, color: "var(--c-primary)"}}>₱{s.p}</span>
                    <span style={{fontSize: 11, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600}}>{s.eta}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add-ons */}
          <div className="display" style={{fontSize: 16, fontWeight: 700, marginBottom: 10}}>Add-ons · stack on any load</div>
          <div style={{display: "flex", gap: 10, flexWrap: "wrap"}}>
            {[
              {n: "Fabric softener", p: 30},
              {n: "Bleach", p: 20},
              {n: "Detergent (own bottle credit)", p: -15, credit: true},
              {n: "Extra spin", p: 25},
              {n: "Express +2h", p: 60},
              {n: "Hanger packaging", p: 40},
              {n: "Plastic wrap (each)", p: 10},
            ].map((a, i) => (
              <span key={i} style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "12px 16px",
                background: "#fff", border: "1.5px solid var(--c-rule)",
                borderRadius: 999,
                fontSize: 13, fontWeight: 600,
              }}>
                {a.n}
                <span className="tnum" style={{
                  color: a.credit ? "var(--c-success-deep)" : "var(--c-muted)",
                  fontWeight: 600,
                }}>{a.credit ? "−" : "+"}₱{Math.abs(a.p)}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Right: claim ticket */}
        <div style={{width: 460, background: "var(--c-cream-soft)", borderLeft: "1px solid var(--c-rule)", display: "flex", flexDirection: "column"}}>
          <div style={{padding: "18px 22px 14px", background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
            <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
              <div>
                <div className="display" style={{fontSize: 18, fontWeight: 700}}>Claim Ticket · L-2026-0428</div>
                <div style={{fontSize: 12, color: "var(--c-muted)", marginTop: 2}}>For: <b style={{color: "var(--c-ink)"}}>Ronaldo Cruz</b> · started 09:18</div>
              </div>
              <span className="btn btn-ghost btn-compact">Hold</span>
            </div>
          </div>

          {/* Lines */}
          <div style={{flex: 1, overflow: "auto"}}>
            {[
              {n: "1× Regular Wash", m: "+ Fabric softener · + Extra spin · 6kg", p: 235, eta: "Pickup 5 PM"},
              {n: "1× Comforter (Queen)", m: "+ Hanger packaging", p: 390, eta: "Pickup tomorrow"},
            ].map((l, i) => (
              <div key={i} style={{padding: "14px 22px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
                <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline"}}>
                  <div style={{flex: 1}}>
                    <div style={{fontSize: 14, fontWeight: 700}}>{l.n}</div>
                    <div style={{fontSize: 12, color: "var(--c-muted)", marginTop: 2}}>{l.m}</div>
                    <div style={{display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, padding: "3px 8px", background: "var(--c-info-soft)", color: "var(--c-info-deep)", borderRadius: 6, fontSize: 11, fontWeight: 600}}>
                      {VIcon.calendar} {l.eta}
                    </div>
                  </div>
                  <div className="tnum" style={{fontSize: 15, fontWeight: 700, color: "var(--c-primary)"}}>₱{l.p}.00</div>
                </div>
              </div>
            ))}
            {/* Pickup date */}
            <div style={{padding: "16px 22px", background: "var(--c-warning-soft)", borderBottom: "1px solid #F8D6A1"}}>
              <div style={{fontSize: 11, color: "var(--c-warning-deep)", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6}}>Ready-by date · required</div>
              <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
                <span style={{padding: "8px 14px", background: "#fff", border: "1px solid var(--c-rule)", borderRadius: 8, fontSize: 13, fontWeight: 600}}>Today 5 PM</span>
                <span style={{padding: "8px 14px", background: "var(--c-primary)", color: "#fff", border: "1px solid var(--c-primary)", borderRadius: 8, fontSize: 13, fontWeight: 700}}>Tomorrow 10 AM</span>
                <span style={{padding: "8px 14px", background: "#fff", border: "1px solid var(--c-rule)", borderRadius: 8, fontSize: 13, fontWeight: 600}}>Sat 4 PM</span>
                <span style={{padding: "8px 14px", background: "#fff", border: "1px dashed var(--c-rule)", borderRadius: 8, fontSize: 13, color: "var(--c-muted)", fontWeight: 500}}>Custom…</span>
              </div>
            </div>
          </div>

          {/* Totals */}
          <div style={{padding: "16px 22px", background: "#fff", borderTop: "1px solid var(--c-rule)"}}>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: "var(--c-muted)"}}><span>Subtotal</span><span className="tnum"><b style={{color: "var(--c-ink)"}}>₱625.00</b></span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: "var(--c-success-deep)"}}><span>Loyalty: 8/10 stamps · ₱50 off next</span><span style={{fontSize: 11}}>(at 10)</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "10px 0 0", marginTop: 6, borderTop: "1px solid var(--c-rule)", fontWeight: 700, fontSize: 22}}><span>Down payment</span><span className="tnum">₱625.00</span></div>
            <div style={{fontSize: 11, color: "var(--c-muted)", marginTop: 4}}>Full payment now · standard policy</div>
          </div>

          <div style={{padding: "16px 22px 22px"}}>
            <button className="btn btn-primary btn-cashier btn-full">
              Charge & print claim ticket
              {VIcon.chevR}
            </button>
            <div style={{textAlign: "center", marginTop: 10, fontSize: 11, color: "var(--c-muted)"}}>Customer keeps stub L-2026-0428 · ours is filed under #00428</div>
          </div>
        </div>
      </div>

      <VVerticalFooter label="B · Laundry" line="Customer-first · per-load + dry-cleaning · required ready-by date · claim ticket as receipt" />
    </div>
  );
};

// =================================================================
// 3. PHARMACY — batch/expiry, Rx capture, controlled substance
// =================================================================

window.POSPharmacy = function POSPharmacy() {
  const cats = [
    {n: "All", a: false}, {n: "OTC", a: true}, {n: "Rx required", a: false, badge: true},
    {n: "Controlled", a: false, warn: true}, {n: "Vitamins", a: false},
    {n: "Personal Care", a: false}, {n: "Medical Devices", a: false},
  ];
  const drugs = [
    {brand: "Biogesic", generic: "Paracetamol 500mg", form: "10 tabs", p: 24.50, stock: 240, batch: "B2025-08", exp: "Jul 2027"},
    {brand: "Neozep Forte", generic: "Phenylprop. + Paracetamol", form: "10 tabs", p: 38.00, stock: 180, batch: "N2025-11", exp: "Dec 2026"},
    {brand: "Decolgen Forte", generic: "Phenylprop. + Chlorphen.", form: "10 tabs", p: 42.00, stock: 32, low: true, batch: "D2024-22", exp: "Mar 2026", expSoon: true},
    {brand: "Solmux 500mg", generic: "Carbocisteine", form: "10 caps", p: 78.00, stock: 96, batch: "S2025-02", exp: "Sep 2027"},
    {brand: "Loperamide 2mg", generic: "Loperamide HCl", form: "10 caps", p: 18.50, stock: 320, batch: "L2025-09", exp: "Aug 2027"},
    {brand: "Cetirizine 10mg", generic: "Cetirizine HCl", form: "10 tabs", p: 32.00, stock: 142, batch: "C2025-04", exp: "Jan 2028"},
    {brand: "Buscopan", generic: "Hyoscine N-butylbromide", form: "10 tabs", p: 95.00, stock: 18, low: true, batch: "Bu2024-08", exp: "Oct 2026"},
    {brand: "Mefenamic 500mg", generic: "Mefenamic acid", form: "10 caps", p: 45.00, stock: 86, batch: "M2025-06", exp: "May 2027", rx: true},
    {brand: "Amoxicillin 500mg", generic: "Amoxicillin trihydrate", form: "10 caps", p: 88.00, stock: 54, batch: "A2024-19", exp: "Nov 2026", rx: true},
    {brand: "Salbutamol Inhaler", generic: "Salbutamol sulfate", form: "200 puffs", p: 285.00, stock: 8, low: true, batch: "Sa2025-03", exp: "Feb 2028", rx: true},
    {brand: "Tramadol 50mg", generic: "Tramadol HCl", form: "10 caps", p: 92.00, stock: 24, batch: "T2025-01", exp: "Jul 2026", rx: true, controlled: true},
    {brand: "Diazepam 5mg", generic: "Diazepam", form: "10 tabs", p: 78.00, stock: 12, low: true, batch: "Di2024-14", exp: "Apr 2027", rx: true, controlled: true},
  ];

  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <VStatusBar />
      <VTopBar tenant="MedExpress Pharmacy" branch="Marikina branch" typeBadge="Pharmacy" />

      {/* Hero search bar — pharmacies are 90% search/scan driven */}
      <div style={{padding: "16px 24px", background: "var(--c-cream-soft)", borderBottom: "1px solid var(--c-rule)"}}>
        <div style={{display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "stretch"}}>
          <div style={{
            background: "#fff",
            border: "2px solid var(--c-primary)",
            borderRadius: 12,
            padding: "12px 18px",
            display: "flex", alignItems: "center", gap: 14,
            boxShadow: "0 0 0 4px rgba(59,130,246,.15)",
          }}>
            <span style={{color: "var(--c-primary)"}}>{VIcon.search}</span>
            <div style={{flex: 1}}>
              <div style={{fontSize: 11, color: "var(--c-muted)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase"}}>Search by brand, generic, or SKU</div>
              <div style={{fontSize: 18, fontWeight: 600, color: "var(--c-ink)", marginTop: 2, fontFamily: "var(--font-mono)"}}>biogesic_</div>
            </div>
            <span style={{fontSize: 11, color: "var(--c-muted)", padding: "4px 10px", background: "var(--c-cream)", borderRadius: 6}}>Auto-suggests generics</span>
          </div>
          <button className="btn btn-primary" style={{height: 60, padding: "0 22px", borderRadius: 12, fontSize: 14, gap: 8}}>
            {VIcon.scan} Scan
          </button>
          <button className="btn btn-secondary" style={{height: 60, padding: "0 22px", borderRadius: 12, fontSize: 14, gap: 8}}>
            {VIcon.rx} Rx pad
          </button>
        </div>
      </div>

      {/* Category tabs */}
      <div style={{padding: "12px 24px", display: "flex", gap: 8, overflowX: "auto", background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
        {cats.map((c, i) => (
          <span key={i} style={{
            flexShrink: 0,
            padding: "8px 16px", borderRadius: 999,
            fontSize: 13, fontWeight: 600,
            color: c.a ? "#fff" : (c.warn ? "var(--c-error-deep)" : "var(--c-muted)"),
            background: c.a ? "var(--c-primary)" : (c.warn ? "var(--c-error-soft)" : "transparent"),
            border: "1px solid " + (c.a ? "var(--c-primary)" : (c.warn ? "var(--c-error-soft)" : "var(--c-rule)")),
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {c.warn && <span style={{color: "var(--c-error)"}}>{VIcon.warn}</span>}
            {c.badge && <span style={{fontFamily: "serif", fontStyle: "italic", fontWeight: 700}}>℞</span>}
            {c.n}
          </span>
        ))}
      </div>

      <div style={{flex: 1, display: "flex", minHeight: 0}}>
        {/* Drug list — table-row layout */}
        <div style={{flex: 1, overflow: "auto"}}>
          <div style={{display: "grid", gridTemplateColumns: "1.6fr 1fr 90px 100px 100px 80px", padding: "12px 24px", borderBottom: "2px solid var(--c-rule)", fontSize: 11, fontWeight: 700, color: "var(--c-muted)", letterSpacing: ".08em", textTransform: "uppercase", position: "sticky", top: 0, background: "var(--c-bg)", zIndex: 1}}>
            <span>Drug · brand / generic</span>
            <span>Batch · expiry</span>
            <span style={{textAlign: "right"}}>Stock</span>
            <span style={{textAlign: "right"}}>Price</span>
            <span></span>
            <span></span>
          </div>
          {drugs.map((d, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1.6fr 1fr 90px 100px 100px 80px",
              padding: "16px 24px", alignItems: "center", gap: 12,
              borderBottom: "1px solid var(--c-rule)",
              fontSize: 14,
              background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.6)",
            }}>
              {/* Brand + generic */}
              <div>
                <div style={{display: "flex", alignItems: "center", gap: 8}}>
                  <span style={{fontWeight: 700, fontSize: 15}}>{d.brand}</span>
                  {d.rx && <span style={{padding: "2px 6px", background: "var(--c-warning-soft)", color: "var(--c-warning-deep)", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 3}}><span style={{fontFamily: "serif", fontStyle: "italic"}}>℞</span> Rx</span>}
                  {d.controlled && <span style={{padding: "2px 6px", background: "var(--c-error-soft)", color: "var(--c-error-deep)", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase"}}>Controlled</span>}
                </div>
                <div style={{fontSize: 12, color: "var(--c-muted)", marginTop: 2}}>{d.generic} · <span style={{fontFamily: "var(--font-mono)"}}>{d.form}</span></div>
              </div>
              {/* Batch + expiry */}
              <div style={{fontFamily: "var(--font-mono)", fontSize: 11}}>
                <div style={{color: "var(--c-ink)", fontWeight: 600}}>{d.batch}</div>
                <div style={{color: d.expSoon ? "var(--c-warning-deep)" : "var(--c-muted)", fontWeight: d.expSoon ? 700 : 400, display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2}}>
                  {d.expSoon && <span style={{color: "var(--c-warning)"}}>{VIcon.warn}</span>}
                  exp {d.exp}
                </div>
              </div>
              {/* Stock */}
              <div style={{textAlign: "right", fontSize: 12, color: d.low ? "var(--c-error-deep)" : "var(--c-muted)", fontWeight: d.low ? 700 : 400}}>
                {d.low ? `Low · ${d.stock}` : `${d.stock} u`}
              </div>
              {/* Price */}
              <div className="tnum" style={{textAlign: "right", fontWeight: 700, fontSize: 15, color: "var(--c-primary)"}}>₱{d.p.toFixed(2)}</div>
              {/* Generic swap suggestion (if branded) */}
              <div style={{fontSize: 11}}>
                {i === 1 && <button style={{padding: "4px 8px", background: "var(--c-info-soft)", color: "var(--c-info-deep)", border: "1px solid #BFD8FB", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", cursor: "default"}}>Generic ↓₱12</button>}
              </div>
              <div style={{display: "flex", justifyContent: "flex-end"}}>
                <button className="btn btn-primary btn-compact" style={{minWidth: 60, padding: "0 10px"}}>{VIcon.plus} Add</button>
              </div>
            </div>
          ))}
        </div>

        {/* Right: prescription cart */}
        <div style={{width: 440, background: "var(--c-cream-soft)", borderLeft: "1px solid var(--c-rule)", display: "flex", flexDirection: "column"}}>
          <div style={{padding: "16px 20px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
            <div className="display" style={{fontSize: 18, fontWeight: 700}}>Order · PH-000125</div>
            <div style={{fontSize: 12, color: "var(--c-muted)", marginTop: 2}}>3 items · 1 requires Rx · cashier MA</div>
          </div>

          {/* Lines */}
          <div style={{flex: 1, overflow: "auto"}}>
            <div style={{padding: "14px 20px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline"}}>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 14, fontWeight: 700}}>2× Biogesic 500mg</div>
                  <div style={{fontSize: 11, color: "var(--c-muted)", marginTop: 2, fontFamily: "var(--font-mono)"}}>B2025-08 · exp Jul 2027 · 10 tabs</div>
                </div>
                <div className="tnum" style={{fontSize: 14, fontWeight: 700, color: "var(--c-primary)"}}>₱49.00</div>
              </div>
            </div>
            <div style={{padding: "14px 20px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline"}}>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 14, fontWeight: 700}}>1× Cetirizine 10mg</div>
                  <div style={{fontSize: 11, color: "var(--c-muted)", marginTop: 2, fontFamily: "var(--font-mono)"}}>C2025-04 · exp Jan 2028 · 10 tabs</div>
                </div>
                <div className="tnum" style={{fontSize: 14, fontWeight: 700, color: "var(--c-primary)"}}>₱32.00</div>
              </div>
            </div>
            {/* Rx line */}
            <div style={{padding: "14px 20px", borderBottom: "1px solid var(--c-rule)", background: "#FFF8E6"}}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline"}}>
                <div style={{flex: 1}}>
                  <div style={{display: "flex", alignItems: "center", gap: 8}}>
                    <span style={{fontSize: 14, fontWeight: 700}}>1× Amoxicillin 500mg</span>
                    <span style={{padding: "2px 6px", background: "var(--c-warning)", color: "#fff", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase"}}>Rx</span>
                  </div>
                  <div style={{fontSize: 11, color: "var(--c-muted)", marginTop: 2, fontFamily: "var(--font-mono)"}}>A2024-19 · exp Nov 2026 · 10 caps</div>
                </div>
                <div className="tnum" style={{fontSize: 14, fontWeight: 700, color: "var(--c-primary)"}}>₱88.00</div>
              </div>
            </div>

            {/* Rx capture card */}
            <div style={{margin: "16px 20px", padding: 16, background: "#fff", border: "1.5px solid var(--c-warning)", borderRadius: 12}}>
              <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 10}}>
                <span style={{fontFamily: "serif", fontStyle: "italic", fontSize: 20, color: "var(--c-warning-deep)", fontWeight: 800}}>℞</span>
                <span style={{fontSize: 12, fontWeight: 700, color: "var(--c-warning-deep)", letterSpacing: ".06em", textTransform: "uppercase"}}>Prescription required · capture below</span>
              </div>
              <div className="field" style={{marginBottom: 10}}>
                <span className="field-label">Doctor name + PRC #</span>
                <div className="field-input" style={{height: 44, fontSize: 14}}>Dr. Maria Santos · 0089432</div>
              </div>
              <div className="field" style={{marginBottom: 10}}>
                <span className="field-label">Patient name</span>
                <div className="field-input" style={{height: 44, fontSize: 14}}>Ronaldo Cruz</div>
              </div>
              <div className="field">
                <span className="field-label">Rx photo (optional)</span>
                <div style={{height: 44, border: "1.5px dashed var(--c-rule)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: "var(--c-muted)", fontWeight: 500}}>
                  {VIcon.scan} Tap to capture or attach
                </div>
              </div>
            </div>
          </div>

          {/* Totals */}
          <div style={{padding: "16px 20px", background: "#fff", borderTop: "1px solid var(--c-rule)"}}>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: "var(--c-muted)"}}><span>Subtotal</span><span className="tnum"><b style={{color: "var(--c-ink)"}}>₱169.00</b></span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: "var(--c-success-deep)"}}><span>Senior · 20% off (BIR-exempt)</span><span className="tnum"><b>− ₱33.80</b></span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "10px 0 0", marginTop: 6, borderTop: "1px solid var(--c-rule)", fontWeight: 700, fontSize: 22}}><span>Total</span><span className="tnum">₱135.20</span></div>
          </div>

          <div style={{padding: "14px 20px 20px"}}>
            <button className="btn btn-primary btn-cashier btn-full">
              Charge ₱135.20 {VIcon.chevR}
            </button>
            <div style={{textAlign: "center", marginTop: 8, fontSize: 11, color: "var(--c-muted)"}}>Rx logged to FDA-required ledger · gap-free</div>
          </div>
        </div>
      </div>

      <VVerticalFooter label="C · Pharmacy" line="Batch + expiry on every line · Rx capture inline · Senior 20% + BIR · controlled-substance gating" />
    </div>
  );
};

// =================================================================
// 4. RETAIL / SARI-SARI — search-first + dense list
// =================================================================

window.POSRetail = function POSRetail() {
  const items = [
    {code: "480001", n: "Lucky Me Pancit Canton Original", p: 14.00, stock: 248, ini: "LM"},
    {code: "480002", n: "Lucky Me Pancit Canton Chilimansi", p: 14.00, stock: 198, ini: "LM"},
    {code: "330905", n: "Coca-Cola 1.5L", p: 75.00, stock: 32, ini: "CC"},
    {code: "330906", n: "Coca-Cola 500ml", p: 25.00, stock: 124, ini: "CC"},
    {code: "330907", n: "Sprite 1.5L", p: 75.00, stock: 28, ini: "Sp"},
    {code: "120001", n: "Surf Powder Detergent 1.4kg", p: 175.00, stock: 18, low: true, ini: "Sf"},
    {code: "120014", n: "Tide Bar 380g", p: 28.00, stock: 86, ini: "Td"},
    {code: "201108", n: "Pandesal · 6 pc", p: 48.00, stock: 32, ini: "Pn"},
    {code: "201112", n: "Spanish Bread · each", p: 8.00, stock: 124, ini: "SB"},
    {code: "440012", n: "Bear Brand Powdered 320g", p: 195.00, stock: 22, ini: "BB"},
    {code: "440018", n: "Alaska Evap 370mL", p: 38.50, stock: 64, ini: "Al"},
    {code: "550008", n: "Magic Sarap 8g sachet", p: 6.00, stock: 480, ini: "MS"},
    {code: "550009", n: "Ajinomoto 11g sachet", p: 5.50, stock: 320, ini: "Aj"},
    {code: "660001", n: "Marlboro Red", p: 145.00, stock: 18, low: true, age: true, ini: "Mb"},
    {code: "660002", n: "Marlboro Lights", p: 145.00, stock: 12, low: true, age: true, ini: "Mb"},
    {code: "770003", n: "Red Horse 500ml", p: 65.00, stock: 48, age: true, ini: "RH"},
  ];

  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <VStatusBar />
      <VTopBar tenant="Aling Nena Store" branch="" typeBadge="Retail · Sari-sari" />

      {/* Hero search + scan */}
      <div style={{padding: "16px 24px", background: "var(--c-cream-soft)", borderBottom: "1px solid var(--c-rule)"}}>
        <div style={{display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12}}>
          <div style={{
            background: "#fff",
            border: "2px solid var(--c-primary)",
            borderRadius: 14,
            padding: "16px 22px",
            display: "flex", alignItems: "center", gap: 16,
            boxShadow: "0 0 0 5px rgba(59,130,246,.15)",
          }}>
            <span style={{color: "var(--c-primary)"}}>{VIcon.search}</span>
            <div style={{flex: 1}}>
              <div style={{fontSize: 11, color: "var(--c-muted)", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase"}}>Scan or search</div>
              <div className="tnum" style={{fontSize: 22, fontWeight: 600, color: "var(--c-ink)", marginTop: 2, fontFamily: "var(--font-mono)"}}>4 8 0 0 0 1 2 3 4 5_</div>
            </div>
            <span style={{fontSize: 11, color: "var(--c-success-deep)", padding: "5px 10px", background: "var(--c-success-soft)", borderRadius: 6, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5}}>
              <span style={{width: 6, height: 6, borderRadius: 50, background: "var(--c-success)"}}></span>
              USB scanner ready
            </span>
          </div>
          <button className="btn btn-primary" style={{height: 68, padding: "0 26px", borderRadius: 14, fontSize: 15, gap: 8}}>
            {VIcon.scan} Scan
          </button>
          <button className="btn btn-secondary" style={{height: 68, padding: "0 26px", borderRadius: 14, fontSize: 15, gap: 8}}>
            Tingi · loose pack
          </button>
        </div>
      </div>

      <div style={{flex: 1, display: "flex", minHeight: 0}}>
        {/* Left: 2-column layout — recent scans + favorites */}
        <div style={{flex: 1, padding: "20px 24px 24px", overflow: "auto", display: "grid", gridTemplateColumns: "1fr", gap: 20, minWidth: 0}}>
          {/* Recent scans */}
          <div>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10}}>
              <div className="display" style={{fontSize: 16, fontWeight: 700}}>Recent scans</div>
              <div style={{fontSize: 12, color: "var(--c-muted)"}}>Last 1 hour · auto-clears at shift end</div>
            </div>
            <div style={{display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10}}>
              {items.slice(0, 8).map((it, i) => (
                <div key={i} style={{background: "#fff", border: "1px solid var(--c-rule)", borderRadius: 10, padding: "10px 12px"}}>
                  <div style={{fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--c-muted)"}}>{it.code}</div>
                  <div style={{fontSize: 13, fontWeight: 600, marginTop: 4, marginBottom: 4, lineHeight: 1.3, minHeight: "2.6em"}}>{it.n}</div>
                  <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline"}}>
                    <span className="tnum" style={{fontSize: 14, fontWeight: 700, color: "var(--c-primary)"}}>₱{it.p}</span>
                    <span style={{fontSize: 10, color: it.low ? "var(--c-warning-deep)" : "var(--c-muted)", fontWeight: it.low ? 700 : 400}}>
                      {it.low ? `Low · ${it.stock}` : `${it.stock} left`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Full catalog table */}
          <div>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10}}>
              <div className="display" style={{fontSize: 16, fontWeight: 700}}>Browse catalog · 1,284 SKUs</div>
              <div style={{display: "flex", gap: 6, fontSize: 12}}>
                <span style={{padding: "5px 11px", background: "var(--c-primary-container)", color: "var(--c-primary-press)", borderRadius: 6, fontWeight: 700}}>All</span>
                <span style={{padding: "5px 11px", background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 6, color: "var(--c-muted)", fontWeight: 600}}>Beverages</span>
                <span style={{padding: "5px 11px", background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 6, color: "var(--c-muted)", fontWeight: 600}}>Canned</span>
                <span style={{padding: "5px 11px", background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 6, color: "var(--c-muted)", fontWeight: 600}}>Snacks</span>
                <span style={{padding: "5px 11px", background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 6, color: "var(--c-muted)", fontWeight: 600}}>Smokes · 18+</span>
              </div>
            </div>
            <div style={{background: "#fff", border: "1px solid var(--c-rule)", borderRadius: 12, overflow: "hidden"}}>
              <div style={{display: "grid", gridTemplateColumns: "80px 1fr 90px 80px 70px", padding: "10px 14px", background: "var(--c-cream-soft)", fontSize: 10, fontWeight: 700, color: "var(--c-muted)", letterSpacing: ".08em", textTransform: "uppercase", borderBottom: "1px solid var(--c-rule)"}}>
                <span>SKU</span><span>Product</span><span style={{textAlign: "right"}}>Stock</span><span style={{textAlign: "right"}}>Price</span><span></span>
              </div>
              {items.slice(0, 10).map((it, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "80px 1fr 90px 80px 70px",
                  padding: "10px 14px", alignItems: "center", gap: 10,
                  borderBottom: i < 9 ? "1px solid var(--c-rule)" : "none",
                  fontSize: 13,
                }}>
                  <span style={{fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--c-muted)"}}>{it.code}</span>
                  <span style={{display: "flex", alignItems: "center", gap: 8}}>
                    <span style={{fontWeight: 600}}>{it.n}</span>
                    {it.age && <span style={{padding: "1px 6px", background: "var(--c-error-soft)", color: "var(--c-error-deep)", borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: ".06em"}}>18+</span>}
                  </span>
                  <span style={{textAlign: "right", fontSize: 11, color: it.low ? "var(--c-warning-deep)" : "var(--c-muted)", fontWeight: it.low ? 700 : 400}}>
                    {it.low ? `Low · ${it.stock}` : `${it.stock}`}
                  </span>
                  <span className="tnum" style={{textAlign: "right", fontWeight: 700, color: "var(--c-primary)"}}>₱{it.p.toFixed(2)}</span>
                  <span style={{display: "flex", justifyContent: "flex-end"}}>
                    <button style={{height: 28, width: 50, padding: 0, borderRadius: 6, background: "var(--c-primary)", color: "#fff", border: 0, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center"}}>{VIcon.plus}</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: simple order line */}
        <div style={{width: 380, background: "var(--c-cream-soft)", borderLeft: "1px solid var(--c-rule)", display: "flex", flexDirection: "column"}}>
          <div style={{padding: "16px 20px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
            <div className="display" style={{fontSize: 16, fontWeight: 700}}>Order · #000125</div>
            <div style={{fontSize: 11, color: "var(--c-muted)", marginTop: 2}}>4 items scanned · MA</div>
          </div>

          <div style={{flex: 1, overflow: "auto"}}>
            {[
              {code: "480001", n: "Lucky Me Pancit Canton", q: 3, p: 42, age: false},
              {code: "330905", n: "Coca-Cola 1.5L", q: 1, p: 75, age: false},
              {code: "201108", n: "Pandesal · 6 pc", q: 1, p: 48, age: false},
              {code: "660001", n: "Marlboro Red", q: 1, p: 145, age: true},
            ].map((l, i) => (
              <div key={i} style={{padding: "12px 20px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
                <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8}}>
                  <div style={{flex: 1}}>
                    <div style={{fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--c-muted)"}}>{l.code}</div>
                    <div style={{display: "flex", alignItems: "center", gap: 6, marginTop: 2}}>
                      <span style={{fontSize: 13, fontWeight: 600}}>{l.q}× {l.n}</span>
                      {l.age && <span style={{padding: "1px 5px", background: "var(--c-error)", color: "#fff", borderRadius: 3, fontSize: 9, fontWeight: 700}}>18+</span>}
                    </div>
                  </div>
                  <div className="tnum" style={{fontSize: 14, fontWeight: 700, color: "var(--c-primary)"}}>₱{l.p}.00</div>
                </div>
              </div>
            ))}
            {/* Age gate notice */}
            <div style={{padding: "12px 20px", background: "var(--c-error-soft)", borderBottom: "1px solid #F4B6B6", display: "flex", alignItems: "center", gap: 10}}>
              <span style={{color: "var(--c-error)"}}>{VIcon.warn}</span>
              <div style={{flex: 1, fontSize: 12, color: "var(--c-error-deep)", fontWeight: 500, lineHeight: 1.4}}>
                <b>18+ item in cart.</b> Verify customer age before charging — RA 9211 (cigarettes).
              </div>
            </div>
          </div>

          <div style={{padding: "16px 20px", background: "#fff", borderTop: "1px solid var(--c-rule)"}}>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: "var(--c-muted)"}}><span>Subtotal</span><span className="tnum"><b style={{color: "var(--c-ink)"}}>₱310.00</b></span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "10px 0 0", marginTop: 6, borderTop: "1px solid var(--c-rule)", fontWeight: 700, fontSize: 22}}><span>Total</span><span className="tnum">₱310.00</span></div>
          </div>

          <div style={{padding: "14px 20px 20px"}}>
            <button className="btn btn-primary btn-cashier btn-full">Charge ₱310.00 {VIcon.chevR}</button>
          </div>
        </div>
      </div>

      <VVerticalFooter label="D · Retail / sari-sari" line="Scan-first · dense SKU table · tingi mode · 18+ gating per RA 9211" />
    </div>
  );
};

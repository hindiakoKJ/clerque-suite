// CLERQUE COUNTER — Tablet screens (1920×1200)
// All screens exported to window for the design canvas to render.

const React = window.React;
const { Fragment } = React;

// ============================ SHARED ATOMS ============================

const Svg = ({ d, w = 18, h = 18, sw = 2 }) => (
  <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
// Common icons (so we don't depend on emoji which look bad in cashier UIs)
const IconSearch = ({ s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
);
const IconMenu = ({ s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
);
const IconBack = ({ s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
);
const IconCheck = ({ s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
);
const IconPrint = ({ s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
);
const IconQR = ({ s = 96 }) => (
  // simple QR-like grid
  <svg width={s} height={s} viewBox="0 0 64 64" fill="currentColor">
    <rect x="2" y="2" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="4"/>
    <rect x="8" y="8" width="8" height="8"/>
    <rect x="42" y="2" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="4"/>
    <rect x="48" y="8" width="8" height="8"/>
    <rect x="2" y="42" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="4"/>
    <rect x="8" y="48" width="8" height="8"/>
    <rect x="26" y="2" width="4" height="4"/><rect x="34" y="2" width="4" height="4"/>
    <rect x="26" y="10" width="4" height="4"/><rect x="34" y="10" width="4" height="4"/>
    <rect x="26" y="18" width="4" height="4"/><rect x="30" y="22" width="4" height="4"/>
    <rect x="26" y="30" width="4" height="4"/><rect x="38" y="26" width="4" height="4"/>
    <rect x="42" y="30" width="4" height="4"/><rect x="34" y="34" width="4" height="4"/>
    <rect x="46" y="34" width="4" height="4"/><rect x="54" y="38" width="4" height="4"/>
    <rect x="26" y="42" width="4" height="4"/><rect x="38" y="42" width="4" height="4"/>
    <rect x="42" y="46" width="4" height="4"/><rect x="50" y="42" width="4" height="4"/>
    <rect x="30" y="50" width="4" height="4"/><rect x="38" y="54" width="4" height="4"/>
    <rect x="50" y="50" width="4" height="4"/><rect x="58" y="50" width="4" height="4"/>
    <rect x="30" y="58" width="4" height="4"/><rect x="42" y="58" width="4" height="4"/>
    <rect x="54" y="58" width="4" height="4"/>
  </svg>
);

const StatusBar = ({ light = false }) => (
  <div className={"statusbar" + (light ? " is-light" : "")}>
    <div className="statusbar-l">
      <span style={{fontWeight: 600}}>09:24</span>
    </div>
    <div className="statusbar-r">
      <span>5G</span>
      <span>·</span>
      <span>87%</span>
      <svg width="14" height="10" viewBox="0 0 24 16" fill="currentColor"><rect x="0" y="2" width="20" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><rect x="22" y="6" width="2" height="4"/><rect x="2" y="4" width="14" height="8"/></svg>
    </div>
  </div>
);

const AppBar = ({ tenant = "Tindahan Coffee", branch = "Katipunan branch", search = true, sync = "online", cashier = "MA", cashierName = "Maricar A.", offline = false }) => (
  <div>
    {offline && (
      <div className="banner banner-offline">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
        Working offline — 3 sales queued, will sync when reconnected.
      </div>
    )}
    <div className="appbar">
      <div>
        <div className="appbar-tenant display">{tenant}</div>
        <div className="appbar-tenant-sub">{branch}</div>
      </div>
      {search && (
        <div className="appbar-search">
          <IconSearch s={16} />
          <span>Search products, OR#, or scan barcode…</span>
        </div>
      )}
      <div className="appbar-right">
        <div className="sync-pill">
          <span className={"sync-pill-dot" + (sync === "offline" ? " is-offline" : "")}></span>
          {sync === "online" ? "Online · in sync" : "Offline · 3 queued"}
        </div>
        <div className="cashier-chip">
          <span className="cashier-chip-avatar">{cashier}</span>
          {cashierName}
        </div>
      </div>
    </div>
  </div>
);

// ============================ 1. SIGN-IN ============================

window.SignInTablet = function SignInTablet() {
  return (
    <div className="screen is-tablet" style={{display:"flex"}}>
      {/* Brand panel */}
      <div style={{
        width: 760,
        background: "linear-gradient(160deg, #EEE9DF 0%, #DDD4C2 100%)",
        padding: "64px 80px",
        display: "flex", flexDirection: "column",
        position: "relative",
      }}>
        {/* Logo */}
        <div style={{display: "flex", alignItems: "center", gap: 14}}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "var(--c-primary)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800, letterSpacing: "-.04em",
            boxShadow: "0 4px 16px rgba(139,94,60,.30)"
          }}>C</div>
          <div>
            <div className="display" style={{fontSize: 24, fontWeight: 700, letterSpacing: "-.02em"}}>Clerque</div>
            <div style={{fontSize: 12, color: "var(--c-muted)", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600, marginTop: 2}}>Counter</div>
          </div>
        </div>

        {/* Tagline */}
        <div style={{marginTop: 160}}>
          <div className="display" style={{fontSize: 56, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-.02em", color: "var(--c-ink)", maxWidth: 500}}>
            One tap.<br/>One sale.<br/>One <span style={{color:"var(--c-primary)"}}>sukli</span>.
          </div>
          <div style={{marginTop: 22, fontSize: 17, color: "var(--c-muted)", lineHeight: 1.5, maxWidth: 460}}>
            The counter side of Clerque — sized for your tablet, tuned for cash, GCash, PayMaya, and the BIR.
          </div>
        </div>

        {/* Bottom hint */}
        <div style={{marginTop: "auto", display: "flex", alignItems: "center", gap: 18, fontSize: 12, color: "var(--c-muted)"}}>
          <span style={{fontFamily: "var(--font-mono)"}}>v 1.4.2 · build 2026.05.12</span>
          <span>·</span>
          <span>Last sync · 11 min ago</span>
        </div>
      </div>

      {/* Form panel */}
      <div style={{flex: 1, background: "#fff", padding: "80px 120px", display: "flex", flexDirection: "column", justifyContent: "center"}}>
        <StatusBar light={true} />
        <div style={{maxWidth: 520, margin: "auto", width: "100%"}}>
          <div className="display" style={{fontSize: 36, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 8}}>Welcome back</div>
          <div style={{fontSize: 16, color: "var(--c-muted)", marginBottom: 36}}>Sign in to your tenant's Cloud account.</div>

          <div className="field" style={{marginBottom: 20}}>
            <span className="field-label">Email</span>
            <div className="field-input is-focus">
              <span>tindahan@kape.ph</span>
              <span style={{marginLeft:"auto"}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--c-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            </div>
          </div>

          <div className="field" style={{marginBottom: 14}}>
            <span className="field-label">Password</span>
            <div className="field-input">
              <span>••••••••••••</span>
              <span className="field-input-action">Show</span>
            </div>
          </div>

          <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28}}>
            <label style={{display: "flex", alignItems: "center", gap: 10, fontSize: 14}}>
              <span style={{width: 20, height: 20, borderRadius: 6, border: "1.5px solid var(--c-rule-strong)", background: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center"}}></span>
              Remember this tablet
            </label>
            <span style={{color: "var(--c-primary)", fontSize: 14, fontWeight: 600}}>Forgot password?</span>
          </div>

          <button className="btn btn-primary btn-cashier btn-full" style={{justifyContent: "center"}}>Sign in</button>

          <div style={{marginTop: 36, padding: 16, background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 10, fontSize: 13, color: "var(--c-muted)", lineHeight: 1.5}}>
            <b style={{color: "var(--c-ink)"}}>No account yet?</b> Subscriptions are managed at <b style={{color: "var(--c-primary)"}}>clerque.com</b> — sign up on a laptop, then sign in here.
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================ 2. PIN ENTRY ============================

window.PinTablet = function PinTablet() {
  return (
    <div className="screen is-tablet" style={{background: "var(--c-cream-soft)", display: "flex", flexDirection: "column"}}>
      <StatusBar light={true} />
      {/* Mini app bar */}
      <div className="appbar" style={{background: "transparent", borderBottom: 0}}>
        <div>
          <div className="appbar-tenant display">Tindahan Coffee</div>
          <div className="appbar-tenant-sub">Katipunan branch · signed in as owner</div>
        </div>
        <div className="appbar-right">
          <div className="sync-pill"><span className="sync-pill-dot"></span> Online · in sync</div>
          <span className="btn btn-ghost btn-default">Sign out</span>
        </div>
      </div>

      {/* Center */}
      <div style={{flex: 1, display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: 60}}>
        <div style={{display: "flex", flexDirection: "column", alignItems: "center"}}>
          {/* Avatar */}
          <div style={{
            width: 96, height: 96, borderRadius: 50,
            background: "var(--c-primary)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 700,
            boxShadow: "0 8px 24px rgba(139,94,60,.30)",
            marginBottom: 20,
          }}>MA</div>

          <div className="display" style={{fontSize: 32, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 4}}>Welcome, Maricar</div>
          <div style={{fontSize: 16, color: "var(--c-muted)", marginBottom: 28}}>Enter your 4-digit PIN to start your shift</div>

          {/* PIN dots */}
          <div className="pin-dots" style={{marginBottom: 36}}>
            <div className="pin-dot is-filled"></div>
            <div className="pin-dot is-filled"></div>
            <div className="pin-dot"></div>
            <div className="pin-dot"></div>
          </div>

          {/* Keypad */}
          <div className="keypad is-3col-lg">
            {[1,2,3,4,5,6,7,8,9].map(n => <div key={n} className="key">{n}</div>)}
            <div className="key is-action">Clear</div>
            <div className="key">0</div>
            <div className="key is-action">⌫</div>
          </div>

          {/* Switch cashier link */}
          <div style={{marginTop: 32, fontSize: 14, color: "var(--c-primary)", fontWeight: 600}}>
            Not Maricar?  &nbsp; Switch cashier ↗
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <div style={{padding: 24, textAlign: "center", fontSize: 12, color: "var(--c-muted)"}}>
        Forgot PIN? An owner can reset cashier PINs at clerque.com → Employees
      </div>
    </div>
  );
};

// ============================ 3. POS MAIN ============================

const CATEGORIES = [
  {id: "all", name: "All products", icon: "★", count: 124, active: false},
  {id: "coffee", name: "Coffee · Hot", icon: "☕", count: 18, active: true},
  {id: "iced", name: "Coffee · Iced", icon: "❄", count: 14, active: false},
  {id: "milk", name: "Milk tea", icon: "T", count: 9, active: false},
  {id: "pastry", name: "Pastry", icon: "P", count: 22, active: false},
  {id: "savory", name: "Savory", icon: "S", count: 11, active: false},
  {id: "merch", name: "Merch", icon: "M", count: 6, active: false},
];

const COFFEE_PRODUCTS = [
  {name: "Americano", price: 110, badge: null, mod: true, tile: "is-coffee", initials: "Am"},
  {name: "Cappuccino", price: 140, badge: null, mod: true, tile: "is-coffee", initials: "Cp"},
  {name: "Café Latte", price: 145, badge: null, mod: true, tile: "is-coffee", initials: "Lt"},
  {name: "Spanish Latte", price: 160, badge: null, mod: true, tile: "is-coffee", initials: "SL"},
  {name: "Mocha", price: 165, badge: null, mod: true, tile: "is-coffee", initials: "Mo"},
  {name: "Caramel Macchiato", price: 170, badge: null, mod: true, tile: "is-coffee", initials: "CM"},
  {name: "Flat White", price: 150, badge: null, mod: true, tile: "is-coffee", initials: "FW"},
  {name: "Cortado", price: 140, badge: "low-stock", mod: true, tile: "is-coffee", initials: "Co"},
  {name: "Espresso · single", price: 80, badge: null, mod: false, tile: "is-coffee", initials: "E1"},
  {name: "Espresso · double", price: 110, badge: null, mod: false, tile: "is-coffee", initials: "E2"},
  {name: "Vietnamese Drip", price: 155, badge: null, mod: true, tile: "is-coffee", initials: "VD"},
  {name: "Café Mocha", price: 165, badge: null, mod: true, tile: "is-coffee", initials: "CM"},
];

function ProductGrid({ highlightedIdx = null }) {
  return (
    <div className="product-grid">
      {COFFEE_PRODUCTS.map((p, i) => (
        <div key={i} className="product-card" style={highlightedIdx === i ? {outline: "2.5px solid var(--c-primary)", outlineOffset: -1} : null}>
          <div className="product-card-img">
            <div className={"ph-tile " + p.tile}>{p.initials}</div>
            {p.badge === "low-stock" && <span className="product-card-badge is-stock">Low · 3 left</span>}
            {p.mod && <span className="product-card-mod">+</span>}
          </div>
          <div className="product-card-body">
            <div className="product-card-name">{p.name}</div>
            <div className="product-card-price tnum">₱{p.price.toFixed(2)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CartPanel({ cta = "Charge ₱360.00", showSenior = false }) {
  return (
    <div className="cart-panel" style={{width: 460}}>
      <div className="cart-head">
        <div>
          <div className="cart-head-t">Current sale</div>
          <div className="cart-head-sub">3 items · started 11:42</div>
        </div>
        <span className="btn btn-ghost btn-compact">Hold</span>
      </div>
      <div className="cart-lines">
        <div className="cart-line">
          <div>
            <div className="cart-line-name">Iced Spanish Latte · Grande</div>
            <div className="cart-line-mods">Oat milk +₱20 · No sugar · Extra shot +₱30</div>
            {showSenior && <div className="cart-line-disc">− Senior · 20%</div>}
            <div className="cart-line-controls">
              <div className="qty-stepper">
                <button>−</button>
                <span className="qty-stepper-val">2</span>
                <button>+</button>
              </div>
            </div>
          </div>
          <div>
            <div className="cart-line-price tnum">₱360.00</div>
            <div className="cart-line-was tnum">₱450.00</div>
          </div>
        </div>
        <div className="cart-line">
          <div>
            <div className="cart-line-name">Pandesal · pack of 6</div>
            <div className="cart-line-mods">No modifiers</div>
            <div className="cart-line-controls">
              <div className="qty-stepper">
                <button disabled>−</button>
                <span className="qty-stepper-val">1</span>
                <button>+</button>
              </div>
            </div>
          </div>
          <div>
            <div className="cart-line-price tnum">₱48.00</div>
          </div>
        </div>
        <div className="cart-line">
          <div>
            <div className="cart-line-name">Cheese ensaymada</div>
            <div className="cart-line-controls">
              <div className="qty-stepper">
                <button disabled>−</button>
                <span className="qty-stepper-val">1</span>
                <button>+</button>
              </div>
            </div>
          </div>
          <div>
            <div className="cart-line-price tnum">₱65.00</div>
          </div>
        </div>
      </div>
      <div className="cart-totals">
        <div className="cart-total-row"><span>Subtotal</span><span className="tnum"><b>₱473.00</b></span></div>
        {showSenior && <div className="cart-total-row" style={{color: "var(--c-success-deep)"}}><span>Senior discount · 20%</span><span className="tnum"><b>− ₱90.00</b></span></div>}
        <div className="cart-total-row"><span>VAT-exempt sales</span><span className="tnum"><b>₱383.00</b></span></div>
        <div className="cart-total-row is-grand"><span>Total · Bayaran</span><span className="tnum"><b>₱383.00</b></span></div>
      </div>
      <div className="cart-cta">
        <button className="btn btn-primary btn-cashier btn-full">{cta}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div style={{display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13, color: "var(--c-muted)"}}>
          <span>Discount</span>
          <span>Senior · PWD</span>
          <span>Note</span>
          <span>Clear cart</span>
        </div>
      </div>
    </div>
  );
}

window.POSMainTablet = function POSMainTablet() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column"}}>
      <StatusBar light={true} />
      <AppBar />
      <div style={{flex: 1, display: "flex", minHeight: 0}}>
        <div className="cat-rail">
          {CATEGORIES.map(c => (
            <div key={c.id} className={"cat-item " + (c.active ? "is-active" : "")}>
              <span className="cat-item-icon">{c.icon}</span>
              {c.name}
              <span className="cat-item-count">{c.count}</span>
            </div>
          ))}
        </div>
        <div style={{flex: 1, display: "flex", flexDirection: "column", minWidth: 0}}>
          <div style={{padding: "16px 18px 6px", display: "flex", alignItems: "center", justifyContent: "space-between"}}>
            <div className="display" style={{fontSize: 22, fontWeight: 700, letterSpacing: "-.01em"}}>Coffee · Hot <span style={{fontFamily: "var(--font-mono)", fontWeight: 400, fontSize: 13, color: "var(--c-muted)", marginLeft: 8}}>18 products</span></div>
            <div style={{display: "flex", gap: 8}}>
              <span className="chip" style={{minHeight: 40, padding: "8px 14px"}}>Popular</span>
              <span className="chip" style={{minHeight: 40, padding: "8px 14px"}}>Recent</span>
              <span className="chip is-selected" style={{minHeight: 40, padding: "8px 14px"}}>A → Z</span>
            </div>
          </div>
          <ProductGrid />
        </div>
        <CartPanel />
      </div>
    </div>
  );
};

// ============================ 4. POS MAIN + MODIFIER SHEET ============================

window.POSModifierSheet = function POSModifierSheet() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", position: "relative"}}>
      <StatusBar light={true} />
      <AppBar />
      <div style={{flex: 1, display: "flex", minHeight: 0}}>
        <div className="cat-rail">
          {CATEGORIES.map(c => (
            <div key={c.id} className={"cat-item " + (c.active ? "is-active" : "")}>
              <span className="cat-item-icon">{c.icon}</span>
              {c.name}
              <span className="cat-item-count">{c.count}</span>
            </div>
          ))}
        </div>
        <div style={{flex: 1, display: "flex", flexDirection: "column", minWidth: 0}}>
          <div style={{padding: "16px 18px 6px", display: "flex", alignItems: "center", justifyContent: "space-between"}}>
            <div className="display" style={{fontSize: 22, fontWeight: 700, letterSpacing: "-.01em"}}>Coffee · Hot</div>
          </div>
          <ProductGrid highlightedIdx={3} />
        </div>
        <CartPanel />
      </div>

      {/* Sheet */}
      <div className="scrim"></div>
      <div className="sheet is-centered">
        <div className="sheet-handle"></div>
        <div className="sheet-head">
          <div>
            <h3>Customize · Spanish Latte</h3>
            <div className="sheet-head-sub">Base ₱160.00 · adjust below</div>
          </div>
          <div className="sheet-head-close">×</div>
        </div>
        <div className="sheet-body">
          {/* Size */}
          <div className="sheet-section">
            <div className="sheet-section-h">Size <span className="sheet-section-h-req">Required</span></div>
            <div style={{display: "flex", gap: 10, flexWrap: "wrap"}}>
              <span className="chip"><span className="chip-radio"></span> Tall <span className="chip-price">+₱0</span></span>
              <span className="chip is-selected"><span className="chip-radio"></span> Grande <span className="chip-price">+₱20</span></span>
              <span className="chip"><span className="chip-radio"></span> Venti <span className="chip-price">+₱40</span></span>
            </div>
          </div>
          {/* Temp */}
          <div className="sheet-section">
            <div className="sheet-section-h">Temperature <span className="sheet-section-h-req">Required</span></div>
            <div style={{display: "flex", gap: 10}}>
              <span className="chip"><span className="chip-radio"></span> Hot</span>
              <span className="chip is-selected"><span className="chip-radio"></span> Iced</span>
            </div>
          </div>
          {/* Milk */}
          <div className="sheet-section">
            <div className="sheet-section-h">Milk <span className="sheet-section-h-req">Required</span></div>
            <div style={{display: "flex", gap: 10, flexWrap: "wrap"}}>
              <span className="chip"><span className="chip-radio"></span> Whole</span>
              <span className="chip"><span className="chip-radio"></span> Skim</span>
              <span className="chip is-selected"><span className="chip-radio"></span> Oat <span className="chip-price">+₱20</span></span>
              <span className="chip"><span className="chip-radio"></span> Soy <span className="chip-price">+₱20</span></span>
              <span className="chip"><span className="chip-radio"></span> Almond <span className="chip-price">+₱20</span></span>
            </div>
          </div>
          {/* Sugar */}
          <div className="sheet-section">
            <div className="sheet-section-h">Sugar</div>
            <div style={{display: "flex", gap: 10}}>
              <span className="chip is-selected"><span className="chip-radio"></span> 0%</span>
              <span className="chip"><span className="chip-radio"></span> 25%</span>
              <span className="chip"><span className="chip-radio"></span> 50%</span>
              <span className="chip"><span className="chip-radio"></span> 75%</span>
              <span className="chip"><span className="chip-radio"></span> 100%</span>
            </div>
          </div>
          {/* Addons */}
          <div className="sheet-section">
            <div className="sheet-section-h">Add-ons <span style={{textTransform:"none",letterSpacing:0,fontWeight:500,color:"var(--c-muted)"}}>Optional · pick any</span></div>
            <div style={{display: "flex", gap: 10, flexWrap: "wrap"}}>
              <span className="chip is-selected"><span style={{width: 18, height: 18, borderRadius: 50, background: "var(--c-primary)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700}}>✓</span> Extra shot <span className="chip-price">+₱30</span></span>
              <span className="chip"><span style={{width: 18, height: 18, borderRadius: 50, border: "1.5px solid var(--c-rule-strong)"}}></span> Whip <span className="chip-price">+₱15</span></span>
              <span className="chip"><span style={{width: 18, height: 18, borderRadius: 50, border: "1.5px solid var(--c-rule-strong)"}}></span> Cinnamon <span className="chip-price">+₱5</span></span>
              <span className="chip"><span style={{width: 18, height: 18, borderRadius: 50, border: "1.5px solid var(--c-rule-strong)"}}></span> Caramel drizzle <span className="chip-price">+₱10</span></span>
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost btn-default">Cancel</button>
          <button className="btn btn-primary btn-default btn-full">Add 1 · ₱210.00</button>
        </div>
      </div>
    </div>
  );
};

// ============================ 5. TENDERING (CASH) ============================

window.TenderingCash = function TenderingCash() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-cream-soft)"}}>
      <StatusBar light={true} />
      {/* Header */}
      <div style={{display: "flex", alignItems: "center", padding: "20px 32px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <button className="btn btn-ghost btn-default" style={{padding: 0, gap: 10, minWidth: 0}}>
          <IconBack s={20} /> Back to cart
        </button>
        <div style={{marginLeft: 32}}>
          <div className="display" style={{fontSize: 20, fontWeight: 700}}>Tendering · Bayad</div>
          <div style={{fontSize: 12, color: "var(--c-muted)"}}>Sale #000125 · 3 items</div>
        </div>
        <div style={{marginLeft: "auto", textAlign: "right"}}>
          <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600}}>Amount due</div>
          <div className="display tnum" style={{fontSize: 48, fontWeight: 800, letterSpacing: "-.02em", color: "var(--c-ink)", lineHeight: 1}}>₱383.00</div>
        </div>
      </div>

      {/* Method tabs */}
      <div style={{display: "flex", padding: "20px 32px 0", gap: 12, background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
        <div style={{padding: "16px 24px", borderBottom: "3px solid var(--c-primary)", color: "var(--c-primary)", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 10}}>
          <span style={{width: 24, height: 24, borderRadius: 50, background: "var(--c-primary-container)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--c-primary-press)", fontSize: 13, fontWeight: 700}}>₱</span>
          Cash
        </div>
        <div style={{padding: "16px 24px", color: "var(--c-muted)", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 10}}>
          <span style={{width: 24, height: 24, borderRadius: 50, background: "#E1EEFE", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--c-gcash)", fontSize: 11, fontWeight: 700}}>G</span>
          GCash
        </div>
        <div style={{padding: "16px 24px", color: "var(--c-muted)", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 10}}>
          <span style={{width: 24, height: 24, borderRadius: 50, background: "#D9F4E1", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--c-paymaya)", fontSize: 11, fontWeight: 700}}>P</span>
          PayMaya
        </div>
        <div style={{padding: "16px 24px", color: "var(--c-muted)", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 10}}>
          <span style={{width: 24, height: 24, borderRadius: 50, background: "var(--c-cream)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--c-ink)", fontSize: 13}}>◧</span>
          Card
        </div>
        <div style={{padding: "16px 24px", color: "var(--c-muted)", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 10}}>
          ÷ &nbsp; Split
        </div>
      </div>

      {/* Body */}
      <div style={{flex: 1, padding: "32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32}}>
        {/* Left: amount & sukli */}
        <div>
          <div style={{padding: 28, background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)", marginBottom: 24}}>
            <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600, marginBottom: 8}}>Bayad · cash received</div>
            <div className="display tnum" style={{fontSize: 64, fontWeight: 700, letterSpacing: "-.02em", color: "var(--c-ink)", lineHeight: 1}}>₱500.00</div>
          </div>
          <div style={{padding: 28, background: "var(--c-success-soft)", borderRadius: 16, border: "1px solid #B5E6D2"}}>
            <div style={{fontSize: 12, color: "var(--c-success-deep)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 8}}>Sukli · change</div>
            <div className="display tnum" style={{fontSize: 64, fontWeight: 700, letterSpacing: "-.02em", color: "var(--c-success-deep)", lineHeight: 1}}>₱117.00</div>
          </div>

          {/* Summary */}
          <div style={{marginTop: 24, padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)", fontSize: 14}}>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-muted)"}}><span>Subtotal</span><span className="tnum">₱473.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-success-deep)"}}><span>Senior discount · 20%</span><span className="tnum">− ₱90.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-muted)"}}><span>VAT-exempt sales</span><span className="tnum">₱383.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "10px 0 0", marginTop: 6, borderTop: "1px solid var(--c-rule)", fontWeight: 700, fontSize: 16}}><span>Total</span><span className="tnum">₱383.00</span></div>
          </div>
        </div>

        {/* Right: keypad + quick amounts */}
        <div style={{display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignSelf: "start"}}>
          <div className="keypad is-3col-lg">
            {[1,2,3,4,5,6,7,8,9].map(n => <div key={n} className="key">{n}</div>)}
            <div className="key is-action">·</div>
            <div className="key">0</div>
            <div className="key is-action">⌫</div>
          </div>
          <div style={{display: "grid", gridTemplateRows: "repeat(7, auto)", gap: 10, padding: 14, background: "var(--c-cream-soft)", borderRadius: 16, border: "1px solid var(--c-cream-deep)"}}>
            <div style={{fontSize: 11, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, padding: "2px 4px"}}>Quick amounts</div>
            <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10}}>
              <div className="key" style={{height: 60}}>₱20</div>
              <div className="key" style={{height: 60}}>₱50</div>
              <div className="key" style={{height: 60}}>₱100</div>
              <div className="key" style={{height: 60}}>₱200</div>
              <div className="key" style={{height: 60}}>₱500</div>
              <div className="key" style={{height: 60}}>₱1,000</div>
            </div>
            <div style={{padding: "6px 4px 2px"}}>
              <button className="btn btn-secondary btn-default btn-full">Exact · ₱383</button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div style={{padding: 24, background: "#fff", borderTop: "1px solid var(--c-rule)", display: "flex", gap: 16}}>
        <button className="btn btn-ghost btn-default" style={{flex: "0 0 200px"}}>Cancel sale</button>
        <button className="btn btn-primary btn-cashier" style={{flex: 1}}>
          Confirm payment · ₱500 received
          <IconCheck s={24} />
        </button>
      </div>
    </div>
  );
};

// ============================ 6. TENDERING (GCash) ============================

window.TenderingGCash = function TenderingGCash() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-cream-soft)"}}>
      <StatusBar light={true} />
      <div style={{display: "flex", alignItems: "center", padding: "20px 32px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <button className="btn btn-ghost btn-default" style={{padding: 0, gap: 10, minWidth: 0}}>
          <IconBack s={20} /> Back to cart
        </button>
        <div style={{marginLeft: 32}}>
          <div className="display" style={{fontSize: 20, fontWeight: 700}}>Tendering · GCash</div>
          <div style={{fontSize: 12, color: "var(--c-muted)"}}>Sale #000125</div>
        </div>
        <div style={{marginLeft: "auto", textAlign: "right"}}>
          <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600}}>Amount due</div>
          <div className="display tnum" style={{fontSize: 48, fontWeight: 800, letterSpacing: "-.02em", color: "var(--c-ink)", lineHeight: 1}}>₱383.00</div>
        </div>
      </div>

      {/* Method tabs */}
      <div style={{display: "flex", padding: "20px 32px 0", gap: 12, background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
        <div style={{padding: "16px 24px", color: "var(--c-muted)", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 10}}>
          <span style={{width: 24, height: 24, borderRadius: 50, background: "var(--c-cream)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--c-ink)", fontSize: 13, fontWeight: 700}}>₱</span>
          Cash
        </div>
        <div style={{padding: "16px 24px", borderBottom: "3px solid var(--c-gcash)", color: "var(--c-gcash)", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 10}}>
          <span style={{width: 24, height: 24, borderRadius: 50, background: "#E1EEFE", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--c-gcash)", fontSize: 11, fontWeight: 700}}>G</span>
          GCash
        </div>
        <div style={{padding: "16px 24px", color: "var(--c-muted)", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 10}}>
          <span style={{width: 24, height: 24, borderRadius: 50, background: "#D9F4E1", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--c-paymaya)", fontSize: 11, fontWeight: 700}}>P</span>
          PayMaya
        </div>
        <div style={{padding: "16px 24px", color: "var(--c-muted)", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 10}}>
          <span style={{width: 24, height: 24, borderRadius: 50, background: "var(--c-cream)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--c-ink)", fontSize: 13}}>◧</span>
          Card
        </div>
        <div style={{padding: "16px 24px", color: "var(--c-muted)", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 10}}>
          ÷ &nbsp; Split
        </div>
      </div>

      {/* Body */}
      <div style={{flex: 1, padding: "32px", display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 32}}>
        {/* Left: instructions + reference */}
        <div>
          <div style={{padding: 28, background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)", marginBottom: 20}}>
            <div style={{display: "flex", gap: 16, marginBottom: 16}}>
              <span style={{width: 32, height: 32, borderRadius: 50, background: "var(--c-gcash)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16}}>G</span>
              <div>
                <div className="display" style={{fontSize: 18, fontWeight: 700}}>Customer pays via GCash</div>
                <div style={{fontSize: 13, color: "var(--c-muted)", marginTop: 2}}>Show them this QR or send the request. They'll get a 6-digit confirmation.</div>
              </div>
            </div>

            <div style={{display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "center"}}>
              {/* QR */}
              <div style={{padding: 14, background: "#fff", border: "1.5px solid var(--c-rule-strong)", borderRadius: 12, color: "var(--c-ink)"}}>
                <IconQR s={140} />
              </div>
              <div>
                <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 8}}>Pay to</div>
                <div className="display" style={{fontSize: 22, fontWeight: 700, marginBottom: 4}}>Tindahan Coffee</div>
                <div className="tnum" style={{fontSize: 16, fontFamily: "var(--font-mono)", color: "var(--c-muted)", marginBottom: 16}}>0917 ••• 4452</div>
                <div style={{padding: "10px 14px", background: "var(--c-info-soft)", borderRadius: 8, fontSize: 13, color: "var(--c-info-deep)", fontWeight: 500}}>Or tap "Send request" — sends a GCash payment request to the phone number entered below.</div>
              </div>
            </div>
          </div>

          <div style={{padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
            <div className="field" style={{marginBottom: 16}}>
              <span className="field-label">Customer phone <span style={{fontWeight: 500, color: "var(--c-muted)"}}>· optional</span></span>
              <div className="field-input">
                <span className="field-input-prefix" style={{fontWeight: 500}}>+63</span>
                <span>9XX XXX XXXX</span>
                <span className="field-input-action">Send request</span>
              </div>
            </div>
            <div className="field">
              <span className="field-label">GCash reference no. <span style={{color: "var(--c-error)"}}>*</span></span>
              <div className="field-input is-focus">
                <span className="tnum">1234567890</span>
                <span className="field-input-action">Paste</span>
              </div>
              <span className="field-help">From the customer's confirmation SMS · 13 digits</span>
            </div>
          </div>
        </div>

        {/* Right: summary + receive */}
        <div>
          <div style={{padding: 28, background: "var(--c-info-soft)", borderRadius: 16, border: "1px solid #BFD8FB", marginBottom: 20}}>
            <div style={{fontSize: 12, color: "var(--c-info-deep)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 8}}>Receive · GCash</div>
            <div className="display tnum" style={{fontSize: 64, fontWeight: 700, letterSpacing: "-.02em", color: "var(--c-info-deep)", lineHeight: 1}}>₱383.00</div>
            <div style={{marginTop: 12, fontSize: 13, color: "var(--c-info-deep)", fontWeight: 500}}>Exact amount only · no change given</div>
          </div>

          <div style={{padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)", fontSize: 14, marginBottom: 20}}>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-muted)"}}><span>Subtotal</span><span className="tnum">₱473.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-success-deep)"}}><span>Senior discount · 20%</span><span className="tnum">− ₱90.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-muted)"}}><span>VAT-exempt sales</span><span className="tnum">₱383.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "10px 0 0", marginTop: 6, borderTop: "1px solid var(--c-rule)", fontWeight: 700, fontSize: 16}}><span>Total · Bayaran</span><span className="tnum">₱383.00</span></div>
          </div>

          <div style={{padding: "16px 20px", background: "var(--c-cream)", borderRadius: 12, fontSize: 13, color: "var(--c-muted)", lineHeight: 1.55}}>
            <b style={{color: "var(--c-ink)"}}>Tip:</b> Wait for the customer's "Sent successfully" SMS before tapping Confirm. The reference number is the final proof — printed on the receipt for both of you.
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{padding: 24, background: "#fff", borderTop: "1px solid var(--c-rule)", display: "flex", gap: 16}}>
        <button className="btn btn-ghost btn-default" style={{flex: "0 0 200px"}}>Cancel sale</button>
        <button className="btn btn-primary btn-cashier" style={{flex: 1, background: "var(--c-gcash)"}}>
          Confirm GCash payment · ref 1234567890
          <IconCheck s={24} />
        </button>
      </div>
    </div>
  );
};

// ============================ 7. RECEIPT ============================

window.ReceiptTablet = function ReceiptTablet() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-cream-soft)"}}>
      <StatusBar light={true} />
      {/* Header */}
      <div style={{display: "flex", alignItems: "center", padding: "20px 32px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <div>
          <div className="display" style={{fontSize: 22, fontWeight: 700}}>Sale complete</div>
          <div style={{display: "flex", alignItems: "center", gap: 10, marginTop: 4}}>
            <span className="badge badge-success" style={{padding: "5px 12px", fontSize: 12}}><span className="badge-dot"></span> Paid · GCash</span>
            <span style={{fontSize: 13, color: "var(--c-muted)"}}>OR # 000125 · 15 May 2026 · 14:32</span>
          </div>
        </div>
        <div style={{marginLeft: "auto", display: "flex", gap: 12, alignItems: "center"}}>
          <span className="badge badge-info"><span className="badge-dot"></span> Sent to printer · 2s ago</span>
          <button className="btn btn-ghost btn-default">Order history →</button>
        </div>
      </div>

      <div style={{flex: 1, display: "flex", padding: "40px 80px", gap: 48, alignItems: "flex-start", justifyContent: "center"}}>
        {/* Receipt */}
        <div className="receipt">
          <div className="receipt-center">
            <div style={{fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800}}>TINDAHAN COFFEE</div>
            <div style={{fontSize: 11, color: "var(--c-muted)", marginTop: 4}}>15 Esteban Abada St., Katipunan, Quezon City</div>
            <div style={{fontSize: 11, color: "var(--c-muted)"}}>TIN 123-456-789-000 · Non-VAT registered</div>
            <div style={{fontSize: 10, color: "var(--c-muted)", marginTop: 4, fontFamily: "var(--font-body)", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 600}}>Pang-opisyal na Resibo</div>
            <div className="receipt-or">OR # 000125</div>
            <div style={{fontSize: 11, color: "var(--c-muted)"}}>15 May 2026 · 14:32 · Cashier MA</div>
          </div>

          <div className="receipt-hr"></div>

          <div className="receipt-row"><span>2× Iced Spanish Latte</span><span>₱360.00</span></div>
          <div style={{fontSize: 11, color: "var(--c-muted)", paddingLeft: 12}}>Grande · Oat milk +₱20 · No sugar · Extra shot +₱30</div>
          <div className="receipt-row" style={{marginTop: 4}}><span>1× Pandesal · 6 pc</span><span>₱48.00</span></div>
          <div className="receipt-row" style={{marginTop: 4}}><span>1× Cheese ensaymada</span><span>₱65.00</span></div>

          <div className="receipt-hr"></div>

          <div className="receipt-row"><span>Subtotal</span><span>₱473.00</span></div>
          <div className="receipt-row"><span>Senior disc (20%)</span><span>− ₱90.00</span></div>
          <div className="receipt-row"><span>VAT-exempt sales</span><span>₱383.00</span></div>
          <div className="receipt-row"><span>VAT amount</span><span>₱0.00</span></div>

          <div className="receipt-hr"></div>

          <div className="receipt-row receipt-tot"><span>TOTAL</span><span>₱383.00</span></div>
          <div className="receipt-row" style={{marginTop: 6}}><span>GCash</span><span>₱383.00</span></div>
          <div className="receipt-row"><span>Ref</span><span>1234567890</span></div>
          <div className="receipt-row"><span>Sukli</span><span>₱0.00</span></div>

          <div className="receipt-hr"></div>

          <div style={{fontSize: 11, color: "var(--c-muted)", lineHeight: 1.6}}>
            <div>Senior ID: SR-2026-0042</div>
            <div>Name: Lola Carmen S.</div>
            <div>Signature: ___________________</div>
          </div>

          <div className="receipt-hr"></div>

          <div className="receipt-center" style={{fontSize: 10, color: "var(--c-muted)", lineHeight: 1.6}}>
            <div style={{fontWeight: 700, color: "var(--c-ink)", marginBottom: 4, fontSize: 11}}>Salamat po · Thank you!</div>
            <div>Powered by Clerque · clerque.com</div>
            <div style={{marginTop: 6}}>This serves as your official receipt.</div>
          </div>
        </div>

        {/* Actions panel */}
        <div style={{flex: 1, maxWidth: 480, display: "flex", flexDirection: "column", gap: 12}}>
          <div style={{padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
            <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 6}}>Receipt for customer</div>
            <div style={{display: "flex", flexDirection: "column", gap: 10}}>
              <button className="btn btn-secondary btn-default btn-full" style={{justifyContent:"flex-start", paddingLeft: 16}}>
                <IconPrint s={18} /> Re-print receipt
              </button>
              <button className="btn btn-secondary btn-default btn-full" style={{justifyContent:"flex-start", paddingLeft: 16}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                Send via SMS · +63 917 •••
              </button>
              <button className="btn btn-secondary btn-default btn-full" style={{justifyContent:"flex-start", paddingLeft: 16}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Email receipt
              </button>
            </div>
          </div>

          <button className="btn btn-primary btn-cashier btn-full" style={{marginTop: 12}}>
            Start next sale
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>

          <div style={{padding: "14px 18px", background: "var(--c-cream)", borderRadius: 10, fontSize: 12, color: "var(--c-muted)", lineHeight: 1.55}}>
            BIR · This sale is appended to your OR sequence (gap-free). Daily Z-read will close at 23:59 or when shift ends.
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================ 8. Z-READ / SHIFT CLOSE ============================

window.ZReadTablet = function ZReadTablet() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-cream-soft)"}}>
      <StatusBar light={true} />
      {/* Header */}
      <div style={{display: "flex", alignItems: "center", padding: "20px 32px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <button className="btn btn-ghost btn-default" style={{padding: 0, gap: 10, minWidth: 0}}>
          <IconBack s={20} /> Cancel
        </button>
        <div style={{marginLeft: 32}}>
          <div className="display" style={{fontSize: 22, fontWeight: 700}}>Close shift · Z-read</div>
          <div style={{fontSize: 13, color: "var(--c-muted)"}}>Shift #2026-05-15-A · opened 08:00 by Maricar A.</div>
        </div>
        <div style={{marginLeft: "auto", display: "flex", gap: 12}}>
          <span className="badge badge-warning" style={{padding: "6px 14px", fontSize: 13}}><span className="badge-dot"></span> 9h 14m elapsed</span>
        </div>
      </div>

      <div style={{flex: 1, padding: "32px", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, overflow: "hidden"}}>
        {/* Left: numbers */}
        <div style={{display: "flex", flexDirection: "column", gap: 16, overflow: "auto"}}>
          {/* Gross sales */}
          <div style={{padding: "24px 28px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
            <div style={{display: "flex", alignItems: "baseline", justifyContent: "space-between"}}>
              <div>
                <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700}}>Gross sales</div>
                <div className="display tnum" style={{fontSize: 48, fontWeight: 800, letterSpacing: "-.02em", marginTop: 4}}>₱18,432.00</div>
                <div style={{fontSize: 13, color: "var(--c-muted)", marginTop: 4}}>87 transactions · avg ₱211.86</div>
              </div>
              <div style={{textAlign: "right"}}>
                <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700}}>Net sales</div>
                <div className="display tnum" style={{fontSize: 32, fontWeight: 700, marginTop: 4, color: "var(--c-success-deep)"}}>₱17,118.00</div>
                <div style={{fontSize: 13, color: "var(--c-muted)", marginTop: 2}}>after discounts</div>
              </div>
            </div>
          </div>

          {/* Tender breakdown */}
          <div style={{padding: "24px 28px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
            <div style={{fontSize: 14, fontWeight: 700, marginBottom: 14}}>By tender</div>
            {[
              {name: "Cash · Bayad", count: 38, amount: 7842, pct: 45.8, color: "var(--c-primary)"},
              {name: "GCash", count: 32, amount: 6450, pct: 37.7, color: "var(--c-gcash)"},
              {name: "PayMaya", count: 11, amount: 1980, pct: 11.6, color: "var(--c-paymaya)"},
              {name: "Card", count: 6, amount: 846, pct: 4.9, color: "var(--c-muted)"},
            ].map(t => (
              <div key={t.name} style={{padding: "10px 0", borderBottom: "1px solid var(--c-rule)"}}>
                <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline"}}>
                  <span style={{fontSize: 14, fontWeight: 600}}>{t.name}</span>
                  <span className="tnum" style={{fontSize: 16, fontWeight: 700}}>₱{t.amount.toLocaleString()}.00</span>
                </div>
                <div style={{display: "flex", alignItems: "center", gap: 10, marginTop: 6}}>
                  <div style={{flex: 1, height: 6, background: "var(--c-cream)", borderRadius: 3, overflow: "hidden"}}>
                    <div style={{height: "100%", background: t.color, width: `${t.pct}%`}}></div>
                  </div>
                  <span className="tnum" style={{fontSize: 11, color: "var(--c-muted)", minWidth: 76, textAlign: "right"}}>{t.count} txn · {t.pct}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* BIR + Voids */}
          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16}}>
            <div style={{padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
              <div style={{fontSize: 12, fontWeight: 700, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10}}>BIR · Non-VAT</div>
              <div style={{fontSize: 13, lineHeight: 1.9}}>
                <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">VAT-exempt sales</span><span className="tnum">₱17,118.00</span></div>
                <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">VAT amount</span><span className="tnum">₱0.00</span></div>
                <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">OR range</span><span className="tnum">000038 → 000125</span></div>
                <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">Gap-free</span><span style={{color: "var(--c-success-deep)", fontWeight: 600}}>✓ Yes</span></div>
              </div>
            </div>
            <div style={{padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
              <div style={{fontSize: 12, fontWeight: 700, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10}}>Voids · refunds · discounts</div>
              <div style={{fontSize: 13, lineHeight: 1.9}}>
                <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">Voided lines</span><span className="tnum">3 · ₱270.00</span></div>
                <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">Refunded sales</span><span className="tnum">1 · ₱180.00</span></div>
                <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">Senior / PWD</span><span className="tnum">14 · ₱1,134.00</span></div>
                <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">Other discounts</span><span className="tnum">2 · ₱80.00</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: cash drawer reconciliation */}
        <div style={{display: "flex", flexDirection: "column", gap: 16, overflow: "auto"}}>
          <div style={{padding: "24px 28px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
            <div style={{fontSize: 14, fontWeight: 700, marginBottom: 4}}>Cash drawer · reconciliation</div>
            <div style={{fontSize: 13, color: "var(--c-muted)", marginBottom: 16}}>Count physical cash, enter below.</div>
            <div style={{fontSize: 14, lineHeight: 2}}>
              <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">Opening float</span><span className="tnum">₱2,000.00</span></div>
              <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">+ Cash sales</span><span className="tnum">₱7,842.00</span></div>
              <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">+ Cash in</span><span className="tnum">₱500.00</span></div>
              <div style={{display: "flex", justifyContent: "space-between"}}><span className="muted">− Cash out</span><span className="tnum">₱(180.00)</span></div>
              <div style={{display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--c-rule)", paddingTop: 8, marginTop: 4, fontWeight: 700, fontSize: 16}}><span>Expected in drawer</span><span className="tnum">₱10,162.00</span></div>
            </div>
            <div className="field" style={{marginTop: 16}}>
              <span className="field-label">Counted cash</span>
              <div className="field-input is-focus">
                <span className="field-input-prefix">₱</span>
                <span className="tnum">10,155.00</span>
              </div>
            </div>
            <div style={{padding: "12px 16px", background: "var(--c-warning-soft)", color: "var(--c-warning-deep)", borderRadius: 10, marginTop: 12, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 10}}>
              <span style={{fontSize: 18}}>!</span>
              Variance · <b className="tnum">− ₱7.00</b> &nbsp;<span style={{fontWeight: 400, color: "var(--c-warning-deep)"}}>(rounding · within tolerance)</span>
            </div>
          </div>

          <div style={{padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
            <div style={{fontSize: 12, fontWeight: 700, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10}}>Notes <span style={{textTransform:"none",letterSpacing:0,fontWeight:500}}>· optional</span></div>
            <div className="field-input" style={{minHeight: 72, alignItems: "flex-start", paddingTop: 12}}>
              <span className="ph">e.g. "₱7 short — gave too much sukli on order #000098"</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{padding: 24, background: "#fff", borderTop: "1px solid var(--c-rule)", display: "flex", gap: 16}}>
        <button className="btn btn-ghost btn-default">Save &amp; continue selling</button>
        <button className="btn btn-secondary btn-default" style={{marginLeft: "auto"}}>
          <IconPrint s={18} /> Print Z-read
        </button>
        <button className="btn btn-primary btn-cashier" style={{flex: "0 0 380px"}}>
          Close shift &amp; sign out
          <IconCheck s={22} />
        </button>
      </div>
    </div>
  );
};


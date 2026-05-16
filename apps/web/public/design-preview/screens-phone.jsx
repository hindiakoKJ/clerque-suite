// CLERQUE COUNTER — Phone screens (414×900)
// Tablet is canonical; phone is for owner spot-checks.

const RPh = window.React;

// ============================ PHONE FRAME helpers ============================

function PhoneStatusBar() {
  return (
    <div style={{
      height: 28,
      padding: "0 18px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: "transparent",
      fontSize: 12,
      fontWeight: 600,
      color: "var(--c-ink)",
    }}>
      <span>09:24</span>
      <div style={{display: "flex", alignItems: "center", gap: 6}}>
        <span>5G</span>
        <span>·</span>
        <span>87%</span>
        <svg width="14" height="10" viewBox="0 0 24 16" fill="currentColor"><rect x="0" y="2" width="20" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><rect x="22" y="6" width="2" height="4"/><rect x="2" y="4" width="14" height="8"/></svg>
      </div>
    </div>
  );
}

function PhoneNavBar() {
  return (
    <div style={{
      position: "absolute",
      left: 0, right: 0, bottom: 0,
      height: 18,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0)",
    }}>
      <div style={{width: 134, height: 4, background: "var(--c-ink)", opacity: .35, borderRadius: 2}}></div>
    </div>
  );
}

// ============================ PHONE 1. SIGN-IN ============================

window.SignInPhone = function SignInPhone() {
  return (
    <div className="screen is-phone" style={{display: "flex", flexDirection: "column"}}>
      <PhoneStatusBar />
      <div style={{flex: 1, padding: "24px 28px 40px", display: "flex", flexDirection: "column", background: "#fff"}}>
        {/* Logo */}
        <div style={{display: "flex", alignItems: "center", gap: 12, marginTop: 24, marginBottom: 56}}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "var(--c-primary)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800,
            boxShadow: "0 4px 12px rgba(139,94,60,.25)",
            letterSpacing: "-.04em",
          }}>C</div>
          <div>
            <div className="display" style={{fontSize: 18, fontWeight: 700}}>Clerque</div>
            <div style={{fontSize: 10, color: "var(--c-muted)", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 600}}>Counter</div>
          </div>
        </div>

        <div className="display" style={{fontSize: 28, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 6, lineHeight: 1.15}}>Welcome back</div>
        <div style={{fontSize: 14, color: "var(--c-muted)", marginBottom: 28}}>Sign in to your Cloud account.</div>

        <div className="field" style={{marginBottom: 18}}>
          <span className="field-label">Email</span>
          <div className="field-input is-focus">
            <span style={{fontSize: 15}}>tindahan@kape.ph</span>
          </div>
        </div>

        <div className="field" style={{marginBottom: 24}}>
          <span className="field-label">Password</span>
          <div className="field-input">
            <span style={{fontSize: 15}}>••••••••</span>
            <span className="field-input-action">Show</span>
          </div>
        </div>

        <button className="btn btn-primary btn-cashier btn-full" style={{height: 56, fontSize: 18}}>Sign in</button>

        <div style={{textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--c-primary)", fontWeight: 600}}>Forgot password?</div>

        <div style={{marginTop: "auto", padding: 14, background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 10, fontSize: 12, color: "var(--c-muted)", lineHeight: 1.5}}>
          <b style={{color: "var(--c-ink)"}}>No account?</b> Subscriptions are managed at <b style={{color: "var(--c-primary)"}}>clerque.com</b>.
        </div>

        <div style={{textAlign: "center", marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--c-faint)"}}>v 1.4.2 · build 2026.05.12</div>
      </div>
      <PhoneNavBar />
    </div>
  );
};

// ============================ PHONE 2. POS MAIN ============================

window.POSMainPhone = function POSMainPhone() {
  const cats = [
    {id: "coffee", name: "Coffee", active: true},
    {id: "iced", name: "Iced", active: false},
    {id: "milk", name: "Milk tea", active: false},
    {id: "pastry", name: "Pastry", active: false},
    {id: "savory", name: "Savory", active: false},
  ];
  return (
    <div className="screen is-phone" style={{display: "flex", flexDirection: "column"}}>
      <PhoneStatusBar />
      {/* Top bar */}
      <div style={{padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <button className="appbar-icon-btn" style={{width: 36, height: 36}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div style={{flex: 1, minWidth: 0}}>
          <div className="display" style={{fontSize: 14, fontWeight: 700}}>Tindahan Coffee</div>
          <div style={{fontSize: 10, color: "var(--c-muted)"}}>Katipunan · MA</div>
        </div>
        <div className="sync-pill" style={{padding: "5px 10px", fontSize: 11}}>
          <span className="sync-pill-dot"></span> Online
        </div>
      </div>

      {/* Search */}
      <div style={{padding: "10px 14px 0", background: "#fff"}}>
        <div className="field-input" style={{height: 40, background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)"}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span style={{color: "var(--c-muted)", fontSize: 14}}>Search or scan…</span>
        </div>
      </div>

      {/* Category tabs (scroll-strip) */}
      <div style={{padding: "12px 14px 8px", display: "flex", gap: 8, overflowX: "auto", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        {cats.map(c => (
          <span key={c.id} className={"chip " + (c.active ? "is-selected" : "")} style={{minHeight: 36, padding: "6px 14px", fontSize: 13}}>{c.name}</span>
        ))}
      </div>

      {/* Products (single column for phone) */}
      <div style={{flex: 1, overflow: "auto", padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignContent: "start"}}>
        {[
          {name: "Americano", price: 110, ini: "Am", tile: "is-coffee"},
          {name: "Cappuccino", price: 140, ini: "Cp", tile: "is-coffee"},
          {name: "Café Latte", price: 145, ini: "Lt", tile: "is-coffee"},
          {name: "Spanish Latte", price: 160, ini: "SL", tile: "is-coffee"},
          {name: "Mocha", price: 165, ini: "Mo", tile: "is-coffee"},
          {name: "Caramel Macchiato", price: 170, ini: "CM", tile: "is-coffee"},
        ].map((p, i) => (
          <div key={i} className="product-card">
            <div className="product-card-img" style={{aspectRatio: "1.5/1"}}>
              <div className={"ph-tile " + p.tile} style={{fontSize: 20}}>{p.ini}</div>
            </div>
            <div className="product-card-body" style={{padding: "8px 10px 10px"}}>
              <div className="product-card-name" style={{fontSize: 13, minHeight: "2.4em"}}>{p.name}</div>
              <div className="product-card-price tnum" style={{fontSize: 14, marginTop: 4}}>₱{p.price}.00</div>
            </div>
          </div>
        ))}
      </div>

      {/* Cart drawer button */}
      <div style={{padding: 14, background: "#fff", borderTop: "1px solid var(--c-rule)", paddingBottom: 26}}>
        <button className="btn btn-primary btn-full" style={{height: 56, borderRadius: 12, fontSize: 16, padding: "0 18px", justifyContent: "space-between"}}>
          <span style={{display: "flex", alignItems: "center", gap: 10}}>
            <span style={{display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 50, background: "rgba(255,255,255,.20)", fontSize: 13, fontWeight: 700}}>3</span>
            View cart
          </span>
          <span className="tnum" style={{fontSize: 18, fontWeight: 800}}>₱473.00 →</span>
        </button>
      </div>
      <PhoneNavBar />
    </div>
  );
};

// ============================ PHONE 3. TENDERING ============================

window.TenderingPhone = function TenderingPhone() {
  return (
    <div className="screen is-phone" style={{display: "flex", flexDirection: "column", background: "var(--c-cream-soft)"}}>
      <PhoneStatusBar />
      {/* Header */}
      <div style={{padding: "8px 14px 12px", background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
        <div style={{display: "flex", alignItems: "center", gap: 10, marginBottom: 8}}>
          <button className="appbar-icon-btn" style={{width: 36, height: 36}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <div style={{flex: 1, minWidth: 0}}>
            <div className="display" style={{fontSize: 14, fontWeight: 700}}>Tendering · Bayad</div>
            <div style={{fontSize: 10, color: "var(--c-muted)"}}>Sale #000125 · 3 items</div>
          </div>
        </div>
        <div style={{textAlign: "center", padding: "8px 0"}}>
          <div style={{fontSize: 10, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700}}>Amount due</div>
          <div className="display tnum" style={{fontSize: 40, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.05, marginTop: 2}}>₱383.00</div>
        </div>
      </div>

      {/* Method tabs */}
      <div style={{display: "flex", padding: "8px 10px", gap: 6, background: "#fff", borderBottom: "1px solid var(--c-rule)", overflowX: "auto"}}>
        <div style={{padding: "8px 12px", background: "var(--c-primary-container)", color: "var(--c-primary-press)", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap"}}>₱ Cash</div>
        <div style={{padding: "8px 12px", color: "var(--c-muted)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap"}}>GCash</div>
        <div style={{padding: "8px 12px", color: "var(--c-muted)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap"}}>PayMaya</div>
        <div style={{padding: "8px 12px", color: "var(--c-muted)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap"}}>Card</div>
        <div style={{padding: "8px 12px", color: "var(--c-muted)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap"}}>Split</div>
      </div>

      {/* Bayad + sukli */}
      <div style={{padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10}}>
        <div style={{padding: "14px 16px", background: "#fff", borderRadius: 12, border: "1px solid var(--c-rule)"}}>
          <div style={{fontSize: 10, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 4}}>Bayad</div>
          <div className="display tnum" style={{fontSize: 26, fontWeight: 700, lineHeight: 1}}>₱500.00</div>
        </div>
        <div style={{padding: "14px 16px", background: "var(--c-success-soft)", borderRadius: 12, border: "1px solid #B5E6D2"}}>
          <div style={{fontSize: 10, color: "var(--c-success-deep)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 4}}>Sukli</div>
          <div className="display tnum" style={{fontSize: 26, fontWeight: 700, color: "var(--c-success-deep)", lineHeight: 1}}>₱117.00</div>
        </div>
      </div>

      {/* Quick amounts */}
      <div style={{padding: "0 14px 10px", display: "flex", gap: 8, overflowX: "auto"}}>
        {["₱50","₱100","₱200","₱500","₱1,000","Exact"].map((v,i) => (
          <span key={i} className={"chip " + (i === 5 ? "is-selected" : "")} style={{minHeight: 36, padding: "8px 14px", fontSize: 13, whiteSpace: "nowrap"}}>{v}</span>
        ))}
      </div>

      {/* Keypad */}
      <div style={{padding: 14, flex: 1, display: "flex", justifyContent: "center", alignItems: "flex-start"}}>
        <div className="keypad" style={{gridTemplateColumns: "repeat(3, 96px)", padding: 12}}>
          {[1,2,3,4,5,6,7,8,9].map(n => <div key={n} className="key" style={{height: 56, fontSize: 20}}>{n}</div>)}
          <div className="key is-action" style={{height: 56}}>·</div>
          <div className="key" style={{height: 56, fontSize: 20}}>0</div>
          <div className="key is-action" style={{height: 56}}>⌫</div>
        </div>
      </div>

      {/* Confirm CTA */}
      <div style={{padding: 14, background: "#fff", borderTop: "1px solid var(--c-rule)", paddingBottom: 26}}>
        <button className="btn btn-primary btn-full" style={{height: 56, borderRadius: 12, fontSize: 15}}>
          Confirm · ₱500 received
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
      <PhoneNavBar />
    </div>
  );
};

// CLERQUE COUNTER — Phone screens v2 (414×900)
// Aligned with web Counter terminology + new blue/cream palette.

const RPh2 = window.React;

function PhStatusBar() {
  return (
    <div style={{
      height: 28, padding: "0 18px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      fontSize: 12, fontWeight: 600, color: "var(--c-ink)",
    }}>
      <span>09:24</span>
      <div style={{display: "flex", alignItems: "center", gap: 6}}>
        <span>5G</span><span>·</span><span>87%</span>
        <svg width="14" height="10" viewBox="0 0 24 16" fill="currentColor"><rect x="0" y="2" width="20" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><rect x="22" y="6" width="2" height="4"/><rect x="2" y="4" width="14" height="8"/></svg>
      </div>
    </div>
  );
}
function PhNav() {
  return (
    <div style={{position: "absolute", left: 0, right: 0, bottom: 0, height: 18, display: "flex", alignItems: "center", justifyContent: "center"}}>
      <div style={{width: 134, height: 4, background: "var(--c-ink)", opacity: .35, borderRadius: 2}}></div>
    </div>
  );
}

function PhCheck() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
}

// ============================ 1. SIGN-IN ============================

window.SignInPhone = function SignInPhone() {
  return (
    <div className="screen is-phone" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <PhStatusBar />
      <div style={{flex: 1, padding: "20px 24px 32px", display: "flex", flexDirection: "column"}}>
        <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32}}>
          <div className="logo-mark">
            <span className="logo-mark-glyph" style={{width: 32, height: 32, borderRadius: 8}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>
            </span>
            <div className="logo-mark-word" style={{fontSize: 15}}>Clerque<span className="dot">·</span><span className="sub">Counter</span></div>
          </div>
          <span className="sync-pill" style={{padding: "5px 10px", fontSize: 11}}>
            <span className="sync-pill-dot"></span> Online
          </span>
        </div>

        <div className="display" style={{fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 4, lineHeight: 1.15}}>Sign in to Counter</div>
        <div style={{fontSize: 13, color: "var(--c-muted)", marginBottom: 18}}>Tenant ID, email, password.</div>

        <div className="auth-tabs" style={{marginBottom: 16, alignSelf: "stretch"}}>
          <span className="auth-tab is-on" style={{flex: 1, justifyContent: "center"}}>Password</span>
          <span className="auth-tab" style={{flex: 1, justifyContent: "center"}}>PIN</span>
        </div>

        <div className="field" style={{marginBottom: 12}}>
          <span className="field-label">Tenant ID</span>
          <div className="field-input is-focus" style={{height: 48}}>
            <span style={{fontFamily: "var(--font-mono)", fontSize: 14}}>hnscorpph</span>
          </div>
        </div>
        <div className="field" style={{marginBottom: 12}}>
          <span className="field-label">Email</span>
          <div className="field-input" style={{height: 48}}>
            <span style={{fontSize: 14}}>maricar@hnscorp.ph</span>
          </div>
        </div>
        <div className="field" style={{marginBottom: 16}}>
          <span className="field-label">Password</span>
          <div className="field-input" style={{height: 48}}>
            <span style={{fontSize: 14}}>••••••••••</span>
            <span className="field-input-action">Show</span>
          </div>
        </div>

        <button className="btn btn-primary btn-full" style={{height: 56, borderRadius: 12, fontSize: 16}}>Sign in →</button>

        <div style={{textAlign: "center", marginTop: 12, fontSize: 12, color: "var(--c-primary)", fontWeight: 600}}>Forgot password?</div>

        <div style={{marginTop: "auto", padding: 14, background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 10, fontSize: 12, color: "var(--c-muted)", lineHeight: 1.5}}>
          Subscriptions are managed at <b style={{color: "var(--c-primary)"}}>clerque.com</b>.
        </div>
        <div style={{textAlign: "center", marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--c-faint)"}}>v 1.4.2 · build 2026.05.12</div>
      </div>
      <PhNav />
    </div>
  );
};

// ============================ 2. TERMINAL (POS MAIN) ============================

window.POSMainPhone = function POSMainPhone() {
  const cats = [
    {id: "all", name: "All"},
    {id: "hot", name: "Hot Coffee", active: true},
    {id: "iced", name: "Iced"},
    {id: "tea", name: "Tea"},
    {id: "pastry", name: "Pastry"},
  ];
  return (
    <div className="screen is-phone" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <PhStatusBar />
      <div style={{padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <button className="appbar-icon-btn" style={{width: 36, height: 36}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div style={{flex: 1, minWidth: 0}}>
          <div className="display" style={{fontSize: 14, fontWeight: 700}}>Terminal · HNS Corp PH</div>
          <div style={{fontSize: 10, color: "var(--c-muted)"}}>Katipunan · MA · OR #000125</div>
        </div>
        <span className="sync-pill" style={{padding: "4px 10px", fontSize: 11}}>
          <span className="sync-pill-dot"></span> Online
        </span>
      </div>

      <div style={{padding: "10px 14px 0", background: "#fff"}}>
        <div className="field-input" style={{height: 40, background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)"}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span style={{color: "var(--c-muted)", fontSize: 14}}>Search by name, SKU, or barcode</span>
        </div>
      </div>

      <div style={{padding: "12px 14px 10px", display: "flex", gap: 6, overflowX: "auto", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        {cats.map(c => (
          <span key={c.id} style={{
            flexShrink: 0,
            padding: "6px 14px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            color: c.active ? "#fff" : "var(--c-ink)",
            background: c.active ? "var(--c-primary)" : "var(--c-cream-soft)",
            border: "1px solid " + (c.active ? "var(--c-primary)" : "var(--c-cream-deep)"),
          }}>{c.name}</span>
        ))}
      </div>

      <div style={{flex: 1, overflow: "auto", padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignContent: "start"}}>
        {[
          {name: "Americano", price: 110, stock: 597, ini: "Am"},
          {name: "Cappuccino", price: 140, stock: 89, ini: "Cp"},
          {name: "Café Latte", price: 145, stock: 11, low: true, ini: "Lt"},
          {name: "Spanish Latte", price: 160, stock: 3, low: true, ini: "SL"},
          {name: "Mocha", price: 165, stock: 240, ini: "Mo"},
          {name: "Caramel Macchiato", price: 170, stock: 180, ini: "CM"},
        ].map((p, i) => (
          <div key={i} className="product-card">
            <div className="product-card-img" style={{aspectRatio: "1.5/1"}}>
              <div className={"ph-tile is-coffee"} style={{fontSize: 20}}>{p.ini}</div>
              <span className={"stock-pill" + (p.low ? " is-low" : "")} style={{fontSize: 9, padding: "2px 6px"}}>
                {p.low ? "Low · " : ""}{p.stock}{p.low ? "" : " left"}
              </span>
            </div>
            <div className="product-card-body" style={{padding: "8px 10px 10px"}}>
              <div className="product-card-name" style={{fontSize: 13, minHeight: "2.4em"}}>{p.name}</div>
              <div className="product-card-price tnum" style={{fontSize: 14, marginTop: 4, color: "var(--c-primary)"}}>₱{p.price}.00</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{padding: 14, background: "#fff", borderTop: "1px solid var(--c-rule)", paddingBottom: 26}}>
        <button className="btn btn-primary btn-full" style={{height: 56, borderRadius: 12, fontSize: 16, padding: "0 18px", justifyContent: "space-between"}}>
          <span style={{display: "flex", alignItems: "center", gap: 10}}>
            <span style={{display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 50, background: "rgba(255,255,255,.22)", fontSize: 13, fontWeight: 700}}>3</span>
            View order
          </span>
          <span className="tnum" style={{fontSize: 18, fontWeight: 800}}>₱473.00 →</span>
        </button>
      </div>
      <PhNav />
    </div>
  );
};

// ============================ 3. TENDERING · CASH ============================

window.TenderingPhone = function TenderingPhone() {
  return (
    <div className="screen is-phone" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <PhStatusBar />
      <div style={{padding: "8px 14px 12px", background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
        <div style={{display: "flex", alignItems: "center", gap: 10, marginBottom: 8}}>
          <button className="appbar-icon-btn" style={{width: 36, height: 36}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <div style={{flex: 1, minWidth: 0}}>
            <div className="display" style={{fontSize: 14, fontWeight: 700}}>Tendering · Bayad</div>
            <div style={{fontSize: 10, color: "var(--c-muted)"}}>Order #000125 · 3 items</div>
          </div>
        </div>
        <div style={{textAlign: "center", padding: "8px 0"}}>
          <div style={{fontSize: 10, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700}}>Amount due</div>
          <div className="display tnum" style={{fontSize: 40, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.05, marginTop: 2, color: "var(--c-primary)"}}>₱383.00</div>
        </div>
      </div>

      <div style={{display: "flex", padding: "8px 10px", gap: 6, background: "#fff", borderBottom: "1px solid var(--c-rule)", overflowX: "auto"}}>
        <div style={{padding: "8px 12px", background: "var(--c-primary-container)", color: "var(--c-primary-press)", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap"}}>₱ Cash</div>
        <div style={{padding: "8px 12px", color: "var(--c-muted)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap"}}>GCash</div>
        <div style={{padding: "8px 12px", color: "var(--c-muted)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap"}}>PayMaya</div>
        <div style={{padding: "8px 12px", color: "var(--c-muted)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap"}}>Card</div>
        <div style={{padding: "8px 12px", color: "var(--c-muted)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap"}}>Split</div>
      </div>

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

      <div style={{padding: "0 14px 10px", display: "flex", gap: 8, overflowX: "auto"}}>
        {["₱50","₱100","₱200","₱500","₱1,000","Exact"].map((v,i) => (
          <span key={i} className={"chip " + (i === 5 ? "is-selected" : "")} style={{minHeight: 36, padding: "8px 14px", fontSize: 13, whiteSpace: "nowrap"}}>{v}</span>
        ))}
      </div>

      <div style={{padding: 14, flex: 1, display: "flex", justifyContent: "center", alignItems: "flex-start"}}>
        <div className="keypad" style={{gridTemplateColumns: "repeat(3, 96px)", padding: 12}}>
          {[1,2,3,4,5,6,7,8,9].map(n => <div key={n} className="key" style={{height: 56, fontSize: 20}}>{n}</div>)}
          <div className="key is-action" style={{height: 56}}>·</div>
          <div className="key" style={{height: 56, fontSize: 20}}>0</div>
          <div className="key is-action" style={{height: 56}}>⌫</div>
        </div>
      </div>

      <div style={{padding: 14, background: "#fff", borderTop: "1px solid var(--c-rule)", paddingBottom: 26}}>
        <button className="btn btn-primary btn-full" style={{height: 56, borderRadius: 12, fontSize: 15}}>
          Confirm · ₱500 received
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
      <PhNav />
    </div>
  );
};

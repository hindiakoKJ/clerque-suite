// CLERQUE COUNTER — Tablet screens v2 (1920×1200)
// Aligned with web Counter app: Tenant ID + email/password auth, "Terminal"
// surface, "Order" panel, surface tabs (Bar/Kitchen/CD/Print), drawer nav.

const React = window.React;
const { useState } = React;

// ============================ ICONS ============================
const Icon = {
  search: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  menu: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  back: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  check: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  bell: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  cart: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>,
  print: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
  monitor: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  kitchen: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4M3 7v10l9 4 9-4V7M3 7l9 4 9-4M12 11v10"/></svg>,
  bar: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 15v6M5 3h14l-2 8a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4L5 3z"/></svg>,
  lock: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  hash: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>,
  eye: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  sun: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  ledger: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  sync: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  qr: (s = 96) => (
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
  ),
};

// ============================ ATOMS ============================

function StatusBar({ light = true }) {
  return (
    <div className={"statusbar" + (light ? " is-light" : "")} style={{height: 28}}>
      <div className="statusbar-l"><span style={{fontWeight: 600}}>09:24</span></div>
      <div className="statusbar-r">
        <span>5G</span><span>·</span><span>87%</span>
        <svg width="14" height="10" viewBox="0 0 24 16" fill="currentColor"><rect x="0" y="2" width="20" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><rect x="22" y="6" width="2" height="4"/><rect x="2" y="4" width="14" height="8"/></svg>
      </div>
    </div>
  );
}

function LogoMark({ size = "default", monochrome = false }) {
  const px = size === "lg" ? 44 : size === "sm" ? 30 : 36;
  return (
    <div className="logo-mark">
      <span className="logo-mark-glyph" style={{width: px, height: px, borderRadius: 10, background: monochrome ? "#fff" : "var(--c-primary)", color: monochrome ? "var(--c-primary)" : "#fff"}}>
        <Icon.cart s={Math.round(px * .55)} />
      </span>
      <div className="logo-mark-word" style={{fontSize: size === "lg" ? 22 : 18}}>
        Clerque<span className="dot">·</span><span className="sub">Counter</span>
      </div>
    </div>
  );
}

function SurfaceTabs({ active = "counter" }) {
  const tabs = [
    {id: "counter", icon: <Icon.cart s={16} />, label: "Counter"},
    {id: "bar", icon: <Icon.bar s={16} />, label: "Bar"},
    {id: "kitchen", icon: <Icon.kitchen s={16} />, label: "Kitchen"},
    {id: "display", icon: <Icon.monitor s={16} />, label: "Customer Display"},
    {id: "print", icon: <Icon.print s={16} />, label: "Print"},
  ];
  return (
    <div className="surface-tabs">
      {tabs.map(t => (
        <span key={t.id} className={"surface-tab" + (active === t.id ? " is-on" : "")}>
          <span className="surface-tab-icon">{t.icon}</span>
          {t.label}
        </span>
      ))}
    </div>
  );
}

function TopBar({ onMenu, syncOK = true, role = "OWNER", roleName = "Maricar A.", search = true, drawerHint = false }) {
  return (
    <div style={{height: 64, padding: "0 24px", display: "flex", alignItems: "center", gap: 16, background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
      <button className="appbar-icon-btn" style={{background: drawerHint ? "var(--c-cream-soft)" : "transparent"}}><Icon.menu /></button>
      <LogoMark />
      {search && (
        <div className="appbar-search" style={{height: 40, marginLeft: 16, flex: 1, maxWidth: 520}}>
          <Icon.search s={16} />
          <span>Search by name, SKU, or barcode <span style={{color: "var(--c-faint)", marginLeft: 6}}>(try: 3x latte)</span></span>
        </div>
      )}
      <div style={{marginLeft: "auto", display: "flex", alignItems: "center", gap: 14}}>
        <span className="sync-pill" title="Sync status">
          <span className={"sync-pill-dot" + (syncOK ? "" : " is-offline")}></span>
          {syncOK ? "Online" : "Offline · 3 queued"}
        </span>
        <button className="appbar-icon-btn"><Icon.bell /></button>
        <span className="tenant-chip">
          <span className="tenant-chip-avatar">MA</span>
          <span>
            <span>{roleName}</span>
            <span className="role-chip" style={{marginLeft: 8}}>{role}</span>
          </span>
        </span>
      </div>
    </div>
  );
}

function Drawer() {
  return (
    <React.Fragment>
      <div className="drawer-scrim"></div>
      <div className="drawer">
        <div className="drawer-head">
          <div className="drawer-tenant">
            <span className="tenant-chip-avatar" style={{width: 40, height: 40, borderRadius: 10, fontSize: 14}}>HN</span>
            <div>
              <div className="drawer-tenant-name">HNS Corp PH</div>
              <div className="drawer-tenant-id">tenant · hnscorpph · Katipunan branch</div>
            </div>
          </div>
        </div>
        <div className="drawer-nav">
          <div className="drawer-section">Sell</div>
          <div className="drawer-item">
            <span className="drawer-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
            Dashboard
          </div>
          <div className="drawer-item is-active">
            <span className="drawer-item-icon"><Icon.cart s={18} /></span>
            Terminal
          </div>
          <div className="drawer-item">
            <span className="drawer-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>
            Orders
            <span className="drawer-item-count">87</span>
          </div>
          <div className="drawer-item">
            <span className="drawer-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
            Shift
            <span className="role-chip" style={{marginLeft: "auto"}}>OPEN 9h</span>
          </div>

          <div className="drawer-section" style={{marginTop: 8}}>Catalog · Cloud-managed</div>
          <div className="drawer-item" style={{color: "var(--c-faint)"}}>
            <span className="drawer-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></span>
            Products
            <span className="drawer-item-count" style={{fontSize: 10}}>set up on web</span>
          </div>
          <div className="drawer-item" style={{color: "var(--c-faint)"}}>
            <span className="drawer-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11v11h-11z"/><path d="M2 2h4l1 4M22 2h-4l-1 4M2 22h4l1-4M22 22h-4l-1-4"/></svg></span>
            Recipes
            <span className="drawer-item-count" style={{fontSize: 10}}>set up on web</span>
          </div>

          <div className="drawer-section" style={{marginTop: 8}}>Reports</div>
          <div className="drawer-item">
            <span className="drawer-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
            Today's Z-read
          </div>

          <div className="drawer-section" style={{marginTop: 8}}>Manage</div>
          <div className="drawer-item">
            <span className="drawer-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
            Settings · printer &amp; PINs
          </div>
          <div className="drawer-item">
            <span className="drawer-item-icon"><Icon.sync s={18} /></span>
            Pending sync
            <span className="drawer-item-badge">3</span>
          </div>
        </div>
        <div className="drawer-foot">
          <div className="drawer-ph-time">PH Time · Asia/Manila</div>
          <div className="drawer-ph-time-val">09:24 · Fri, May 15</div>
          <div style={{marginTop: 14, display: "flex", gap: 8}}>
            <button className="btn btn-secondary btn-compact" style={{flex: 1}}>Switch cashier</button>
            <button className="btn btn-ghost btn-compact" style={{flex: 1}}>Sign out</button>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

// ============================ 1. SIGN-IN ============================

window.SignInTablet = function SignInTablet() {
  return (
    <div className="screen is-tablet" style={{display: "flex"}}>
      {/* Hero (dark, matches web app vibe) */}
      <div className="hero-dark" style={{width: 760, padding: "60px 80px", display: "flex", flexDirection: "column"}}>
        <LogoMark size="lg" monochrome={true} />

        <div style={{marginTop: 140}}>
          <div className="hero-tagline">
            Sell faster.<br/>
            <span className="accent">Close the till.</span>
          </div>
          <div style={{marginTop: 24, fontSize: 17, color: "#94A3B8", lineHeight: 1.5, maxWidth: 460}}>
            Clerque Counter — point-of-sale for retail, F&amp;B, and services. Built to keep the line moving.
          </div>
        </div>

        <div style={{marginTop: 56, display: "flex", flexDirection: "column", gap: 18}}>
          <div className="hero-bullet"><span className="hero-bullet-check"><Icon.check s={14} /></span> Fast checkout with barcode + hotkeys</div>
          <div className="hero-bullet"><span className="hero-bullet-check"><Icon.check s={14} /></span> Works offline, syncs when back</div>
          <div className="hero-bullet"><span className="hero-bullet-check"><Icon.check s={14} /></span> Tablet, phone, or desktop terminal</div>
        </div>

        <div style={{marginTop: "auto", display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748B"}}>
          <span style={{fontFamily: "var(--font-mono)"}}>Clerque Counter · v1.4.2</span>
          <span>Terms · Privacy · Support</span>
        </div>
      </div>

      {/* Form panel */}
      <div style={{flex: 1, background: "var(--c-bg)", padding: "32px 64px", display: "flex", flexDirection: "column", position: "relative"}}>
        {/* Top row: light/dark + online */}
        <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
          <button className="appbar-icon-btn" aria-label="Theme"><Icon.sun /></button>
          <span className="sync-pill"><span className="sync-pill-dot"></span> Online</span>
        </div>

        <div style={{
          maxWidth: 540,
          margin: "auto",
          width: "100%",
          background: "#fff",
          borderRadius: 20,
          padding: "40px 48px",
          boxShadow: "0 1px 2px rgba(15,23,42,.05), 0 12px 32px rgba(15,23,42,.08)",
          border: "1px solid var(--c-rule)",
        }}>
          <div className="display" style={{fontSize: 32, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 4}}>Sign in to Counter</div>
          <div style={{fontSize: 14, color: "var(--c-muted)", marginBottom: 24}}>Tenant ID, email, and password.</div>

          {/* Auth tab */}
          <div className="auth-tabs" style={{marginBottom: 20, width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr"}}>
            <span className="auth-tab is-on" style={{justifyContent: "center"}}><span className="auth-tab-icon"><Icon.lock s={14} /></span> Password</span>
            <span className="auth-tab" style={{justifyContent: "center"}}><span className="auth-tab-icon"><Icon.hash s={14} /></span> PIN</span>
          </div>

          {/* Fields */}
          <div className="field" style={{marginBottom: 14}}>
            <span className="field-label">Tenant ID</span>
            <div className="field-input is-focus">
              <span className="tnum" style={{fontFamily: "var(--font-mono)"}}>hnscorpph</span>
            </div>
            <span className="field-help">Your organisation ID — same across all Clerque apps.</span>
          </div>

          <div className="field" style={{marginBottom: 14}}>
            <span className="field-label">Email</span>
            <div className="field-input">
              <span>maricar@hnscorp.ph</span>
            </div>
          </div>

          <div className="field" style={{marginBottom: 6}}>
            <div style={{display: "flex", justifyContent: "space-between"}}>
              <span className="field-label">Password</span>
              <span style={{fontSize: 12, color: "var(--c-primary)", fontWeight: 600}}>Forgot password?</span>
            </div>
            <div className="field-input">
              <span>••••••••••••</span>
              <span className="field-input-action">Show</span>
            </div>
          </div>

          <label style={{display: "flex", alignItems: "center", gap: 10, fontSize: 13, marginTop: 16, marginBottom: 24, color: "var(--c-ink)"}}>
            <span style={{width: 18, height: 18, borderRadius: 5, background: "var(--c-primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff"}}><Icon.check s={11} /></span>
            Remember me on this device
          </label>

          <button className="btn btn-primary btn-cashier btn-full" style={{justifyContent: "center", height: 56}}>Sign in →</button>

          <div style={{marginTop: 20, fontSize: 12, color: "var(--c-faint)", textAlign: "center"}}>
            By signing in, you agree to our <u>Terms</u> and <u>Privacy Policy</u>.
          </div>
        </div>

        <div style={{textAlign: "center", fontSize: 13, color: "var(--c-muted)", marginTop: 16}}>
          Need access? <b style={{color: "var(--c-ink)"}}>Contact your admin</b>
        </div>
      </div>
    </div>
  );
};

// ============================ 2. CASHIER PIN ============================

window.PinTablet = function PinTablet() {
  return (
    <div className="screen is-tablet" style={{background: "var(--c-bg)", display: "flex", flexDirection: "column"}}>
      <StatusBar />
      <div style={{padding: "20px 32px", display: "flex", alignItems: "center"}}>
        <LogoMark />
        <div style={{marginLeft: "auto", display: "flex", alignItems: "center", gap: 14}}>
          <span className="tenant-chip"><span className="tenant-chip-avatar">HN</span>HNS Corp PH<span className="tenant-chip-id">· hnscorpph</span></span>
          <span className="sync-pill"><span className="sync-pill-dot"></span> Online</span>
          <button className="btn btn-ghost btn-default">Sign out</button>
        </div>
      </div>

      <div style={{flex: 1, display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: 80}}>
        <div style={{display: "flex", flexDirection: "column", alignItems: "center"}}>
          <div style={{
            width: 96, height: 96, borderRadius: 50,
            background: "var(--c-primary)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 700,
            boxShadow: "0 12px 32px rgba(59,130,246,.32)",
            marginBottom: 20,
          }}>MA</div>

          <div className="display" style={{fontSize: 32, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 4}}>Welcome, Maricar</div>
          <div style={{fontSize: 16, color: "var(--c-muted)", marginBottom: 6}}>Enter your 4-digit cashier PIN to start your shift</div>
          <span className="role-chip" style={{marginBottom: 28}}>Cashier · katipunan branch</span>

          <div className="pin-dots" style={{marginBottom: 36}}>
            <div className="pin-dot is-filled"></div>
            <div className="pin-dot is-filled"></div>
            <div className="pin-dot"></div>
            <div className="pin-dot"></div>
          </div>

          <div className="keypad is-3col-lg">
            {[1,2,3,4,5,6,7,8,9].map(n => <div key={n} className="key">{n}</div>)}
            <div className="key is-action">Clear</div>
            <div className="key">0</div>
            <div className="key is-action">⌫</div>
          </div>

          <div style={{marginTop: 32, fontSize: 14, color: "var(--c-muted)"}}>
            Not Maricar? <b style={{color: "var(--c-primary)"}}>Switch cashier ↗</b>
          </div>
        </div>
      </div>
      <div style={{padding: 18, textAlign: "center", fontSize: 12, color: "var(--c-muted)", background: "var(--c-cream-soft)", borderTop: "1px solid var(--c-rule)"}}>
        Forgot PIN? An owner can reset cashier PINs at <b>clerque.com → Manage → Staff</b>
      </div>
    </div>
  );
};

// ============================ 3. TERMINAL (POS MAIN) ============================

const CATS_V2 = [
  {id: "all", name: "All", count: 124, active: false},
  {id: "cold", name: "Cold", count: 14, active: false},
  {id: "hot", name: "Hot Coffee", count: 18, active: true},
  {id: "ccoffee", name: "Cold Coffee", count: 12, active: false},
  {id: "spec", name: "Specialty", count: 8, active: false},
  {id: "frap", name: "Frappes", count: 7, active: false},
  {id: "tea", name: "Tea", count: 11, active: false},
  {id: "non", name: "Non-Coffee", count: 6, active: false},
  {id: "sand", name: "Sandwiches", count: 9, active: false},
  {id: "bf", name: "Breakfast", count: 5, active: false},
  {id: "mains", name: "Mains", count: 14, active: false},
  {id: "sides", name: "Sides", count: 8, active: false},
  {id: "pastry", name: "Pastries", count: 22, active: false},
  {id: "cakes", name: "Cakes", count: 6, active: false},
  {id: "cookie", name: "Cookies", count: 4, active: false},
];

const PRODS_V2 = [
  {name: "Americano", price: 110, stock: 597, ini: "Am"},
  {name: "Cappuccino", price: 140, stock: 89, ini: "Cp"},
  {name: "Café Latte", price: 145, stock: 11, lowStock: true, ini: "Lt"},
  {name: "Spanish Latte", price: 160, stock: 3, lowStock: true, ini: "SL", mod: true},
  {name: "Mocha", price: 165, stock: 240, ini: "Mo", mod: true},
  {name: "Caramel Macchiato", price: 170, stock: 180, ini: "CM", mod: true},
  {name: "Flat White", price: 150, stock: 92, ini: "FW", mod: true},
  {name: "Cortado", price: 140, stock: 64, ini: "Co", mod: true},
  {name: "Espresso · double", price: 110, stock: 410, ini: "E2"},
  {name: "Vietnamese Drip", price: 155, stock: 28, ini: "VD", mod: true},
  {name: "Pour-over · single origin", price: 220, stock: 0, ini: "PO", out: true},
  {name: "Hot Choco", price: 130, stock: 88, ini: "Hc"},
];

function CategoryTabs({ activeIdx = 2 }) {
  return (
    <div style={{padding: "12px 18px 12px", display: "flex", gap: 8, overflowX: "auto", background: "#fff", borderBottom: "1px solid var(--c-rule)", flexShrink: 0}}>
      {CATS_V2.map((c, i) => (
        <span key={c.id} style={{
          flexShrink: 0,
          padding: "8px 16px",
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 600,
          color: i === activeIdx ? "#fff" : "var(--c-ink)",
          background: i === activeIdx ? "var(--c-primary)" : "var(--c-cream-soft)",
          border: "1px solid " + (i === activeIdx ? "var(--c-primary)" : "var(--c-cream-deep)"),
        }}>
          {c.name}
        </span>
      ))}
    </div>
  );
}

function ProductGridV2({ highlightedIdx = null }) {
  return (
    <div className="product-grid">
      {PRODS_V2.map((p, i) => (
        <div key={i} className="product-card" style={highlightedIdx === i ? {outline: "2.5px solid var(--c-primary)", outlineOffset: -1} : null}>
          <div className="product-card-img">
            <div className={"ph-tile is-coffee"} style={{fontSize: 28}}>{p.ini}</div>
            <span className={"stock-pill" + (p.out ? " is-out" : p.lowStock ? " is-low" : "")}>
              {p.out ? "Out of stock" : (p.lowStock ? "Low · " : "") + p.stock + (p.lowStock ? "" : " left")}
            </span>
            {p.mod && <span className="product-card-mod">+</span>}
          </div>
          <div className="product-card-body">
            <div className="product-card-name">{p.name}</div>
            <div className="product-card-price tnum" style={{color: "var(--c-primary)"}}>₱{p.price.toFixed(2)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrderPanel({ cta = "Charge ₱383.00 →", showSenior = true }) {
  return (
    <div className="cart-panel" style={{width: 460}}>
      <div className="cart-head">
        <div>
          <div className="cart-head-t">Order · #000125</div>
          <div className="cart-head-sub">3 items · MA · started 09:18</div>
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
              {showSenior && <span className="badge badge-senior" style={{fontSize: 11}}><span className="badge-dot"></span> Senior</span>}
            </div>
          </div>
          <div>
            <div className="cart-line-price tnum" style={{color: "var(--c-primary)"}}>₱360.00</div>
            {showSenior && <div className="cart-line-was tnum">₱450.00</div>}
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
            <div className="cart-line-price tnum" style={{color: "var(--c-primary)"}}>₱48.00</div>
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
            <div className="cart-line-price tnum" style={{color: "var(--c-primary)"}}>₱65.00</div>
          </div>
        </div>
      </div>
      <div className="cart-totals">
        <div className="cart-total-row"><span>Subtotal</span><span className="tnum"><b>₱473.00</b></span></div>
        {showSenior && <div className="cart-total-row" style={{color: "var(--c-success-deep)"}}><span>Senior · 20% off</span><span className="tnum"><b>− ₱90.00</b></span></div>}
        <div className="cart-total-row"><span>VAT-exempt sales</span><span className="tnum"><b>₱383.00</b></span></div>
        <div className="cart-total-row is-grand"><span>Bayaran</span><span className="tnum"><b>₱383.00</b></span></div>
      </div>
      <div className="cart-cta">
        <button className="btn btn-primary btn-cashier btn-full">{cta}</button>
        <div style={{display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13, color: "var(--c-muted)"}}>
          <span>Discount</span>
          <span>Senior · PWD</span>
          <span>Note</span>
          <span>Clear</span>
        </div>
      </div>
    </div>
  );
}

window.POSMainTablet = function POSMainTablet() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <StatusBar />
      <TopBar />
      <CategoryTabs activeIdx={2} />
      <div style={{flex: 1, display: "flex", minHeight: 0}}>
        <div style={{flex: 1, display: "flex", flexDirection: "column", minWidth: 0}}>
          <div style={{padding: "14px 18px 6px", display: "flex", alignItems: "center", justifyContent: "space-between"}}>
            <div>
              <span className="display" style={{fontSize: 20, fontWeight: 700, letterSpacing: "-.01em"}}>Hot Coffee</span>
              <span style={{fontFamily: "var(--font-mono)", fontWeight: 400, fontSize: 12, color: "var(--c-muted)", marginLeft: 10}}>18 products · sorted A→Z</span>
            </div>
            <div style={{display: "flex", gap: 8}}>
              <span style={{padding: "6px 12px", background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "var(--c-muted)"}}>Sort: A→Z</span>
              <span style={{padding: "6px 12px", background: "var(--c-cream-soft)", border: "1px solid var(--c-cream-deep)", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "var(--c-muted)"}}>Grid: 4 cols</span>
            </div>
          </div>
          <ProductGridV2 />
        </div>
        <OrderPanel />
      </div>
    </div>
  );
};

// ============================ 4. POS + DRAWER OPEN ============================

window.POSDrawer = function POSDrawer() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)", position: "relative"}}>
      <StatusBar />
      <TopBar drawerHint={true} />
      <CategoryTabs activeIdx={2} />
      <div style={{flex: 1, display: "flex", minHeight: 0}}>
        <div style={{flex: 1, display: "flex", flexDirection: "column", minWidth: 0}}>
          <ProductGridV2 />
        </div>
        <OrderPanel />
      </div>
      <Drawer />
    </div>
  );
};

// ============================ 5. POS + MODIFIER SHEET ============================

window.POSModifierSheet = function POSModifierSheet() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)", position: "relative"}}>
      <StatusBar />
      <TopBar />
      <CategoryTabs activeIdx={2} />
      <div style={{flex: 1, display: "flex", minHeight: 0}}>
        <div style={{flex: 1, display: "flex", flexDirection: "column", minWidth: 0}}>
          <ProductGridV2 highlightedIdx={3} />
        </div>
        <OrderPanel />
      </div>

      <div className="scrim"></div>
      <div className="sheet is-centered">
        <div className="sheet-handle"></div>
        <div className="sheet-head">
          <div>
            <h3>Customize · Spanish Latte</h3>
            <div className="sheet-head-sub">Base ₱160.00 · adjust below · stock 3 left</div>
          </div>
          <div className="sheet-head-close">×</div>
        </div>
        <div className="sheet-body">
          <div className="sheet-section">
            <div className="sheet-section-h">Size <span className="sheet-section-h-req">Required</span></div>
            <div style={{display: "flex", gap: 10, flexWrap: "wrap"}}>
              <span className="chip"><span className="chip-radio"></span> Tall <span className="chip-price">+₱0</span></span>
              <span className="chip is-selected"><span className="chip-radio"></span> Grande <span className="chip-price">+₱20</span></span>
              <span className="chip"><span className="chip-radio"></span> Venti <span className="chip-price">+₱40</span></span>
            </div>
          </div>
          <div className="sheet-section">
            <div className="sheet-section-h">Temperature <span className="sheet-section-h-req">Required</span></div>
            <div style={{display: "flex", gap: 10}}>
              <span className="chip"><span className="chip-radio"></span> Hot</span>
              <span className="chip is-selected"><span className="chip-radio"></span> Iced</span>
            </div>
          </div>
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
          <div className="sheet-section">
            <div className="sheet-section-h">Add-ons <span style={{textTransform:"none",letterSpacing:0,fontWeight:500,color:"var(--c-muted)"}}>Optional · pick any</span></div>
            <div style={{display: "flex", gap: 10, flexWrap: "wrap"}}>
              <span className="chip is-selected"><span style={{width: 18, height: 18, borderRadius: 4, background: "var(--c-primary)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center"}}><Icon.check s={12}/></span> Extra shot <span className="chip-price">+₱30</span></span>
              <span className="chip"><span style={{width: 18, height: 18, borderRadius: 4, border: "1.5px solid var(--c-rule-strong)"}}></span> Whip <span className="chip-price">+₱15</span></span>
              <span className="chip"><span style={{width: 18, height: 18, borderRadius: 4, border: "1.5px solid var(--c-rule-strong)"}}></span> Cinnamon <span className="chip-price">+₱5</span></span>
              <span className="chip"><span style={{width: 18, height: 18, borderRadius: 4, border: "1.5px solid var(--c-rule-strong)"}}></span> Caramel drizzle <span className="chip-price">+₱10</span></span>
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost btn-default">Cancel</button>
          <button className="btn btn-primary btn-default btn-full">Add 1 to order · ₱210.00</button>
        </div>
      </div>
    </div>
  );
};

// ============================ 6. TENDERING · CASH ============================

function TenderTabs({ active = "cash" }) {
  const tabs = [
    {id: "cash", label: "Cash · Bayad", bg: "var(--c-primary-container)", color: "var(--c-primary-press)", letter: "₱"},
    {id: "gcash", label: "GCash", bg: "#E1EEFE", color: "var(--c-gcash)", letter: "G"},
    {id: "paymaya", label: "PayMaya", bg: "#D9F4E1", color: "var(--c-paymaya)", letter: "P"},
    {id: "card", label: "Card", bg: "var(--c-cream)", color: "var(--c-ink)", letter: "◧"},
    {id: "split", label: "Split", bg: "var(--c-cream)", color: "var(--c-ink)", letter: "÷"},
  ];
  return (
    <div style={{display: "flex", padding: "12px 32px 0", gap: 8, background: "#fff", borderBottom: "1px solid var(--c-rule)"}}>
      {tabs.map(t => {
        const isOn = active === t.id;
        return (
          <div key={t.id} style={{
            padding: "12px 18px 14px",
            borderBottom: "3px solid " + (isOn ? "var(--c-primary)" : "transparent"),
            color: isOn ? "var(--c-primary)" : "var(--c-muted)",
            fontSize: 14, fontWeight: isOn ? 700 : 500,
            display: "flex", alignItems: "center", gap: 10,
            marginBottom: -1,
          }}>
            <span style={{width: 24, height: 24, borderRadius: 50, background: t.bg, display: "inline-flex", alignItems: "center", justifyContent: "center", color: t.color, fontSize: 12, fontWeight: 700}}>{t.letter}</span>
            {t.label}
          </div>
        );
      })}
    </div>
  );
}

window.TenderingCash = function TenderingCash() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <StatusBar />
      {/* Header */}
      <div style={{display: "flex", alignItems: "center", padding: "20px 32px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <button className="btn btn-ghost btn-default" style={{padding: 0, gap: 10, minWidth: 0}}>
          <Icon.back s={20} /> Back to Order
        </button>
        <div style={{marginLeft: 32}}>
          <div className="display" style={{fontSize: 20, fontWeight: 700}}>Tendering · Bayad</div>
          <div style={{fontSize: 12, color: "var(--c-muted)"}}>Order #000125 · 3 items · MA</div>
        </div>
        <div style={{marginLeft: "auto", textAlign: "right"}}>
          <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700}}>Amount due</div>
          <div className="display tnum" style={{fontSize: 48, fontWeight: 800, letterSpacing: "-.02em", color: "var(--c-primary)", lineHeight: 1}}>₱383.00</div>
        </div>
      </div>
      <TenderTabs active="cash" />

      <div style={{flex: 1, padding: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32}}>
        <div>
          <div style={{padding: 28, background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)", marginBottom: 20}}>
            <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 8}}>Bayad · cash received</div>
            <div className="display tnum" style={{fontSize: 64, fontWeight: 800, letterSpacing: "-.02em", color: "var(--c-ink)", lineHeight: 1}}>₱500.00</div>
          </div>
          <div style={{padding: 28, background: "var(--c-success-soft)", borderRadius: 16, border: "1px solid #B5E6D2"}}>
            <div style={{fontSize: 12, color: "var(--c-success-deep)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 8}}>Sukli · change</div>
            <div className="display tnum" style={{fontSize: 64, fontWeight: 800, letterSpacing: "-.02em", color: "var(--c-success-deep)", lineHeight: 1}}>₱117.00</div>
          </div>
          <div style={{marginTop: 20, padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)", fontSize: 14}}>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-muted)"}}><span>Subtotal</span><span className="tnum">₱473.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-success-deep)"}}><span>Senior discount · 20%</span><span className="tnum">− ₱90.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-muted)"}}><span>VAT-exempt sales</span><span className="tnum">₱383.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "10px 0 0", marginTop: 6, borderTop: "1px solid var(--c-rule)", fontWeight: 700, fontSize: 16}}><span>Total · Bayaran</span><span className="tnum">₱383.00</span></div>
          </div>
        </div>

        <div style={{display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignSelf: "start"}}>
          <div className="keypad is-3col-lg">
            {[1,2,3,4,5,6,7,8,9].map(n => <div key={n} className="key">{n}</div>)}
            <div className="key is-action">·</div>
            <div className="key">0</div>
            <div className="key is-action">⌫</div>
          </div>
          <div style={{display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "var(--c-cream-soft)", borderRadius: 16, border: "1px solid var(--c-cream-deep)"}}>
            <div style={{fontSize: 11, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, padding: "2px 4px"}}>Quick amounts</div>
            <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10}}>
              <div className="key" style={{height: 60, fontSize: 16}}>₱20</div>
              <div className="key" style={{height: 60, fontSize: 16}}>₱50</div>
              <div className="key" style={{height: 60, fontSize: 16}}>₱100</div>
              <div className="key" style={{height: 60, fontSize: 16}}>₱200</div>
              <div className="key" style={{height: 60, fontSize: 16}}>₱500</div>
              <div className="key" style={{height: 60, fontSize: 16}}>₱1,000</div>
            </div>
            <button className="btn btn-secondary btn-default btn-full" style={{marginTop: 4}}>Exact · ₱383</button>
          </div>
        </div>
      </div>

      <div style={{padding: 24, background: "#fff", borderTop: "1px solid var(--c-rule)", display: "flex", gap: 16}}>
        <button className="btn btn-ghost btn-default" style={{flex: "0 0 200px"}}>Cancel sale</button>
        <button className="btn btn-primary btn-cashier" style={{flex: 1}}>
          Confirm payment · ₱500 received <Icon.check s={24} />
        </button>
      </div>
    </div>
  );
};

// ============================ 7. TENDERING · GCASH ============================

window.TenderingGCash = function TenderingGCash() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <StatusBar />
      <div style={{display: "flex", alignItems: "center", padding: "20px 32px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <button className="btn btn-ghost btn-default" style={{padding: 0, gap: 10, minWidth: 0}}>
          <Icon.back s={20} /> Back to Order
        </button>
        <div style={{marginLeft: 32}}>
          <div className="display" style={{fontSize: 20, fontWeight: 700}}>Tendering · GCash</div>
          <div style={{fontSize: 12, color: "var(--c-muted)"}}>Order #000125</div>
        </div>
        <div style={{marginLeft: "auto", textAlign: "right"}}>
          <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700}}>Amount due</div>
          <div className="display tnum" style={{fontSize: 48, fontWeight: 800, letterSpacing: "-.02em", color: "var(--c-gcash)", lineHeight: 1}}>₱383.00</div>
        </div>
      </div>
      <TenderTabs active="gcash" />

      <div style={{flex: 1, padding: 32, display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 32}}>
        <div>
          <div style={{padding: 28, background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)", marginBottom: 20}}>
            <div style={{display: "flex", gap: 16, marginBottom: 16}}>
              <span style={{width: 32, height: 32, borderRadius: 50, background: "var(--c-gcash)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16}}>G</span>
              <div>
                <div className="display" style={{fontSize: 18, fontWeight: 700}}>Customer pays via GCash</div>
                <div style={{fontSize: 13, color: "var(--c-muted)", marginTop: 2}}>Show this QR or send a request. They'll get a 6-digit confirmation.</div>
              </div>
            </div>
            <div style={{display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "center"}}>
              <div style={{padding: 14, background: "#fff", border: "1.5px solid var(--c-rule-strong)", borderRadius: 12, color: "var(--c-ink)"}}>
                <Icon.qr s={140} />
              </div>
              <div>
                <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 8}}>Pay to</div>
                <div className="display" style={{fontSize: 22, fontWeight: 700, marginBottom: 4}}>HNS Corp PH</div>
                <div className="tnum" style={{fontSize: 16, fontFamily: "var(--font-mono)", color: "var(--c-muted)", marginBottom: 16}}>0917 ••• 4452</div>
                <div style={{padding: "10px 14px", background: "var(--c-info-soft)", borderRadius: 8, fontSize: 13, color: "var(--c-info-deep)", fontWeight: 500}}>Tap "Send request" — a GCash payment request goes to the phone number below.</div>
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

        <div>
          <div style={{padding: 28, background: "var(--c-info-soft)", borderRadius: 16, border: "1px solid #BFD8FB", marginBottom: 20}}>
            <div style={{fontSize: 12, color: "var(--c-info-deep)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 8}}>Receive · GCash</div>
            <div className="display tnum" style={{fontSize: 64, fontWeight: 800, letterSpacing: "-.02em", color: "var(--c-info-deep)", lineHeight: 1}}>₱383.00</div>
            <div style={{marginTop: 12, fontSize: 13, color: "var(--c-info-deep)", fontWeight: 500}}>Exact amount only · no sukli</div>
          </div>
          <div style={{padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)", fontSize: 14, marginBottom: 20}}>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-muted)"}}><span>Subtotal</span><span className="tnum">₱473.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--c-success-deep)"}}><span>Senior discount · 20%</span><span className="tnum">− ₱90.00</span></div>
            <div style={{display: "flex", justifyContent: "space-between", padding: "10px 0 0", marginTop: 6, borderTop: "1px solid var(--c-rule)", fontWeight: 700, fontSize: 16}}><span>Total · Bayaran</span><span className="tnum">₱383.00</span></div>
          </div>
          <div style={{padding: "16px 20px", background: "var(--c-cream)", borderRadius: 12, fontSize: 13, color: "var(--c-muted)", lineHeight: 1.55}}>
            <b style={{color: "var(--c-ink)"}}>Tip:</b> Wait for the customer's "Sent successfully" SMS before tapping Confirm. The reference number prints on both copies of the receipt.
          </div>
        </div>
      </div>

      <div style={{padding: 24, background: "#fff", borderTop: "1px solid var(--c-rule)", display: "flex", gap: 16}}>
        <button className="btn btn-ghost btn-default" style={{flex: "0 0 200px"}}>Cancel sale</button>
        <button className="btn btn-cashier btn-full" style={{flex: 1, background: "var(--c-gcash)", color: "#fff", boxShadow: "0 4px 12px rgba(0,123,252,.30)"}}>
          Confirm GCash · ref 1234567890 <Icon.check s={24} />
        </button>
      </div>
    </div>
  );
};

// ============================ 8. RECEIPT ============================

window.ReceiptTablet = function ReceiptTablet() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <StatusBar />
      <div style={{display: "flex", alignItems: "center", padding: "20px 32px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <div>
          <div className="display" style={{fontSize: 22, fontWeight: 700}}>Sale complete · #000125</div>
          <div style={{display: "flex", alignItems: "center", gap: 10, marginTop: 4}}>
            <span className="badge badge-success" style={{padding: "5px 12px", fontSize: 12}}><span className="badge-dot"></span> Paid · GCash</span>
            <span style={{fontSize: 13, color: "var(--c-muted)"}}>OR # 000125 · 15 May 2026 · 14:32 · cashier MA</span>
          </div>
        </div>
        <div style={{marginLeft: "auto", display: "flex", gap: 12, alignItems: "center"}}>
          <span className="badge badge-info"><span className="badge-dot"></span> Sent to printer · 2s ago</span>
          <button className="btn btn-ghost btn-default">Order history →</button>
        </div>
      </div>

      <div style={{flex: 1, display: "flex", padding: "40px 80px", gap: 48, alignItems: "flex-start", justifyContent: "center"}}>
        <div className="receipt">
          <div className="receipt-center">
            <div style={{fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800}}>HNS CORP PH</div>
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
            <div>Signature: _____________________</div>
          </div>
          <div className="receipt-hr"></div>
          <div className="receipt-center" style={{fontSize: 10, color: "var(--c-muted)", lineHeight: 1.6}}>
            <div style={{fontWeight: 700, color: "var(--c-ink)", marginBottom: 4, fontSize: 11}}>Salamat po · Thank you!</div>
            <div>Powered by Clerque · clerque.com</div>
            <div style={{marginTop: 6}}>This serves as your official receipt.</div>
          </div>
        </div>

        <div style={{flex: 1, maxWidth: 480, display: "flex", flexDirection: "column", gap: 12}}>
          <div style={{padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
            <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 6}}>Receipt for customer</div>
            <div style={{display: "flex", flexDirection: "column", gap: 10}}>
              <button className="btn btn-secondary btn-default btn-full" style={{justifyContent:"flex-start", paddingLeft: 16}}>
                <Icon.print s={18} /> Re-print receipt
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
          <button className="btn btn-primary btn-cashier btn-full" style={{marginTop: 12}}>Start next sale →</button>
          <div style={{padding: "14px 18px", background: "var(--c-cream)", borderRadius: 10, fontSize: 12, color: "var(--c-muted)", lineHeight: 1.55}}>
            BIR · This sale is appended to your OR sequence (gap-free). Daily Z-read closes at 23:59 or when shift ends.
          </div>
          <div style={{padding: "14px 18px", background: "var(--c-success-soft)", border: "1px solid #B5E6D2", borderRadius: 10, fontSize: 12, color: "var(--c-success-deep)", display: "flex", alignItems: "center", gap: 10}}>
            <span style={{width: 18, height: 18, borderRadius: 50, background: "var(--c-success)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center"}}><Icon.check s={12} /></span>
            Synced to Clerque Cloud · ready for accounting
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================ 9. Z-READ ============================

window.ZReadTablet = function ZReadTablet() {
  return (
    <div className="screen is-tablet" style={{display: "flex", flexDirection: "column", background: "var(--c-bg)"}}>
      <StatusBar />
      <div style={{display: "flex", alignItems: "center", padding: "20px 32px", borderBottom: "1px solid var(--c-rule)", background: "#fff"}}>
        <button className="btn btn-ghost btn-default" style={{padding: 0, gap: 10, minWidth: 0}}>
          <Icon.back s={20} /> Cancel
        </button>
        <div style={{marginLeft: 32}}>
          <div className="display" style={{fontSize: 22, fontWeight: 700}}>Close shift · Z-read</div>
          <div style={{fontSize: 13, color: "var(--c-muted)"}}>Shift #2026-05-15-A · opened 08:00 by Maricar A. · cashier MA</div>
        </div>
        <div style={{marginLeft: "auto"}}>
          <span className="badge badge-warning" style={{padding: "6px 14px", fontSize: 13}}><span className="badge-dot"></span> 9h 14m elapsed</span>
        </div>
      </div>

      <div style={{flex: 1, padding: 32, display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, overflow: "hidden"}}>
        <div style={{display: "flex", flexDirection: "column", gap: 16, overflow: "auto"}}>
          <div style={{padding: "24px 28px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
            <div style={{display: "flex", alignItems: "baseline", justifyContent: "space-between"}}>
              <div>
                <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700}}>Gross sales</div>
                <div className="display tnum" style={{fontSize: 48, fontWeight: 800, letterSpacing: "-.02em", marginTop: 4, color: "var(--c-primary)"}}>₱18,432.00</div>
                <div style={{fontSize: 13, color: "var(--c-muted)", marginTop: 4}}>87 transactions · avg ₱211.86</div>
              </div>
              <div style={{textAlign: "right"}}>
                <div style={{fontSize: 12, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700}}>Net sales</div>
                <div className="display tnum" style={{fontSize: 32, fontWeight: 700, marginTop: 4, color: "var(--c-success-deep)"}}>₱17,118.00</div>
                <div style={{fontSize: 13, color: "var(--c-muted)", marginTop: 2}}>after discounts</div>
              </div>
            </div>
          </div>

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
              Variance · <b className="tnum">− ₱7.00</b> &nbsp;<span style={{fontWeight: 400}}>(rounding · within tolerance)</span>
            </div>
          </div>

          <div style={{padding: "20px 24px", background: "#fff", borderRadius: 16, border: "1px solid var(--c-rule)"}}>
            <div style={{fontSize: 12, fontWeight: 700, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10}}>Shift notes <span style={{textTransform:"none",letterSpacing:0,fontWeight:500}}>· optional</span></div>
            <div className="field-input" style={{minHeight: 72, alignItems: "flex-start", paddingTop: 12}}>
              <span className="ph">e.g. "₱7 short — gave too much sukli on order #000098"</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{padding: 24, background: "#fff", borderTop: "1px solid var(--c-rule)", display: "flex", gap: 16}}>
        <button className="btn btn-ghost btn-default">Save &amp; continue selling</button>
        <button className="btn btn-secondary btn-default" style={{marginLeft: "auto"}}>
          <Icon.print s={18} /> Print Z-read
        </button>
        <button className="btn btn-primary btn-cashier" style={{flex: "0 0 380px"}}>
          Close shift &amp; sign out <Icon.check s={22} />
        </button>
      </div>
    </div>
  );
};

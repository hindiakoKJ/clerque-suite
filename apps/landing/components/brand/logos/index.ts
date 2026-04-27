export type { LogoProps } from './types';

// ── HNScorpPH (parent) ────────────────────────────────────────────────────────
export { HNSAperture } from './HNSAperture';
export { HNSKeystone } from './HNSKeystone';
export { HNSPillar   } from './HNSPillar';
export { HNSNetwork  } from './HNSNetwork';

// ── Clerque ───────────────────────────────────────────────────────────────────
export { ClerqueStack } from './ClerqueStack';
export { ClerqueTally } from './ClerqueTally';
export { ClerqueFlow  } from './ClerqueFlow';
export { ClerqueGrid  } from './ClerqueGrid';

// ── Steady ────────────────────────────────────────────────────────────────────
export { SteadyPulse   } from './SteadyPulse';
export { SteadyRipple  } from './SteadyRipple';
export { SteadyAnchorS } from './SteadyAnchorS';
export { SteadyHorizon } from './SteadyHorizon';

// ── Canonical aliases (recommended picks) ─────────────────────────────────────
// Re-point any alias here to update every composition in one line.
export { HNSAperture  as HNSLogo     } from './HNSAperture';
export { ClerqueStack as ClerqueLogo } from './ClerqueStack';
export { SteadyPulse  as SteadyLogo  } from './SteadyPulse';

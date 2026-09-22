/**
 * Where a business-type card on the Settings hub really goes.
 *
 * Those cards come from the vertical registry
 * (packages/shared-types/src/verticals.ts, settings.extraCards). Trucking's
 * "Fleet Setup" card points at /settings/fleet, a page that was never built:
 * the fleet screen lives in POS. So a trucking owner got a 404 from the
 * Settings hub. settings-card-href.spec.mjs reads the registry and fails if
 * any card, after this map, points at a page that does not exist.
 *
 * Pure, so the spec can load it under plain Node.
 */
const MOVED: Record<string, string> = {
  '/settings/fleet': '/pos/trucking/fleet',
};

export function settingsCardHref(href: string): string {
  return MOVED[href] ?? href;
}

/**
 * Kitchen and bar screens must be paired to one station.
 *
 * A kitchen or bar code with no station used to be the default ("Any
 * matching station"). The tablet then opened /pos/station/generic, which no
 * station matches, and showed "All caught up" forever while tickets waited.
 * The API now refuses such a code; this page never offers one.
 */

export interface StationOption {
  id: string;
  name: string;
}

/**
 * Which stations a kitchen or bar card offers, out of the stations that have
 * their screen turned on. A station counts when its kind fits the card, or
 * when its name reads that way (a shop that set "Kitchen" up as a counter).
 *
 * If nothing fits, every station with a screen is offered instead. The card
 * can no longer make a code without a station, so a shop whose stations are
 * named their own way must still have something to pick, or no kitchen
 * tablet could be paired from this page at all.
 */
const ROLE_STATIONS: Record<string, { kinds: string[]; word: string }> = {
  KDS_KITCHEN:     { kinds: ['KITCHEN'],                  word: 'kitchen' },
  KDS_BAR:         { kinds: ['BAR', 'HOT_BAR', 'COLD_BAR'], word: 'bar' },
  KDS_COLD_BAR:    { kinds: ['COLD_BAR'],                 word: 'cold' },
  KDS_HOT_BAR:     { kinds: ['HOT_BAR'],                  word: 'hot' },
  KDS_PASTRY_PASS: { kinds: ['PASTRY_PASS'],              word: 'pastry' },
};

export function stationsForRole<T extends { name: string; kind: string }>(
  role: string,
  withScreens: T[],
): T[] {
  if (role === 'CUSTOMER_DISPLAY') return [];
  const want = ROLE_STATIONS[role];
  if (!want) return withScreens; // a screen for no particular kind
  const fits = withScreens.filter(
    (s) => want.kinds.includes(s.kind) || s.name.toLowerCase().includes(want.word),
  );
  return fits.length > 0 ? fits : withScreens;
}

/**
 * The station a kitchen or bar code will be for, or null when staff still
 * have to pick one. The only matching station is picked for them.
 */
export function stationForPairing(stations: StationOption[], picked: string): string | null {
  if (stations.length === 1) return stations[0].id;
  return stations.some((s) => s.id === picked) ? picked : null;
}

/** A kitchen or bar screen paired before this rule: it shows no orders. */
export function pairedWithoutStation(row: { role: string; stationId: string | null }): boolean {
  return row.role !== 'CUSTOMER_DISPLAY' && !row.stationId;
}

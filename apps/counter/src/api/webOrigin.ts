/**
 * Clerque Counter — canonical web origin.
 *
 * Used wherever we render a URL that points back at the Clerque web
 * surface (pairing QR codes, "open in browser" deep links, receipt
 * footer attribution). Single source of truth so swapping the domain
 * from clerque.hnscorpph.com → clerque.com is a one-line change in
 * app.json.
 */
import Constants from 'expo-constants';

const FALLBACK = 'https://clerque.hnscorpph.com';

export function getWebOrigin(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { webOrigin?: string };
  const raw = extra.webOrigin ?? FALLBACK;
  return raw.replace(/\/+$/, '');
}

/**
 * Strip the leading scheme so the value reads cleanly on a printed
 * receipt or in plain text body copy. e.g. "clerque.hnscorpph.com".
 */
export function getWebHost(): string {
  return getWebOrigin().replace(/^https?:\/\//i, '');
}

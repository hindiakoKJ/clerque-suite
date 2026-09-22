import * as QRCode from 'qrcode';

/**
 * The QR on the "Pair your device" dialog, drawn here instead of by an outside
 * QR website. The dialog used to load its image from api.qrserver.com, which
 * sent the shop's company code and the live pairing number to a third party,
 * and showed a broken image on shop Wi-Fi that blocks that site.
 *
 * Only a /pair link is drawn, so this is not a general QR service for anyone
 * with a login.
 */
export function isPairLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname === '/pair';
}

/** A PNG data URL of the link, sized for the 240px dialog image. */
export function pairQrDataUrl(link: string): Promise<string> {
  return QRCode.toDataURL(link, { width: 240, margin: 1, errorCorrectionLevel: 'M' });
}

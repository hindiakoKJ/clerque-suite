/**
 * Business logo + name helpers shared by every screen that shows the tenant's
 * brand (app menu, app picker, receipt, customer display, stamp card, login).
 *
 * The logo lives in ONE place: GET /tenant/branding. It used to ride inside the
 * login token, and an inline image there could push the session cookie past the
 * browser's ~4 KB limit and lock the whole business out. Never put it back.
 */
import { api, resolveAssetUrl } from './api';

export interface TenantBranding {
  name:         string;
  businessName: string | null;
  /** Short storage link (or null). Always build the <img> src with brandLogoSrc. */
  logoUrl:      string | null;
  /** Up to two letters, for the placeholder when there is no logo. */
  initials:     string;
}

/**
 * The <img> src for a stored logo link, or '' when there is nothing to show.
 *
 * A data: value is an old inline logo from before uploads went to storage. It is
 * treated as "no logo" everywhere so it can never be copied into a token, a
 * cookie or a print popup again; the owner uploads it once more in Settings.
 */
export function brandLogoSrc(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed || /^data:/i.test(trimmed)) return '';
  return resolveAssetUrl(trimmed);
}

/**
 * Up to two letters from a name, the same rule as the API's brandingInitials
 * (apps/api/src/tenant/logo-link.ts) so the circle never changes letters when
 * branding loads: two words give their first letters ("Bambu Coffee" -> "BC"),
 * one word gives its first two ("Starbucks" -> "ST"). Punctuation-only words
 * such as "&" are skipped.
 */
export function initialsFrom(name: string | null | undefined): string {
  if (!name) return '';
  const isLetterOrDigit = (c: string) => c.toLowerCase() !== c.toUpperCase() || (c >= '0' && c <= '9');
  const words = name
    .split(/\s+/)
    .map((w) => Array.from(w).filter(isLetterOrDigit).join(''))
    .filter((w) => w.length > 0);
  if (words.length === 0) return '';
  const letters = words.length >= 2
    ? [Array.from(words[0])[0], Array.from(words[1])[0]]
    : Array.from(words[0]).slice(0, 2);
  return letters.join('').toUpperCase();
}

/**
 * Accept only a well-formed branding reply. Demo mode answers unknown routes
 * with a 200 { message, code }, and an older API answers 404, so anything that
 * does not look right becomes null and callers fall back to the app icon.
 */
export function normalizeBranding(raw: unknown): TenantBranding | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string') return null;
  const businessName = typeof r.businessName === 'string' && r.businessName.trim() ? r.businessName : null;
  const logoUrl = typeof r.logoUrl === 'string' && r.logoUrl.trim() && !/^data:/i.test(r.logoUrl.trim())
    ? r.logoUrl
    : null;
  const initials = typeof r.initials === 'string' && r.initials.trim()
    ? r.initials.trim().slice(0, 2).toUpperCase()
    : (initialsFrom(businessName) || initialsFrom(r.name));
  return { name: r.name, businessName, logoUrl, initials };
}

export async function fetchBranding(): Promise<TenantBranding | null> {
  const { data } = await api.get<unknown>('/tenant/branding');
  return normalizeBranding(data);
}

/* ─── "Last business on this device" (login page) ──────────────────────────
 * The login page cannot look a business up by company code: that would let
 * anyone list which businesses exist. Instead this device remembers the last
 * business that signed in here, and the login page shows that logo only while
 * the Tenant ID box is empty or matches it. Every read and write is wrapped:
 * private windows and blocked storage must never break sign-in.
 */

export const LAST_BUSINESS_KEY = 'clerque.lastBusiness';

export interface LastBusiness {
  companyCode: string;
  tenantId:    string;
  name:        string | null;
  logoUrl:     string | null;
}

export function readLastBusiness(): LastBusiness | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_BUSINESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastBusiness>;
    if (typeof parsed?.companyCode !== 'string' || typeof parsed?.tenantId !== 'string') return null;
    return {
      companyCode: parsed.companyCode,
      tenantId:    parsed.tenantId,
      name:        typeof parsed.name === 'string' ? parsed.name : null,
      logoUrl:     typeof parsed.logoUrl === 'string' && !/^data:/i.test(parsed.logoUrl) ? parsed.logoUrl : null,
    };
  } catch {
    return null;
  }
}

export function writeLastBusiness(entry: LastBusiness): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_BUSINESS_KEY, JSON.stringify(entry));
  } catch {
    // storage full or blocked -- the login page simply shows no logo
  }
}

/** Keep the remembered logo fresh when branding loads for the same business. */
export function refreshLastBusiness(tenantId: string | null | undefined, branding: TenantBranding): void {
  if (!tenantId) return;
  const current = readLastBusiness();
  if (!current || current.tenantId !== tenantId) return;
  const name = branding.businessName || branding.name;
  if (current.name === name && current.logoUrl === branding.logoUrl) return;
  writeLastBusiness({ ...current, name, logoUrl: branding.logoUrl });
}

/**
 * Called once after a successful sign-in, without waiting on it: fetch branding
 * with the new session and remember it for this device's login page.
 */
export async function rememberBusinessAfterLogin(companyCode: string, tenantId: string | null | undefined): Promise<void> {
  const code = companyCode.trim();
  if (!code || !tenantId) return;
  try {
    const branding = await fetchBranding();
    if (!branding) return;
    writeLastBusiness({
      companyCode: code,
      tenantId,
      name:    branding.businessName || branding.name,
      logoUrl: branding.logoUrl,
    });
  } catch {
    // branding unavailable -- nothing to remember
  }
}

/* ─── Print popups ─────────────────────────────────────────────────────────
 * A print popup copies the markup, so its images start loading from scratch.
 * Printing straight away prints a blank where the logo should be. Wait for
 * every image to finish (or fail, which hides it) with a time limit so a slow
 * link can never block printing.
 */
export async function waitForImages(doc: Document, timeoutMs = 3000): Promise<void> {
  const imgs = Array.from(doc.images);
  if (imgs.length === 0) return;
  const settle = Promise.all(imgs.map((img) => {
    if (img.complete) {
      if (img.naturalWidth === 0) img.style.display = 'none';
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => { img.style.display = 'none'; resolve(); }, { once: true });
    });
  }));
  await Promise.race([settle, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

/* ─── Upload preparation (browser-side resize) ─────────────────────────────
 * The server keeps logos at 1 MB or less and has no image library, so the
 * browser shrinks the picture first: about 512 px on the longest side. PNG and
 * WEBP come out as PNG so a transparent background stays transparent; JPEG
 * stays JPEG. Re-drawing also strips camera data (such as GPS location) from
 * phone photos, which matters because the logo link is public.
 */

export const LOGO_MAX_BYTES      = 1024 * 1024;       // server cap
export const LOGO_MAX_INPUT_BYTES = 15 * 1024 * 1024; // what we are willing to decode
export const LOGO_TARGET_EDGE    = 512;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export class LogoFileError extends Error {}

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new LogoFileError("We couldn't read that image. Save it again as PNG or JPG and try once more."));
    el.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function draw(img: HTMLImageElement, edge: number, opaque: boolean): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new LogoFileError("This browser can't prepare the image. Try another browser.");
  if (opaque) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) return true;
  }
  return false;
}

/** Check and shrink a picked file. Throws LogoFileError with a plain message. */
export async function prepareLogoFile(file: File): Promise<File> {
  const type = (file.type || '').toLowerCase();
  if (type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    throw new LogoFileError("SVG files can't be used. Save your logo as a PNG and upload that.");
  }
  if (!LOGO_TYPES.includes(type)) {
    throw new LogoFileError('That file type isn\'t supported. Use a PNG, JPG or WEBP image.');
  }
  if (file.size > LOGO_MAX_INPUT_BYTES) {
    throw new LogoFileError('That image is over 15 MB. Pick a smaller file.');
  }

  const img = await loadImage(file);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new LogoFileError("We couldn't read that image. Save it again as PNG or JPG and try once more.");
  }

  const base = file.name.replace(/\.[^.]+$/, '') || 'logo';

  if (type === 'image/jpeg') {
    const canvas = draw(img, LOGO_TARGET_EDGE, true);
    const blob = await toBlob(canvas, 'image/jpeg', 0.9);
    if (!blob) throw new LogoFileError("This browser can't prepare the image. Try another browser.");
    if (blob.size > LOGO_MAX_BYTES) throw new LogoFileError('The logo is still over 1 MB after shrinking. Try a simpler image.');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  }

  // PNG / WEBP: keep transparency. A very detailed picture can come out large
  // as PNG, so step the size down, and fall back to JPEG only when nothing is
  // transparent (nothing is lost then).
  for (const edge of [LOGO_TARGET_EDGE, 384, 256]) {
    const canvas = draw(img, edge, false);
    const png = await toBlob(canvas, 'image/png');
    if (!png) throw new LogoFileError("This browser can't prepare the image. Try another browser.");
    if (png.size <= LOGO_MAX_BYTES) return new File([png], `${base}.png`, { type: 'image/png' });
    if (edge === LOGO_TARGET_EDGE && !hasTransparency(canvas)) {
      const jpg = await toBlob(draw(img, LOGO_TARGET_EDGE, true), 'image/jpeg', 0.9);
      if (jpg && jpg.size <= LOGO_MAX_BYTES) return new File([jpg], `${base}.jpg`, { type: 'image/jpeg' });
    }
  }
  throw new LogoFileError('The logo is still over 1 MB after shrinking. Try a simpler image.');
}

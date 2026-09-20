/**
 * Plain ASCII for thermal printers — the one place the swap list lives.
 *
 * Receipt and bar/kitchen printers read one byte per character from their
 * code page; they do not understand UTF-8. A "×" or the "é" in "Café Latte"
 * goes out as two bytes and prints as two junk characters. Every string the
 * ESC/POS builders (printer.ts, printer-dispatch.ts) put on paper goes through
 * here first.
 */

// Characters that are not just a letter with an accent. Checked first.
const SWAPS: Record<string, string> = {
  '×': 'x', '÷': '/',
  '₱': 'P',
  '½': '1/2', '¼': '1/4', '¾': '3/4',
  // hyphens, dashes, minus
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  // single quotes, apostrophes
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  // double quotes
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
  '…': '...',
  '•': '*', '·': '.',
  // no-break and thin spaces (some browsers put U+202F before AM/PM)
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe', 'Ø': 'O', 'ø': 'o', 'ß': 'ss',
};
const SWAP_RE = new RegExp(`[${Object.keys(SWAPS).join('')}]`, 'g');

/**
 * Printable ASCII version of `s`: known symbols swapped (× → x, ₱ → P, curly
 * quotes and dashes → plain), accents dropped (é → e, ñ → n), and anything
 * still outside ASCII (emoji, other scripts) left out. ASCII passes through
 * unchanged, so running it twice is harmless.
 */
export function toThermalText(s: string): string {
  return s
    .replace(SWAP_RE, (c) => SWAPS[c] ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7F]/g, '');
}

const enc = new TextEncoder();

/** Bytes for the printer: `toThermalText(s)`, one byte per character. */
export function thermalBytes(s: string): Uint8Array {
  return enc.encode(toThermalText(s));
}

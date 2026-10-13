/**
 * Code 128 barcodes, drawn by our own code (no library).
 *
 * The labels the shop prints from a PC carry the tag number twice: in big
 * digits for people, and as a Code 128 barcode for a USB or Bluetooth scanner.
 * A 6-digit tag number is all digits and an even length, so it is encoded in
 * code set C (two digits per symbol): start + 3 symbols + check + stop = 68
 * modules, 88 with the quiet zones -- 33 mm at 0.375 mm per module, which fits
 * a 40 mm label.
 *
 * Anything else (odd length, letters) falls back to code set B, so the
 * function never refuses a printable code.
 *
 * Pure and free of React so Node's own test runner can check it:
 *   cd apps/web && node --test lib/inventory/code128.spec.mjs
 */

/**
 * Bar and space widths (in modules) for each symbol value 0..106, bar first.
 * 0..102 are data, 103/104/105 are Start A/B/C, 106 is Stop (7 elements, the
 * last a 2-module bar). From the Code 128 specification (ISO/IEC 15417).
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

export const START_B = 104;
export const START_C = 105;
export const STOP = 106;

/** Quiet zone on each side, in modules (the spec asks for at least 10). */
export const QUIET_ZONE = 10;

/** True when code set C can carry the text: digits only, an even count. */
export function fitsCodeSetC(text: string): boolean {
  return text.length > 0 && text.length % 2 === 0 && /^\d+$/.test(text);
}

/**
 * The check symbol: the start value plus each data value times its position
 * (1-based), modulo 103.
 */
export function code128Checksum(startValue: number, dataValues: readonly number[]): number {
  let sum = startValue;
  dataValues.forEach((v, i) => { sum += v * (i + 1); });
  return sum % 103;
}

/**
 * Every symbol value in order: start, data, check, stop.
 * Throws on a character code set B cannot carry (outside ASCII 32..126).
 */
export function code128Values(text: string): number[] {
  if (!text) throw new Error('Nothing to encode.');
  let start: number;
  const data: number[] = [];
  if (fitsCodeSetC(text)) {
    start = START_C;
    for (let i = 0; i < text.length; i += 2) data.push(Number(text.slice(i, i + 2)));
  } else {
    start = START_B;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) throw new Error(`Code 128 cannot print "${ch}".`);
      data.push(code - 32);
    }
  }
  return [start, ...data, code128Checksum(start, data), STOP];
}

/**
 * The run of bar and space widths, in modules, bar first and last, without
 * the quiet zones.
 */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap((v) => CODE128_PATTERNS[v]!.split('').map(Number));
}

export interface Code128Bars {
  /** Each dark bar: where it starts and how wide it is, in modules. */
  bars: { x: number; w: number }[];
  /** Total width in modules, quiet zones included. */
  totalModules: number;
}

/** The dark bars, positioned in modules, with a quiet zone on each side. */
export function code128Bars(text: string, quietZone: number = QUIET_ZONE): Code128Bars {
  const widths = code128Widths(text);
  const bars: { x: number; w: number }[] = [];
  let x = quietZone;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return { bars, totalModules: x + quietZone };
}

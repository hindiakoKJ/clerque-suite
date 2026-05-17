/**
 * Clerque Counter — ESC/POS command builder
 *
 * Emits raw bytes for a thermal receipt printer. Supports the small subset of
 * ESC/POS used for cashier receipts: init, alignment, bold + double-size,
 * line feed, divider, paper cut, and cash-drawer kick.
 *
 * 58 mm paper = 32 columns at Font A; 80 mm paper = 48 columns. Width is
 * carried by callers (see `receiptToEscPos`) so this builder stays
 * width-agnostic.
 *
 * No third-party deps — uses TextEncoder (available on Hermes via
 * `react-native`'s polyfills) for UTF-8 encoding and a plain `number[]`
 * accumulator. The final `build()` returns a `Uint8Array`.
 */

const GS = 0x1d;
const ESC = 0x1b;
const LF = 0x0a;

export type EscPosAlign = 'L' | 'C' | 'R';

export class EscPosBuilder {
  private buf: number[] = [];
  private readonly encoder: TextEncoder;

  constructor() {
    // TextEncoder is globally available on Hermes / RN >= 0.74.
    this.encoder = new TextEncoder();
  }

  private push(...bytes: number[]): this {
    for (const b of bytes) this.buf.push(b & 0xff);
    return this;
  }

  private text(s: string): this {
    const bytes = this.encoder.encode(s);
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
    return this;
  }

  /** ESC @ — reset printer to defaults. */
  init(): this {
    return this.push(ESC, 0x40);
  }

  /** ESC a n — alignment. */
  align(mode: EscPosAlign): this {
    const n = mode === 'L' ? 0 : mode === 'C' ? 1 : 2;
    return this.push(ESC, 0x61, n);
  }

  /** ESC E n — bold on/off. */
  bold(on: boolean): this {
    return this.push(ESC, 0x45, on ? 1 : 0);
  }

  /** GS ! n — character size. Bit 0 = double-width, bit 4 = double-height. */
  private setSize(doubleWidth: boolean, doubleHeight: boolean): this {
    const n = (doubleWidth ? 0x20 : 0) | (doubleHeight ? 0x10 : 0);
    return this.push(GS, 0x21, n);
  }

  private dw = false;
  private dh = false;

  doubleHeight(on: boolean): this {
    this.dh = on;
    return this.setSize(this.dw, this.dh);
  }

  doubleWidth(on: boolean): this {
    this.dw = on;
    return this.setSize(this.dw, this.dh);
  }

  /** Plain text followed by LF. */
  line(t: string = ''): this {
    return this.text(t).push(LF);
  }

  /** Repeating-char divider. */
  divider(char: string = '-', width: number = 32): this {
    return this.line(char.repeat(width));
  }

  /** Advance n blank lines. */
  feed(n: number = 1): this {
    for (let i = 0; i < n; i++) this.push(LF);
    return this;
  }

  /** GS V 0 — full cut (most printers also accept this for partial cut). */
  cut(): this {
    return this.push(GS, 0x56, 0x00);
  }

  /**
   * ESC p m t1 t2 — kick cash drawer pin 2 with default pulse timings
   * (on = 25 * 2 ms, off = 250 * 2 ms). Standard for 6P6C RJ-11 drawers.
   */
  openCashDrawer(): this {
    return this.push(ESC, 0x70, 0x00, 25, 250);
  }

  /** Final byte payload. */
  build(): Uint8Array {
    return Uint8Array.from(this.buf);
  }
}

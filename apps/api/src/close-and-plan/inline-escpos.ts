/**
 * A minimal ESC/POS byte builder used by the API to produce briefing
 * print bytes without depending on the Counter mobile printer package.
 *
 * Mirrors the public API of `apps/counter/src/receipt/EscPosBuilder` —
 * just enough for the briefing format (init / align / bold /
 * doubleHeight / line / divider / feed / cut / build).
 */
const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

export class InlineEscPosBuilder {
  private buf: number[] = [];
  private encoder: TextEncoder = new TextEncoder();
  private dw = false;
  private dh = false;

  private push(...bytes: number[]): this {
    for (const b of bytes) this.buf.push(b & 0xff);
    return this;
  }

  private text(s: string): this {
    const bytes = this.encoder.encode(s);
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
    return this;
  }

  init(): this { return this.push(ESC, 0x40); }

  align(mode: 'L' | 'C' | 'R'): this {
    const n = mode === 'L' ? 0 : mode === 'C' ? 1 : 2;
    return this.push(ESC, 0x61, n);
  }

  bold(on: boolean): this { return this.push(ESC, 0x45, on ? 1 : 0); }

  private setSize(doubleWidth: boolean, doubleHeight: boolean): this {
    const n = (doubleWidth ? 0x20 : 0) | (doubleHeight ? 0x10 : 0);
    return this.push(GS, 0x21, n);
  }
  doubleHeight(on: boolean): this { this.dh = on; return this.setSize(this.dw, this.dh); }
  doubleWidth(on: boolean):  this { this.dw = on; return this.setSize(this.dw, this.dh); }

  line(t: string = ''): this { return this.text(t).push(LF); }
  divider(char: string = '-', width: number = 32): this { return this.line(char.repeat(width)); }
  feed(n: number = 1): this { for (let i = 0; i < n; i++) this.push(LF); return this; }
  cut(): this { return this.push(GS, 0x56, 0x00); }

  build(): Uint8Array { return Uint8Array.from(this.buf); }
}

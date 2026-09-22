import { isPairLink, pairQrDataUrl } from './pair-qr';

describe('pairing QR', () => {
  it('draws the pairing link as a PNG, here, not on an outside site', async () => {
    const png = await pairQrDataUrl('https://clerque.cc/pair?code=1234&tenant=cafe-carolina');
    expect(png).toMatch(/^data:image\/png;base64,/);
  });

  it('accepts only a /pair link on http or https', () => {
    expect(isPairLink('https://clerque.cc/pair?code=1234&tenant=cafe-carolina')).toBe(true);
    expect(isPairLink('http://localhost:3000/pair?code=1234&tenant=demo')).toBe(true);
    for (const bad of [
      undefined, null, 42, '',
      'https://clerque.cc/login',
      'https://clerque.cc/pair/extra',
      'javascript:alert(1)',
      'not a url',
      `https://clerque.cc/pair?x=${'a'.repeat(400)}`,
    ]) {
      expect(isPairLink(bad)).toBe(false);
    }
  });
});

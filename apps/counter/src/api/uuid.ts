/**
 * Minimal RFC4122 v4 generator. We avoid pulling in `uuid` to keep the
 * Android bundle slim; this implementation uses `Math.random()` which is
 * acceptable for an idempotency token (collision probability for the
 * cashier-volume domain is vanishingly small).
 */
export function uuidV4(): string {
  // xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Unit specs for the pure tier computation. Covers the 4 boundary cases
 * (USE_FIRST, EXPIRING_SOON, EXPIRED, NORMAL) plus the non-perishable
 * fallback (null expirationDate).
 */
import { StickerTier } from '@prisma/client';
import { tierForLot } from './sticker-tier';

const NOW = new Date('2026-05-20T08:00:00Z');

describe('tierForLot', () => {
  it('returns USE_FIRST when isSoonestExpiring AND has expiry', () => {
    const expiry = new Date('2026-05-25T00:00:00Z'); // 5 days out
    expect(tierForLot(true, expiry, NOW)).toBe(StickerTier.USE_FIRST);
  });

  it('returns USE_FIRST when isSoonestExpiring AND non-perishable (null expiry)', () => {
    expect(tierForLot(true, null, NOW)).toBe(StickerTier.USE_FIRST);
  });

  it('returns NORMAL when not soonest AND non-perishable', () => {
    expect(tierForLot(false, null, NOW)).toBe(StickerTier.NORMAL);
  });

  it('returns EXPIRING_SOON when expiry within 3 days but not soonest', () => {
    const expiry = new Date('2026-05-22T00:00:00Z'); // ~2 days out
    expect(tierForLot(false, expiry, NOW)).toBe(StickerTier.EXPIRING_SOON);
  });

  it('returns NORMAL when expiry >3 days out and not soonest', () => {
    const expiry = new Date('2026-05-28T00:00:00Z'); // 8 days out
    expect(tierForLot(false, expiry, NOW)).toBe(StickerTier.NORMAL);
  });

  it('returns EXPIRED when expiry is in the past', () => {
    const expiry = new Date('2026-05-19T00:00:00Z'); // yesterday
    expect(tierForLot(false, expiry, NOW)).toBe(StickerTier.EXPIRED);
  });

  it('returns EXPIRED for past expiry even when soonest', () => {
    const expiry = new Date('2026-05-19T00:00:00Z');
    expect(tierForLot(true, expiry, NOW)).toBe(StickerTier.EXPIRED);
  });

  it('handles the exact 3-day boundary', () => {
    const exactly3 = new Date('2026-05-23T08:00:00Z'); // exactly 3 days
    expect(tierForLot(false, exactly3, NOW)).toBe(StickerTier.EXPIRING_SOON);
  });

  it('handles slightly over 3 days (NORMAL)', () => {
    const slightlyOver = new Date('2026-05-23T09:00:00Z'); // 3 days + 1 hr
    expect(tierForLot(false, slightlyOver, NOW)).toBe(StickerTier.NORMAL);
  });
});

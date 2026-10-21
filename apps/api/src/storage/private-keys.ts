/**
 * Objects that must never be reachable from a public link.
 *
 * The nightly backup holds a whole shop: staff with their SSS, PhilHealth,
 * Pag-IBIG and TIN numbers and pay, customers, payslips, orders and books.
 * The audit archive holds the shop's audit trail and sign-in history.
 *
 * Product photos and logos are meant to be public, and Cloudflare R2 makes a
 * whole bucket public or none of it (it cannot open one folder). So two
 * things keep these files out of reach:
 *
 *   1. StorageService sends every key under these prefixes to the backup
 *      bucket (BACKUP_S3_BUCKET) when one is set, so they never sit in the
 *      bucket that serves photos.
 *   2. Their keys carry a 128-bit random folder. The day is guessable and the
 *      slug is the company code staff type at sign-in, so without it anyone
 *      who reached the bucket could fetch any shop's file by guessing.
 */
import { randomBytes } from 'crypto';

/** Key prefixes for whole-shop data. Matched at the start of a key. */
export const PRIVATE_KEY_PREFIXES = ['backups/', 'audit-archive/'] as const;

/** True when the key (or listing prefix) belongs to the private set above. */
export function isPrivateKey(key: string): boolean {
  return PRIVATE_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Key for one shop's nightly file: `<prefix>/<YYYY-MM-DD>/<32 hex>/<slug>.json`.
 *
 * The random folder goes between the day and the slug on purpose: the backup
 * reader lists under `backups/`, keeps keys ending in `/<slug>.json` and reads
 * the day from the front, so keys in this shape and the older
 * `backups/<day>/<slug>.json` shape are both found the same way.
 */
export function unguessableArchiveKey(
  prefix: 'backups' | 'audit-archive',
  day: string,
  slug: string,
): string {
  return `${prefix}/${day}/${randomBytes(16).toString('hex')}/${slug}.json`;
}

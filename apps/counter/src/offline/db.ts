/**
 * Clerque Counter — offline SQLite store
 * Thin expo-sqlite wrapper exposing a single `sync_outbox` table used by the
 * SyncProvider to durably queue mutations while the device is offline.
 *
 * Each row represents one pending API call:
 *   kind         — short event tag ('sale.create', 'shift.close', etc.)
 *   payload_json — the request body, JSON-encoded
 *   attempts     — number of drain attempts so far
 *   last_error   — most recent failure message (for diagnostics)
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'clerque-counter.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sync_outbox (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          kind         TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at   INTEGER NOT NULL,
          attempts     INTEGER NOT NULL DEFAULT 0,
          last_error   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_outbox_created ON sync_outbox(created_at);
      `);
      return db;
    })();
  }
  return dbPromise;
}

export interface OutboxRow {
  id: number;
  kind: string;
  payload_json: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

export async function enqueueOutbox(kind: string, payload: unknown): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO sync_outbox (kind, payload_json, created_at, attempts) VALUES (?, ?, ?, 0)',
    kind,
    JSON.stringify(payload),
    Date.now(),
  );
  return result.lastInsertRowId ?? 0;
}

export async function listOutbox(limit = 50): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(
    'SELECT * FROM sync_outbox ORDER BY created_at ASC LIMIT ?',
    limit,
  );
}

export async function countOutbox(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM sync_outbox');
  return row?.c ?? 0;
}

export async function deleteOutbox(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_outbox WHERE id = ?', id);
}

export async function markOutboxFailure(id: number, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE sync_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?',
    error,
    id,
  );
}

/**
 * Drop every pending outbox row. Used on sign-out so a different operator
 * doesn't inherit the previous session's unsent mutations.
 */
export async function clearOutbox(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_outbox');
}

/**
 * One-shot cleanup for outbox rows from earlier app versions that the
 * current dispatcher can never drain. Currently:
 *   - `shift.open` (v1-v4) had no handler — every row sat in the queue
 *     forever marked "unknown kind". Server-side shift creation is now
 *     synchronous via POST /shifts at open time, so these rows are
 *     duplicates and safe to drop.
 * Called once at app launch (App.tsx).
 */
export async function purgeLegacyOutbox(): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    "DELETE FROM sync_outbox WHERE kind IN ('shift.open')",
  );
  return result.changes ?? 0;
}

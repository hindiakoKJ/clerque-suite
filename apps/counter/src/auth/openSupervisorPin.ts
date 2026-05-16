/**
 * Clerque Counter — imperative supervisor-PIN helper
 *
 * Lets non-React code (or deeply nested vertical screens) raise the
 * supervisor-PIN modal with a single async call, without prop-drilling a
 * trigger or wiring a context everywhere.
 *
 * Usage:
 *   const result = await openSupervisorPin({ reason: 'VOID' });
 *   if (!result) return; // user cancelled
 *   await voidLine(line.id, 'WRONG_ITEM', result.supervisorId);
 *
 * The host (SupervisorPinHost) is rendered once near the app root and
 * registers a callback that this helper resolves against. If the host is
 * not yet mounted, the call rejects with a clear error.
 */

import type { AuthSession } from '@/types';

export interface OpenSupervisorPinOptions {
  /** Human-readable reason shown in the modal eyebrow. */
  reason: string;
  /**
   * When true, the verifying user must have a PRC license on file
   * (pharmacy controlled-substance gate per RA 9165 §61).
   */
  requirePrcLicense?: boolean;
}

export interface OpenSupervisorPinResult {
  supervisorId: string;
  role: AuthSession['user']['role'];
}

type Handler = (
  opts: OpenSupervisorPinOptions,
) => Promise<OpenSupervisorPinResult | null>;

let handler: Handler | null = null;

/** Internal — used by `<SupervisorPinHost />` only. */
export function _registerSupervisorPinHandler(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/**
 * Resolves with `{ supervisorId, role }` on success, or `null` on cancel.
 * Never throws unless the host isn't mounted.
 */
export function openSupervisorPin(
  opts: OpenSupervisorPinOptions,
): Promise<OpenSupervisorPinResult | null> {
  if (!handler) {
    return Promise.reject(
      new Error(
        'openSupervisorPin called before <SupervisorPinHost /> mounted. ' +
        'Add the host once near the navigator root.',
      ),
    );
  }
  return handler(opts);
}

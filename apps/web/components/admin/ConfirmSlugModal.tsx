'use client';
/**
 * Sprint 19 — Global confirm-slug modal.
 *
 * The axios response interceptor in lib/api.ts calls `requestSlugConfirmation`
 * when any backend endpoint returns `code: 'CONFIRMATION_REQUIRED'`. That
 * function shows this React modal and resolves with the typed slug (or null
 * if the operator cancels / closes the dialog). The interceptor injects the
 * slug into the request body and retries.
 *
 * We use a React modal — not window.prompt — because Chrome / Brave / some
 * extensions can suppress prompt() per-origin, leaving the user with the
 * raw 400 toast and no path forward.
 *
 * Mounted once at the app root via providers.tsx.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

type Pending = {
  message: string;
  resolve: (slug: string | null) => void;
};

let pendingRef: Pending | null = null;
let listeners: Array<() => void> = [];

function emit() { listeners.forEach((fn) => fn()); }

/** Called by the axios interceptor. Returns the typed slug, or null if cancelled. */
export function requestSlugConfirmation(message: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    // Resolve any prior pending dialog as cancelled (shouldn't happen in
    // practice — only one destructive op fires at a time — but defensive).
    if (pendingRef) pendingRef.resolve(null);
    pendingRef = { message, resolve };
    emit();
  });
}

export function ConfirmSlugModal() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.push(fn);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  }, []);

  const [typed, setTyped] = useState('');

  useEffect(() => {
    // Reset the input each time a new dialog opens.
    if (pendingRef) setTyped('');
  }, [pendingRef]);

  if (!pendingRef) return null;

  function close(result: string | null) {
    const p = pendingRef;
    pendingRef = null;
    setTyped('');
    emit();
    p?.resolve(result);
  }

  function submit() {
    const v = typed.trim();
    if (!v) return;
    close(v);
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter')  submit();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-background border border-border shadow-2xl">
        <header className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Confirm destructive operation</h2>
          </div>
          <button
            onClick={() => close(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-5 space-y-3">
          <p className="text-sm text-foreground whitespace-pre-line">
            {pendingRef.message}
          </p>
          <input
            autoFocus
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="type confirmation here"
            className="w-full h-10 px-3 rounded-md border border-border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2 border-t border-border pt-4">
          <button
            onClick={() => close(null)}
            className="h-9 px-4 rounded-md text-sm font-medium border border-border hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!typed.trim()}
            className="h-9 px-4 rounded-md text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent, hsl(330 70% 45%))' }}
          >
            Confirm
          </button>
        </footer>
      </div>
    </div>
  );
}

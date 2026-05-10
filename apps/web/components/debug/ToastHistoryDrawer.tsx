'use client';
/**
 * Sprint 19 — In-app toast history drawer.
 *
 * Sonner toasts auto-dismiss after a few seconds, so by the time a busy
 * cashier reaches for their phone to screenshot a transient error it's
 * already gone. This drawer captures every toast (success, error,
 * warning) into a session-scoped buffer and exposes a small button in
 * the bottom-right that opens a slide-up panel with the last 50.
 *
 * Implementation:
 *   - Monkey-patch sonner's `toast.success / .error / .warning / etc.`
 *     so we mirror every call into a singleton store.
 *   - Drawer is a controlled component listening to that store.
 *   - Buffer is in-memory only (does not persist across page reloads —
 *     the previous-session log lives in browser DevTools console).
 */
import { useEffect, useState } from 'react';
import { Bug, X, AlertTriangle, CheckCircle2, Info, AlertCircle } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';

interface Entry {
  id:        number;
  level:     'success' | 'error' | 'warning' | 'info' | 'message';
  message:   string;
  createdAt: number;
}

const buffer: Entry[] = [];
const listeners: Array<() => void> = [];
let nextId = 1;
let patched = false;

function record(level: Entry['level'], msg: unknown) {
  const message = typeof msg === 'string' ? msg : (() => {
    try { return JSON.stringify(msg); } catch { return String(msg); }
  })();
  buffer.unshift({ id: nextId++, level, message, createdAt: Date.now() });
  if (buffer.length > 50) buffer.length = 50;
  listeners.forEach((l) => l());
}

/** Patch sonner so every toast call also lands in our buffer. */
function patchSonnerOnce() {
  if (patched) return;
  patched = true;
  // sonner exposes `toast` as a callable + named methods. We wrap each
  // method while preserving the original call signature.
  const t = sonnerToast as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const lvl of ['success', 'error', 'warning', 'info', 'message'] as const) {
    const orig = t[lvl];
    if (typeof orig !== 'function') continue;
    t[lvl] = (...args: unknown[]) => {
      record(lvl, args[0]);
      return orig.apply(sonnerToast, args);
    };
  }
}

const ICONS: Record<Entry['level'], React.ElementType> = {
  success: CheckCircle2,
  error:   AlertCircle,
  warning: AlertTriangle,
  info:    Info,
  message: Info,
};

const LEVEL_TINT: Record<Entry['level'], string> = {
  success: 'text-emerald-500',
  error:   'text-red-500',
  warning: 'text-amber-500',
  info:    'text-blue-500',
  message: 'text-muted-foreground',
};

export function ToastHistoryDrawer() {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    patchSonnerOnce();
    const fn = () => setTick((n) => n + 1);
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }, []);

  const errorCount = buffer.filter((e) => e.level === 'error').length;

  return (
    <>
      {/* Floating button — bottom-right, easy thumb reach on tablets */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Toast history (recent notifications)"
        className="fixed bottom-3 right-3 z-30 h-9 w-9 rounded-full bg-background border border-border shadow hover:bg-muted flex items-center justify-center text-muted-foreground"
      >
        <Bug className="h-4 w-4" />
        {errorCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {errorCount > 99 ? '99+' : errorCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-end pointer-events-none">
          <div className="pointer-events-auto w-full sm:max-w-sm h-[60vh] sm:h-[80vh] bg-background border border-border shadow-2xl sm:rounded-l-xl overflow-hidden flex flex-col mr-0 sm:mr-3 mb-12 sm:mb-3">
            <header className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <Bug className="h-3.5 w-3.5" /> Recent notifications
                </h2>
                <p className="text-[10px] text-muted-foreground">
                  Last {buffer.length} toast{buffer.length === 1 ? '' : 's'}{' '}
                  · session-only · cleared on reload
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-auto divide-y divide-border">
              {buffer.length === 0 ? (
                <div className="p-6 text-xs text-muted-foreground text-center">
                  No notifications yet this session.
                </div>
              ) : (
                buffer.map((e) => {
                  const Icon = ICONS[e.level];
                  return (
                    <div key={e.id} className="p-3 flex items-start gap-2">
                      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${LEVEL_TINT[e.level]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs whitespace-pre-wrap break-words">{e.message}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(e.createdAt).toLocaleTimeString('en-PH', {
                            hour: '2-digit', minute: '2-digit', second: '2-digit',
                          })}
                          {' · '}
                          <span className="uppercase tracking-wider">{e.level}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {buffer.length > 0 && (
              <footer className="px-4 py-2 border-t border-border flex justify-between items-center">
                <button
                  onClick={() => {
                    const text = buffer
                      .map((e) => `[${new Date(e.createdAt).toLocaleTimeString('en-PH')}] ${e.level.toUpperCase()}: ${e.message}`)
                      .join('\n');
                    navigator.clipboard?.writeText(text);
                    sonnerToast.success('Copied to clipboard.');
                  }}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Copy all
                </button>
                <button
                  onClick={() => {
                    buffer.length = 0;
                    listeners.forEach((l) => l());
                  }}
                  className="text-[10px] text-muted-foreground hover:text-red-600"
                >
                  Clear
                </button>
              </footer>
            )}
          </div>
        </div>
      )}
    </>
  );
}

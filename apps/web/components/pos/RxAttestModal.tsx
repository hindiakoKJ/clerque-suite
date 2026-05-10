'use client';
/**
 * Sprint 19 — Pharmacy PIN-attest modal.
 *
 * Replaces the heavier `RxAttachModal` (commit 2d30c97) which forced the
 * cashier to type Rx number / patient name / doctor PRC at the till.
 * Real Filipino pharmacy workflow: the assistant verifies the paper Rx
 * BEFORE the customer reaches the till; the cashier just rings up. So this
 * modal asks for one thing — the pharmacist's PIN — and lets the line
 * progress to Charge.
 *
 * Flow:
 *   1. Cashier taps "Verify Rx · N items" → this modal opens.
 *   2. Pharmacist enters their User.kioskPin on the numeric keypad.
 *   3. Frontend POSTs to /pharmacy/verify-attest, which returns
 *      { valid, pharmacistName, prcLicense } if the PIN belongs to a user
 *      with prcLicense set.
 *   4. If any DDB_S2 lines are in the cart, the modal expands to show one
 *      Yellow Rx serial input per S2 line. All must be filled before Confirm.
 *   5. Confirm stamps every Rx-required line with attestPin + name (+
 *      yellowRxSerial for S2). Charge unlocks.
 *
 * The PIN is re-validated server-side at order create time (defence in
 * depth) — this preview lookup is purely UX so the line shows the
 * pharmacist's name before submit.
 */
import { useEffect, useState } from 'react';
import { Delete, Loader2, X, Check, AlertCircle, FileBadge } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCartStore, type CartLine } from '@/store/pos/cart';

interface VerifyResponse {
  valid:           boolean;
  pharmacistName?: string;
  prcLicense?:     string;
  reason?:         'PIN_NOT_FOUND' | 'NOT_PHARMACIST' | 'INACTIVE';
}

export function RxAttestModal({ onClose }: { onClose: () => void }) {
  const lines  = useCartStore((s) => s.lines);
  const attest = useCartStore((s) => s.attestPharmacistForRxLines);

  // Lines that need attest right now (Rx-required + no attest yet).
  const targetLines: CartLine[] = lines.filter(
    (l) => l.product.isRxRequired && !l.attestPin,
  );
  // S2 lines need an extra Yellow Rx serial per line.
  const s2Lines: CartLine[] = targetLines.filter(
    (l) => l.product.drugClass === 'DDB_S2',
  );

  const [pin,         setPin]         = useState('');
  const [verifying,   setVerifying]   = useState(false);
  const [verified,    setVerified]    = useState<{ name: string; prc: string } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [serials,     setSerials]     = useState<Record<string, string>>({});

  // Auto-verify when PIN reaches 4 digits — common UX for these keypads.
  useEffect(() => {
    if (pin.length < 4 || verifying || verified) return;
    let cancelled = false;
    setVerifying(true);
    setVerifyError(null);
    api.get<VerifyResponse>(`/pharmacy/verify-attest?pin=${encodeURIComponent(pin)}`)
      .then(({ data }) => {
        if (cancelled) return;
        if (data.valid && data.pharmacistName && data.prcLicense) {
          setVerified({ name: data.pharmacistName, prc: data.prcLicense });
        } else {
          const msg =
            data.reason === 'NOT_PHARMACIST' ? 'PIN belongs to a non-pharmacist staff member.' :
            data.reason === 'INACTIVE'       ? 'That account is inactive.' :
            'Wrong PIN — try again.';
          setVerifyError(msg);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setVerifyError('Could not verify PIN. Check your connection.');
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => { cancelled = true; };
  }, [pin, verifying, verified]);

  function press(d: string) {
    if (verifying) return;
    if (pin.length >= 8) return;
    setPin((p) => p + d);
    setVerifyError(null);
    if (verified) setVerified(null); // changing PIN invalidates the prior preview
  }
  function backspace() {
    if (verifying) return;
    setPin((p) => p.slice(0, -1));
    setVerifyError(null);
    setVerified(null);
  }

  const allSerialsFilled = s2Lines.every(
    (l) => (serials[l.lineKey] ?? '').trim().length >= 4,
  );
  const canConfirm = !!verified && (s2Lines.length === 0 || allSerialsFilled);

  function confirm() {
    if (!verified) return;
    if (s2Lines.length > 0 && !allSerialsFilled) {
      toast.error('Type the Yellow Rx serial for each Schedule II item.');
      return;
    }
    attest(pin, verified.name, serials);
    toast.success(`Verified by ${verified.name}.`);
    onClose();
  }

  const inputCls = 'w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-xl bg-card border border-border p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-base flex items-center gap-2">
              <FileBadge className="h-5 w-5 text-[var(--accent)]" />
              Verify Rx
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pharmacist PIN attests {targetLines.length} item{targetLines.length === 1 ? '' : 's'}: {targetLines.map((l) => l.product.name).join(', ')}.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* PIN dot indicator */}
        <div className="flex justify-center gap-2 py-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`h-3 w-3 rounded-full border-2 transition-colors ${
                i < pin.length
                  ? verified
                    ? 'bg-emerald-500 border-emerald-500'
                    : verifyError
                      ? 'bg-rose-500 border-rose-500'
                      : 'bg-[var(--accent)] border-[var(--accent)]'
                  : 'border-border'
              }`}
            />
          ))}
        </div>

        {/* Verification status */}
        {verifying && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking PIN…
          </div>
        )}
        {verified && !verifying && (
          <div className="flex items-center justify-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <Check className="h-4 w-4" />
            <span><strong>{verified.name}</strong> · PRC {verified.prc}</span>
          </div>
        )}
        {verifyError && !verifying && (
          <div className="flex items-center justify-center gap-2 text-sm text-rose-700 dark:text-rose-400">
            <AlertCircle className="h-4 w-4" />
            {verifyError}
          </div>
        )}

        {/* Numeric keypad */}
        <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
          {['1','2','3','4','5','6','7','8','9'].map((d) => (
            <button
              key={d}
              onClick={() => press(d)}
              className="h-14 rounded-xl bg-muted/60 hover:bg-muted active:scale-95 text-2xl font-semibold transition-all"
            >
              {d}
            </button>
          ))}
          <button
            onClick={backspace}
            className="h-14 rounded-xl bg-muted/60 hover:bg-muted active:scale-95 flex items-center justify-center transition-all"
            aria-label="Backspace"
          >
            <Delete className="h-5 w-5" />
          </button>
          <button
            onClick={() => press('0')}
            className="h-14 rounded-xl bg-muted/60 hover:bg-muted active:scale-95 text-2xl font-semibold transition-all"
          >
            0
          </button>
          <button
            onClick={() => { setPin(''); setVerified(null); setVerifyError(null); }}
            className="h-14 rounded-xl bg-muted/60 hover:bg-muted active:scale-95 text-xs font-semibold transition-all"
            aria-label="Clear"
          >
            Clear
          </button>
        </div>

        {/* Yellow Rx serials for DDB_S2 lines (only when PIN verified) */}
        {verified && s2Lines.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Yellow Rx serial — required (RA 9165 §61)
            </div>
            {s2Lines.map((l) => (
              <label key={l.lineKey} className="block">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {l.product.name}
                </span>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="e.g. Y-2026-001"
                  value={serials[l.lineKey] ?? ''}
                  onChange={(e) => setSerials((prev) => ({ ...prev, [l.lineKey]: e.target.value }))}
                  maxLength={32}
                />
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!canConfirm}
            className="rounded-lg bg-[var(--accent)] text-white text-sm px-4 py-2 hover:opacity-90 disabled:opacity-40"
          >
            Confirm verification
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * CashOutModal — record a Cash Paid-Out or Cash Drop during an open shift.
 *
 * - PAID_OUT  = real expense paid from the till (parking tip, ice, COD).
 *               Above ₱500 requires manager PIN co-auth.
 * - CASH_DROP = mid-shift safekeeping move to the safe.
 *               Always requires manager confirmation.
 *
 * Both reduce expected cash at close-shift, so variance reconciles correctly.
 *
 * The receiptPhotoUrl + aiAssisted fields are reserved for the next bundle
 * (receipt OCR), but the API already accepts them.
 */

import { useEffect, useRef, useState } from 'react';
import { Wallet, Vault, AlertTriangle, ShieldCheck, Camera, Sparkles, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { useSound } from '@/hooks/pos/useSound';

interface CashOutModalProps {
  open: boolean;
  shiftId: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

const APPROVAL_THRESHOLD = 500;

const CATEGORIES_PAID_OUT = [
  { value: 'supplies',       label: 'Supplies' },
  { value: 'delivery',       label: 'Delivery / COD' },
  { value: 'fuel',           label: 'Fuel / Transport' },
  { value: 'change_fund',    label: 'Change fund' },
  { value: 'tip',            label: 'Tip / Service fee' },
  { value: 'other',          label: 'Other' },
];

interface ApproverOption {
  id: string;
  name: string;
  role: string;
}

export function CashOutModal({ open, shiftId, onClose, onSuccess }: CashOutModalProps) {
  const playSound = useSound();
  const [type,            setType]            = useState<'PAID_OUT' | 'CASH_DROP'>('PAID_OUT');
  const [amountStr,       setAmountStr]       = useState('');
  const [reason,          setReason]          = useState('');
  const [category,        setCategory]        = useState<string>('supplies');
  const [approverId,      setApproverId]      = useState<string>('');
  const [approvers,       setApprovers]       = useState<ApproverOption[]>([]);
  const [submitting,      setSubmitting]      = useState(false);

  // Receipt OCR state
  const [scanning,        setScanning]        = useState(false);
  const [aiUsed,          setAiUsed]          = useState(false);
  const [aiConfidence,    setAiConfidence]    = useState<{ amount: number; vendor: number; date: number; category: number } | null>(null);
  const [aiVendor,        setAiVendor]        = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setType('PAID_OUT');
      setAmountStr('');
      setReason('');
      setCategory('supplies');
      setApproverId('');
      setScanning(false);
      setAiUsed(false);
      setAiConfidence(null);
      setAiVendor(null);
    }
  }, [open]);

  /**
   * Read a File as base64 (no data: prefix). Used to ship the receipt photo
   * to /ai/receipt-ocr without going through a file-upload pipeline.
   */
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleReceiptScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Receipt image too large (max 5MB).');
      return;
    }
    setScanning(true);
    try {
      const imageBase64 = await fileToBase64(file);
      const mediaType = (file.type === 'image/png' || file.type === 'image/webp')
        ? file.type
        : 'image/jpeg';
      const { data } = await api.post('/ai/receipt-ocr', { imageBase64, mediaType });

      // Apply suggestions — only auto-fill empty fields so the cashier's
      // existing edits are preserved.
      if (data.amount != null && Number.isFinite(data.amount)) {
        setAmountStr(String(data.amount));
      }
      if (data.category && type === 'PAID_OUT') {
        setCategory(data.category);
      }
      if (data.reasonHint) {
        const hint = data.reasonHint.length >= 10
          ? data.reasonHint
          : (data.vendor ? `Bought from ${data.vendor}: ${data.reasonHint}` : data.reasonHint);
        setReason((prev) => prev.trim().length === 0 ? hint : prev);
      }
      setAiVendor(data.vendor ?? null);
      setAiConfidence(data.confidence ?? null);
      setAiUsed(true);
      playSound('success');
      toast.success('Receipt scanned — review and submit.');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not read receipt — try a sharper photo.';
      playSound('error');
      toast.error(msg);
    } finally {
      setScanning(false);
    }
  }

  // Lazy-load potential approvers when the manager dropdown is needed
  const amount = parseFloat(amountStr);
  const numericValid = Number.isFinite(amount) && amount > 0;
  const needsApproval =
    (type === 'CASH_DROP') ||
    (type === 'PAID_OUT' && numericValid && amount > APPROVAL_THRESHOLD);

  useEffect(() => {
    if (!open || !needsApproval || approvers.length > 0) return;
    api.get('/users')
      .then(({ data }) => {
        const eligible = (data as { id: string; name: string; role: string; isActive: boolean }[])
          .filter((u) => u.isActive && ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'].includes(u.role))
          .map((u) => ({ id: u.id, name: u.name, role: u.role }));
        setApprovers(eligible);
      })
      .catch(() => {
        toast.error('Could not load approvers — check your connection.');
      });
  }, [open, needsApproval, approvers.length]);

  const reasonValid = reason.trim().length >= 10;
  const approverValid = !needsApproval || !!approverId;
  const canSubmit = numericValid && reasonValid && approverValid && !submitting && !!shiftId;

  async function handleSubmit() {
    if (!canSubmit || !shiftId) return;
    setSubmitting(true);
    try {
      await api.post(`/shifts/${shiftId}/cash-out`, {
        type,
        amount,
        reason: reason.trim(),
        category: type === 'PAID_OUT' ? category : undefined,
        approvedById: approverId || undefined,
        aiAssisted: aiUsed,
      });
      playSound('success');
      toast.success(
        type === 'PAID_OUT'
          ? `Paid out ${formatPeso(amount)} — logged to shift`
          : `Cash drop ${formatPeso(amount)} — moved to safe`,
      );
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to record cash-out.';
      playSound('error');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === 'PAID_OUT' ? <Wallet className="h-5 w-5 text-amber-600" /> : <Vault className="h-5 w-5 text-blue-600" />}
            {type === 'PAID_OUT' ? 'Cash Paid-Out' : 'Cash Drop to Safe'}
          </DialogTitle>
        </DialogHeader>

        {/* Type toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('PAID_OUT')}
            className={`px-3 py-2.5 text-sm font-semibold rounded-lg border transition-colors ${
              type === 'PAID_OUT'
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                : 'border-border bg-card text-muted-foreground hover:bg-secondary'
            }`}
          >
            <Wallet className="h-4 w-4 mx-auto mb-0.5" />
            Paid Out
          </button>
          <button
            type="button"
            onClick={() => setType('CASH_DROP')}
            className={`px-3 py-2.5 text-sm font-semibold rounded-lg border transition-colors ${
              type === 'CASH_DROP'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200'
                : 'border-border bg-card text-muted-foreground hover:bg-secondary'
            }`}
          >
            <Vault className="h-4 w-4 mx-auto mb-0.5" />
            Cash Drop
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          {type === 'PAID_OUT'
            ? 'Real expense paid from the till — ice run, COD payment, parking tip.'
            : 'Move cash from till to the safe — not an expense, just safekeeping.'}
        </p>

        {/* Receipt OCR — paid-outs only (drops have no receipt) */}
        {type === 'PAID_OUT' && (
          <div className="space-y-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={handleReceiptScan}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={scanning}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-[var(--accent)]/40 bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] text-sm font-semibold text-[var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {scanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Reading receipt…
                </>
              ) : aiUsed ? (
                <>
                  <Sparkles className="h-4 w-4" />
                  Re-scan receipt
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  Snap receipt to autofill
                </>
              )}
            </button>
            {aiUsed && aiConfidence && (
              <div className="rounded-lg bg-[color-mix(in_oklab,var(--accent)_4%,transparent)] border border-[var(--accent)]/20 px-2.5 py-1.5 text-[11px] space-y-0.5">
                <div className="flex items-center gap-1 text-[var(--accent)] font-semibold">
                  <Sparkles className="h-3 w-3" />
                  AI-assisted — review fields below
                </div>
                {aiVendor && (
                  <p className="text-muted-foreground">
                    Vendor: <span className="text-foreground font-medium">{aiVendor}</span>
                    {aiConfidence.vendor < 0.75 && <span className="text-amber-600 ml-1">(low confidence)</span>}
                  </p>
                )}
                {aiConfidence.amount < 0.85 && (
                  <p className="text-amber-600">⚠ Double-check the amount — confidence {(aiConfidence.amount * 100).toFixed(0)}%</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount (₱)</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-2xl font-bold text-center focus:outline-none focus:ring-2 focus:ring-[var(--accent)] tabular-nums"
          />
        </div>

        {type === 'PAID_OUT' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {CATEGORIES_PAID_OUT.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={type === 'PAID_OUT'
              ? 'e.g. Bought ice for the bar from store next door'
              : 'e.g. Drawer hit ₱20k — moved ₱10k to safe'}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <p className="text-[11px] text-muted-foreground">
            Recorded on the EOD report and the audit trail.
          </p>
        </div>

        {needsApproval && (
          <div className="space-y-1.5">
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {type === 'CASH_DROP'
                  ? 'Cash drops always need manager confirmation.'
                  : `Paid-outs over ${formatPeso(APPROVAL_THRESHOLD)} require manager approval.`}
              </p>
            </div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Approving manager <span className="text-red-500">*</span>
            </label>
            <select
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">— Select manager —</option>
              {approvers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role.replace(/_/g, ' ').toLowerCase()})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              In v1 the manager confirms verbally; in a future release this requires their PIN.
            </p>
          </div>
        )}

        <div className="flex gap-2 justify-end mt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? 'Recording…' : type === 'PAID_OUT' ? 'Pay out' : 'Drop to safe'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

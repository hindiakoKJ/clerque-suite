'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Plus, Save, FileCheck, Upload, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────

interface Account { id: string; code: string; name: string; type: string; }
interface JeLine {
  id:           string;
  date:         string;
  entryNumber:  string;
  description:  string | null;
  debit:        number;
  credit:       number;
  signedAmount: number;
}
interface DraftResponse {
  account:     Account;
  periodStart: string;
  periodEnd:   string;
  glBalance:   number;
  jeLines:     JeLine[];
}
interface Recon {
  id:            string;
  accountId:     string;
  account:       { code: string; name: string };
  periodStart:   string;
  periodEnd:     string;
  bankBalance:   string | number;
  glBalance:     string | number;
  matchedAmount: string | number;
  status:        'IN_PROGRESS' | 'COMPLETED';
  preparedBy:    { name: string };
  _count?:       { items: number };
  completedAt?:  string | null;
  createdAt:     string;
}

interface StatementRow {
  id:          string;
  date:        string;
  description: string;
  amount:      string;       // user-typed; positive deposit, negative withdrawal
  matchedJeId: string | null; // null = unmatched
}

const READ_ROLES = ['BUSINESS_OWNER', 'ACCOUNTANT', 'FINANCE_LEAD', 'SUPER_ADMIN'];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function startOfMonth() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }

let stmtSeq = 0;
function newStmt(): StatementRow {
  stmtSeq += 1;
  return { id: `S${stmtSeq}`, date: todayIso(), description: '', amount: '', matchedJeId: null };
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function BankReconPage() {
  const user = useAuthStore((s) => s.user);
  const qc   = useQueryClient();
  const canRead = user ? READ_ROLES.includes(user.role) : false;

  // Reconciliation form state
  const [accountId,   setAccountId]   = useState('');
  const [periodStart, setPeriodStart] = useState(startOfMonth());
  const [periodEnd,   setPeriodEnd]   = useState(todayIso());
  const [bankBalance, setBankBalance] = useState('');
  const [notes,       setNotes]       = useState('');
  const [stmtRows,    setStmtRows]    = useState<StatementRow[]>([]);
  const [saving,      setSaving]      = useState(false);

  // Past reconciliations
  const { data: history = [] } = useQuery<Recon[]>({
    queryKey: ['bank-recon-list'],
    queryFn:  () => api.get('/bank-recon').then((r) => r.data),
    enabled:  !!user && canRead,
  });

  // Cash / bank GL accounts (codes 10xx)
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts-list'],
    queryFn:  () => api.get('/accounting/accounts').then((r) => r.data),
    enabled:  !!user && canRead,
  });
  const cashAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'ASSET' && a.code.startsWith('10')),
    [accounts],
  );

  // Draft worksheet — fetched when account + period chosen
  const { data: draft } = useQuery<DraftResponse>({
    queryKey: ['bank-recon-draft', accountId, periodStart, periodEnd],
    queryFn:  () => api.get(`/bank-recon/draft?accountId=${accountId}&periodStart=${periodStart}&periodEnd=${periodEnd}`).then((r) => r.data),
    enabled:  !!user && canRead && !!accountId && !!periodStart && !!periodEnd,
  });

  // Computed totals
  const matchedJeIds = new Set(stmtRows.filter((s) => s.matchedJeId).map((s) => s.matchedJeId));
  const totalStatement = stmtRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const totalMatched = stmtRows
    .filter((r) => r.matchedJeId)
    .reduce((s, r) => s + Math.abs(parseFloat(r.amount) || 0), 0);
  const bankBal = parseFloat(bankBalance) || 0;
  const glBal = draft?.glBalance ?? 0;
  const variance = bankBal - glBal;

  // ── CSV upload handler ─────────────────────────────────────────────────
  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) { toast.error('CSV needs at least a header and one row.'); return; }
      // Heuristic: assume columns Date, Description, Amount (in any order)
      // Parse all rows after the first (header).
      const parsed: StatementRow[] = lines.slice(1).map((line) => {
        const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const dateCol = cols[0] ?? '';
        const descCol = cols.slice(1, -1).join(' ').trim() || cols[1] || '';
        const amtCol  = cols[cols.length - 1] ?? '';
        stmtSeq += 1;
        return {
          id:          `S${stmtSeq}`,
          date:        dateCol,
          description: descCol,
          amount:      amtCol.replace(/[₱,]/g, ''),
          matchedJeId: null,
        };
      });
      setStmtRows((prev) => [...prev, ...parsed]);
      toast.success(`Imported ${parsed.length} statement line${parsed.length === 1 ? '' : 's'}.`);
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-upload of the same file
  }

  // ── Save / complete ────────────────────────────────────────────────────
  async function save(complete: boolean) {
    if (!accountId)    { toast.error('Pick a cash/bank account.'); return; }
    if (!bankBalance)  { toast.error('Enter the bank statement closing balance.'); return; }
    setSaving(true);
    try {
      const items: unknown[] = [];
      // Save each statement row
      for (const r of stmtRows) {
        items.push({
          itemType:        r.matchedJeId ? 'MATCHED' : 'STATEMENT',
          statementDate:   r.date || undefined,
          statementDesc:   r.description,
          statementAmount: parseFloat(r.amount) || 0,
          journalLineId:   r.matchedJeId ?? undefined,
          isMatched:       !!r.matchedJeId,
        });
      }
      // Save unmatched JE lines as JE_LINE items (outstanding checks / deposits in transit)
      for (const je of draft?.jeLines ?? []) {
        if (matchedJeIds.has(je.id)) continue;
        items.push({
          itemType:        'JE_LINE',
          journalLineId:   je.id,
          isMatched:       false,
          statementAmount: je.signedAmount,
          statementDesc:   je.description ?? je.entryNumber,
        });
      }

      await api.post('/bank-recon', {
        accountId,
        periodStart, periodEnd,
        bankBalance: parseFloat(bankBalance),
        glBalance:   glBal,
        notes:       notes || undefined,
        items,
        complete,
      });

      toast.success(complete ? 'Reconciliation completed.' : 'Reconciliation saved.');
      qc.invalidateQueries({ queryKey: ['bank-recon-list'] });
      // Reset form
      setStmtRows([]);
      setBankBalance('');
      setNotes('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to save reconciliation.');
    } finally {
      setSaving(false);
    }
  }

  if (!canRead) {
    return <div className="p-8 text-center text-muted-foreground text-sm">Bank Reconciliation is restricted to Owner / Accountant / Finance Lead.</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Banknote className="w-5 h-5 text-[var(--accent)]" />
          Bank Reconciliation
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Match a bank statement to your GL cash account. Outstanding items (deposits in transit, unpresented
          cheques) become reconciling items at period end.
        </p>
      </div>

      {/* Picker */}
      <div className="rounded-lg border border-border bg-background p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Cash / Bank Account *</label>
          <select className="h-9 px-3 rounded-md border border-border bg-background text-sm w-full"
            value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— Pick account —</option>
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Period Start</label>
          <input type="date" className="h-9 px-3 rounded-md border border-border bg-background text-sm w-full"
            value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Period End</label>
          <input type="date" className="h-9 px-3 rounded-md border border-border bg-background text-sm w-full"
            value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Bank Statement Balance *</label>
          <input type="number" step="0.01" placeholder="As stated on bank statement"
            className="h-9 px-3 rounded-md border border-border bg-background text-sm w-full text-right"
            value={bankBalance} onChange={(e) => setBankBalance(e.target.value)} />
        </div>
      </div>

      {/* GL balance + variance summary */}
      {draft && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="text-xs text-muted-foreground">GL Balance ({draft.account.code})</div>
            <div className="text-base font-semibold tabular-nums">{formatPeso(draft.glBalance)}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="text-xs text-muted-foreground">Bank Statement</div>
            <div className="text-base font-semibold tabular-nums">{formatPeso(bankBal)}</div>
          </div>
          <div className={`rounded-lg border px-3 py-2 ${Math.abs(variance) < 0.005 ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
            <div className="text-xs text-muted-foreground">Variance (Bank − GL)</div>
            <div className="text-base font-semibold tabular-nums">{formatPeso(variance)}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="text-xs text-muted-foreground">Matched / Outstanding</div>
            <div className="text-base font-semibold tabular-nums">
              {formatPeso(totalMatched)} / {(draft.jeLines.length - matchedJeIds.size)} JE&apos;s
            </div>
          </div>
        </div>
      )}

      {/* Two-column workspace */}
      {accountId && draft && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Statement rows */}
          <div className="rounded-lg border border-border bg-background overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <div className="text-sm font-semibold">Bank Statement Lines ({stmtRows.length})</div>
              <div className="flex gap-2">
                <label className="text-xs px-2 py-1 rounded border border-border hover:bg-muted cursor-pointer flex items-center gap-1">
                  <Upload className="w-3 h-3" /> Import CSV
                  <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                </label>
                <button onClick={() => setStmtRows((r) => [...r, newStmt()])}
                  className="text-xs px-2 py-1 rounded border border-border hover:bg-muted flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add row
                </button>
              </div>
            </div>
            <table className="w-full text-xs">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="text-left p-2 w-24">Date</th>
                  <th className="text-left p-2">Description</th>
                  <th className="text-right p-2 w-24">Amount</th>
                  <th className="text-left p-2 w-32">Match JE</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {stmtRows.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-muted-foreground p-6">
                    No statement lines yet. Paste from your bank&apos;s download or click Add row.
                  </td></tr>
                ) : (
                  stmtRows.map((r, idx) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-1">
                        <input type="date" className="w-full h-7 px-1 text-xs bg-transparent focus:bg-muted/40 rounded"
                          value={r.date} onChange={(e) => setStmtRows((p) => p.map((x, i) => i === idx ? { ...x, date: e.target.value } : x))} />
                      </td>
                      <td className="p-1">
                        <input className="w-full h-7 px-1 text-xs bg-transparent focus:bg-muted/40 rounded"
                          value={r.description} onChange={(e) => setStmtRows((p) => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                      </td>
                      <td className="p-1">
                        <input type="number" step="0.01" className="w-full h-7 px-1 text-xs bg-transparent focus:bg-muted/40 rounded text-right tabular-nums"
                          value={r.amount} onChange={(e) => setStmtRows((p) => p.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))} />
                      </td>
                      <td className="p-1">
                        <select className="w-full h-7 px-1 text-xs bg-transparent focus:bg-muted/40 rounded"
                          value={r.matchedJeId ?? ''}
                          onChange={(e) => setStmtRows((p) => p.map((x, i) => i === idx ? { ...x, matchedJeId: e.target.value || null } : x))}>
                          <option value="">— Unmatched —</option>
                          {draft.jeLines.map((j) => (
                            <option key={j.id} value={j.id}
                              disabled={matchedJeIds.has(j.id) && r.matchedJeId !== j.id}>
                              {new Date(j.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} · {j.entryNumber} · {formatPeso(j.signedAmount)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-center p-1">
                        <button onClick={() => setStmtRows((p) => p.filter((_, i) => i !== idx))}
                          className="text-muted-foreground hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="bg-muted/40">
                <tr>
                  <td colSpan={2} className="p-2 text-right font-medium text-xs">Total Statement:</td>
                  <td className="p-2 text-right font-semibold tabular-nums">{formatPeso(totalStatement)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* GL JE lines */}
          <div className="rounded-lg border border-border bg-background overflow-hidden">
            <div className="px-3 py-2 border-b border-border text-sm font-semibold">
              Posted JE Lines on {draft.account.code} ({draft.jeLines.length})
            </div>
            <table className="w-full text-xs">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="text-left p-2 w-24">Date</th>
                  <th className="text-left p-2 w-24">JE #</th>
                  <th className="text-left p-2">Description</th>
                  <th className="text-right p-2 w-24">Amount</th>
                  <th className="text-center p-2 w-20">Status</th>
                </tr>
              </thead>
              <tbody>
                {draft.jeLines.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-muted-foreground p-6">No JE lines on this account in the period.</td></tr>
                ) : (
                  draft.jeLines.map((j) => {
                    const matched = matchedJeIds.has(j.id);
                    return (
                      <tr key={j.id} className={`border-t border-border ${matched ? 'bg-emerald-500/5' : ''}`}>
                        <td className="p-2 text-muted-foreground">{new Date(j.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</td>
                        <td className="p-2 font-mono text-[10px]">{j.entryNumber}</td>
                        <td className="p-2">{j.description ?? '—'}</td>
                        <td className="p-2 text-right tabular-nums">{formatPeso(j.signedAmount)}</td>
                        <td className="p-2 text-center">
                          {matched
                            ? <span className="text-[10px] text-emerald-600 font-medium">✓ matched</span>
                            : <span className="text-[10px] text-muted-foreground">outstanding</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Notes + actions */}
      {accountId && (
        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Reconciling Notes</label>
            <textarea rows={3} className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
              placeholder="Outstanding cheques, deposits in transit, bank fees, errors, etc."
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => save(false)} disabled={saving}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-4 h-4" /> Save draft
            </button>
            <button onClick={() => save(true)} disabled={saving}
              className="h-9 px-3 rounded-md bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 flex items-center gap-1.5 disabled:opacity-50">
              <FileCheck className="w-4 h-4" /> Mark Complete
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="rounded-lg border border-border bg-background overflow-hidden">
          <div className="px-3 py-2 border-b border-border text-sm font-semibold">Past Reconciliations</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left p-2">Account</th>
                <th className="text-left p-2">Period</th>
                <th className="text-right p-2">Bank</th>
                <th className="text-right p-2">GL</th>
                <th className="text-right p-2">Variance</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Prepared by</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const v = Number(r.bankBalance) - Number(r.glBalance);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2">{r.account.code} — {r.account.name}</td>
                    <td className="p-2 text-muted-foreground">
                      {new Date(r.periodStart).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                      {' – '}
                      {new Date(r.periodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="p-2 text-right tabular-nums">{formatPeso(Number(r.bankBalance))}</td>
                    <td className="p-2 text-right tabular-nums">{formatPeso(Number(r.glBalance))}</td>
                    <td className={`p-2 text-right tabular-nums ${Math.abs(v) < 0.005 ? 'text-emerald-600' : 'text-amber-600'}`}>{formatPeso(v)}</td>
                    <td className="p-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.status === 'COMPLETED' ? 'Completed' : 'In Progress'}
                      </span>
                    </td>
                    <td className="p-2 text-muted-foreground">{r.preparedBy.name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

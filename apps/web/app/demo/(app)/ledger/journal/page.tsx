'use client';

/**
 * Demo Ledger — Journal Entries.
 *
 * Two parts:
 *   - Top: form to post a manual journal entry (multi-line, balanced)
 *   - Bottom: list of all journal entries (auto-posted from POS sales +
 *     manually-posted ones), expandable to see each line
 */

import { useState } from 'react';
import { useDemoStore } from '@/lib/demo/store';
import type { DemoJournalEntry } from '@/lib/demo/types';
import { Plus, Trash2, ChevronDown, ChevronRight, FileText, Sparkles } from 'lucide-react';

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface DraftLine {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

function emptyLine(): DraftLine {
  return { accountId: '', debit: '', credit: '', description: '' };
}

export default function DemoJournalPage() {
  const accounts = useDemoStore((s) => s.accounts);
  const journalEntries = useDemoStore((s) => s.journalEntries);
  const postManualJournalEntry = useDemoStore((s) => s.postManualJournalEntry);

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const totalDebit = draftLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = draftLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  function updateLine(idx: number, field: keyof DraftLine, value: string) {
    setDraftLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function addLine() {
    setDraftLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number) {
    setDraftLines((prev) => prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev);
  }

  function resetForm() {
    setDescription('');
    setReference('');
    setDraftLines([emptyLine(), emptyLine()]);
    setSubmitError(null);
  }

  function handleSubmit() {
    setSubmitError(null);
    if (!description.trim()) {
      setSubmitError('Description is required.');
      return;
    }
    if (draftLines.some((l) => !l.accountId)) {
      setSubmitError('Select an account on every line.');
      return;
    }
    try {
      postManualJournalEntry({
        description: description.trim(),
        reference: reference.trim() || undefined,
        lines: draftLines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || undefined,
        })),
      });
      resetForm();
      setShowForm(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Journal Entries</h1>
          <p className="text-sm text-stone-500">
            All postings — auto-generated from POS sales, plus your manual entries.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-lg"
        >
          <Plus className="w-4 h-4" />
          Post Entry
        </button>
      </div>

      {showForm && (
        <div className="bg-white border-2 border-emerald-200 rounded-lg p-4 space-y-4">
          <div>
            <h2 className="font-semibold text-stone-900">New Journal Entry</h2>
            <p className="text-xs text-stone-500">Manual entries balance debit and credit.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="md:col-span-2 block">
              <span className="text-xs font-semibold text-stone-700">Description *</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Owner cash injection"
                className="mt-1 w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-stone-700">Reference</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="optional"
                className="mt-1 w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"
              />
            </label>
          </div>

          <div className="border border-stone-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Account</th>
                  <th className="text-left px-3 py-2 font-semibold hidden lg:table-cell">Note</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Debit</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Credit</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {draftLines.map((line, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2">
                      <select
                        value={line.accountId}
                        onChange={(e) => updateLine(idx, 'accountId', e.target.value)}
                        className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                      >
                        <option value="">Select account…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      <input
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        placeholder="optional"
                        className="w-full px-2 py-1.5 border border-stone-200 rounded text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={line.debit}
                        onChange={(e) => {
                          updateLine(idx, 'debit', e.target.value);
                          if (e.target.value) updateLine(idx, 'credit', '');
                        }}
                        className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm text-right"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={line.credit}
                        onChange={(e) => {
                          updateLine(idx, 'credit', e.target.value);
                          if (e.target.value) updateLine(idx, 'debit', '');
                        }}
                        className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm text-right"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => removeLine(idx)}
                        disabled={draftLines.length <= 2}
                        className="text-stone-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-stone-50 border-t border-stone-200 text-sm font-bold">
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-right hidden lg:table-cell">Total</td>
                  <td colSpan={1} className="px-3 py-2 text-right lg:hidden">Total</td>
                  <td className="px-3 py-2 text-right">{peso(totalDebit)}</td>
                  <td className="px-3 py-2 text-right">{peso(totalCredit)}</td>
                  <td></td>
                </tr>
                {totalDebit !== totalCredit && totalDebit + totalCredit > 0 && (
                  <tr className="bg-amber-50 text-amber-800 text-xs">
                    <td colSpan={5} className="px-3 py-1.5 text-center">
                      Out of balance by {peso(Math.abs(totalDebit - totalCredit))} — debit must equal credit.
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          <button
            type="button"
            onClick={addLine}
            className="text-emerald-700 hover:text-emerald-800 text-sm font-medium inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add line
          </button>

          {submitError && (
            <div className="bg-red-50 text-red-700 text-sm rounded p-3">{submitError}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
            <button
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
              className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isBalanced || draftLines.some((l) => !l.accountId)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Post Entry
            </button>
          </div>
        </div>
      )}

      {/* Entries list */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        {journalEntries.length === 0 ? (
          <div className="p-8 text-center text-stone-500">
            No entries yet. Make a sale or post a manual entry above.
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {journalEntries.slice(0, 50).map((je) => (
              <JournalEntryRow
                key={je.id}
                entry={je}
                isExpanded={expanded === je.id}
                onToggle={() => setExpanded((cur) => (cur === je.id ? null : je.id))}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function JournalEntryRow({
  entry,
  isExpanded,
  onToggle,
}: {
  entry: DemoJournalEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const date = new Date(entry.date);
  const Icon = entry.source === 'SYSTEM' ? Sparkles : FileText;
  const sourceColor = entry.source === 'SYSTEM' ? 'text-blue-600' : 'text-emerald-600';

  return (
    <li>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-stone-50 text-left"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-stone-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-stone-400 flex-shrink-0" />
        )}
        <Icon className={`w-4 h-4 flex-shrink-0 ${sourceColor}`} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-stone-900 truncate">{entry.description}</p>
          <p className="text-xs text-stone-500">
            {entry.entryNumber} · {date.toLocaleDateString('en-PH')}
            {' · '}
            {entry.source === 'SYSTEM' ? 'Auto-posted' : 'Manual'}
            {entry.reference && ` · Ref: ${entry.reference}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-stone-900">{peso(entry.totalDebit)}</p>
          <p className="text-[10px] text-stone-500 uppercase">{entry.lines.length} lines</p>
        </div>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 ml-7 mr-4 mb-2 bg-stone-50 rounded-lg overflow-hidden border border-stone-200">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Account</th>
                <th className="text-right px-3 py-2 font-semibold w-28">Debit</th>
                <th className="text-right px-3 py-2 font-semibold w-28">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {entry.lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2">
                    <p className="font-mono text-xs text-stone-500">{line.accountCode}</p>
                    <p className="text-stone-900">{line.accountName}</p>
                    {line.description && (
                      <p className="text-xs text-stone-500 italic">{line.description}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {line.debit > 0 ? peso(line.debit) : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {line.credit > 0 ? peso(line.credit) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

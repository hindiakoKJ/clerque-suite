'use client';

/**
 * SECURITY D3-02 — Two-factor authentication enrolment + management.
 *
 * Owner-facing settings page. Lets any logged-in user:
 *   - Enrol in TOTP 2FA (scan QR, verify code, get backup codes)
 *   - View current status (enrolled vs not)
 *   - Regenerate backup codes (after re-confirming a current code)
 *   - Disable 2FA (after confirming a current code)
 *
 * Backend endpoints already exist under /auth/2fa/*; this page is the UI
 * binding. Once enrolled, the next login will trigger the 2fa-challenge
 * path the login page handles.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Loader2, Copy, ChevronLeft, KeyRound, X } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface StatusResp {
  enabled: boolean;
  pendingEnrollment: boolean;
  backupCodesRemaining: number;
}
interface EnrolResp {
  secret:       string;
  otpauthUrl:   string;
  qrDataUrl:    string;
}
interface VerifyResp {
  backupCodes: string[];
}

export default function SecuritySettingsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [enrolling, setEnrolling] = useState<EnrolResp | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState('');
  const [showDisable, setShowDisable] = useState(false);

  // Sprint 22 — owner-feedback hardening. Previous version had no retry
  // controls or stale-time, so a transient 500/401 caused the query to
  // retry up to 3 times within a second, each retry triggering a render
  // that could look like a loop to a non-technical user. Now:
  //   - retry: 1 (single retry on transient failure)
  //   - staleTime: 30s (don't re-fetch on tab focus while you're enrolling)
  //   - refetchOnWindowFocus: false (kills the "page flashed when I tabbed
  //     back" effect a coffee-shop owner reported as a "loop")
  //   - The query stays enabled only after `user` is populated, so the
  //     initial mount doesn't race against Zustand hydration.
  const { data: status, isLoading } = useQuery<StatusResp>({
    queryKey:           ['2fa-status'],
    queryFn:            () => api.post('/auth/2fa/status').then((r) => r.data),
    enabled:            !!user?.sub,
    retry:              1,
    staleTime:          30_000,
    refetchOnWindowFocus: false,
  });

  const beginEnrol = useMutation({
    mutationFn: () => api.post<EnrolResp>('/auth/2fa/enroll').then((r) => r.data),
    onSuccess:  (data) => { setEnrolling(data); setCode(''); },
    onError:    (e: any) => toast.error(e?.response?.data?.message ?? 'Could not start enrolment'),
  });

  const verifyEnrol = useMutation({
    mutationFn: () => api.post<VerifyResp>('/auth/2fa/verify', { code }).then((r) => r.data),
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setEnrolling(null);
      setCode('');
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
      toast.success('Two-factor authentication enabled.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Invalid code. Try again.'),
  });

  const cancelEnrol = useMutation({
    mutationFn: () => api.post('/auth/2fa/cancel-enroll').then((r) => r.data),
    onSuccess: () => { setEnrolling(null); setCode(''); qc.invalidateQueries({ queryKey: ['2fa-status'] }); },
  });

  const disable = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable', { code: disableCode }).then((r) => r.data),
    onSuccess: () => {
      setShowDisable(false); setDisableCode('');
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
      toast.success('Two-factor authentication disabled.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Invalid code.'),
  });

  const regenerate = useMutation({
    mutationFn: (currentCode: string) =>
      api.post<VerifyResp>('/auth/2fa/regenerate-backup', { code: currentCode }).then((r) => r.data),
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
      toast.success('New backup codes generated. Save them now — old codes no longer work.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Invalid code.'),
  });

  const copyCodes = async () => {
    if (!backupCodes) return;
    await navigator.clipboard.writeText(backupCodes.join('\n'));
    toast.success('Backup codes copied to clipboard.');
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
          <ChevronLeft className="h-3 w-3" /> Settings
        </Link>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <KeyRound className="h-5 w-5" style={{ color: 'var(--accent)' }} />
          Security &amp; Two-Factor Authentication
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Protect your account against stolen-password attacks with a 6-digit code from an authenticator app.
        </p>
      </div>

      <div className="flex-1 p-4 sm:p-6 max-w-2xl space-y-6">
        {/* Status banner */}
        {isLoading ? (
          <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading status…</span>
          </div>
        ) : status?.enabled ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 flex gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-foreground">Two-factor authentication is ON.</p>
              <p className="text-xs text-muted-foreground mt-1">
                You have {status.backupCodesRemaining} backup code{status.backupCodesRemaining !== 1 ? 's' : ''} remaining.
                When you log in from a new device, you'll be asked for the 6-digit code from your authenticator app
                (or a backup code if you've lost the device).
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex gap-3">
            <ShieldAlert className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-foreground">Two-factor authentication is OFF.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your account is protected by your password alone. We strongly recommend enabling 2FA — especially
                for BUSINESS_OWNER, ACCOUNTANT, AP_ACCOUNTANT, and PAYROLL_MASTER roles. A stolen password without
                2FA gives full access to all financial data.
              </p>
            </div>
          </div>
        )}

        {/* Backup codes display (after enrol or regenerate) */}
        {backupCodes && (
          <div className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/20 p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-foreground">Save these backup codes now</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Each code works once. Keep them in a password manager — you'll need them if you lose your
                  authenticator device. <strong>They will not be shown again.</strong>
                </p>
              </div>
              <button
                onClick={() => setBackupCodes(null)}
                className="text-muted-foreground hover:text-foreground p-1"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-sm">
              {backupCodes.map((c) => (
                <code key={c} className="bg-background border border-border rounded px-2 py-1.5">{c}</code>
              ))}
            </div>
            <button
              onClick={copyCodes}
              className="text-sm flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg hover:bg-background/50"
            >
              <Copy className="h-3 w-3" /> Copy all to clipboard
            </button>
          </div>
        )}

        {/* Stale pending-enrollment exit. If the user started enrolment
            on a previous session and never finished (browser closed,
            QR scanned but never verified), the server still treats them
            as pending. Without this exit row they'd see only "Begin
            enrolment" again — clicking it creates a NEW pending state
            without resolving the old one. This row lets them cancel
            the stale pending row cleanly. */}
        {!status?.enabled && status?.pendingEnrollment && !enrolling && (
          <div className="rounded-xl border-2 border-amber-500 bg-amber-500/10 p-5 space-y-3">
            <h2 className="font-semibold text-foreground">You have a pending 2FA setup</h2>
            <p className="text-sm text-muted-foreground">
              Looks like you started setting up 2FA but didn't finish. Resume the setup
              to scan a fresh QR, or cancel to start over later.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => beginEnrol.mutate()}
                disabled={beginEnrol.isPending}
                className="px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-60"
                style={{ background: 'var(--accent)' }}
              >
                {beginEnrol.isPending ? 'Loading…' : 'Resume setup'}
              </button>
              <button
                onClick={() => cancelEnrol.mutate()}
                disabled={cancelEnrol.isPending}
                className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted disabled:opacity-60"
              >
                {cancelEnrol.isPending ? 'Cancelling…' : 'Cancel pending setup'}
              </button>
            </div>
          </div>
        )}

        {/* Enrolment flow */}
        {!status?.enabled && !status?.pendingEnrollment && !enrolling && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h2 className="font-semibold text-foreground">Enable two-factor authentication</h2>
            <ol className="text-sm text-muted-foreground space-y-1 ml-4 list-decimal">
              <li>Install an authenticator app (Google Authenticator, Authy, 1Password).</li>
              <li>Click <em>Begin enrolment</em> below.</li>
              <li>Scan the QR code or paste the secret into your app.</li>
              <li>Enter the 6-digit code your app shows to confirm.</li>
              <li>Save the backup codes somewhere safe.</li>
            </ol>
            <button
              onClick={() => beginEnrol.mutate()}
              disabled={beginEnrol.isPending}
              className="px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              {beginEnrol.isPending ? 'Starting…' : 'Begin enrolment'}
            </button>
          </div>
        )}

        {enrolling && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="font-semibold text-foreground">Scan this with your authenticator app</h2>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrolling.qrDataUrl} alt="2FA QR code" className="w-48 h-48 border border-border rounded-lg bg-white" />
              <div className="flex-1 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Can't scan? Manually enter this secret in your authenticator app:
                </p>
                <code className="block bg-muted rounded px-3 py-2 text-sm font-mono break-all">{enrolling.secret}</code>
                <label className="block text-sm font-medium text-foreground mt-3">Enter the 6-digit code from your app</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-center font-mono text-xl tracking-widest"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => verifyEnrol.mutate()}
                disabled={code.length !== 6 || verifyEnrol.isPending}
                className="px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-60"
                style={{ background: 'var(--accent)' }}
              >
                {verifyEnrol.isPending ? 'Verifying…' : 'Verify &amp; enable'}
              </button>
              <button
                onClick={() => cancelEnrol.mutate()}
                className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Management for enrolled users */}
        {status?.enabled && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h2 className="font-semibold text-foreground">Manage 2FA</h2>
            <button
              onClick={() => {
                const c = prompt('Enter a current 6-digit code to regenerate backup codes:');
                if (c) regenerate.mutate(c);
              }}
              className="text-sm px-3 py-2 border border-border rounded-lg hover:bg-muted"
            >
              Regenerate backup codes
            </button>
            <div>
              {!showDisable ? (
                <button
                  onClick={() => setShowDisable(true)}
                  className="text-sm px-3 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20"
                >
                  Disable 2FA
                </button>
              ) : (
                <div className="border border-red-300 bg-red-50 dark:bg-red-950/20 rounded-lg p-3 space-y-2">
                  <p className="text-sm text-foreground">Enter a current 6-digit code to confirm:</p>
                  <input
                    type="text"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="w-32 px-3 py-2 border border-border rounded-lg bg-background font-mono text-center"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => disable.mutate()}
                      disabled={disableCode.length !== 6}
                      className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg disabled:opacity-50"
                    >
                      Confirm disable
                    </button>
                    <button
                      onClick={() => { setShowDisable(false); setDisableCode(''); }}
                      className="px-3 py-1.5 text-sm border border-border rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

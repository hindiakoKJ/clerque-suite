'use client';
/**
 * Sprint 13 — Pharmacy Setup.
 *
 * Owner-facing summary of pharmacy compliance state:
 *   • Pharmacist roster (users with PRC license) with expiry warnings.
 *   • Quick links to the operational pharmacy pages (Rx queue, Product
 *     Lots for FDA expiry tracking, DDB Register for RA 9165 controlled
 *     substances).
 *   • Compliance reminders so the owner doesn't need to remember every
 *     PH pharmacy regulation off the top of their head.
 *
 * No DB writes happen on this page — credentials are edited per-staff
 * from POS → Staff (so the SOD audit trail captures the change with the
 * editing user attached). This page is the consolidated read-out.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Pill, FileBadge, ShieldAlert, ClipboardList, ExternalLink,
  CheckCircle2, AlertTriangle, XCircle, Users, Info,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  prcLicense?: string | null;
  prcLicenseExpiresAt?: string | null;
}

function expiryStatus(iso: string | null | undefined):
  | { kind: 'expired';   label: string; color: string; Icon: typeof XCircle }
  | { kind: 'expiring';  label: string; color: string; Icon: typeof AlertTriangle }
  | { kind: 'valid';     label: string; color: string; Icon: typeof CheckCircle2 }
  | { kind: 'unknown';   label: string; color: string; Icon: typeof Info } {
  if (!iso) {
    return { kind: 'unknown',  label: 'No expiry on file',
             color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
             Icon: Info };
  }
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return { kind: 'expired', label: `Expired ${Math.abs(days)}d ago`,
             color: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20',
             Icon: XCircle };
  }
  if (days < 30) {
    return { kind: 'expiring', label: `Expires in ${days}d`,
             color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
             Icon: AlertTriangle };
  }
  if (days < 90) {
    return { kind: 'expiring', label: `Expires in ${days}d`,
             color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
             Icon: AlertTriangle };
  }
  return { kind: 'valid', label: `Valid · expires ${new Date(iso).toLocaleDateString()}`,
           color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
           Icon: CheckCircle2 };
}

export default function PharmacySettingsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  // Sprint 19 — Owner-only. Non-owners (cashier, branch manager, sales lead,
  // employee) see the Pharmacy Setup card on /settings only when isOwner is
  // true; this redirect closes the URL-hack path. Pharmacist roster + PRC
  // expiry + compliance reminders are policy-level data that the day-to-day
  // till crew shouldn't see.
  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  useEffect(() => {
    if (user && !isOwner) router.replace('/settings');
  }, [user, isOwner, router]);

  const { data: staff = [], isLoading } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn:  () => api.get('/users').then((r) => r.data),
    enabled:  !!user && isOwner,
  });

  if (!isOwner) return null;

  const pharmacists = staff.filter((s) => s.prcLicense && s.isActive);
  const expiredCount  = pharmacists.filter((p) => expiryStatus(p.prcLicenseExpiresAt).kind === 'expired').length;
  const expiringCount = pharmacists.filter((p) => expiryStatus(p.prcLicenseExpiresAt).kind === 'expiring').length;

  const cardCls = 'rounded-xl border border-border bg-card p-4 hover:border-[var(--accent)] hover:shadow-sm transition-all';

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) router.back();
          else router.push('/settings');
        }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Pill className="h-6 w-6 text-[var(--accent)]" />
          Pharmacy Setup
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Compliance summary and quick links for your pharmacy operations. PH regulations
          relevant here: <strong>RA 6675</strong> (generics labeling), <strong>RA 9165</strong> (Comprehensive
          Dangerous Drugs Act + DDB register), <strong>FDA Circular 13-2014</strong> (lot/expiry
          traceability), and <strong>BIR RR 16-2018</strong> (prescription drug VAT exemption for senior
          citizens / PWD).
        </p>
      </div>

      {/* Pharmacist roster */}
      <section className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--accent)]" />
            <span className="text-sm font-semibold">Licensed Pharmacists</span>
            <span className="text-xs text-muted-foreground">· {pharmacists.length} on roster</span>
          </div>
          <Link
            href="/pos/staff"
            className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1"
          >
            Manage in Staff <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {(expiredCount > 0 || expiringCount > 0) && (
          <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {expiredCount > 0 && <><strong>{expiredCount}</strong> expired</>}
              {expiredCount > 0 && expiringCount > 0 && ' · '}
              {expiringCount > 0 && <><strong>{expiringCount}</strong> expiring soon</>}
              {' '}— update PRC details from <Link href="/pos/staff" className="underline">Staff</Link> to keep dispensing legal.
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : pharmacists.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No pharmacists on the roster yet. Add a staff member with role <em>Pharmacist</em> and
            fill in their PRC license number from <Link href="/pos/staff" className="underline">Staff</Link>.
            <br />
            <span className="text-xs">RA 6675 §6 requires a licensed pharmacist on duty whenever the drugstore is open.</span>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pharmacists.map((p) => {
              const status = expiryStatus(p.prcLicenseExpiresAt);
              return (
                <div key={p.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{p.email}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      PRC <span className="font-mono">{p.prcLicense}</span>
                    </div>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded border inline-flex items-center gap-1.5 ${status.color}`}>
                    <status.Icon className="h-3.5 w-3.5" />
                    {status.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick links to operational pages */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Operations
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Link href="/pos/pharmacy/rx" className={cardCls}>
            <div className="flex items-start gap-3">
              <FileBadge className="h-5 w-5 text-[var(--accent)] mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-sm">Prescriptions (Rx)</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Intake + refill tracking. Required before selling Rx-only products.
                </div>
              </div>
            </div>
          </Link>
          <Link href="/pos/pharmacy/lots" className={cardCls}>
            <div className="flex items-start gap-3">
              <ClipboardList className="h-5 w-5 text-[var(--accent)] mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-sm">Product Lots</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Lot + expiry tracking (FDA Circular 13-2014). FEFO dispatch at the till.
                </div>
              </div>
            </div>
          </Link>
          <Link href="/pos/pharmacy/register" className={cardCls}>
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-[var(--accent)] mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-sm">DDB Register</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  RA 9165 Dangerous Drugs Board log. Auto-populated on every controlled-substance sale.
                </div>
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* Compliance reminders */}
      <section className="rounded-xl border border-border bg-muted/20 p-4">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Info className="h-4 w-4 text-[var(--accent)]" />
          Compliance reminders
        </h2>
        <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
          <li>
            <strong>Rx receipt format:</strong> Every dispensed-drug sale must print the
            patient name, generic + brand name, and the dispensing pharmacist&apos;s PRC number.
            Clerque does this automatically when the product&apos;s &quot;Rx required&quot; flag is set.
          </li>
          <li>
            <strong>Senior citizen / PWD discount:</strong> Prescription drugs are 20% off
            and VAT-exempt by law for SC/PWD ID holders. The cashier&apos;s SC/PWD discount
            workflow handles both the discount and the VAT removal.
          </li>
          <li>
            <strong>FDA expiry rule:</strong> Selling an expired drug is a criminal
            offense. Set product lots with expiry dates so the till blocks expired stock.
          </li>
          <li>
            <strong>DDB controlled substances:</strong> Selling RA 9165 schedule II / III drugs
            without a valid Rx + active pharmacist is logged AND blocked at the till. Audit trail
            lives in <Link href="/pos/pharmacy/register" className="underline">DDB Register</Link>.
          </li>
        </ul>
      </section>
    </div>
  );
}

'use client';
/**
 * Trucking → PM Schedules
 *
 * Preventive-maintenance dashboard. Shows schedules due within N days
 * (default 14) so the dispatcher knows what to action this week. Click
 * the day-window selector to widen / narrow.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, ArrowLeft, AlertTriangle, Calendar } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface DuePm {
  id:                string;
  type:              string;
  customLabel:       string | null;
  intervalKm:        number | null;
  intervalDays:      number | null;
  lastDoneAt:        string | null;
  nextDueAt:         string | null;
  nextDueMileageKm:  number | null;
  isActive:          boolean;
  fleetAsset: {
    id:          string;
    plateNumber: string;
    mileageKm:   number;
  };
}

const TYPE_LABELS: Record<string, string> = {
  ENGINE_OIL:         'Engine Oil',
  TIRE_ROTATION:      'Tire Rotation',
  TIRE_REPLACEMENT:   'Tire Replacement',
  CHASSIS_LUBE:       'Chassis Lube',
  BRAKE_INSPECTION:   'Brake Inspection',
  TRANSMISSION_FLUID: 'Transmission Fluid',
  AIR_FILTER:         'Air Filter',
  REGISTRATION_LTO:   'LTO Registration',
  INSURANCE_RENEWAL:  'Insurance Renewal',
  CUSTOM:             'Custom',
};

export default function PmSchedulesPage() {
  const router = useRouter();
  const [withinDays, setWithinDays] = useState(14);

  const { data: due = [] } = useQuery<DuePm[]>({
    queryKey: ['trucking-pm-due', withinDays],
    queryFn:  () => api.get('/trucking/pm-schedules/due', { params: { withinDays } }).then((r) => r.data),
  });

  const overdue = due.filter((d) => d.nextDueAt && new Date(d.nextDueAt) < new Date());
  const upcoming = due.filter((d) => !overdue.includes(d));

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <ClipboardList className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">PM Schedules</h1>
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-5 flex-1 overflow-auto">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Show due within</span>
          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => setWithinDays(d)}
              className={
                'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ' +
                (withinDays === d
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-border text-muted-foreground hover:bg-muted')
              }
            >
              {d}d
            </button>
          ))}
        </div>

        {overdue.length > 0 && (
          <Section
            title={`Overdue (${overdue.length})`}
            tone="danger"
            items={overdue}
          />
        )}
        <Section
          title={overdue.length > 0 ? `Upcoming (${upcoming.length})` : `Due in next ${withinDays} days`}
          tone="default"
          items={upcoming}
        />
      </div>
    </div>
  );
}

function Section({ title, items, tone }: { title: string; items: DuePm[]; tone: 'default' | 'danger' }) {
  return (
    <section>
      <h2 className={
        'text-sm font-semibold mb-2 inline-flex items-center gap-2 ' +
        (tone === 'danger' ? 'text-red-600' : 'text-foreground')
      }>
        {tone === 'danger' && <AlertTriangle className="h-4 w-4" />}
        {title}
      </h2>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Nothing here.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                <th className="px-4 py-2.5 font-medium">Plate</th>
                <th className="px-4 py-2.5 font-medium">PM type</th>
                <th className="px-4 py-2.5 font-medium">Due date</th>
                <th className="px-4 py-2.5 font-medium text-right">Due mileage</th>
                <th className="px-4 py-2.5 font-medium text-right">Current mileage</th>
                <th className="px-4 py-2.5 font-medium">Last done</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const due = d.nextDueAt ? new Date(d.nextDueAt) : null;
                const isOverdue = due && due < new Date();
                return (
                  <tr key={d.id} className={'border-b border-border/60 last:border-b-0 ' + (isOverdue ? 'bg-red-500/5' : 'hover:bg-muted/20')}>
                    <td className="px-4 py-2.5 font-mono">{d.fleetAsset.plateNumber}</td>
                    <td className="px-4 py-2.5">{TYPE_LABELS[d.type] ?? d.type}{d.customLabel ? `: ${d.customLabel}` : ''}</td>
                    <td className={'px-4 py-2.5 text-xs whitespace-nowrap ' + (isOverdue ? 'text-red-600 font-medium' : '')}>
                      <Calendar className="h-3 w-3 inline mr-1" />
                      {due ? due.toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {d.nextDueMileageKm ? `${d.nextDueMileageKm.toLocaleString()} km` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                      {d.fleetAsset.mileageKm.toLocaleString()} km
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {d.lastDoneAt ? new Date(d.lastDoneAt).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

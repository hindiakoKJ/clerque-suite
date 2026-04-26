'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Coffee, ShoppingBag, Wrench, Factory, ChevronRight, X } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

type BusinessType = 'COFFEE_SHOP' | 'RETAIL' | 'SERVICE' | 'MANUFACTURING';

interface TenantProfile {
  id: string;
  name: string;
  businessType: BusinessType;
}

interface Option {
  type: BusinessType;
  label: string;
  description: string;
  Icon: React.ElementType;
  color: string;
}

const OPTIONS: Option[] = [
  {
    type: 'COFFEE_SHOP',
    label: 'Food & Beverage',
    description: 'Café, restaurant, or any food business. Unlocks modifier groups (Size, Add-ons, etc.).',
    Icon: Coffee,
    color: 'hsl(25 85% 50%)',
  },
  {
    type: 'RETAIL',
    label: 'Retail',
    description: 'Convenience store, boutique, or product-based shop.',
    Icon: ShoppingBag,
    color: 'hsl(217 91% 55%)',
  },
  {
    type: 'SERVICE',
    label: 'Service',
    description: 'Salon, clinic, laundry, repair, or any service-based business.',
    Icon: Wrench,
    color: 'hsl(173 70% 40%)',
  },
  {
    type: 'MANUFACTURING',
    label: 'Manufacturing / Construction',
    description: 'Fabrication, construction, or businesses with bill-of-materials workflows.',
    Icon: Factory,
    color: 'hsl(262 70% 58%)',
  },
];

interface Props {
  onDismiss: () => void;
}

export function BusinessSetupWizard({ onDismiss }: Props) {
  const [selected, setSelected] = useState<BusinessType | null>(null);
  const qc = useQueryClient();

  const { mutate: save, isPending } = useMutation({
    mutationFn: (businessType: BusinessType) =>
      api.patch('/tenant/profile', { businessType }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-profile'] });
      toast.success('Business type saved!');
      onDismiss();
    },
    onError: () => toast.error('Failed to save. Try again.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-8 pt-8 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                One-time setup
              </p>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">
                What kind of business<br />are you running?
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                This helps Clerque show the right features for your industry.
                You can change it later in Settings.
              </p>
            </div>
            <button
              onClick={onDismiss}
              className="text-slate-300 hover:text-slate-500 dark:hover:text-slate-300 transition-colors mt-1"
              aria-label="Skip"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Options */}
        <div className="px-8 pb-2 space-y-2">
          {OPTIONS.map(({ type, label, description, Icon, color }) => {
            const isSelected = selected === type;
            return (
              <button
                key={type}
                onClick={() => setSelected(type)}
                className={`w-full flex items-center gap-4 rounded-2xl border-2 px-4 py-3.5 text-left transition-all ${
                  isSelected
                    ? 'border-transparent shadow-md'
                    : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700'
                }`}
                style={isSelected ? {
                  borderColor: color,
                  background: `color-mix(in oklab, ${color} 8%, transparent)`,
                } : {}}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `color-mix(in oklab, ${color} 15%, transparent)` }}
                >
                  <Icon className="h-5 w-5" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                    {description}
                  </p>
                </div>
                {isSelected && (
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: color }}
                  >
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-8 py-6">
          <button
            onClick={() => selected && save(selected)}
            disabled={!selected || isPending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm text-white transition-all disabled:opacity-40 hover:opacity-90"
            style={{ background: selected ? OPTIONS.find((o) => o.type === selected)?.color ?? '#8B5E3C' : '#94a3b8' }}
          >
            {isPending ? 'Saving…' : 'Confirm & Continue'}
            {!isPending && <ChevronRight className="h-4 w-4" />}
          </button>
          <p className="text-center text-xs text-slate-400 mt-3">
            You can change this any time from Settings.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Hook — returns tenant profile and whether wizard should show */
export function useBusinessSetup(isOwner: boolean) {
  return useQuery<TenantProfile>({
    queryKey: ['tenant-profile'],
    queryFn: () => api.get('/tenant/profile').then((r) => r.data),
    enabled: isOwner,
    staleTime: 5 * 60_000,
  });
}

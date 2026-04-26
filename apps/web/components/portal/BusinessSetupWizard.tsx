'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Coffee, ShoppingBag, Wrench, Factory, ChevronRight, X, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { isFnbType, type BusinessType } from '@repo/shared-types';

// Re-export BusinessType so consumers (useBusinessSetup callers) can use the shared type
export type { BusinessType };

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
  /** When true this option expands to show F&B sub-type choices */
  isFnbGroup?: boolean;
}

// F&B sub-types the user can choose from inside the "Food & Beverage" group
const FNB_SUB_OPTIONS: { type: BusinessType; label: string; description: string }[] = [
  { type: 'COFFEE_SHOP', label: 'Café / Coffee Shop',   description: 'Espresso bar, milk tea, kiosk' },
  { type: 'RESTAURANT',  label: 'Restaurant',           description: 'Dine-in or takeout, full-service' },
  { type: 'BAKERY',      label: 'Bakery / Pastry',      description: 'Bakery, cake shop, pastry counter' },
  { type: 'FOOD_STALL',  label: 'Food Stall / Carinderia', description: 'Market stall, turo-turo, carinderia' },
  { type: 'BAR_LOUNGE',  label: 'Bar / Lounge',         description: 'Bar, lounge, nightspot with food' },
  { type: 'CATERING',    label: 'Catering',             description: 'Events catering, food service' },
];

const OPTIONS: Option[] = [
  {
    type: 'COFFEE_SHOP',   // representative type for the group; overridden by sub-type selection
    label: 'Food & Beverage',
    description: 'Café, restaurant, bakery, bar, catering. Unlocks recipe-based inventory and modifier groups.',
    Icon: Coffee,
    color: 'hsl(25 85% 50%)',
    isFnbGroup: true,
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
  // `selected` is the final BusinessType that will be saved
  const [selected, setSelected]   = useState<BusinessType | null>(null);
  // `fnbExpanded` tracks whether the F&B group is open to show sub-types
  const [fnbExpanded, setFnbExpanded] = useState(false);
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

  const FNB_COLOR = 'hsl(25 85% 50%)';

  // Which top-level option card is highlighted
  function isCardSelected(opt: Option) {
    if (opt.isFnbGroup) return !!selected && isFnbType(selected);
    return selected === opt.type;
  }

  function handleCardClick(opt: Option) {
    if (opt.isFnbGroup) {
      setFnbExpanded((v) => !v);
      // If they click the group card without picking a sub-type yet, don't change selected
      return;
    }
    setFnbExpanded(false);
    setSelected(opt.type);
  }

  function handleSubType(type: BusinessType) {
    setSelected(type);
  }

  // Label for the confirm button
  const selectedLabel =
    selected == null ? null
    : isFnbType(selected)
      ? (FNB_SUB_OPTIONS.find((s) => s.type === selected)?.label ?? 'Food & Beverage')
      : OPTIONS.find((o) => o.type === selected)?.label;

  const accentColor = selected
    ? (isFnbType(selected) ? FNB_COLOR : OPTIONS.find((o) => o.type === selected)?.color ?? '#8B5E3C')
    : '#94a3b8';

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
          {OPTIONS.map((opt) => {
            const { type, label, description, Icon, color, isFnbGroup } = opt;
            const isSelected = isCardSelected(opt);
            return (
              <div key={type}>
                <button
                  onClick={() => handleCardClick(opt)}
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
                  {isFnbGroup ? (
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${fnbExpanded ? 'rotate-180' : ''}`}
                    />
                  ) : isSelected ? (
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: color }}
                    >
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : null}
                </button>

                {/* F&B sub-type picker — shown when group is expanded */}
                {isFnbGroup && fnbExpanded && (
                  <div className="mt-1.5 ml-4 pl-4 border-l-2 border-slate-100 dark:border-slate-800 space-y-1">
                    {FNB_SUB_OPTIONS.map((sub) => {
                      const isSubSelected = selected === sub.type;
                      return (
                        <button
                          key={sub.type}
                          onClick={() => handleSubType(sub.type)}
                          className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${
                            isSubSelected
                              ? 'shadow-sm'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                          style={isSubSelected ? {
                            background: `color-mix(in oklab, ${FNB_COLOR} 10%, transparent)`,
                            outline: `1.5px solid ${FNB_COLOR}`,
                          } : {}}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white">{sub.label}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{sub.description}</p>
                          </div>
                          {isSubSelected && (
                            <div
                              className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                              style={{ background: FNB_COLOR }}
                            >
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-8 py-6">
          <button
            onClick={() => selected && save(selected)}
            disabled={!selected || isPending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm text-white transition-all disabled:opacity-40 hover:opacity-90"
            style={{ background: accentColor }}
          >
            {isPending ? 'Saving…' : selectedLabel ? `Confirm — ${selectedLabel}` : 'Select a business type'}
            {!isPending && selected && <ChevronRight className="h-4 w-4" />}
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

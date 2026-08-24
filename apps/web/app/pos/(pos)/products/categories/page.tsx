'use client';
/**
 * Categories management page — Products → Categories.
 *
 * Today there's no dedicated UI for editing categories beyond the inline
 * <select> on the product form. This page exists primarily to manage
 * category-level modifier groups (the union returned by
 * `/modifiers/products/:productId/groups` auto-applies any group whose
 * `categoryId` matches the product's category, so binding/unbinding here
 * propagates to every product in the category without per-product attach).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Plus, X, Trash2, ChevronDown, ChevronUp, MonitorSpeaker, CheckSquare, Square } from 'lucide-react';
import { api } from '@/lib/api';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import { toast } from 'sonner';

interface Category { id: string; name: string; stationId?: string | null; }
interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number | string;
  sortOrder: number;
}
interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  sortOrder: number;
  categoryId: string | null;
  options: ModifierOption[];
}

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

export default function CategoriesPage() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => api.get('/categories').then((r) => r.data),
    staleTime: 60_000,
  });

  // All tenant modifier groups — we partition by categoryId client-side.
  const { data: allGroups = [] } = useQuery<ModifierGroup[]>({
    queryKey: ['modifier-groups'],
    queryFn: () => api.get('/modifiers/groups').then((r) => r.data),
    staleTime: 30_000,
  });

  // Prep stations (Bar, Kitchen, ...) from the floor layout. An item only
  // reaches a Kitchen/Bar display when its category routes to that station,
  // so this page is where an imported menu comes alive on the screens.
  const { stations } = useFloorLayout();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['modifier-groups'] });
    qc.invalidateQueries({ queryKey: ['products-pos'] });
    qc.invalidateQueries({ queryKey: ['categories'] });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/pos/products"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold">Categories</h1>
          <p className="text-sm text-muted-foreground">
            Bind modifier groups to a category so every product in it gets them
            automatically — and route each category to a prep station. Orders only
            appear on the Kitchen or Bar screen when their category is routed there.
          </p>
        </div>
      </div>

      <PrepScreensPanel stations={stations} categories={categories} onChange={invalidate} />

      {categories.length === 0 ? (
        <div className="border border-border rounded-2xl p-8 text-center text-sm text-muted-foreground">
          No categories yet. Create one from the Products page.
        </div>
      ) : (
        <div className="space-y-3">
          {categories.map((c) => {
            const bound = allGroups.filter((g) => g.categoryId === c.id);
            const isOpen = expanded === c.id;
            return (
              <CategoryCard
                key={c.id}
                category={c}
                stations={stations}
                boundGroups={bound}
                tenantGroups={allGroups.filter((g) => !g.categoryId)}
                isOpen={isOpen}
                onToggle={() => setExpanded(isOpen ? null : c.id)}
                onChange={invalidate}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}


/* ─── Prep Screens panel — tick which categories each screen makes ────────── */

/**
 * Station-centric routing, the way an owner thinks about it: "Kitchen makes
 * the meals and pasta; Bar makes the drinks." One card per prep screen, tick
 * the categories that belong to it.
 *
 * A category can only feed ONE screen (it is a single pointer on the
 * category), so ticking it on Kitchen moves it off Bar rather than duplicating
 * the ticket — moving, not copying, is almost always what a shop means.
 * Unticking sends it nowhere, which is right for grab-and-go items nobody has
 * to make.
 */
function PrepScreensPanel({
  stations,
  categories,
  onChange,
}: {
  stations: Array<{ id: string; name: string }>;
  categories: Category[];
  onChange: () => void;
}) {
  const { mutate: route, isPending } = useMutation({
    mutationFn: ({ categoryId, stationId }: { categoryId: string; stationId: string | null }) =>
      api.patch(`/categories/${categoryId}`, { stationId }),
    onSuccess: (_d, v) => {
      onChange();
      const cat = categories.find((c) => c.id === v.categoryId);
      const st = stations.find((s) => s.id === v.stationId);
      toast.success(
        st
          ? `"${cat?.name}" orders now appear on the ${st.name} screen.`
          : `"${cat?.name}" no longer goes to a prep screen.`,
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update routing.'),
  });

  if (stations.length === 0) {
    return (
      <div className="border border-border rounded-2xl p-5 text-sm text-muted-foreground">
        No prep screens yet.{' '}
        <Link href="/settings/floor-layout" className="text-primary hover:underline">
          Set up your Bar / Kitchen screens
        </Link>{' '}
        first, then come back here to choose what each one makes.
      </div>
    );
  }

  const unrouted = categories.filter((c) => !c.stationId);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MonitorSpeaker className="h-4 w-4 text-muted-foreground" />
          Prep screens
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Tick the categories each screen makes. Orders only appear on a Kitchen or Bar display
          when their category is ticked here. A category can feed one screen — ticking it on
          another moves it.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {stations.map((st) => (
          <div key={st.id} className="border border-border rounded-2xl p-4">
            <p className="font-medium text-foreground mb-2.5">{st.name}</p>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => {
                const here = c.stationId === st.id;
                return (
                  <button
                    key={c.id}
                    disabled={isPending}
                    onClick={() =>
                      route({ categoryId: c.id, stationId: here ? null : st.id })
                    }
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60 ${
                      here
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                        : 'bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                    }`}
                  >
                    {here ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {unrouted.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Not on any screen (nobody has to make them):{' '}
          {unrouted.map((c) => c.name).join(', ')}
        </p>
      )}
    </div>
  );
}

interface CardProps {
  category: Category;
  stations: Array<{ id: string; name: string }>;
  boundGroups: ModifierGroup[];
  tenantGroups: ModifierGroup[];
  isOpen: boolean;
  onToggle: () => void;
  onChange: () => void;
}

function CategoryCard({ category, stations, boundGroups, tenantGroups, isOpen, onToggle, onChange }: CardProps) {
  const [creating, setCreating] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [name, setName] = useState('');
  const [required, setRequired] = useState(false);
  const [multi, setMulti] = useState(false);
  const [pickGroupId, setPickGroupId] = useState('');

  const { mutate: createGroup, isPending: createPending } = useMutation({
    mutationFn: () =>
      api.post('/modifiers/groups', {
        name: name.trim(),
        required,
        multiSelect: multi,
        categoryId: category.id,
      }),
    onSuccess: () => {
      setName('');
      setRequired(false);
      setMulti(false);
      setCreating(false);
      onChange();
      toast.success('Group created for category');
    },
    onError: () => toast.error('Failed to create modifier group'),
  });

  // "Attach existing" = take a tenant-level group (categoryId === null) and
  // bind it to this category. Implementation = PATCH categoryId on the group.
  const { mutate: bindExisting, isPending: bindPending } = useMutation({
    mutationFn: (groupId: string) =>
      api.patch(`/modifiers/groups/${groupId}`, { categoryId: category.id }),
    onSuccess: () => {
      setPickGroupId('');
      setAttaching(false);
      onChange();
      toast.success('Group bound to category');
    },
    onError: () => toast.error('Failed to bind group'),
  });

  const { mutate: unbind } = useMutation({
    mutationFn: (groupId: string) =>
      api.patch(`/modifiers/groups/${groupId}`, { categoryId: null }),
    onSuccess: () => {
      onChange();
      toast.success('Group unbound from category');
    },
    onError: () => toast.error('Failed to unbind group'),
  });

  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      <div className="w-full flex items-center gap-3 px-5 py-4">
        <button onClick={onToggle} className="flex-1 flex items-center justify-between text-left hover:opacity-80 transition-opacity">
          <div>
            <p className="font-medium text-foreground">{category.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {boundGroups.length === 0
                ? 'No modifier groups'
                : `${boundGroups.length} modifier group${boundGroups.length > 1 ? 's' : ''}`}
            </p>
          </div>
          {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {/* Prep-station route. Outside the toggle button so changing it does
            not expand/collapse the card. */}
        {/* Routing is edited in the Prep Screens panel above; this is just
            the at-a-glance answer to "where do these orders go?". */}
        <span className={`shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full ${
          category.stationId
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground'
        }`}>
          <MonitorSpeaker className="h-3 w-3" />
          {stations.find((st) => st.id === category.stationId)?.name ?? 'No prep screen'}
        </span>
      </div>

      {isOpen && (
        <div className="border-t border-border p-5 space-y-4 bg-muted/10">
          {/* Bound groups */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Bound modifier groups
            </h4>
            {boundGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">None yet.</p>
            ) : (
              <div className="space-y-2">
                {boundGroups.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{g.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {g.options.length} option{g.options.length === 1 ? '' : 's'}
                        {g.required ? ' · required' : ''}
                        {g.multiSelect ? ' · multi-select' : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => unbind(g.id)}
                      className="text-muted-foreground hover:text-red-400 transition-colors"
                      title="Unbind from category (group stays tenant-wide)"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            {!creating && !attaching && (
              <>
                <button
                  onClick={() => setCreating(true)}
                  className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
                  style={{ color: 'var(--counter-primary)' }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New group for this category
                </button>
                {tenantGroups.length > 0 && (
                  <button
                    onClick={() => setAttaching(true)}
                    className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:opacity-80"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Attach existing group
                  </button>
                )}
              </>
            )}
          </div>

          {/* Create form */}
          {creating && (
            <div className="border border-border rounded-xl p-4 space-y-3 bg-background">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  New group
                </p>
                <button onClick={() => setCreating(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Group name (e.g. Size, Milk type)"
                className={INPUT_CLS}
              />
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="rounded" />
                  <span className="text-foreground">Required</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="rounded" />
                  <span className="text-foreground">Allow multiple</span>
                </label>
              </div>
              <button
                onClick={() => name.trim() && createGroup()}
                disabled={!name.trim() || createPending}
                className="w-full text-sm text-white rounded-lg py-2 font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                style={{ background: 'var(--counter-primary)' }}
              >
                {createPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          )}

          {/* Attach existing form */}
          {attaching && (
            <div className="border border-border rounded-xl p-4 space-y-3 bg-background">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Attach existing group
                </p>
                <button onClick={() => setAttaching(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Only groups not yet bound to a category are listed. Binding here turns
                a tenant-level group into a category-managed one.
              </p>
              <select
                value={pickGroupId}
                onChange={(e) => setPickGroupId(e.target.value)}
                className={INPUT_CLS}
              >
                <option value="">— Pick a group —</option>
                {tenantGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <button
                onClick={() => pickGroupId && bindExisting(pickGroupId)}
                disabled={!pickGroupId || bindPending}
                className="w-full text-sm text-white rounded-lg py-2 font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                style={{ background: 'var(--counter-primary)' }}
              >
                {bindPending ? 'Binding…' : 'Bind to category'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

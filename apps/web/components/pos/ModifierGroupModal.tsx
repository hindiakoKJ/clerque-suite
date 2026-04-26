'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical, X, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number | string;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
}

interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  options: ModifierOption[];
  _count: { products: number };
}

interface ProductModifierGroup {
  modifierGroupId: string;
  sortOrder: number;
  modifierGroup: ModifierGroup & { options: ModifierOption[] };
}

interface Props {
  productId: string;
  productName: string;
  onClose: () => void;
}

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

export function ModifierGroupModal({ productId, productName, onClose }: Props) {
  const qc = useQueryClient();
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupRequired, setNewGroupRequired] = useState(false);
  const [newGroupMulti, setNewGroupMulti] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [newOptionName, setNewOptionName] = useState('');
  const [newOptionPrice, setNewOptionPrice] = useState('');

  // All modifier groups for this tenant
  const { data: allGroups = [] } = useQuery<ModifierGroup[]>({
    queryKey: ['modifier-groups'],
    queryFn: () => api.get('/modifiers/groups').then((r) => r.data),
    staleTime: 30_000,
  });

  // Groups already attached to this product
  const { data: attached = [] } = useQuery<ProductModifierGroup[]>({
    queryKey: ['product-modifier-groups', productId],
    queryFn: () => api.get(`/modifiers/products/${productId}/groups`).then((r) => r.data),
    staleTime: 15_000,
  });

  const attachedIds = new Set(attached.map((a) => a.modifierGroupId));
  const unattached = allGroups.filter((g) => !attachedIds.has(g.id));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['modifier-groups'] });
    qc.invalidateQueries({ queryKey: ['product-modifier-groups', productId] });
    qc.invalidateQueries({ queryKey: ['products-pos'] });
  };

  const { mutate: attachGroup } = useMutation({
    mutationFn: (groupId: string) =>
      api.post(`/modifiers/products/${productId}/groups/${groupId}`),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to attach modifier group'),
  });

  const { mutate: detachGroup } = useMutation({
    mutationFn: (groupId: string) =>
      api.delete(`/modifiers/products/${productId}/groups/${groupId}`),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to remove modifier group'),
  });

  const { mutate: createGroup, isPending: creatingGroupPending } = useMutation({
    mutationFn: () =>
      api.post('/modifiers/groups', {
        name: newGroupName.trim(),
        required: newGroupRequired,
        multiSelect: newGroupMulti,
      }).then((r) => r.data),
    onSuccess: (group: ModifierGroup) => {
      setNewGroupName('');
      setNewGroupRequired(false);
      setNewGroupMulti(false);
      setCreatingGroup(false);
      invalidate();
      // Auto-attach the new group to this product
      attachGroup(group.id);
    },
    onError: () => toast.error('Failed to create modifier group'),
  });

  const { mutate: addOption, isPending: addingOption } = useMutation({
    mutationFn: ({ groupId }: { groupId: string }) =>
      api.post(`/modifiers/groups/${groupId}/options`, {
        name: newOptionName.trim(),
        priceAdjustment: parseFloat(newOptionPrice) || 0,
      }),
    onSuccess: () => {
      setNewOptionName('');
      setNewOptionPrice('');
      invalidate();
    },
    onError: () => toast.error('Failed to add option'),
  });

  const { mutate: deleteOption } = useMutation({
    mutationFn: ({ groupId, optionId }: { groupId: string; optionId: string }) =>
      api.delete(`/modifiers/groups/${groupId}/options/${optionId}`),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to delete option'),
  });

  return (
    <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-foreground">Modifier Groups</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{productName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Attached groups */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Attached to this product
            </h3>
            {attached.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No modifier groups yet.</p>
            ) : (
              <div className="space-y-2">
                {attached.map(({ modifierGroup: g }) => (
                  <div key={g.id} className="border border-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3">
                      <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{g.name}</p>
                        <div className="flex gap-2 mt-0.5">
                          {g.required && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                              REQUIRED
                            </span>
                          )}
                          {g.multiSelect && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                              MULTI-SELECT
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setExpandedGroup(expandedGroup === g.id ? null : g.id)}
                        className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                      >
                        {expandedGroup === g.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => detachGroup(g.id)}
                        className="text-muted-foreground hover:text-red-400 p-1 transition-colors"
                        title="Remove from product"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Options list (expanded) */}
                    {expandedGroup === g.id && (
                      <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-2">
                        {g.options.map((opt) => (
                          <div key={opt.id} className="flex items-center gap-2 text-sm">
                            <span className="flex-1 text-foreground">{opt.name}</span>
                            <span className="text-muted-foreground tabular-nums">
                              {Number(opt.priceAdjustment) > 0 ? `+₱${Number(opt.priceAdjustment).toFixed(2)}` : '—'}
                            </span>
                            {opt.isDefault && (
                              <span className="text-[10px] font-semibold text-[var(--accent)]">DEFAULT</span>
                            )}
                            <button
                              onClick={() => deleteOption({ groupId: g.id, optionId: opt.id })}
                              className="text-muted-foreground hover:text-red-400 transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        {/* Add option inline */}
                        <div className="flex gap-2 pt-1">
                          <input
                            value={newOptionName}
                            onChange={(e) => setNewOptionName(e.target.value)}
                            placeholder="Option name (e.g. Large)"
                            className="flex-1 h-8 text-xs rounded-lg border border-border bg-background px-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                          />
                          <input
                            type="number"
                            value={newOptionPrice}
                            onChange={(e) => setNewOptionPrice(e.target.value)}
                            placeholder="+₱0"
                            className="w-20 h-8 text-xs rounded-lg border border-border bg-background px-2 text-right text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                          />
                          <button
                            onClick={() =>
                              newOptionName.trim() && addOption({ groupId: g.id })
                            }
                            disabled={!newOptionName.trim() || addingOption}
                            className="h-8 px-3 text-xs font-medium text-white rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
                            style={{ background: 'var(--accent)' }}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attach existing group */}
          {unattached.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Add existing group
              </h3>
              <div className="flex flex-wrap gap-2">
                {unattached.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => attachGroup(g.id)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border text-foreground hover:bg-muted transition-colors"
                  >
                    + {g.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create new group */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Create new group
            </h3>
            {!creatingGroup ? (
              <button
                onClick={() => setCreatingGroup(true)}
                className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
                style={{ color: 'var(--accent)' }}
              >
                <Plus className="h-3.5 w-3.5" />
                New modifier group
              </button>
            ) : (
              <div className="border border-border rounded-xl p-4 space-y-3">
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Group name (e.g. Size, Add-ons, Temperature)"
                  className={INPUT_CLS}
                />
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newGroupRequired}
                      onChange={(e) => setNewGroupRequired(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-foreground">Required</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newGroupMulti}
                      onChange={(e) => setNewGroupMulti(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-foreground">Allow multiple</span>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCreatingGroup(false)}
                    className="flex-1 text-sm border border-border text-muted-foreground rounded-lg py-2 hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => newGroupName.trim() && createGroup()}
                    disabled={!newGroupName.trim() || creatingGroupPending}
                    className="flex-1 text-sm text-white rounded-lg py-2 font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                    style={{ background: 'var(--accent)' }}
                  >
                    {creatingGroupPending ? 'Creating…' : 'Create & Attach'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

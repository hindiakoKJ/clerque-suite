'use client';

/**
 * StaffPermissionEditor — RBAC Phase 5 surface.
 *
 * Renders four sections:
 *   1. Persona dropdown (12 templates from PERSONAS, filtered by tenant tier)
 *   2. Effective permissions list — read-only summary of what role+persona grants
 *   3. Advanced toggles for the full 38-permission matrix, with state badges:
 *        ☑  — granted via role default
 *        🟢 — granted via custom override (added)
 *        🟡 — SOD warning if granted
 *        🔴 — SOD block if granted
 *        🔒 — tier-locked (shown but disabled)
 *   4. Inline SOD warnings for the FINAL permission set
 *
 * Parent owns the form state; this component is controlled.
 */

import { useMemo } from 'react';
import {
  PERSONAS,
  PERMISSION_MATRIX,
  TIERS,
  detectViolations,
  isPersonaAvailableAtTier,
  isPermissionAvailableAtTier,
  type PersonaKey,
  type PermissionKey,
  type TierId,
  type UserRole,
} from '@repo/shared-types';
import { ShieldAlert, Lock, AlertTriangle, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface Props {
  role: UserRole;
  tier: TierId;
  personaKey: string | null;
  customPermissions: string[];
  onPersonaChange: (key: string | null) => void;
  onCustomPermissionsChange: (perms: string[]) => void;
}

const ALL_PERMISSIONS = Object.keys(PERMISSION_MATRIX) as PermissionKey[];

function permissionDomain(perm: PermissionKey): string {
  return perm.split(':')[0];
}

export function StaffPermissionEditor({
  role,
  tier,
  personaKey,
  customPermissions,
  onPersonaChange,
  onCustomPermissionsChange,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Personas filtered by tier
  const availablePersonas = useMemo(
    () => Object.values(PERSONAS).filter((p) => isPersonaAvailableAtTier(p.key, tier)),
    [tier],
  );

  // Effective permission set = role default + custom additions.
  // For UI clarity we don't merge persona extra-perms into "role default" —
  // those are handled when applying a persona via onPersonaChange (parent
  // is expected to also push the persona's extraPermissions into customPermissions).
  const rolePermissions = useMemo(() => {
    return ALL_PERMISSIONS.filter((p) =>
      (PERMISSION_MATRIX[p] as readonly string[]).includes(role),
    );
  }, [role]);

  const customSet = useMemo(() => new Set(customPermissions), [customPermissions]);
  const finalSet  = useMemo(() => {
    const s = new Set<PermissionKey>(rolePermissions);
    customPermissions.forEach((p) => s.add(p as PermissionKey));
    return s;
  }, [rolePermissions, customPermissions]);

  const violations = useMemo(
    () => detectViolations(role, [...finalSet]),
    [role, finalSet],
  );
  const blockingCount = violations.filter((v) => v.rule.severity === 'BLOCK').length;
  const warningCount  = violations.filter((v) => v.rule.severity === 'WARN').length;

  function togglePermission(perm: PermissionKey) {
    if (rolePermissions.includes(perm)) return; // already granted by role; not a custom toggle
    if (!isPermissionAvailableAtTier(perm, tier)) return; // tier-locked
    const next = customSet.has(perm)
      ? customPermissions.filter((p) => p !== perm)
      : [...customPermissions, perm];
    onCustomPermissionsChange(next);
  }

  // Group permissions by domain for display
  const grouped = useMemo(() => {
    const map: Record<string, PermissionKey[]> = {};
    for (const p of ALL_PERMISSIONS) {
      const d = permissionDomain(p);
      (map[d] ??= []).push(p);
    }
    return map;
  }, []);

  return (
    <div className="space-y-4">
      {/* Persona picker */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Persona template
        </label>
        <select
          value={personaKey ?? ''}
          onChange={(e) => onPersonaChange(e.target.value || null)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <option value="">— No persona (use role default) —</option>
          {availablePersonas.map((p) => (
            <option key={p.key} value={p.key}>
              {p.displayName} — {p.description}
            </option>
          ))}
        </select>
        {personaKey && (
          <p className="text-[11px] text-muted-foreground">
            Persona presets a starter permission set. Use Advanced below to fine-tune.
          </p>
        )}
      </div>

      {/* SOD summary */}
      {(blockingCount > 0 || warningCount > 0) && (
        <div className={`rounded-lg border px-3 py-2 ${
          blockingCount > 0
            ? 'border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800'
            : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700'
        }`}>
          <div className="flex items-start gap-2">
            <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${blockingCount > 0 ? 'text-red-600' : 'text-amber-600'}`} />
            <div className="text-xs space-y-1">
              <p className={`font-bold ${blockingCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {blockingCount > 0
                  ? `${blockingCount} blocking violation${blockingCount > 1 ? 's' : ''}`
                  : `${warningCount} warning${warningCount > 1 ? 's' : ''}`}
              </p>
              {violations.map((v) => (
                <div key={v.rule.key} className="text-foreground">
                  <span className={`font-mono text-[10px] px-1 py-0.5 rounded mr-1 ${
                    v.rule.severity === 'BLOCK' ? 'bg-red-200 dark:bg-red-900 text-red-900 dark:text-red-200'
                                                : 'bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200'
                  }`}>{v.rule.severity}</span>
                  <span className="font-semibold">{v.rule.description}</span>
                  <span className="text-muted-foreground"> — {v.rule.recommendation}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Advanced expander */}
      <div className="border border-border rounded-lg">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-foreground hover:bg-secondary transition-colors rounded-lg"
        >
          <span>Advanced permissions ({customPermissions.length} custom)</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
        </button>

        {advancedOpen && (
          <div className="px-3 pb-3 space-y-3 max-h-80 overflow-y-auto">
            {Object.entries(grouped).map(([domain, perms]) => (
              <div key={domain} className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold pt-1">
                  {domain}
                </p>
                {perms.map((perm) => {
                  const inRole       = rolePermissions.includes(perm);
                  const inCustom     = customSet.has(perm);
                  const tierLocked   = !isPermissionAvailableAtTier(perm, tier);
                  const isGranted    = inRole || inCustom;
                  return (
                    <label
                      key={perm}
                      className={`flex items-center gap-2 text-xs py-1 px-1.5 rounded transition-colors ${
                        tierLocked    ? 'opacity-50 cursor-not-allowed'
                        : inRole      ? 'cursor-default'
                                      : 'hover:bg-secondary cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={inRole || tierLocked}
                        checked={isGranted}
                        onChange={() => togglePermission(perm)}
                        className="rounded border-border accent-[var(--accent)]"
                      />
                      <code className={`font-mono ${isGranted ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {perm}
                      </code>
                      {inRole       && <span className="ml-auto text-[9px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-bold">role</span>}
                      {!inRole && inCustom && <span className="ml-auto text-[9px] uppercase tracking-wide text-blue-600 dark:text-blue-400 font-bold">custom</span>}
                      {tierLocked && (
                        <span className="ml-auto inline-flex items-center gap-1 text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-bold">
                          <Lock className="w-2.5 h-2.5" />
                          tier
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground pt-2 border-t border-border">
              Tier-locked permissions need {TIERS.TIER_4.displayName} or higher to enable.
              Role defaults can't be removed — they come with the role.
            </p>
          </div>
        )}
      </div>

      {blockingCount > 0 && (
        <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>This combination cannot be saved until the blocking violation is resolved.</span>
        </div>
      )}
    </div>
  );
}

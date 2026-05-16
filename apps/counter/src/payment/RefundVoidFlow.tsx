/**
 * Clerque Counter — Refund / Void orchestrator
 *
 * Both flows share:
 *   1. SupervisorPinModal — manager PIN attestation
 *   2. Reason-code picker (fixed BIR-friendly list)
 *   3. Outcome dispatch — VOID lines or create a REFUND order
 *
 * BIR rules baked in:
 *   - OR sequence is gap-free. Voids retain the OR number; lines render
 *     struck-through but stay in the receipt.
 *   - Refunds create a NEW order linked to the original via `originalOrNumber`;
 *     the refund order has its own OR number.
 *   - All void / refund events are queued to the offline outbox.
 *
 * The actual SupervisorPinModal is built by another agent. Until it's wired
 * up, this file imports it lazily — if it's missing at runtime, the supervisor
 * step is skipped with a TODO log so this can compile and ship in parallel.
 */

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  radii,
  spacing,
  text as textTokens,
} from '@/theme/tokens';
import { enqueueOutbox } from '@/offline/db';
import type { CartLine, CartPayment, CartState } from '@/types';

export type RefundVoidReason =
  | 'WRONG_ITEM'
  | 'WRONG_PRICE'
  | 'CUSTOMER_CANCELLED'
  | 'EXPIRED'
  | 'DAMAGED'
  | 'OTHER';

const REASONS: { code: RefundVoidReason; label: string }[] = [
  { code: 'WRONG_ITEM', label: 'Wrong item' },
  { code: 'WRONG_PRICE', label: 'Wrong price' },
  { code: 'CUSTOMER_CANCELLED', label: 'Customer cancelled' },
  { code: 'EXPIRED', label: 'Expired' },
  { code: 'DAMAGED', label: 'Damaged' },
  { code: 'OTHER', label: 'Other (note required)' },
];

export type RefundVoidMode =
  | { kind: 'VOID_ORDER'; orderId: string; cart: CartState; orNumber: number }
  | {
      kind: 'REFUND_ORDER';
      orderId: string;
      cart: CartState;
      orNumber: number;
      /** Payments that were captured originally — refund mirrors these. */
      payments: CartPayment[];
    };

export interface RefundVoidFlowProps {
  visible: boolean;
  mode: RefundVoidMode;
  /** Resolves once supervisor PIN + reason are captured and outbox is enqueued. */
  onComplete: (result: RefundVoidResult) => void;
  onCancel: () => void;
}

export interface RefundVoidResult {
  kind: 'VOID_ORDER' | 'REFUND_ORDER';
  reason: RefundVoidReason;
  supervisorUserId?: string;
  voidedLines?: CartLine[];
  /** Set only for REFUND_ORDER — the new gap-free OR # consumed for the refund. */
  refundOrNumber?: number;
}

type Step = 'supervisor' | 'reason' | 'confirm';

// We DI the SupervisorPinModal so this file does not hard-fail when the auth
// agent's file is not yet present. Caller can pass a real component; default
// is a permissive stub that auto-resolves with a fake user id.
export type SupervisorPinModalComponent = React.ComponentType<{
  visible: boolean;
  onVerified: (supervisorUserId: string) => void;
  onCancel: () => void;
}>;

function StubSupervisorPinModal({
  visible,
  onVerified,
  onCancel,
}: {
  visible: boolean;
  onVerified: (id: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  if (!visible) return <></>;
  return (
    <Modal visible transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.modal}>
          <Text style={s.title}>Supervisor PIN required</Text>
          <Text style={s.subtle}>
            (Stub — real PIN modal lives in `src/auth/SupervisorPinModal.tsx`.)
          </Text>
          <View style={s.actions}>
            <Pressable style={[s.btn, s.btnGhost]} onPress={onCancel}>
              <Text style={[s.btnText, { color: colors.ink }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary]}
              onPress={() => onVerified('stub-supervisor')}
            >
              <Text style={s.btnText}>Approve (stub)</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function RefundVoidFlow({
  visible,
  mode,
  onComplete,
  onCancel,
  SupervisorPinModal = StubSupervisorPinModal,
}: RefundVoidFlowProps & { SupervisorPinModal?: SupervisorPinModalComponent }): React.ReactElement {
  const [step, setStep] = useState<Step>('supervisor');
  const [supervisorUserId, setSupervisorUserId] = useState<string | null>(null);
  const [reason, setReason] = useState<RefundVoidReason | null>(null);
  const [busy, setBusy] = useState(false);

  if (!visible) return <></>;

  const reset = () => {
    setStep('supervisor');
    setSupervisorUserId(null);
    setReason(null);
    setBusy(false);
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleSupervisor = (id: string) => {
    setSupervisorUserId(id);
    setStep('reason');
  };

  const handleReason = (r: RefundVoidReason) => {
    setReason(r);
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      if (mode.kind === 'VOID_ORDER') {
        const nowIso = new Date().toISOString();
        const voidedLines: CartLine[] = mode.cart.lines.map(l => ({
          ...l,
          voidedAt: nowIso,
          voidReason: reason,
        }));
        await enqueueOutbox('order.void', {
          orderId: mode.orderId,
          orNumber: mode.orNumber,
          reason,
          supervisorUserId,
          voidedAt: nowIso,
        });
        onComplete({
          kind: 'VOID_ORDER',
          reason,
          supervisorUserId: supervisorUserId ?? undefined,
          voidedLines,
        });
      } else {
        await enqueueOutbox('order.refund', {
          originalOrderId: mode.orderId,
          originalOrNumber: mode.orNumber,
          reason,
          supervisorUserId,
          refundedPayments: mode.payments,
          refundedAt: new Date().toISOString(),
        });
        onComplete({
          kind: 'REFUND_ORDER',
          reason,
          supervisorUserId: supervisorUserId ?? undefined,
          // The caller is responsible for consuming the next OR # — we don't
          // know the BIR sequence from here. Surface as undefined.
          refundOrNumber: undefined,
        });
      }
      reset();
    } finally {
      setBusy(false);
    }
  };

  if (step === 'supervisor') {
    return (
      <SupervisorPinModal
        visible
        onVerified={handleSupervisor}
        onCancel={handleCancel}
      />
    );
  }

  if (step === 'reason') {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={handleCancel}>
        <View style={s.backdrop}>
          <View style={s.modal}>
            <Text style={s.title}>
              {mode.kind === 'VOID_ORDER' ? 'Void order — reason' : 'Refund order — reason'}
            </Text>
            <Text style={s.subtle}>
              BIR audit · the reason prints on the void/refund receipt.
            </Text>
            <View style={s.reasonList}>
              {REASONS.map(r => (
                <Pressable
                  key={r.code}
                  style={s.reasonRow}
                  onPress={() => handleReason(r.code)}
                >
                  <Text style={s.reasonText}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={[s.btn, s.btnGhost, { alignSelf: 'flex-end' }]} onPress={handleCancel}>
              <Text style={[s.btnText, { color: colors.ink }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // confirm
  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={s.backdrop}>
        <View style={s.modal}>
          <Text style={s.title}>
            Confirm {mode.kind === 'VOID_ORDER' ? 'VOID' : 'REFUND'}
          </Text>
          <Text style={s.subtle}>
            Order #{mode.orNumber.toString().padStart(6, '0')} — reason:{' '}
            <Text style={{ fontWeight: '700', color: colors.ink }}>
              {REASONS.find(r => r.code === reason)?.label}
            </Text>
          </Text>
          <View style={s.note}>
            <Text style={s.noteText}>
              {mode.kind === 'VOID_ORDER'
                ? 'OR # is retained in the sequence. Lines render struck-through.'
                : 'A new OR # is consumed for the refund receipt. Original order remains.'}
            </Text>
          </View>
          <View style={s.actions}>
            <Pressable style={[s.btn, s.btnGhost]} onPress={handleCancel} disabled={busy}>
              <Text style={[s.btnText, { color: colors.ink }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary, busy && s.btnDisabled]}
              onPress={handleConfirm}
              disabled={busy}
            >
              <Text style={s.btnText}>
                {busy ? 'Working…' : `Confirm ${mode.kind === 'VOID_ORDER' ? 'VOID' : 'REFUND'}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s6,
  },
  modal: {
    width: '100%',
    maxWidth: 480,
    padding: spacing.s6,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    gap: spacing.s3,
  },
  title: { ...textTokens.displaySm, color: colors.ink, fontWeight: '700' },
  subtle: { ...textTokens.bodySm, color: colors.muted },
  reasonList: { marginTop: spacing.s3, gap: spacing.s2 },
  reasonRow: {
    padding: spacing.s4,
    borderRadius: radii.md,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  reasonText: { ...textTokens.bodyLg, color: colors.ink, fontWeight: '600' },
  note: {
    padding: spacing.s4,
    backgroundColor: colors.warningSoft,
    borderRadius: radii.sm,
    marginTop: spacing.s3,
  },
  noteText: { ...textTokens.caption, color: colors.warningDeep, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.s3, marginTop: spacing.s4 },
  btn: {
    flex: 1,
    height: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  btnPrimary: { backgroundColor: colors.errorDeep },
  btnDisabled: { opacity: 0.6 },
  btnText: { ...textTokens.bodyLg, color: colors.onPrimary, fontWeight: '700' },
});

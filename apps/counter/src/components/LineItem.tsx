import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { colors, spacing, radii, text as textTokens, tnum } from '@/theme/tokens';
import { CartLine } from '@/types';
import Money from './Money';
import Pill from './Pill';

interface LineItemProps {
  line: CartLine;
  onLongPress?: (line: CartLine) => void;
  onSwipeRemove?: (line: CartLine) => void;
  onQtyChange?: (line: CartLine, qty: number) => void;
  /** Optional status pill rendered under the line (e.g., FB kitchen status). */
  statusPill?: React.ReactNode;
  /** Optional SKU / barcode shown above the line name (used by Retail). */
  codeLabel?: string;
  /** Optional 18+ marker (Retail). */
  ageRestricted?: boolean;
}

const KITCHEN_LABEL: Record<NonNullable<CartLine['kitchenStatus']>, { tone: 'success' | 'warning' | 'info' | 'neutral'; text: string }> = {
  NEW:    { tone: 'warning', text: 'Not fired yet' },
  FIRED:  { tone: 'success', text: 'Fired to bar' },
  READY:  { tone: 'info', text: 'Ready' },
  SERVED: { tone: 'neutral', text: 'Served' },
};

export default function LineItem({ line, onLongPress, onSwipeRemove, statusPill, codeLabel, ageRestricted }: LineItemProps) {
  const swipeRef = useRef<Swipeable>(null);
  const voided = !!line.voidedAt;
  const removed = !!line.removed;

  const renderRightActions = () => (
    <View style={styles.swipeAction}>
      <Text style={styles.swipeActionText}>Remove</Text>
    </View>
  );

  const inferredPill = !statusPill && line.kitchenStatus ? KITCHEN_LABEL[line.kitchenStatus] : null;

  const content = (
    <Pressable
      onLongPress={() => onLongPress?.(line)}
      delayLongPress={500}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.creamSoft }]}
    >
      <View style={styles.left}>
        {codeLabel && <Text style={styles.code}>{codeLabel}</Text>}
        <View style={styles.nameRow}>
          <Text
            style={[
              styles.name,
              (voided || removed) && styles.struck,
            ]}
            numberOfLines={2}
          >
            {line.qty}× {line.productName}
            {line.variantName ? ` · ${line.variantName}` : ''}
          </Text>
          {ageRestricted && (
            <View style={styles.ageBadge}>
              <Text style={styles.ageBadgeText}>18+</Text>
            </View>
          )}
        </View>
        {line.modifiers.length > 0 && (
          <Text style={styles.mods}>
            {line.modifiers
              .map((m) => m.priceAdjustment ? `${m.optionName} +₱${(m.priceAdjustment / 100).toFixed(0)}` : m.optionName)
              .join(' · ')}
          </Text>
        )}
        {line.discount && (
          <Text style={styles.disc}>
            {line.discount.kind === 'SENIOR' ? 'Senior 20%' : line.discount.kind === 'PWD' ? 'PWD 20%' : `Manual ${line.discount.percent ?? 0}%`}
          </Text>
        )}
        {statusPill ?? (inferredPill && (
          <View style={{ marginTop: spacing.s2 }}>
            <Pill tone={inferredPill.tone} dot>{inferredPill.text}</Pill>
          </View>
        ))}
        {voided && (
          <View style={{ marginTop: spacing.s2 }}>
            <Pill tone="error">VOIDED · {line.voidReason ?? ''}</Pill>
          </View>
        )}
      </View>
      <View style={styles.right}>
        <Money
          cents={line.lineTotal}
          style={[
            styles.price,
            (voided || removed) && styles.struck,
          ]}
        />
      </View>
    </Pressable>
  );

  if (!onSwipeRemove || voided) return content;

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      onSwipeableOpen={() => {
        swipeRef.current?.close();
        Alert.alert('Remove line?', `Remove ${line.productName}?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => onSwipeRemove(line) },
        ]);
      }}
      overshootRight={false}
    >
      {content}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: spacing.s4,
    gap: spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  left: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', justifyContent: 'flex-start' },
  code: {
    ...textTokens.mono,
    fontSize: 10,
    color: colors.muted,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2, flexWrap: 'wrap' },
  name: { ...textTokens.body, fontWeight: '600', flexShrink: 1 },
  mods: { ...textTokens.bodySm, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
  disc: { ...textTokens.caption, color: colors.successDeep, marginTop: 2 },
  price: { ...textTokens.body, ...tnum, fontWeight: '700', color: colors.primary },
  struck: { textDecorationLine: 'line-through', color: colors.faint },
  swipeAction: {
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.s5,
    width: 120,
  },
  swipeActionText: { color: colors.onPrimary, fontWeight: '700' },
  ageBadge: {
    backgroundColor: colors.error,
    borderRadius: radii.xs,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  ageBadgeText: { color: colors.onPrimary, fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
});

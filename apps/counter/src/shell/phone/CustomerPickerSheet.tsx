/**
 * Customer picker — modal sheet for the phone cart.
 *
 * Lazy-searches /customers?search=… (300ms debounce). Selecting a row
 * writes the customer into the cart store; the price-list resolver
 * downstream will re-price lines if the customer is on a wholesale list.
 * "None" clears the customer.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { colors, fonts, radii, spacing, text as textTokens } from '@/theme';

export interface CustomerRow {
  id: string;
  name: string;
  phone?: string;
  tin?: string;
  priceListId?: string | null;
}

interface ApiCustomerRow {
  id: string;
  name: string;
  phone?: string | null;
  tin?: string | null;
  priceListId?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (c: CustomerRow | null) => void;
  currentName?: string;
}

export default function CustomerPickerSheet({ visible, onClose, onPick, currentName }: Props): React.ReactElement {
  const [query, setQuery]       = useState('');
  const [rows, setRows]         = useState<CustomerRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Debounced search.
  useEffect(() => {
    if (!visible) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<ApiCustomerRow[]>(
          `/customers${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ''}`,
        );
        setRows((data ?? []).map(r => ({
          id: r.id,
          name: r.name,
          phone: r.phone ?? undefined,
          tin: r.tin ?? undefined,
          priceListId: r.priceListId ?? null,
        })));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
        setRows([]);
      } finally {
        setLoading(false);
      }
    }, query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [query, visible]);

  // Reset query on close so reopening starts fresh.
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setRows([]);
      setError(null);
    }
  }, [visible]);

  const empty = useMemo(() => !loading && !error && rows.length === 0, [loading, error, rows.length]);

  const pick = useCallback((c: CustomerRow | null) => {
    onPick(c);
    onClose();
  }, [onPick, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => { /* swallow */ }}>
          <View style={s.handle} />
          <View style={s.headerRow}>
            <Text style={s.title}>Add customer</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>

          <View style={s.searchWrap}>
            <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name or phone"
              placeholderTextColor={colors.faint}
              style={s.searchInput}
              autoFocus
              returnKeyType="search"
            />
          </View>

          {/* None / clear */}
          <Pressable onPress={() => pick(null)} style={({ pressed }) => [s.row, pressed && s.rowPressed]}>
            <View style={[s.avatar, { backgroundColor: colors.creamSoft }]}>
              <MaterialCommunityIcons name="account-off-outline" size={18} color={colors.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowName}>No customer</Text>
              <Text style={s.rowSub}>Walk-in sale</Text>
            </View>
            {!currentName ? <MaterialCommunityIcons name="check" size={20} color={colors.primary} /> : null}
          </Pressable>

          {loading ? (
            <View style={s.state}><ActivityIndicator color={colors.primary} /></View>
          ) : error ? (
            <View style={s.state}><Text style={s.errorText}>{error}</Text></View>
          ) : empty && query ? (
            <View style={s.state}><Text style={s.muted}>No customers match &ldquo;{query}&rdquo;</Text></View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(r) => r.id}
              keyboardShouldPersistTaps="handled"
              ItemSeparatorComponent={() => <View style={s.divider} />}
              renderItem={({ item }) => (
                <Pressable onPress={() => pick(item)} style={({ pressed }) => [s.row, pressed && s.rowPressed]}>
                  <View style={[s.avatar, { backgroundColor: colors.primaryContainer }]}>
                    <Text style={s.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.rowSub} numberOfLines={1}>
                      {item.phone ?? (item.tin ? `TIN ${item.tin}` : 'No phone')}
                      {item.priceListId ? '  ·  Wholesale price list' : ''}
                    </Text>
                  </View>
                  {currentName === item.name ? <MaterialCommunityIcons name="check" size={20} color={colors.primary} /> : null}
                </Pressable>
              )}
              style={{ maxHeight: 360 }}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim:    { flex: 1, backgroundColor: 'rgba(31,27,22,0.45)', justifyContent: 'flex-end' },
  sheet:    {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.s5,
    paddingBottom: spacing.s7,
    gap: spacing.s3,
  },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.rule, alignSelf: 'center' },
  headerRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:    { fontFamily: fonts.displayBold, fontSize: 22, fontWeight: '700', color: colors.ink },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    backgroundColor: colors.creamSoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  searchInput: { flex: 1, ...textTokens.body, color: colors.ink, paddingVertical: 4 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingVertical: spacing.s3,
    paddingHorizontal: spacing.s1,
  },
  rowPressed: { backgroundColor: colors.creamSoft },
  avatar:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.primary, fontWeight: '700' },
  rowName:    { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  rowSub:     { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  divider:    { height: 1, backgroundColor: colors.rule },

  state:      { paddingVertical: spacing.s5, alignItems: 'center' },
  muted:      { ...textTokens.bodySm, color: colors.muted },
  errorText:  { ...textTokens.bodySm, color: colors.error },
});

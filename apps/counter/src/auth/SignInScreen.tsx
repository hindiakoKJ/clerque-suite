/**
 * Clerque Counter — Sign-in screen (P-02)
 *
 * Pixel-faithful to design-source-v3 phone P-02:
 *   • Top row: small brand lockup + Online sync pill
 *   • Display heading "Sign in to Counter", muted helper line
 *   • Segmented Password / PIN tabs (PIN is roadmap, disabled today)
 *   • Three fields: Tenant ID (mono input), Email, Password (with Show toggle)
 *   • 56dp brown primary "Sign in →" CTA, 14px radius
 *   • Cream info card pinned to the bottom with the subscription link
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { HelperText, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth, ApiHttpError } from '@/auth/AuthProvider';
import { getWebHost } from '@/api/webOrigin';
import BrandLockup from '@/components/BrandLockup';
import SyncPill from '@/components/SyncPill';
import { colors, fonts, spacing, text } from '@/theme';

export default function SignInScreen(): React.ReactElement {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();

  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPassword, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  const onSubmit = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!tenantSlug.trim()) { setErrorMsg('Tenant ID is required.'); return; }
    if (!email.trim() || !password) { setErrorMsg('Email and password are required.'); return; }
    setSubmitting(true);
    try {
      await signIn({ tenantSlug: tenantSlug.trim(), email: email.trim(), password });
    } catch (err) {
      if (err instanceof ApiHttpError) {
        if (err.status === 401 && err.code === 'SUBSCRIPTION_INACTIVE') {
          setErrorMsg(`Your Clerque subscription is paused — renew at ${getWebHost()} to keep using Counter.`);
        } else if (err.status === 401) {
          setErrorMsg('Incorrect email or password.');
        } else if (err.status === 0) {
          setErrorMsg('No network connection. Check your internet and try again.');
        } else {
          setErrorMsg(err.message || 'Something went wrong. Please try again.');
        }
      } else {
        setErrorMsg('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.s4 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topRow}>
          <BrandLockup size="sm" />
          <SyncPill compact />
        </View>

        <Text style={styles.heading}>Sign in to Counter</Text>
        <Text style={styles.helper}>Tenant ID, email, password.</Text>

        {/* Password / PIN segmented (PIN is roadmap — non-interactive) */}
        <View style={styles.tabs}>
          <View style={[styles.tab, styles.tabOn]}>
            <MaterialCommunityIcons name="lock-outline" size={13} color={colors.ink} />
            <Text style={[styles.tabLabel, styles.tabLabelOn]}>Password</Text>
          </View>
          <View style={styles.tab}>
            <MaterialCommunityIcons name="dialpad" size={13} color={colors.muted} />
            <Text style={styles.tabLabel}>PIN</Text>
          </View>
        </View>

        <TextInput
          label="Tenant ID"
          value={tenantSlug}
          onChangeText={setTenantSlug}
          autoCapitalize="none"
          autoCorrect={false}
          mode="outlined"
          dense
          style={styles.input}
          outlineStyle={styles.inputOutline}
          contentStyle={[styles.inputContent, { fontFamily: fonts.mono }]}
          disabled={submitting}
          theme={INPUT_THEME}
        />
        <TextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          mode="outlined"
          dense
          style={styles.input}
          outlineStyle={styles.inputOutline}
          contentStyle={styles.inputContent}
          disabled={submitting}
          theme={INPUT_THEME}
        />
        <TextInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          mode="outlined"
          dense
          style={styles.input}
          outlineStyle={styles.inputOutline}
          contentStyle={styles.inputContent}
          right={
            <TextInput.Icon
              icon={showPassword ? 'eye-off' : 'eye'}
              size={20}
              color={colors.primary}
              onPress={() => setShowPass((v) => !v)}
            />
          }
          disabled={submitting}
          theme={INPUT_THEME}
        />

        {errorMsg ? (
          <HelperText type="error" visible style={styles.error}>
            {errorMsg}
          </HelperText>
        ) : null}

        <Pressable
          onPress={onSubmit}
          disabled={submitting}
          style={({ pressed }) => [styles.cta, (submitting || pressed) && styles.ctaPressed]}
        >
          <Text style={styles.ctaLabel}>{submitting ? 'Signing in…' : 'Sign in →'}</Text>
        </Pressable>

        <Text style={styles.forgot}>Forgot password?</Text>

        <View style={[styles.footerCard, { marginBottom: Math.max(insets.bottom, spacing.s4) }]}>
          <Text style={styles.footerText}>
            Need access? <Text style={styles.footerStrong}>Contact your admin</Text>.{'\n'}
            Subscriptions at <Text style={styles.footerLink}>{getWebHost()}</Text>.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const INPUT_THEME = {
  colors: {
    primary:           colors.primary,
    outline:           colors.rule,
    background:        colors.surface,
    onSurfaceVariant:  colors.muted,
  },
  roundness: 10,
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.s5,
    paddingBottom: spacing.s5,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.s5,
  },
  heading: { ...text.displayMd, fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.5, marginBottom: 4 },
  helper:  { ...text.bodySm, color: colors.muted, marginBottom: spacing.s4 },

  tabs: {
    flexDirection: 'row',
    padding: 4,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.creamDeep,
    borderRadius: 10,
    gap: 2,
    marginBottom: spacing.s4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 7,
  },
  tabOn: {
    backgroundColor: colors.surface,
    shadowColor: colors.ink, shadowOpacity: 0.06, shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  tabLabel:   { ...text.bodySm, fontSize: 13, fontWeight: '700', color: colors.muted },
  tabLabelOn: { color: colors.ink },

  input:        { marginBottom: spacing.s3, backgroundColor: colors.surface, height: 48 },
  inputOutline: { borderRadius: 10 },
  inputContent: { fontFamily: fonts.body, fontSize: 14 },

  error: { marginTop: 2, marginBottom: 4 },

  cta: {
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.s3,
  },
  ctaPressed: { backgroundColor: colors.primaryPress },
  ctaLabel:   { color: colors.onPrimary, fontFamily: fonts.bodyBold, fontWeight: '700', fontSize: 16 },

  forgot: { textAlign: 'center', color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700', fontSize: 12, marginTop: spacing.s3 },

  footerCard: {
    marginTop: 'auto',
    padding: 14,
    backgroundColor: colors.creamSoft,
    borderColor: colors.creamDeep,
    borderWidth: 1,
    borderRadius: 10,
  },
  footerText:   { fontFamily: fonts.body, fontSize: 12, color: colors.muted, lineHeight: 18 },
  footerStrong: { color: colors.ink, fontWeight: '700' },
  footerLink:   { color: colors.primary, fontWeight: '700' },
});

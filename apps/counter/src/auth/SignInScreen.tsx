/**
 * Clerque Counter — Sign-in screen
 * Centered cream card with tenant slug + email + password.
 * Subscription-paused errors surface a friendly message pointing to clerque.com
 * — there is no in-app upgrade button by product policy.
 */

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { colors, fonts, radii, spacing, text } from '@/theme';
import { useAuth, ApiHttpError } from '@/auth/AuthProvider';

export default function SignInScreen(): React.ReactElement {
  const { signIn } = useAuth();

  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async () => {
    if (submitting) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await signIn({
        tenantSlug: tenantSlug.trim() || undefined,
        email: email.trim(),
        password,
      });
    } catch (err) {
      if (err instanceof ApiHttpError) {
        if (err.status === 401 && err.code === 'SUBSCRIPTION_INACTIVE') {
          setErrorMsg(
            'Your Clerque subscription is paused — renew at clerque.com to keep using Counter.',
          );
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
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.logoWrap}>
            {/* Brand mark — rendered inline (no PNG asset required until
                the Play Store build, where the SVG → PNG conversion runs
                per apps/counter/README.md). Matches assets/icon.svg. */}
            <View style={styles.logo}>
              <Text style={styles.logoLetter}>C</Text>
            </View>
          </View>

          <Text style={styles.title}>Clerque · Counter</Text>
          <Text style={styles.subtitle}>Sign in to your tenant to start a shift.</Text>

          <TextInput
            label="Tenant slug (optional)"
            value={tenantSlug}
            onChangeText={setTenantSlug}
            autoCapitalize="none"
            autoCorrect={false}
            mode="outlined"
            style={styles.input}
            disabled={submitting}
          />
          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            mode="outlined"
            style={styles.input}
            disabled={submitting}
          />
          <TextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            mode="outlined"
            style={styles.input}
            right={
              <TextInput.Icon
                icon={showPassword ? 'eye-off' : 'eye'}
                onPress={() => setShowPassword((v) => !v)}
              />
            }
            disabled={submitting}
          />

          {errorMsg ? (
            <HelperText type="error" visible style={styles.errorText}>
              {errorMsg}
            </HelperText>
          ) : null}

          <Button
            mode="contained"
            onPress={onSubmit}
            loading={submitting}
            disabled={submitting || !email || !password}
            style={styles.submit}
            contentStyle={styles.submitContent}
            labelStyle={styles.submitLabel}
          >
            Sign in
          </Button>

          <Text style={styles.footer}>Subscription sold separately at clerque.com</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s5,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.s6,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  logoWrap: { alignItems: 'center', marginBottom: spacing.s4 },
  logo: {
    width: 64, height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: {
    color: colors.onPrimary,
    fontFamily: fonts.displayBold,
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 40,
  },
  title: { ...text.displayMd, color: colors.ink, textAlign: 'center' },
  subtitle: {
    ...text.bodySm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.s2,
    marginBottom: spacing.s5,
  },
  input: { marginBottom: spacing.s3, backgroundColor: colors.surface },
  errorText: { marginBottom: spacing.s2 },
  submit: { marginTop: spacing.s3, borderRadius: radii.md },
  submitContent: { height: 52 },
  submitLabel: { ...text.bodyLg, fontWeight: '700' },
  footer: {
    ...text.caption,
    color: colors.faint,
    textAlign: 'center',
    marginTop: spacing.s5,
  },
});

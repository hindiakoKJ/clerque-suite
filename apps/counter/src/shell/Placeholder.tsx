/**
 * Clerque Counter — Drawer placeholder
 * Lightweight stand-in used by drawer destinations whose real screens are
 * owned by other teams (terminal, shift, receipt, etc.). Renders the
 * TopBar + a labeled body so the shell is verifiable end-to-end on its own.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import TopBar from '@/shell/TopBar';
import { colors, spacing, text } from '@/theme';

interface Props {
  title: string;
  caption?: string;
  onMenuPress?: () => void;
}

export default function Placeholder({ title, caption, onMenuPress }: Props): React.ReactElement {
  return (
    <View style={styles.root}>
      <TopBar onMenuPress={onMenuPress} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.s6 },
  title: { ...text.displayMd, color: colors.ink },
  caption: { ...text.bodySm, color: colors.muted, marginTop: spacing.s2, textAlign: 'center' },
});

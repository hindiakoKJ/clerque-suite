import React from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';
import { tnum, colors, text as textTokens } from '@/theme/tokens';

interface MoneyProps {
  /** Amount in centavos (₱ cents, integer). */
  cents: number;
  style?: StyleProp<TextStyle>;
  /** Hide the ₱ prefix. */
  noSymbol?: boolean;
  /** Round to whole peso (no decimals). */
  noDecimals?: boolean;
}

const formatter = new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeFormatter = new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatPeso(cents: number, opts?: { noDecimals?: boolean; noSymbol?: boolean }): string {
  const value = cents / 100;
  const body = opts?.noDecimals ? wholeFormatter.format(Math.round(value)) : formatter.format(value);
  return opts?.noSymbol ? body : `₱${body}`;
}

export default function Money({ cents, style, noSymbol, noDecimals }: MoneyProps) {
  return (
    <Text style={[textTokens.body, tnum, { color: colors.ink }, style]}>
      {formatPeso(cents, { noSymbol, noDecimals })}
    </Text>
  );
}

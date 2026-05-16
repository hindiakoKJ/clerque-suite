import React from 'react';
import EWalletTab from './EWalletTab';
import { colors } from '@/theme/tokens';
import type { CartPayment } from '@/types';

export interface GCashTabProps {
  totalCents: number;
  onConfirm: (p: CartPayment) => void;
}

export default function GCashTab({ totalCents, onConfirm }: GCashTabProps): React.ReactElement {
  return (
    <EWalletTab
      totalCents={totalCents}
      method="GCASH"
      brandColor={colors.gcash}
      brandLabel="GCash"
      brandLetter="G"
      onConfirm={onConfirm}
    />
  );
}

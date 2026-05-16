import React from 'react';
import EWalletTab from './EWalletTab';
import { colors } from '@/theme/tokens';
import type { CartPayment } from '@/types';

export interface PayMayaTabProps {
  totalCents: number;
  onConfirm: (p: CartPayment) => void;
}

export default function PayMayaTab({ totalCents, onConfirm }: PayMayaTabProps): React.ReactElement {
  return (
    <EWalletTab
      totalCents={totalCents}
      method="PAYMAYA"
      brandColor={colors.paymaya}
      brandLabel="PayMaya"
      brandLetter="M"
      onConfirm={onConfirm}
    />
  );
}

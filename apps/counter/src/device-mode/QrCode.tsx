/**
 * Clerque Counter — Minimal QR component
 *
 * Renders a QR code to react-native-svg using the `qrcode` library's
 * matrix generator (synchronous, no Canvas needed). Used in the cashier-side
 * Displays screen to pair a customer-display / KDS device by camera scan.
 */

import React, { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const QRCode = require('qrcode');

interface Props {
  value:      string;
  size?:      number;
  /** Black-module color. Defaults to #1F1B16 (counter ink). */
  color?:     string;
  /** Background color. Defaults to #FFFFFF. */
  background?: string;
}

interface QrMatrix {
  size: number;
  data: Uint8Array; // row-major, 1 = dark
}

function buildMatrix(value: string): QrMatrix | null {
  try {
    // qrcode.create() is synchronous and returns a { modules } payload.
    // modules.size = matrix dimension, modules.data = Uint8Array (row-major).
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    return { size: qr.modules.size, data: qr.modules.data };
  } catch {
    return null;
  }
}

export default function QrCode({ value, size = 200, color = '#1F1B16', background = '#FFFFFF' }: Props): React.ReactElement | null {
  const matrix = useMemo(() => buildMatrix(value), [value]);
  if (!matrix) return null;
  const cell = size / matrix.size;
  const cells: React.ReactElement[] = [];
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.data[y * matrix.size + x]) {
        cells.push(
          <Rect
            key={`${x}-${y}`}
            x={x * cell}
            y={y * cell}
            width={cell}
            height={cell}
            fill={color}
          />,
        );
      }
    }
  }
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect x={0} y={0} width={size} height={size} fill={background} />
      {cells}
    </Svg>
  );
}

/**
 * Clerque Counter — BarcodeScannerSheet
 *
 * Bottom-sheet-hosted camera barcode scanner. Use `openBarcodeScanner()`
 * from anywhere (mirrors `openSupervisorPin()` pattern) to await a scanned
 * string; resolves with the decoded value, or `null` if the user cancels
 * or denies camera permission.
 *
 * Backed by `<BarcodeScannerHost />` mounted once near the navigator root
 * (see App.tsx). Decoding is handled by `CameraView` from `expo-camera`
 * (SDK >= 52 folded barcode scanning into expo-camera; the standalone
 * `expo-barcode-scanner` package was removed).
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { CameraView, Camera, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing, text as textTokens } from '@/theme';

// --------------------------------------------------------------------------
// Imperative API
// --------------------------------------------------------------------------

type Handler = () => Promise<string | null>;

let handler: Handler | null = null;

/** Internal — used by `<BarcodeScannerHost />` only. */
export function _registerBarcodeScannerHandler(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/**
 * Open the camera barcode scanner. Resolves with the decoded value, or
 * `null` if the user cancels (or denies permission).
 */
export function openBarcodeScanner(): Promise<string | null> {
  if (!handler) {
    return Promise.reject(
      new Error(
        'openBarcodeScanner called before <BarcodeScannerHost /> mounted. ' +
        'Add the host once near the navigator root.',
      ),
    );
  }
  return handler();
}

// --------------------------------------------------------------------------
// Host component
// --------------------------------------------------------------------------

interface SheetRef {
  open: () => Promise<string | null>;
}

export default function BarcodeScannerHost(): React.ReactElement {
  const ref = useRef<SheetRef>(null);

  useEffect(() => {
    const unregister = _registerBarcodeScannerHandler(() => {
      if (!ref.current) return Promise.resolve<string | null>(null);
      return ref.current.open();
    });
    return unregister;
  }, []);

  return <BarcodeScannerSheet ref={ref} />;
}

// --------------------------------------------------------------------------
// The sheet itself
// --------------------------------------------------------------------------

type Pending = { resolve: (v: string | null) => void };

const SUPPORTED_TYPES = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'qr',
] as const;

const BarcodeScannerSheet = forwardRef<SheetRef>(function BarcodeScannerSheet(_, ref) {
  const sheetRef = useRef<BottomSheet>(null);
  const pendingRef = useRef<Pending | null>(null);
  const handledRef = useRef(false);

  const [visible, setVisible] = useState(false);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const snapPoints = useMemo(() => ['92%'], []);

  const requestPermission = useCallback(async () => {
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setPermission(status === 'granted' ? 'granted' : 'denied');
    } catch {
      setPermission('denied');
    }
  }, []);

  const finish = useCallback((value: string | null) => {
    if (handledRef.current) return;
    handledRef.current = true;
    const p = pendingRef.current;
    pendingRef.current = null;
    sheetRef.current?.close();
    // Defer hide so the close animation can run.
    setTimeout(() => setVisible(false), 200);
    p?.resolve(value);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      open: () =>
        new Promise<string | null>((resolve) => {
          // If a prior call is still in flight, resolve it as cancel first.
          if (pendingRef.current) {
            pendingRef.current.resolve(null);
          }
          pendingRef.current = { resolve };
          handledRef.current = false;
          setVisible(true);
          // Defer expand to next tick so the sheet mounts first.
          setTimeout(() => sheetRef.current?.expand(), 0);
          // Kick permission check.
          void requestPermission();
        }),
    }),
    [requestPermission],
  );

  const onScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (handledRef.current) return;
      const value = (result?.data ?? '').trim();
      if (!value) return;
      // Light haptic — beep would require expo-audio which isn't installed.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      finish(value);
    },
    [finish],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  if (!visible) return <></>;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onClose={() => finish(null)}
      handleIndicatorStyle={{ backgroundColor: colors.muted }}
      backgroundStyle={{ backgroundColor: '#000' }}
    >
      <BottomSheetView style={styles.sheet}>
        {permission === 'granted' ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => finish(null)}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              onBarcodeScanned={onScanned}
              barcodeScannerSettings={{ barcodeTypes: [...SUPPORTED_TYPES] }}
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={styles.maskTop} />
              <View style={styles.middleRow}>
                <View style={styles.maskSide} />
                <View style={styles.window} />
                <View style={styles.maskSide} />
              </View>
              <View style={styles.maskBottom}>
                <Text style={styles.hint}>Point the camera at a barcode</Text>
                <Text style={styles.subhint}>Tap anywhere to cancel</Text>
              </View>
            </View>
          </Pressable>
        ) : permission === 'denied' ? (
          <View style={styles.deniedWrap}>
            <Text style={styles.deniedTitle}>Camera access needed</Text>
            <Text style={styles.deniedBody}>
              Clerque needs camera access to scan barcodes. Open Settings to allow camera access,
              then try again.
            </Text>
            <View style={styles.deniedActions}>
              <Pressable
                style={[styles.deniedBtn, styles.deniedBtnSecondary]}
                onPress={() => finish(null)}
              >
                <Text style={styles.deniedBtnSecondaryLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.deniedBtn}
                onPress={() => {
                  Linking.openSettings().catch(() => {});
                }}
              >
                <Text style={styles.deniedBtnLabel}>Open Settings</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.deniedWrap}>
            <Text style={styles.deniedBody}>Requesting camera permission…</Text>
          </View>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
});

const WINDOW_SIZE = 260;

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'column' },
  maskTop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  middleRow: { flexDirection: 'row', height: WINDOW_SIZE },
  maskSide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  window: {
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radii.lg,
    backgroundColor: 'transparent',
  },
  maskBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    paddingTop: spacing.s5,
    gap: spacing.s2,
  },
  hint: { ...textTokens.bodyLg, color: '#FFFFFF', fontWeight: '700' },
  subhint: { ...textTokens.bodySm, color: 'rgba(255,255,255,0.75)' },

  deniedWrap: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.s6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s3,
  },
  deniedTitle: { ...textTokens.displaySm, color: colors.ink },
  deniedBody: { ...textTokens.body, color: colors.muted, textAlign: 'center' },
  deniedActions: {
    flexDirection: 'row',
    gap: spacing.s3,
    marginTop: spacing.s4,
  },
  deniedBtn: {
    paddingHorizontal: spacing.s5,
    paddingVertical: spacing.s3,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  deniedBtnLabel: { ...textTokens.body, color: colors.onPrimary, fontWeight: '700' },
  deniedBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  deniedBtnSecondaryLabel: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
});

/**
 * Clerque Counter — SupervisorPinHost
 *
 * Singleton host that bridges imperative `openSupervisorPin()` calls to
 * the declarative `<SupervisorPinModal />` component. Mount once near the
 * navigator root (inside AuthProvider so the modal has session context).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import SupervisorPinModal from '@/auth/SupervisorPinModal';
import {
  _registerSupervisorPinHandler,
  type OpenSupervisorPinOptions,
  type OpenSupervisorPinResult,
} from '@/auth/openSupervisorPin';

interface Pending {
  opts: OpenSupervisorPinOptions;
  resolve: (v: OpenSupervisorPinResult | null) => void;
}

export default function SupervisorPinHost(): React.ReactElement | null {
  const [pending, setPending] = useState<Pending | null>(null);
  // Keep the resolver in a ref so unmount mid-flight rejects cleanly.
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    const unregister = _registerSupervisorPinHandler((opts) =>
      new Promise<OpenSupervisorPinResult | null>((resolve) => {
        setPending({ opts, resolve });
      }),
    );
    return () => {
      // If a call is still in flight when the host unmounts, treat it as cancel.
      if (pendingRef.current) {
        pendingRef.current.resolve(null);
        pendingRef.current = null;
      }
      unregister();
    };
  }, []);

  if (!pending) return null;

  return (
    <SupervisorPinModal
      visible
      reason={pending.opts.reason}
      onCancel={() => {
        pending.resolve(null);
        setPending(null);
      }}
      onSuccess={(info) => {
        // `requirePrcLicense` gating: if requested but the verifying role
        // doesn't carry a PRC license, treat as a soft reject. The modal
        // itself doesn't know about PRC; AuthProvider.verifySupervisorPin
        // returns the role, and pharmacy callers can require the role-
        // ladder check by reading `info.role` after resolve. For V1 we
        // pass the info through unchanged and let the caller decide.
        pending.resolve(info);
        setPending(null);
      }}
    />
  );
}

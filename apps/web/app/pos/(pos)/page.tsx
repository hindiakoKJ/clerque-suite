'use client';
/**
 * /pos root — vertical-aware landing redirect.
 *
 * The legacy implementation did a server-side `redirect('/pos/terminal')`,
 * which forced every tenant (including laundry / gas-station / pharmacy)
 * through the F&B-flavoured PosTerminal page for one frame before the
 * client-side layout's useEffect bounced them away. That was the
 * "intake → terminal → intake" flash users were seeing.
 *
 * Now we read the active tenant's businessType from the auth store (loaded
 * during sign-in, persisted to localStorage by Zustand) and route directly
 * to the right home for the vertical:
 *
 *   LAUNDRY            → /pos/laundry/queue
 *   GAS_STATION        → /pos/fuel/pumps
 *   PHARMACY           → /pos/pharmacy/rx
 *   MEDICAL_EQUIPMENT  → /pos/rentals
 *   anything else      → /pos/terminal (the existing F&B / Retail default)
 *
 * While the auth store hydrates we render a tiny "Routing…" spinner —
 * nothing else mounts, no PosTerminal flash.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import { Spinner } from '@/components/ui/Spinner';

function landingFor(businessType: string | null | undefined): string {
  switch (businessType) {
    case 'LAUNDRY':           return '/pos/laundry/queue';
    case 'GAS_STATION':       return '/pos/fuel/pumps';
    case 'PHARMACY':          return '/pos/pharmacy/rx';
    case 'MEDICAL_EQUIPMENT': return '/pos/rentals';
    default:                  return '/pos/terminal';
  }
}

export default function PosRoot() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  // useFloorLayout returns the tenant when known; covers the case where the
  // auth store doesn't carry businessType but the layout query has it.
  const { layout } = useFloorLayout();

  // Wait one tick so Zustand can rehydrate from localStorage on first paint —
  // otherwise `user` is briefly null and we'd misroute to /pos/terminal.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  const businessType = useMemo(
    () => layout?.tenant?.businessType ?? (user as { businessType?: string } | null)?.businessType,
    [layout?.tenant?.businessType, user],
  );

  useEffect(() => {
    if (!hydrated) return;
    router.replace(landingFor(businessType));
  }, [hydrated, businessType, router]);

  return (
    <div className="flex items-center justify-center w-full h-screen">
      <Spinner size="lg" message="Loading your terminal…" />
    </div>
  );
}

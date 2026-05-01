import { Spinner } from '@/components/ui/Spinner';

/**
 * Root-level loading screen — shown for any route that doesn't have a
 * more specific loading.tsx. Next.js auto-renders this whenever a server
 * component is being prepared after navigation.
 */
export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Spinner size="lg" message="Loading…" />
    </div>
  );
}

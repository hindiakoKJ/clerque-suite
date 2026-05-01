import { Spinner } from '@/components/ui/Spinner';

export default function PortalLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Spinner size="lg" />
    </div>
  );
}

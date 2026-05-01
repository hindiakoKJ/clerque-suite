import { Spinner } from '@/components/ui/Spinner';

export default function CounterLoading() {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[60vh]">
      <Spinner size="lg" message="Loading Counter…" />
    </div>
  );
}

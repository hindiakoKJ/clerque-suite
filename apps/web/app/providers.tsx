'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { ConfirmSlugModal } from '@/components/admin/ConfirmSlugModal';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
      {/* Sprint 19 — Global slug-confirmation modal. The axios interceptor
          opens this whenever a destructive endpoint returns
          CONFIRMATION_REQUIRED, instead of using window.prompt (which
          some browsers / extensions silently suppress). */}
      <ConfirmSlugModal />
    </QueryClientProvider>
  );
}

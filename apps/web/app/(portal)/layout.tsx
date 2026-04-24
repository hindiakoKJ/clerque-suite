import type React from 'react';

// Portal pages (app picker, login, app selector) use the bare layout — no shell
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

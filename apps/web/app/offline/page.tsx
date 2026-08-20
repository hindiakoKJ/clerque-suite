'use client';

/**
 * Shown by the service worker when a navigation is attempted with no
 * connection and no cached copy of that page. Deliberately static and
 * dependency-free so it renders from cache with no data fetch.
 */
export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#F8F5EE] text-[#1F1B16]">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold">You&apos;re offline</h1>
        <p className="text-sm leading-relaxed text-[#5F564B]">
          Clerque can&apos;t reach the internet right now. Sales you already rang up
          are saved on this device and will sync automatically once you&apos;re back
          online — don&apos;t re-enter them.
        </p>
        <p className="text-sm leading-relaxed text-[#5F564B]">
          If you were at the till, go back to the previous screen to keep selling.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg text-white text-sm font-medium"
          style={{ background: '#8B5E3C' }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}

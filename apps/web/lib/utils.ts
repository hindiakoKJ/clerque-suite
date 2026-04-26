import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPeso(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(num);
}

export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-PH', options ?? { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Download a file from an authenticated API endpoint.
 * Reads the Bearer token from the persisted auth store in localStorage,
 * fetches the resource, and triggers a browser download.
 */
export async function downloadAuthFile(url: string, filename: string): Promise<void> {
  let token: string | null = null;
  try {
    const raw = localStorage.getItem('app-auth');
    if (raw) {
      const { state } = JSON.parse(raw) as { state: { accessToken: string | null } };
      token = state.accessToken;
    }
  } catch { /* ignore */ }

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href     = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

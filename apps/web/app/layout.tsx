import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { DemoBanner } from '@/components/demo/DemoBanner';
import { DemoErrorBoundary } from '@/components/demo/DemoErrorBoundary';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Clerque',
  description: 'Clerque — Counter, Ledger, and Sync for your business.',
  applicationName: 'Clerque',
  appleWebApp: {
    title:   'Clerque',
    capable: true,
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#8B5E3C' },
    { media: '(prefers-color-scheme: dark)',  color: '#2C2018' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before first paint — prevents flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var stored = localStorage.getItem('theme');
            var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (stored === 'dark' || (!stored && prefersDark)) {
              document.documentElement.classList.add('dark');
            }
          } catch(e) {}
        ` }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans bg-background text-foreground`}>
        <Providers>
          <DemoBanner />
          <DemoErrorBoundary>{children}</DemoErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}

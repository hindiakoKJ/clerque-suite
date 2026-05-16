import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Inter, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { DemoBanner } from '@/components/demo/DemoBanner';
import { DemoErrorBoundary } from '@/components/demo/DemoErrorBoundary';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
// Counter design system — Plus Jakarta (display), Inter (body), JetBrains Mono (numerics)
const inter        = Inter({           subsets: ['latin'], variable: '--font-body',    display: 'swap' });
const jakarta      = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const jetbrainsMono= JetBrains_Mono({  subsets: ['latin'], variable: '--font-mono',    display: 'swap' });

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
    { media: '(prefers-color-scheme: light)', color: '#7C3AED' }, // deep purple
    { media: '(prefers-color-scheme: dark)',  color: '#5B21B6' }, // darker purple
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
      <body className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${jakarta.variable} ${jetbrainsMono.variable} font-sans bg-background text-foreground`}>
        <Providers>
          <DemoBanner />
          <DemoErrorBoundary>{children}</DemoErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}

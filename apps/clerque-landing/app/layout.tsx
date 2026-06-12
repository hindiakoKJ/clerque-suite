import type { Metadata } from 'next';
import { Inter_Tight } from 'next/font/google';
import './globals.css';

const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-inter-tight',
  display: 'swap',
});

export const metadata: Metadata = {
  title:       'Clerque — POS, Accounting and Payroll for Philippine MSMEs',
  description:
    'Clerque runs your café, bakery, restaurant, laundromat, pharmacy, or retail shop. BIR-ready receipts, FEFO ingredient inventory, GCash · Maya · QR PH, automatic Z-read. Solo tier starts at ₱199/month.',
  keywords: [
    'Clerque',
    'POS Philippines',
    'BIR-ready POS',
    'Philippine bakery POS',
    'coffee shop POS Philippines',
    'MSME accounting software',
    'GCash POS',
    'QR PH POS',
    'PWD Senior discount POS',
  ],
  openGraph: {
    title:       'Clerque — the operating system of your Philippine MSME',
    description: 'POS, Accounting, and Payroll built for Filipino small businesses. BIR-compliant from day one.',
    url:         'https://clerque.hnscorpph.com',
    siteName:    'Clerque',
    type:        'website',
  },
  metadataBase: new URL('https://clerque.hnscorpph.com'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body>{children}</body>
    </html>
  );
}

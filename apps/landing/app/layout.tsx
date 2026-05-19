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
  title: 'HNScorpPH — Digital Sovereignty for the Filipino MSME',
  description:
    'HNScorpPH provides high-tech infrastructure for Philippine MSMEs. Flagship product: Clerque — unified POS, Payroll, and Accounting.',
  keywords: [
    'HNScorpPH',
    'Clerque',
    'POS Philippines',
    'MSME software',
    'BIR CAS ready',
    'Philippine payroll',
  ],
  openGraph: {
    title: 'HNScorpPH — Powering the Philippine MSME Revolution',
    description: 'Clerque: Unified POS, Payroll, and Accounting for Filipino businesses.',
    url: 'https://hnscorpph.com',
    siteName: 'HNScorpPH',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body>{children}</body>
    </html>
  );
}

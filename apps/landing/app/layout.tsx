import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HNScorpPH — Digital Sovereignty for the Filipino MSME',
  description: 'HNScorpPH provides high-tech infrastructure for Philippine MSMEs. Flagship product: Clerque — unified POS, Payroll, and Accounting.',
  keywords: ['HNScorpPH', 'Clerque', 'POS Philippines', 'MSME software', 'BIR CAS ready', 'Philippine payroll'],
  openGraph: {
    title: 'HNScorpPH — Powering the Philippine MSME Revolution',
    description: 'Clerque: Unified POS, Payroll, and Accounting for Filipino businesses.',
    url: 'https://hnscorpph.com',
    siteName: 'HNScorpPH',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}

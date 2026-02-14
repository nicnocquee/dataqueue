import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://dataqueue.dev'),
  title: 'DataQueue | A lightweight job queue backed by PostgreSQL or Redis',
  description:
    'An open-source, lightweight job queue backed by PostgreSQL or Redis for Node.js/TypeScript projects. Schedule, process, and manage background jobs with ease.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}

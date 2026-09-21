import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JevOps — Engineering Decision Cockpit',
  description:
    'LLM reads the mess. Jev makes the call. The application executes it. Deterministic engineering decisions with a model on either end.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-base text-ink min-h-full">{children}</body>
    </html>
  );
}

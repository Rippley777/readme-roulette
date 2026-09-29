import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'README Roulette — Give your repos a glow-up',
  description:
    'A thoughtful workspace for repository health, evidence-based documentation, and portfolio-ready READMEs.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

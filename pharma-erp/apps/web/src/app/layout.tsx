import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { NoNumberScroll } from '@/components/no-number-scroll';
import { ToastHost } from '@/components/toast';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Pharma ERP',
    template: '%s · Pharma ERP',
  },
  description: 'Manufacturing, quality and compliance ERP for pharmaceutical manufacturers.',
  // An internal ERP has no business being indexed.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        {children}
        {/* One host for the whole application, outside every route group, so
            admin, master data, platform and workflow screens all report the
            result of an action in the same place. */}
        <ToastHost />
        {/* Here for the same reason: a number field added to any screen later
            is covered without its author having to know this rule exists. */}
        <NoNumberScroll />
      </body>
    </html>
  );
}

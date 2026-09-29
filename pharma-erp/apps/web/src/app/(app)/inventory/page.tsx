import type { Metadata } from 'next';

import { EmptyState, Panel } from '@/components/procurement/ui';

export const metadata: Metadata = { title: 'Dashboard · Dashboard & Reports' };

/**
 * The Dashboard tab — reserved for the charts still to be designed.
 *
 * Deliberately empty rather than filled with stand-in figures. The near-expiry
 * counts US-INV-03 asks for are on the Near-Expiry Report and on the main
 * dashboard's Inventory section.
 */
export default function InventoryDashboardPage() {
  return (
    <Panel title="Dashboard">
      <EmptyState
        title="Charts will appear here."
        hint="For stock and expiry figures today, open Reports above."
      />
    </Panel>
  );
}

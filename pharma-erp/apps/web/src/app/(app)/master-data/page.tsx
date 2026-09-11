import { redirect } from 'next/navigation';
import { MASTER_DATA_HOME } from '@pharma-erp/types';

export const dynamic = 'force-dynamic';

/**
 * Master Data has no content of its own — the registers are the content — so
 * this forwards to the first tab rather than rendering a landing page with
 * every tab looking unselected.
 *
 * Same shape as the workflow index, and for the same reason: it keeps
 * /master-data a durable link even if the registers are later reordered.
 */
export default async function MasterDataIndexPage() {
  redirect(MASTER_DATA_HOME);
}

import { permanentRedirect } from 'next/navigation';
import { PROCUREMENT_ROUTES } from '@pharma-erp/types';

/**
 * Low stock, as it was, now Required stock.
 *
 * KEPT AS A REDIRECT rather than deleted outright. This path is in people's
 * bookmarks and in links sent between colleagues, and the screen it named still
 * exists in every sense that matters to them — it answers the same question,
 * from the sales order rather than from a reorder level. A 404 would read as
 * the feature having been removed.
 *
 * `permanentRedirect` (308) rather than a temporary one, because the move is
 * permanent and a browser may as well remember it.
 */
export default function LowStockRedirect(): never {
  permanentRedirect(PROCUREMENT_ROUTES.requiredStock);
}

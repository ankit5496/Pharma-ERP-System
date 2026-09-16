'use client';

import { useState, useTransition } from 'react';
import { type PartySummary } from '@pharma-erp/types';

import { deleteCustomerAction, updateCustomerAction } from './actions';
import { DANGER_BUTTON, SECONDARY_BUTTON } from './ui';

/**
 * Client-side pieces of the Customers tab.
 *
 * ONLY ROW ACTIONS. There is no create form here: a customer is a party, and
 * the party register is added to on the Master Data screen, where it is
 * maintained for purchasing, sales and job work alike. A second create flow
 * would mean a second set of rules to keep in step.
 *
 * There is no licence panel either. The party register holds ONE drug licence —
 * the number and validity US-MD-02 tests — and it is edited where the rest of
 * the party is.
 */

/**
 * Block / unblock and retire, on the shared party register.
 *
 * Both of these WRITE TO MASTER DATA: the row they change is the one the Master
 * Data screen shows, and the API applies the same role checks either way. They
 * are here because a sales desk that cannot stop trading with a customer has to
 * leave the screen to do it — but they are the only writes this page offers.
 */
export function CustomerRowActions({ customer }: { customer: PartySummary }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? 'That did not work.');
    });
  };

  return (
    <div className="min-w-[9rem]">
      <div className="flex flex-wrap gap-1.5">
        {customer.status === 'BLOCKED' ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => updateCustomerAction(customer.id, { status: 'ACTIVE' }))}
            className={SECONDARY_BUTTON}
          >
            Unblock
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => updateCustomerAction(customer.id, { status: 'BLOCKED' }))}
            className={SECONDARY_BUTTON}
          >
            Block
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            // Says where the change lands, because it is not only this screen's
            // record — the party register is shared.
            if (
              !window.confirm(
                `Remove ${customer.name} from the shared party register? This is a soft delete — their invoices and history stay.`,
              )
            ) {
              return;
            }

            run(() => deleteCustomerAction(customer.id));
          }}
          className={DANGER_BUTTON}
        >
          Remove
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { type PartySummary } from '@pharma-erp/types';

import { updateCustomerAction } from './actions';
import { Modal } from './modal';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './ui';

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
 * Row actions for a customer — EDIT ONLY.
 *
 * Block and Remove were here and have been taken out: both wrote to the shared
 * party register, and withdrawing or halting a customer reaches past the sales
 * desk to purchasing and job work, which read the same row. Those belong on the
 * Master Data screen, where the register is maintained for everyone who reads
 * it. Edit stays because correcting a licence or a credit limit is the sales
 * desk's own work and changes nothing about whether the customer exists.
 */
export function CustomerRowActions({ customer }: { customer: PartySummary }) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="min-w-[5rem]">
      <button type="button" onClick={() => setEditing(true)} className={SECONDARY_BUTTON}>
        Edit
      </button>

      {editing && <EditCustomerModal customer={customer} onClose={() => setEditing(false)} />}
    </div>
  );
}

/**
 * Edits a customer on the shared party register.
 *
 * The fields are exactly those `UpdatePartyDto` accepts, and no more. `code` is
 * absent because it is permanent — it is printed on issued documents, so a
 * rename would leave them pointing at something that no longer resolves; the
 * DTO has no field for it either.
 *
 * STATUS IS NOT EDITED HERE. Block and unblock are their own buttons with their
 * own consequences, and burying a commercial hold in a form of twelve fields is
 * how one gets applied by accident.
 *
 * US-MD-02 still governs: the API refuses an ACTIVE customer with no licence
 * number and validity, so clearing the licence fields on an active customer
 * comes back as a refusal rather than being silently accepted.
 */
function EditCustomerModal({
  customer,
  onClose,
}: {
  customer: PartySummary;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Modal
      title={`Edit ${customer.name}`}
      description={`${customer.code} · part of the shared party register, so changes are visible to every desk that reads it.`}
      onClose={onClose}
    >
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <form
        className="grid gap-4 sm:grid-cols-2"
        action={(formData) => {
          const text = (key: string): string | undefined => {
            const value = formData.get(key);
            if (typeof value !== 'string') return undefined;
            return value.trim() || undefined;
          };

          const number = (key: string): number | undefined => {
            const value = text(key);
            return value === undefined ? undefined : Number(value);
          };

          setError(null);

          startTransition(async () => {
            const result = await updateCustomerAction(customer.id, {
              name: text('name'),
              email: text('email'),
              phone: text('phone'),
              address: text('address'),
              gstin: text('gstin'),
              drugLicenceNumber: text('drugLicenceNumber'),
              drugLicenceValidTo: text('drugLicenceValidTo'),
              creditLimit: text('creditLimit'),
              creditPeriodDays: number('creditPeriodDays'),
              paymentTermsDays: number('paymentTermsDays'),
            });

            if (result.ok) onClose();
            else setError(result.error ?? 'That did not work.');
          });
        }}
      >
        <EditField label="Name" name="name" defaultValue={customer.name} required />
        <EditField label="GSTIN" name="gstin" defaultValue={customer.gstin ?? ''} />
        <EditField label="Email" name="email" type="email" defaultValue={customer.email ?? ''} />
        <EditField label="Phone" name="phone" defaultValue={customer.phone ?? ''} />

        <div className="sm:col-span-2">
          <EditField label="Address" name="address" defaultValue={customer.address ?? ''} />
        </div>

        <EditField
          label="Drug licence number"
          name="drugLicenceNumber"
          defaultValue={customer.drugLicenceNumber ?? ''}
          hint="An active customer must have this and its validity on file."
        />
        <EditField
          label="Licence valid to"
          name="drugLicenceValidTo"
          type="date"
          defaultValue={customer.drugLicenceValidTo ?? ''}
        />

        <EditField
          label="Credit limit"
          name="creditLimit"
          defaultValue={customer.creditLimit ?? ''}
          hint="A decimal amount, e.g. 250000.00"
        />
        <EditField
          label="Credit period (days)"
          name="creditPeriodDays"
          type="number"
          defaultValue={customer.creditPeriodDays?.toString() ?? ''}
        />

        <EditField
          label="Payment terms (days)"
          name="paymentTermsDays"
          type="number"
          defaultValue={customer.paymentTermsDays.toString()}
        />

        <div className="sm:col-span-2 flex gap-2">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditField({
  label,
  name,
  defaultValue,
  type = 'text',
  required = false,
  hint,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={`edit-${name}`} className="field-label">
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      <input
        id={`edit-${name}`}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        autoComplete="off"
        className="field mt-1.5"
      />
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

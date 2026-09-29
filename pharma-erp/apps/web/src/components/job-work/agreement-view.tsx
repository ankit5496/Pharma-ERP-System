'use client';

import {
  AGREEMENT_STATUS_LABELS,
  BILLING_MODEL_LABELS,
  CONVERSION_RATE_BASIS_LABELS,
  type JobWorkAgreementSummary,
} from '@pharma-erp/types';
import { useState } from 'react';

import { Derived, Disclosure } from '@/components/procurement/form-kit';
import { RowActionMenu } from '@/components/row-action-menu';

/**
 * A principal and their job work agreement, opened read-only.
 *
 * WHY VIEW AND NOT EDIT. An agreement is a contract: the billing model decides
 * whose material is consumed and whose stock the output belongs to, the
 * conversion charge decides what is invoiced, and the mappings decide which of
 * our formulations may be made under the principal's brand. Orders, receipts,
 * batches and invoices are all raised against those terms and inherit them — so
 * changing one here would silently restate the basis of work already done.
 * Agreements are written in Master Data, where that history is dealt with.
 *
 * WHAT IT SHOWS is everything the register holds about the pair, including what
 * the table has to truncate: the whole mapping list with its pack design
 * references, both validity dates, the notes, and who recorded it.
 */
export function ViewJobWorkAgreementButton({
  agreement,
  isOpen,
  onOpenChange,
}: {
  agreement: JobWorkAgreementSummary;
  /** Passed by the row's Actions menu, which is then the trigger. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Disclosure
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="View"
      title={agreement.principalName}
      subtitle={
        agreement.agreementReference
          ? `Agreement ${agreement.agreementReference}`
          : 'No agreement reference'
      }
      width="60rem"
    >
      {() => (
        <div className="flex grow flex-col gap-5">
          <Section title="The principal">
            <Derived label="Principal" value={agreement.principalName} />
            <Derived label="Principal code" value={agreement.principalCode} />
            <Derived
              label="Agreement reference"
              value={agreement.agreementReference ?? 'None recorded'}
            />
          </Section>

          {/* THE TERMS. The billing model comes first because everything else
              on this screen, and in the workflow under it, follows from it. */}
          <Section title="The terms">
            <Derived
              label="Billing model"
              value={BILLING_MODEL_LABELS[agreement.billingModel]}
              hint={
                agreement.billingModel === 'PURE_CONVERSION'
                  ? 'The principal sends the material; we convert it and invoice the charge.'
                  : 'We buy the material ourselves and invoice it with the conversion.'
              }
            />
            <Derived
              label="Conversion charge"
              value={agreement.conversionChargeRate ?? 'Not set'}
              hint={
                agreement.conversionRateBasis
                  ? CONVERSION_RATE_BASIS_LABELS[agreement.conversionRateBasis]
                  : undefined
              }
            />
            <Derived
              label="Rate basis"
              value={
                agreement.conversionRateBasis
                  ? CONVERSION_RATE_BASIS_LABELS[agreement.conversionRateBasis]
                  : 'Not set'
              }
            />
            <Derived label="Valid from" value={agreement.validFrom ?? 'No start date'} />
            <Derived label="Valid to" value={agreement.validTo ?? 'No end date'} />
            <Derived
              label="Status"
              value={AGREEMENT_STATUS_LABELS[agreement.status]}
              hint="Derived from the validity dates against today."
            />
          </Section>

          {/* THE MAPPINGS IN FULL. The register truncates this column to keep
              its rows readable, which is exactly why somebody opens this. */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Products covered
            </h3>

            {agreement.mappings.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                No formulation is mapped to this agreement, so no job work order can be raised
                against it.
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Principal&rsquo;s brand</th>
                      <th className="px-3 py-2 font-medium">Our product</th>
                      <th className="px-3 py-2 font-medium">Formulation</th>
                      <th className="px-3 py-2 font-medium">Pack design</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {agreement.mappings.map((mapping) => (
                      <tr key={mapping.id}>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {mapping.principalBrandName}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{mapping.productName}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {mapping.bomLabel}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {mapping.packDesignRef ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <Section title="Record">
            <Derived label="Recorded on" value={agreement.createdAt.slice(0, 10)} />
            <Derived label="Recorded by" value={agreement.createdBy ?? 'Not recorded'} />
          </Section>

          {agreement.notes && (
            <div>
              <span className="field-label">Notes</span>
              <p className="mt-1.5 whitespace-pre-line rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {agreement.notes}
              </p>
            </div>
          )}

          {/* SAID ONCE, PLAINLY. Somebody who wants to change a term needs to
              know where to go, and "read-only" on its own does not tell them. */}
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Agreements are read-only here. Orders, receipts and invoices inherit these terms, so
            they are changed in Master Data rather than on this register.
          </p>
        </div>
      )}
    </Disclosure>
  );
}

/** A titled group of read-only fields, laid out as the other view dialogs lay theirs out. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * The Action cell on the agreement register.
 *
 * VIEW ONLY, for the reason above: the terms are a contract the rest of the
 * workflow has already inherited. The menu is the same control every other
 * register's Action column uses, so the column behaves the way a reader has
 * already learnt on the other tabs.
 */
export function JobWorkAgreementRowActions({
  agreement,
}: {
  agreement: JobWorkAgreementSummary;
}) {
  const [viewing, setViewing] = useState(false);

  return (
    <>
      <RowActionMenu
        label={`${agreement.principalName}${
          agreement.agreementReference ? ` (${agreement.agreementReference})` : ''
        }`}
        actions={[{ label: 'View', onSelect: () => setViewing(true) }]}
      />

      <ViewJobWorkAgreementButton
        agreement={agreement}
        isOpen={viewing}
        onOpenChange={setViewing}
      />
    </>
  );
}

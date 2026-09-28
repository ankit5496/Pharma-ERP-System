'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type { CustomerBalance, CustomerDetail, ItemPackagingSpec } from '@pharma-erp/types';

import { customerBalanceAction, customerDetailAction, itemPackagingAction } from './actions';

/**
 * The read-only panels on the Sales Order form.
 *
 * EVERY VALUE HERE COMES FROM A MASTER OR THE LEDGER. Nothing in this file is
 * typed by the person raising the order, and nothing it shows is written back:
 * the point is that the customer's address, GST number and licence, and the
 * product's packaging specification, are already recorded somewhere, and the
 * order should display them for checking rather than ask for them again.
 *
 * A FIELD THE MASTER DOES NOT CARRY YET IS LEFT BLANK, deliberately and
 * visibly — "Not in master data" rather than an empty box that looks like an
 * omission, and never a plausible-looking value. When the master gains the
 * field, these panels show it without changing.
 */

/**
 * One master-data value, drawn as a read-only field.
 *
 * A FIELD, NOT A LINE OF TEXT, so the panels read as part of the form rather
 * than as a note beside it, and so every box on the screen is the same height
 * whether it holds a GST number or an address.
 *
 * READ-ONLY AND DISABLED, both: `readOnly` stops typing, `disabled` keeps it
 * out of the tab order and out of any submission. Nothing here is the order's
 * to change — it belongs to the master.
 *
 * Absent data shows as a placeholder rather than an empty box, so "the master
 * does not have this" is distinguishable from "nobody has filled it in".
 */
function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  const text = value === null || value === undefined || value === '' ? '' : value;

  return (
    <div>
      <p className="field-label">{label}</p>
      <input
        readOnly
        disabled
        value={text}
        placeholder="Not in master data"
        title={text || 'Not in master data'}
        className="field mt-1.5 h-10 w-full"
      />
    </div>
  );
}

/**
 * One collapsible group of read-only fields.
 *
 * DRAWN LIKE THE REST OF THE FORM: the same white card, the same heading
 * weight, and the same four-column field grid the order's own terms use. These
 * groups hold master data rather than input, but they are part of the same
 * document and looked like a different component pasted in.
 *
 * `<details>` rather than state: the browser supplies the toggle, the arrow
 * rotates off `group-open`, and the content stays in the page for Ctrl-F and
 * for anyone reading with assistive technology.
 */
export 
/**
 * A specification field nobody records yet, typed by hand for now.
 *
 * THE MASTERS WILL OWN THESE. Dosage, cap, foil, mono, outer and shipper detail
 * belong to the product, not to one order — the same product sold twice should
 * not be described twice, differently. Until Master Data carries them, they are
 * typed here so an order can still be raised with the specification on it.
 *
 * WHAT IS TYPED IS NOT SAVED. The sales order has no columns for these, and I
 * have not invented any: the value lives in the form while it is open. When the
 * masters gain the fields, this reverts to a read-only `Detail` and the typing
 * goes away with it.
 */
function TypedDetail({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={255}
        autoComplete="off"
        placeholder="Type to enter"
        className="field mt-1.5 h-10 w-full"
      />
    </div>
  );
}

export function Section({
  title,
  subtitle,
  children,
  nested = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** A nested section: lighter, so the hierarchy is visible at a glance. */
  nested?: boolean;
}) {
  return (
    <details
      // Closed by default: the form is long, and a document opens on the
      // fields somebody is about to type rather than on everything at once.
      className={`rounded-lg border shadow-sm ${
        nested ? 'group/inner border-slate-200 bg-slate-50/60' : 'group/outer border-slate-200 bg-white'
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-baseline gap-2">
          <span
            className={
              nested
                ? 'text-xs font-semibold uppercase tracking-wide text-slate-700'
                : 'text-sm font-semibold text-slate-900'
            }
          >
            {title}
          </span>
          {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
        </span>

        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`h-4 w-4 shrink-0 text-slate-400 transition ${
            nested ? 'group-open/inner:rotate-180' : 'group-open/outer:rotate-180'
          }`}
          fill="currentColor"
        >
          <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </summary>

      <div className="border-t border-slate-200 px-4 py-4">{children}</div>
    </details>
  );
}

/**
 * The PAN, read out of the GSTIN.
 *
 * A GSTIN is 2 digits of state code, then the 10-character PAN, then 3 more.
 * The PAN is therefore already recorded — storing it again on the party would
 * be a second copy of the same fact, free to drift from the first.
 */
function panFromGstin(gstin: string | null): string | null {
  if (!gstin || gstin.length < 12) return null;

  const pan = gstin.slice(2, 12).toUpperCase();
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? pan : null;
}

function addressOf(lines: readonly (string | null)[]): string | null {
  const parts = lines.map((line) => line?.trim()).filter((line): line is string => Boolean(line));
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Billed To, Shipped To, and what the customer owes.
 *
 * Fetched when the customer changes. The order form already knows the
 * customer's id; everything else is looked up rather than carried in the form's
 * state, so the panel cannot show a stale address after the master is edited.
 */
export function CustomerPanels({ customerId }: { customerId: string }) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [balance, setBalance] = useState<CustomerBalance | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId) {
      setDetail(null);
      setBalance(null);
      return;
    }

    let current = true;
    setLoading(true);

    void (async () => {
      const [detailResult, balanceResult] = await Promise.all([
        customerDetailAction(customerId),
        customerBalanceAction(customerId),
      ]);

      // A reply for the customer chosen a moment ago must not overwrite the
      // one chosen since.
      if (!current) return;

      setDetail(detailResult.ok ? (detailResult.data ?? null) : null);
      setBalance(balanceResult.ok ? (balanceResult.data ?? null) : null);
      setBalanceError(!balanceResult.ok);
      setLoading(false);
    })();

    return () => {
      current = false;
    };
  }, [customerId]);

  if (!customerId) return null;

  if (loading && !detail) {
    return <p className="text-xs text-slate-500">Reading the customer master…</p>;
  }

  if (!detail) {
    return <p className="text-xs text-amber-700">The customer record could not be read.</p>;
  }

  const pan = panFromGstin(detail.gstin);
  const licence = detail.primaryLicence?.licenceNumber ?? null;

  const billing = addressOf([
    detail.billingLine1,
    detail.billingLine2,
    detail.billingCity,
    detail.billingState,
    detail.billingPin,
  ]);

  // Falls back to the billing address, which is what the invoice does when a
  // customer has given no separate ship-to.
  const shipping =
    addressOf([
      detail.shippingLine1,
      detail.shippingLine2,
      detail.shippingCity,
      detail.shippingState,
      detail.shippingPin,
    ]) ?? billing;

  const shippingState = detail.shippingState ?? detail.billingState;

  return (
    <div className="space-y-3">
      {/* Stacked, not side by side: each address gets the full width, so its
          fields sit on the same three-column grid as every other row on the
          form instead of being squeezed into half of it. */}
      <div className="space-y-3">
        <Section nested title="Billing Information" subtitle={detail.name}>
          <dl className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
            <Detail label="Billing Address" value={billing} />
            <Detail label="GST No." value={detail.gstin} />
            <Detail label="D.L. No." value={licence} />
            <Detail label="PAN No." value={pan} />
            <Detail label="State" value={detail.billingState} />
            <Detail label="State Code" value={detail.stateCode} />
          </dl>
        </Section>

        <Section nested title="Shipping Information" subtitle={detail.name}>
          <dl className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
            <Detail label="Shipping Address" value={shipping} />
            <Detail label="GST No." value={detail.gstin} />
            <Detail label="D.L. No." value={licence} />
            <Detail label="PAN No." value={pan} />
            <Detail label="State" value={shippingState} />
            <Detail label="State Code" value={detail.stateCode} />
          </dl>
        </Section>
      </div>

      {/* What the customer owes and what they may still be sold — a
          sub-section like the addresses, because it belongs to the customer
          rather than to this order. */}
      <Section nested title="Account Information" subtitle={detail.name}>
        <dl className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
          <Detail
            label="Ledger Balance"
            value={
              balanceError || !balance
                ? 'Not available'
                : Number(balance.ledgerBalance).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                  })
            }
          />
          <Detail
            label="Over Due"
            value={
              balanceError || !balance
                ? 'Not available'
                : Number(balance.overdueAmount).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                  })
            }
          />
          <Detail
            label="Credit Available"
            value={Number(detail.availableCredit).toLocaleString('en-IN', {
              minimumFractionDigits: 2,
            })}
          />
        </dl>
      </Section>
    </div>
  );
}

/**
 * Composition and packaging for one chosen product.
 *
 * Read from the item master and the packaging register. The fields the real
 * Sales Order document carries that those masters do not record yet — dosage,
 * colour, flavour, cap type, label and foil detail — are listed as not in
 * master data rather than offered as free text, which would put a second,
 * unverified copy of a product specification inside every order.
 */
export function ProductPanel({ itemId }: { itemId: string }) {
  const [spec, setSpec] = useState<ItemPackagingSpec | null>(null);
  const [loading, setLoading] = useState(false);

  // Typed by hand until Master Data carries them — see TypedDetail.
  const [specText, setSpecText] = useState({
    dosage: '',
    pvc: '',
    ppCap: '',
    dosingCap: '',
    foil: '',
    mono: '',
    outer: '',
    shipper: '',
  });

  useEffect(() => {
    if (!itemId) {
      setSpec(null);
      return;
    }

    let current = true;
    setLoading(true);

    void (async () => {
      const result = await itemPackagingAction(itemId);
      if (!current) return;

      setSpec(result.ok ? (result.data ?? null) : null);
      setLoading(false);
    })();

    return () => {
      current = false;
    };
  }, [itemId]);

  if (!itemId) return null;
  if (loading && !spec) return <p className="text-xs text-slate-500">Reading the item master…</p>;
  if (!spec) return null;

  const typed = (key: keyof typeof specText) => ({
    value: specText[key],
    onChange: (next: string) => setSpecText((current) => ({ ...current, [key]: next })),
  });

  /**
   * The components at one packaging level, as fields.
   *
   * One box per component, labelled with the component's name and holding its
   * code and quantity — the same shape as every other field on the form, so a
   * packing specification does not read as a bulleted note in the middle of an
   * order. An empty level shows one field saying so.
   */
  const components = (label: string, list: ItemPackagingSpec['primaryComponents']) =>
    list.length === 0 ? (
      <Detail label={label} value={null} />
    ) : (
      <>
        {list.map((component) => (
          <Detail
            key={component.itemCode}
            label={component.itemName}
            value={`${component.itemCode} · ${component.quantityPer} ${component.uom}`}
          />
        ))}
      </>
    );

  return (
    <div className="mt-3 space-y-3">
      {/* The three groups the Sales Order document itself uses. Every column it
          carries is named here, whether or not a master records it yet: a field
          shown as "Not in master data" tells whoever maintains the masters what
          is missing, where an omitted field tells nobody anything. */}
      <Section nested title="Composition" subtitle={spec.itemCode}>
        <dl className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
          <Detail label="Brand" value={spec.brandName} />
          <Detail label="Composition" value={spec.genericName} />
          <Detail label="Schedule" value={spec.scheduleClassification} />
          <TypedDetail label="Dosage / Colour of Formulation / Flavour" {...typed('dosage')} />
          <Detail label="Packing" value={spec.packVariant} />
          <Detail label="Packing Type" value={null} />
          <Detail label="Units Per Pack" value={spec.unitsPerPack} />
          <Detail label="Unit" value={spec.uom} />
          <Detail label="HSN" value={spec.hsnCode} />
          <Detail label="MRP" value={spec.mrp} />
          <Detail label="Storage" value={spec.storageConditions} />
        </dl>
      </Section>

      <Section nested title="Primary Packing Specification">
        <dl className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
          <TypedDetail label="Colour and Shape of PVC / ALU / Bottle" {...typed('pvc')} />
          <TypedDetail label="PP Cap Type / Colour" {...typed('ppCap')} />
          <TypedDetail label="Dosing Cap Colour / Type / Change" {...typed('dosingCap')} />
          {/* What the packaging register does hold for this product. */}
          {components('Primary Component', spec.primaryComponents)}
        </dl>
      </Section>

      <Section nested title="Secondary Specification">
        <dl className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
          <TypedDetail label="Foil / Label Details" {...typed('foil')} />
          <TypedDetail label="Mono Details" {...typed('mono')} />
          <TypedDetail label="Outer Details" {...typed('outer')} />
          <TypedDetail label="Shipper Details" {...typed('shipper')} />
        </dl>
      </Section>
    </div>
  );
}

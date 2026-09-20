'use client';

import { useState, type ReactNode } from 'react';

import { DialogFooter, Modal } from './modal';
import { PRIMARY_BUTTON } from './ui';

/**
 * The confirmation for an action that cannot simply be undone.
 *
 * REPLACES `window.confirm` AND `window.prompt`. Those put the browser's own
 * grey box over the page, which is the wrong shape for this: it carries the
 * site's hostname rather than the record's name, it cannot show the figures the
 * decision turns on — what is reserved, what has shipped, what has been paid —
 * and its single unlabelled text box gives no hint that the reason is optional.
 * It also renders nothing on a screen reader beyond its own sentence.
 *
 * WHAT IS BEING ACTED ON IS SHOWN, not merely named. Cancelling SO-2026-0023
 * means something different when 26.34 has been invoiced and part paid, and the
 * decision is made against those numbers.
 */
export function ConfirmDialog({
  title,
  description,
  details,
  reason: reasonConfig,
  confirmLabel,
  pending = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  /** The record, as label/value pairs. Rendered as a definition list. */
  details: readonly { label: string; value: ReactNode }[];
  /** Omit where the API takes no reason — Release, for instance. */
  reason?: { label: string; hint?: string };
  confirmLabel: string;
  pending?: boolean;
  onConfirm: (reason?: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal title={title} description={description} onClose={onClose}>
      <dl className="grid gap-x-6 gap-y-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-2">
        {details.map((detail) => (
          <div key={detail.label}>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">{detail.label}</dt>
            <dd className="mt-0.5 text-sm text-slate-900">{detail.value}</dd>
          </div>
        ))}
      </dl>

      {reasonConfig && (
        <div className="mt-4">
          <label htmlFor="confirm-reason" className="field-label">
            {reasonConfig.label}
          </label>
          <input
            id="confirm-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
          {reasonConfig.hint && <p className="field-hint">{reasonConfig.hint}</p>}
        </div>
      )}

      <DialogFooter>
        <button
          type="button"
          disabled={pending}
          // Kept out of the danger palette: these are ordinary steps in the
          // flow — a cheque bounces, an order is cancelled — and colouring
          // them as alarms would make the genuinely destructive look routine.
          onClick={() => onConfirm(reason.trim() || undefined)}
          className={PRIMARY_BUTTON}
        >
          {pending ? 'Working…' : confirmLabel}
        </button>
      </DialogFooter>
    </Modal>
  );
}

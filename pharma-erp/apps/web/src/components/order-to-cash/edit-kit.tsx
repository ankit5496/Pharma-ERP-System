'use client';

import { useState, useTransition, type ReactNode } from 'react';

import { Modal } from './modal';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './ui';

/**
 * The shared shape of every Order-to-Cash edit dialog.
 *
 * WHETHER SOMETHING IS EDITABLE IS THE API'S ANSWER, NOT THIS FILE'S. Each
 * button below is hidden when the record's state forbids editing, but that is a
 * courtesy — the service re-decides it, so a stale page that still shows the
 * button gets a refusal rather than a silent write. The two must agree, and
 * when they disagree the API wins.
 *
 * Only fields the caller passes are sent. A field left untouched is omitted
 * rather than posted back unchanged, so an edit never overwrites something
 * another desk changed in the meantime with the value this page happened to
 * load.
 */

export interface EditFieldSpec {
  name: string;
  label: string;
  value: string;
  type?: 'text' | 'number' | 'date' | 'email';
  hint?: string;
  /** Renders a <select> instead of an input. */
  options?: readonly { value: string; label: string }[];
  /** Spans both columns. */
  wide?: boolean;
  /** Sent as a number rather than a string. */
  numeric?: boolean;
}

export function EditButton({ onClick, label = 'Edit' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className={SECONDARY_BUTTON}>
      {label}
    </button>
  );
}

/**
 * A dialog of flat fields over one PATCH.
 *
 * `note` is where each screen says what it will NOT let you change and why —
 * an edit form that silently omits the field somebody came to fix is worse than
 * one that explains the omission.
 */
export function EditDialog({
  title,
  description,
  note,
  fields,
  onClose,
  onSave,
}: {
  title: string;
  description?: string;
  note?: ReactNode;
  fields: readonly EditFieldSpec[];
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Modal title={title} description={description} onClose={onClose}>
      {note && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {note}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <form
        className="grid gap-4 sm:grid-cols-2"
        action={(formData) => {
          const patch: Record<string, unknown> = {};

          for (const field of fields) {
            const raw = formData.get(field.name);
            if (typeof raw !== 'string') continue;

            const trimmed = raw.trim();

            // Unchanged fields are not sent — see the note at the top.
            if (trimmed === field.value.trim()) continue;

            patch[field.name] = field.numeric
              ? trimmed === ''
                ? undefined
                : Number(trimmed)
              : trimmed;
          }

          if (Object.keys(patch).length === 0) {
            onClose();
            return;
          }

          setError(null);

          startTransition(async () => {
            const result = await onSave(patch);

            if (result.ok) onClose();
            else setError(result.error ?? 'That did not work.');
          });
        }}
      >
        {fields.map((field) => (
          <div key={field.name} className={field.wide ? 'sm:col-span-2' : undefined}>
            <label htmlFor={`o2c-edit-${field.name}`} className="field-label">
              {field.label}
            </label>

            {field.options ? (
              <select
                id={`o2c-edit-${field.name}`}
                name={field.name}
                defaultValue={field.value}
                className="field mt-1.5"
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`o2c-edit-${field.name}`}
                name={field.name}
                type={field.type ?? 'text'}
                defaultValue={field.value}
                autoComplete="off"
                className="field mt-1.5"
              />
            )}

            {field.hint && <p className="field-hint">{field.hint}</p>}
          </div>
        ))}

        <div className="flex gap-2 sm:col-span-2">
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

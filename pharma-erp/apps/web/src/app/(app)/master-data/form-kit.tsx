'use client';

import { useRef, useState, type ReactNode } from 'react';

/**
 * Shared parts for the six master-data forms.
 *
 * Here rather than repeated six times because the alternative is six sets of
 * label markup that drift: one form ends up with its hint above the input,
 * another loses the asterisk on a required field, and the section stops
 * looking like one thing. The controls themselves reuse the `.field`,
 * `.field-label` and `.field-hint` classes from globals.css, so master data
 * matches the rest of the application rather than introducing a second style.
 *
 * A client module because every form is a client component: none of them has
 * an action behind it yet, so each has to stop its own submit.
 */

/** An asterisk carries the meaning; the text makes it audible. */
function RequiredMark() {
  return (
    <span className="text-red-600">
      {' '}
      *<span className="sr-only"> (required)</span>
    </span>
  );
}

interface FieldShell {
  /** Also used as the control's id, so the label points at it. */
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  /** Span both columns of the grid — for addresses and long names. */
  wide?: boolean;
  /** Smaller control, for the line-item rows where a full-height field is too tall. */
  compact?: boolean;
}

function Shell({
  name,
  label,
  required,
  hint,
  wide,
  compact,
  children,
}: FieldShell & { children: ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <label
        htmlFor={name}
        className={compact ? 'block text-xs font-medium text-slate-600' : 'field-label'}
      >
        {label}
        {required && <RequiredMark />}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function TextField({
  type = 'text',
  placeholder,
  pattern,
  inputMode,
  maxLength,
  min,
  step,
  defaultValue,
  readOnly,
  ...shell
}: FieldShell & {
  /**
   * `readOnly`, not `disabled`: a disabled input is omitted from the form
   * submission entirely, and this is used for fields the server keeps but
   * will not let you change — the value still has to be readable and
   * copyable.
   */
  readOnly?: boolean;
  type?: 'text' | 'number' | 'date';
  placeholder?: string;
  pattern?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  maxLength?: number;
  min?: string;
  step?: string;
  /**
   * What was typed last time, when a submit came back refused. React 19
   * resets an uncontrolled form once its action resolves, so without this a
   * rejected form comes back empty and the whole thing is retyped to fix one
   * field.
   */
  defaultValue?: string;
}) {
  return (
    <Shell {...shell}>
      <input
        id={shell.name}
        name={shell.name}
        type={type}
        required={shell.required}
        placeholder={placeholder}
        pattern={pattern}
        inputMode={inputMode}
        maxLength={maxLength}
        min={min}
        step={step}
        defaultValue={defaultValue}
        readOnly={readOnly}
        // Off everywhere: a browser offering someone's home address for
        // "Issuing authority" is worse than no help at all.
        autoComplete="off"
        className={`${shell.compact ? 'field-sm mt-1 w-full' : 'field mt-1.5'} ${
          readOnly ? 'cursor-not-allowed bg-slate-100 text-slate-500' : ''
        }`}
      />
    </Shell>
  );
}

export function SelectField({
  options,
  placeholder = 'Choose…',
  defaultValue,
  onChange,
  ...shell
}: FieldShell & {
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <Shell {...shell}>
      <select
        id={shell.name}
        name={shell.name}
        required={shell.required}
        defaultValue={defaultValue ?? ''}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className={shell.compact ? 'field-sm mt-1 w-full' : 'field mt-1.5'}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function TextAreaField({
  rows = 3,
  defaultValue,
  ...shell
}: FieldShell & { rows?: number; defaultValue?: string }) {
  return (
    <Shell {...shell}>
      <textarea
        id={shell.name}
        name={shell.name}
        required={shell.required}
        rows={rows}
        defaultValue={defaultValue}
        autoComplete="off"
        className="field mt-1.5"
      />
    </Shell>
  );
}

/**
 * A yes/no that is genuinely a flag, not a two-option choice.
 *
 * Laid out with the label beside the box rather than above it, because a
 * checkbox with its label overhead reads as an empty field.
 */
export function CheckboxField({
  name,
  label,
  hint,
  wide,
  defaultChecked,
}: Omit<FieldShell, 'compact' | 'required'> & { defaultChecked?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <div className="flex items-start gap-2.5">
        <input
          id={name}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/15"
        />
        <label htmlFor={name} className="text-sm font-medium text-slate-700">
          {label}
        </label>
      </div>
      {/* Indented to the label, not the box: 16px checkbox + 10px gap. There
          is no `ml-6.5` in the default scale, so this is stated exactly. */}
      {hint && <p className="field-hint ml-[26px]">{hint}</p>}
    </div>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/**
 * A named group of fields.
 *
 * A real fieldset/legend rather than a heading and a div: screen readers
 * announce the group name with each control inside it, which is what makes
 * "Drug licence number" under a "Customer" legend unambiguous.
 */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="border-t border-slate-200 pt-6 first:border-t-0 first:pt-0">
      <legend className="text-sm font-semibold text-slate-900">{title}</legend>
      {description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>}
      <div className="mt-4">{children}</div>
    </fieldset>
  );
}

/**
 * Stated once at the top of each form, because everything below it looks
 * exactly like a working form and is not one.
 */
export function NotWiredNotice({ children }: { children: ReactNode }) {
  return (
    <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
      {children}
    </p>
  );
}

/**
 * The save row for a register that cannot save yet.
 *
 * An enabled button that silently does nothing is worse than a disabled one
 * that says why — the first looks like a bug in the save, the second looks
 * like unfinished work, and unfinished work is what it is. Registers with a
 * real endpoint use {@link SubmitActions} instead.
 */
export function FormActions({ label }: { label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-5">
      <button
        type="submit"
        disabled
        className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {label}
      </button>
      <p className="text-xs text-slate-500">
        Nothing is saved yet — this register has no endpoint behind it.
      </p>
    </div>
  );
}

/** The save row for a register that does save. */
export function SubmitActions({
  label,
  pending,
  onCancel,
}: {
  label: string;
  pending: boolean;
  onCancel?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {pending ? 'Saving…' : label}
      </button>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

/** What the API said when it refused. Shown above the fields, not below. */
export function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-6 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
    >
      {message}
    </div>
  );
}

/**
 * Row identity for the repeating sections (BOM lines, packaging components).
 *
 * Ids rather than array indices, because React keys taken from an index make
 * the wrong row disappear: remove line 2 of 4 and lines 3 and 4 shift down
 * into keys 2 and 3, so their DOM nodes — and whatever was typed into them —
 * are reused for the wrong data.
 */
export function useLineRows(initial = 1) {
  const nextId = useRef(initial);
  const [ids, setIds] = useState<number[]>(() => Array.from({ length: initial }, (_, i) => i));

  return {
    ids,
    add: () => {
      setIds((current) => [...current, nextId.current]);
      nextId.current += 1;
    },
    // The last row stays: a BOM with no material lines is not a state worth
    // being able to reach by clicking Remove four times.
    remove: (id: number) =>
      setIds((current) => (current.length === 1 ? current : current.filter((x) => x !== id))),
  };
}

export function LineRow({
  index,
  canRemove,
  onRemove,
  columns = 3,
  children,
}: {
  index: number;
  canRemove: boolean;
  onRemove: () => void;
  columns?: 2 | 3 | 4;
  children: ReactNode;
}) {
  const grid =
    columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3';

  return (
    <li className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Line {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          Remove
        </button>
      </div>
      <div className={`mt-2.5 grid gap-3 ${grid}`}>{children}</div>
    </li>
  );
}

export function AddLineButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

/** Wraps a repeating section so every one of them spaces its rows the same. */
export function LineList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-2.5">{children}</ul>;
}

/**
 * Units of measure offered across the registers.
 *
 * Shared so a BOM line and the item it points at cannot end up with different
 * spellings of the same unit.
 */
export const UOM_OPTIONS = [
  { value: 'KG', label: 'kg' },
  { value: 'G', label: 'g' },
  { value: 'MG', label: 'mg' },
  { value: 'L', label: 'L' },
  { value: 'ML', label: 'mL' },
  { value: 'NOS', label: 'nos' },
  { value: 'TABLET', label: 'tablets' },
  { value: 'CAPSULE', label: 'capsules' },
  { value: 'VIAL', label: 'vials' },
  { value: 'STRIP', label: 'strips' },
  { value: 'BOTTLE', label: 'bottles' },
] as const;

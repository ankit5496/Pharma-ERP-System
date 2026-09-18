'use client';

import { UOM_LABELS } from '@pharma-erp/types';
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
  /**
   * The refusal about THIS field, shown under it and used to redden the
   * control. Replaces the hint while it is present: the hint explains what to
   * type and the error says what is wrong with what was typed, and showing
   * both makes the person read two lines to find the one that matters.
   */
  error?: string;
  /** Span both columns of the grid — for addresses and long names. */
  wide?: boolean;
  /** Smaller control, for the line-item rows where a full-height field is too tall. */
  compact?: boolean;
}

/**
 * The control's own classes plus the invalid state.
 *
 * A red ring AND a message, never colour alone: about one man in twelve cannot
 * reliably distinguish the red from the grey, and a field that is only
 * differently-coloured is a field they cannot find.
 */
function fieldClass(base: string, error?: string): string {
  return error ? `${base} border-red-400 focus:border-red-500 focus:ring-red-500` : base;
}

function Shell({
  name,
  label,
  required,
  hint,
  error,
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
      {error ? (
        // `id` matches the control's aria-describedby, and role="alert" is what
        // makes a screen reader announce it when it appears after a save.
        <p id={`${name}-error`} role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
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
  /**
   * `email` and `tel` are here for the keyboard and the browser's own
   * autofill, not for validation: the form carries `noValidate`, so the
   * server's answer is the only one that counts.
   */
  type?: 'text' | 'number' | 'date' | 'email' | 'tel';
  placeholder?: string;
  pattern?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email';
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
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={shell.error ? `${shell.name}-error` : undefined}
        // Off everywhere: a browser offering someone's home address for
        // "Issuing authority" is worse than no help at all.
        autoComplete="off"
        className={`${fieldClass(
          shell.compact ? 'field-sm mt-1 w-full' : 'field mt-1.5',
          shell.error,
        )} ${readOnly ? 'cursor-not-allowed bg-slate-100 text-slate-500' : ''}`}
      />
    </Shell>
  );
}

/**
 * A dropdown, uncontrolled by default and controlled when `value` is given.
 *
 * WHY THE CONTROLLED MODE EXISTS. React 19 resets an uncontrolled form once its
 * action resolves. A text input picks its new `defaultValue` up from the
 * re-render, so a rejected save re-renders what was typed. A `<select>` does
 * NOT: React applies `defaultValue` by marking an option `defaultSelected` at
 * mount, and does not re-apply it afterwards — so the reset returns the select
 * to the option it had on FIRST mount, which is the placeholder.
 *
 * The visible symptom is a form that comes back after a failed save with every
 * text field preserved and every dropdown blank, which is worse than losing
 * both: it looks like the dropdowns were never filled in.
 *
 * Pass `value` + `onChange` from state to hold a dropdown across a refusal.
 */
export function SelectField({
  options,
  placeholder = 'Choose…',
  defaultValue,
  value,
  onChange,
  ...shell
}: FieldShell & {
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  defaultValue?: string;
  /** Controlled value. When given, `onChange` must be given too. */
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <Shell {...shell}>
      <select
        id={shell.name}
        name={shell.name}
        required={shell.required}
        {...(value === undefined ? { defaultValue: defaultValue ?? '' } : { value })}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={shell.error ? `${shell.name}-error` : undefined}
        className={fieldClass(shell.compact ? 'field-sm mt-1 w-full' : 'field mt-1.5', shell.error)}
      >
        {/* NOT `disabled`, deliberately. A disabled option cannot hold the
            selection, so a select whose value is "" fell through to the first
            real option — the Item form opened already showing "Raw material"
            and "kg", submitted them for someone who had chosen neither, and
            the required-field check passed because the values were genuinely
            there. QA reported it as "the dropdowns select themselves on save".

            Selectable-and-empty is what makes "nothing chosen" a real state.
            `required` on the select is what refuses it, and the browser then
            says so before the request is ever made. */}
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

/**
 * A phone number: the country code and the national number as ONE control.
 *
 * Two separate form fields were the first attempt and read as two unrelated
 * questions — "Country code" sitting above "Contact number" looks like a field
 * somebody forgot to fill in. They are one value, so they share one label, one
 * border and one focus ring; the seam between them is a divider, not a gap.
 *
 * A native `<select>` rather than a custom dropdown. It gives keyboard
 * behaviour, type-ahead and screen-reader support for nothing, and the only
 * thing it costs is that the flag has to be an emoji rather than an SVG.
 *
 * The two inputs submit separately — `<name>Dial` and `<name>National` — and
 * the server action joins them into E.164. Joining on the server rather than in
 * a hidden input means a request made without this form still has to supply a
 * country code.
 */
export function PhoneField({
  dialOptions,
  dialValue,
  onDialChange,
  defaultNational,
  placeholder,
  ...shell
}: FieldShell & {
  /** `label` is what the control shows; `title` is the full country on hover. */
  dialOptions: readonly { value: string; label: string; title?: string }[];
  dialValue: string;
  onDialChange: (value: string) => void;
  defaultNational?: string;
  placeholder?: string;
}) {
  return (
    <Shell {...shell}>
      {/* focus-within puts the ring on the group, so tabbing between the two
          halves does not make the control look like it is jumping. */}
      <div className="mt-1.5 flex rounded-md border border-slate-300 bg-white shadow-sm transition focus-within:border-slate-900 focus-within:ring-2 focus-within:ring-slate-900/15">
        <select
          id={`${shell.name}Dial`}
          name={`${shell.name}Dial`}
          value={dialValue}
          onChange={(event) => onDialChange(event.target.value)}
          aria-label="Country code"
          // Sized to "IN +91" rather than a country name, so the number beside
          // it keeps the width. Its own right border is the divider; no outer
          // ring, because the group already has one.
          className="w-[6rem] shrink-0 rounded-l-md border-r border-slate-300 bg-slate-50 px-2 py-2 text-sm tabular-nums text-slate-900 focus:outline-none"
        >
          {dialOptions.map((option) => (
            // `title` gives the full country name on hover, which is the only
            // place a native select has room for it.
            <option key={option.value} value={option.value} title={option.title}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          id={shell.name}
          name={`${shell.name}National`}
          type="tel"
          inputMode="tel"
          maxLength={20}
          placeholder={placeholder}
          defaultValue={defaultNational}
          autoComplete="off"
          className="w-full min-w-0 rounded-r-md px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
      </div>
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
/**
 * The refusal, above the form.
 *
 * SUPPRESSED when every failed field is marked on its own control. Saying
 * "Item code, Category and GST rate are required" at the top AND under each of
 * the three fields is the same sentence four times, and it pushes the form
 * down so the marked fields are further from the eye that just read it.
 *
 * Still shown when the refusal has no control to point at — a duplicate that
 * names a field the form does not render, a role check, a rule about the state
 * of a document — because that is exactly when a person has nowhere else to
 * look.
 */
export function FormError({
  message,
  fieldErrors,
}: {
  message: string;
  /** What is already marked inline; the banner hides when this covers it. */
  fieldErrors?: Record<string, string>;
}) {
  // Anything marked on a control is already said where it can be acted on, so
  // the banner has nothing left to add. Hidden on the presence of field errors
  // rather than by comparing the sentences: the banner's wording is a combined
  // list — "Party code, Party name and Status are required" — and no substring
  // of it matches the per-field "Party code is required.", so matching was
  // never going to suppress the case it was written for.
  //
  // A refusal with no field attached still shows: a role check, an expired
  // session, a rule about the state of a document. Those have no control to
  // point at, which is exactly when a banner is the only place to put them.
  if (fieldErrors && Object.keys(fieldErrors).length > 0) return null;

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
  // At least one row always: `initial` of 0 would render a section with no
  // line and no way to add one back except the Add button, which reads as a
  // broken form on the edit path when a formulation has no packing material.
  const count = Math.max(initial, 1);
  const nextId = useRef(count);
  const [ids, setIds] = useState<number[]>(() => Array.from({ length: count }, (_, i) => i));

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
export const UOM_OPTIONS = Object.entries(UOM_LABELS).map(([value, label]) => ({
  value,
  label,
}));

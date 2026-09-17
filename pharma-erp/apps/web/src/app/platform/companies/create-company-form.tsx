'use client';

import { useActionState, useState } from 'react';

import { useActionToast } from '@/components/toast';

import { createCompanyAction, type CreateCompanyState } from '../actions';

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
] as const;

const INITIAL: CreateCompanyState = { status: 'idle' };

/** Mirrors slugifyCompanyName on the server, for the live preview. */
function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

export function CreateCompanyForm() {
  const [state, formAction, isSubmitting] = useActionState(createCompanyAction, INITIAL);

  // ONLY THE FAILURE IS A TOAST. The success panel below hands over a
  // one-time password that is never shown again; moving that into a
  // notification that dismisses itself after four seconds would destroy the
  // credential before anyone could copy it. An error message has no such
  // content and belongs with every other error in the application.
  useActionToast(isSubmitting, 'error', state.status === 'error' ? state.message : undefined);
  const [companyName, setCompanyName] = useState(state.values?.companyName ?? '');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [copied, setCopied] = useState(false);

  const effectiveSlug = slugEdited ? slug : slugify(companyName);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-6">
      <h2 className="text-base font-semibold text-slate-100">Create a company</h2>
      <p className="mt-1 text-sm text-slate-400">
        Creates the company and its first administrator together. That administrator belongs to this
        company and no other, and creates every other user themselves.
      </p>

      {state.status === 'success' && state.adminPassword && (
        <div
          role="status"
          className="mt-5 rounded-md border border-green-400/40 bg-green-500/10 p-4 text-sm text-green-100"
        >
          <p className="font-medium">{state.message}</p>
          <p className="mt-2 text-green-200/80">
            Give the administrator these credentials. They must change the password on first
            sign-in.
          </p>

          <dl className="mt-3 space-y-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-green-200/70">Email</dt>
              <dd className="font-mono text-sm text-green-50">{state.adminEmail}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-green-200/70">
                Temporary password
              </dt>
              <dd className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded border border-green-400/40 bg-slate-900/60 px-3 py-2 font-mono text-sm tracking-wide text-green-50">
                  {state.adminPassword}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(state.adminPassword ?? '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="rounded border border-green-400/40 px-3 py-2 text-xs font-semibold text-green-100 hover:bg-green-500/10"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </dd>
            </div>
          </dl>

          {/* Stated plainly because it is literally true: only an argon2 hash is
              stored, so nobody — including a platform operator — can retrieve
              this later. */}
          <p className="mt-3 text-xs text-green-200/70">
            Shown once and not recoverable. If lost, the administrator can be given a new password
            from their company&rsquo;s user management, or you can create another administrator.
          </p>
        </div>
      )}

      <form action={formAction} className="mt-6 space-y-6" noValidate>
        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
            Company
          </legend>

          <Field
            id="companyName"
            label="Company name"
            required
            hint="As registered with the drug licensing authority."
            value={companyName}
            onChange={setCompanyName}
          />

          <div>
            <label htmlFor="slug" className="field-label-dark">
              Identifier
            </label>
            <input
              id="slug"
              name="slug"
              value={effectiveSlug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(event.target.value.toLowerCase());
              }}
              maxLength={63}
              spellCheck={false}
              className="field-dark mt-1.5 font-mono"
            />
            <p className="field-hint-dark">
              Derived from the name. Used in URLs and cannot be changed afterwards.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="drugLicenceNumber"
              label="Manufacturing licence"
              hint="Required before a batch can be released."
              mono
            />
            <Field id="gstin" label="GSTIN" hint="15-character registration number." mono />
          </div>

          <div>
            <label htmlFor="timezone" className="field-label-dark">
              Timezone
            </label>
            <select
              id="timezone"
              name="timezone"
              defaultValue="Asia/Kolkata"
              className="field-dark mt-1.5"
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <p className="field-hint-dark">
              Manufacturing and expiry dates are shown in this zone. Legally meaningful — use the
              site&rsquo;s own timezone.
            </p>
          </div>
        </fieldset>

        <fieldset className="space-y-4 border-t border-slate-700 pt-6">
          <legend className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
            First administrator
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="adminFullName"
              label="Full name"
              required
              defaultValue={state.values?.adminFullName}
            />
            <Field
              id="adminEmail"
              label="Email"
              type="email"
              required
              hint="What they sign in with."
              defaultValue={state.values?.adminEmail}
            />
          </div>

          <p className="text-xs text-slate-500">
            A temporary password is generated and shown once after creation. There is no role to
            choose — the first user of a company is always its Admin.
          </p>
        </fieldset>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-500"
        >
          {isSubmitting ? 'Creating…' : 'Create company'}
        </button>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  required = false,
  type = 'text',
  mono = false,
  value,
  defaultValue,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  type?: string;
  mono?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="field-label-dark">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        autoComplete="off"
        aria-describedby={hintId}
        {...(onChange
          ? { value: value ?? '', onChange: (event) => onChange(event.target.value) }
          : { defaultValue: defaultValue ?? '' })}
        className={`field-dark mt-1.5 ${mono ? 'font-mono' : ''}`}
      />
      {hint && (
        <p id={hintId} className="field-hint-dark">
          {hint}
        </p>
      )}
    </div>
  );
}

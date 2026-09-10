/**
 * The result shape every Procure-to-Pay server action returns.
 *
 * Lives here rather than in `actions.ts` for a hard reason: a `'use server'`
 * module may export ONLY async functions. Everything it exports becomes a
 * callable server endpoint, so a plain object export is rejected at runtime —
 * and because the check happens when the action module is loaded, it survives
 * both `tsc` and `next build` and first appears when a form is submitted.
 *
 * The interface alone would have been safe (types are erased), but keeping the
 * pair together means the next person adding a constant puts it somewhere it
 * cannot break.
 */
export interface ActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Echoed back so a rejected form does not lose what was typed. */
  values?: Record<string, string>;
}

/** Starting state for `useActionState`. */
export const IDLE: ActionState = { status: 'idle' };

import type { ReactNode } from 'react';

import { logoutAction } from '@/app/(auth)/login/actions';
import { DatasetPicker } from '@/components/dataset-picker';
import { PrimaryNav } from '@/components/primary-nav';
import { SectionMenu } from '@/components/section-menu';
import { READ_ONLY_ROLES, USER_ROLE_LABELS, type SessionUser } from '@pharma-erp/types';

/**
 * Chrome for every signed-in staff page: company header, the four workflow
 * tabs, the account block and the record-browser dropdown.
 *
 * The navigation is the four workflows and nothing else. The previous
 * per-module menu (Dashboard, Items & parties, Purchase, …) was mostly
 * disabled placeholder rows; the workflows say the same thing in terms of the
 * work rather than in terms of the tables, and the steps that were placeholders
 * are now sub-tabs where they belong. Nothing was deleted to achieve that —
 * /dashboard and /admin/users still resolve, and the API is untouched.
 *
 * Every tab is visible to every role for now, deliberately. Worth restating
 * because the old comment here claimed otherwise: hiding a link was never the
 * security boundary. RolesGuard and row-level security are, and both still
 * hold regardless of what this renders.
 */
export function AppShell({
  user,
  children,
  /** Dataset key when the record browser is open, so its dropdown shows it. */
  activeDataset,
  /**
   * How the area below the header behaves.
   *
   * `document` (the default) keeps the page as the scroller and makes the
   * chrome sticky. Every long page — the record tables, the workflow steps —
   * keeps the browser's own scrolling, including scroll restoration on Back,
   * which an inner scroll container silently loses.
   *
   * `fill` pins the chrome and hands the remaining viewport height to the
   * page, which then owns its own scrolling. For a screen that is a fixed
   * frame around one scrolling region — the master-data forms beside their
   * register list — that is the right shape, and it is opt-in precisely
   * because it is the wrong shape for an ordinary document.
   */
  layout = 'document',
}: {
  user: SessionUser;
  children: ReactNode;
  activeDataset?: string;
  layout?: 'document' | 'fill';
}) {
  const isReadOnly = READ_ONLY_ROLES.includes(user.role);
  const isFill = layout === 'fill';

  return (
    <div
      className={
        isFill
          ? // h-dvh, not h-screen: on a phone `100vh` is the height with the
            // address bar hidden, so a fixed frame built on it puts its
            // bottom edge off the bottom of the screen until you scroll.
            'flex h-dvh flex-col overflow-hidden bg-slate-50'
          : 'min-h-screen bg-slate-50'
      }
    >
      {/* The chrome travels together — header and both banners. Sticking only
          the header would let a banner slide under it and reappear on scroll. */}
      <div className={isFill ? 'flex-none' : 'sticky top-0 z-30'}>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
            {/* The section menu sits left of the wordmark, where a hamburger is
              looked for. It is the layer ABOVE the workflow tabs: the tabs are
              processes, the menu is places. */}
            <div className="flex min-w-0 items-center gap-3">
              <SectionMenu />

              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Pharma ERP
                </p>
                <p className="truncate text-sm font-semibold text-slate-900">{user.tenantName}</p>
              </div>
            </div>

            {/* The account block, with the table picker directly beneath it.
              `items-end` keeps both flush to the right edge on wide screens;
              on a phone the column takes the full width and the select
              stretches with it rather than being squeezed next to the button. */}
            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <div className="min-w-0 text-left sm:text-right">
                  <p className="truncate text-sm font-medium text-slate-900">{user.fullName}</p>
                  <p className="truncate text-xs text-slate-500">{USER_ROLE_LABELS[user.role]}</p>
                </div>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="whitespace-nowrap rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Sign out
                  </button>
                </form>
              </div>

              <DatasetPicker current={activeDataset} />
            </div>
          </div>

          <PrimaryNav />
        </header>

        {isReadOnly && (
          <p
            role="status"
            className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-xs font-medium text-amber-900"
          >
            Read-only access — you can view every module but cannot create or change records.
          </p>
        )}

        {user.status === 'INVITED' && (
          <p
            role="status"
            className="border-b border-slate-200 bg-slate-100 px-6 py-2 text-center text-xs font-medium text-slate-700"
          >
            Your account is pending activation by an administrator.
          </p>
        )}
      </div>

      {/* `min-h-0` is what actually makes the child scroll rather than the
          frame grow: a flex item's default min-height is its content, so
          without it the page pushes the layout past the viewport and the
          overflow-y-auto inside never has a bounded height to scroll within. */}
      {isFill ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
    </div>
  );
}

import type { ReactNode } from 'react';

import { logoutAction } from '@/app/(auth)/login/actions';
import { PrimaryNav } from '@/components/primary-nav';
import { SectionMenu } from '@/components/section-menu';
import {
  READ_ONLY_ROLES,
  USER_ROLE_LABELS,
  canManageUsers,
  type SessionUser,
} from '@pharma-erp/types';

/**
 * Chrome for every signed-in staff page: the section menu, company header, the
 * workflow tabs and the account block.
 *
 * TWO LAYERS OF NAVIGATION, which is the thing to understand here. The section
 * menu beside the wordmark is PLACES — Master Data, the workflows, the admin
 * screens. The tab row beneath is PROCESSES — the four workflows, each with
 * its own sub-tabs. They are deliberately not merged: a register you edit and
 * a process you follow are different kinds of destination.
 *
 * A raw-table picker used to sit under the account block. It was removed:
 * browsing tables is not something staff do as part of their work, and
 * offering it beside their own name invited it. The `/data` routes still
 * resolve for anyone who needs them.
 *
 * Hiding a link is never the security boundary here. RolesGuard and row-level
 * security are, and both hold regardless of what this renders.
 */
export function AppShell({
  user,
  children,
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
          </div>

          {/* The User settings tab is offered only to roles that can actually
              use it. See the note in PrimaryNav: this is a courtesy so that
              most of the company is not shown a link that bounces them back,
              not the access control. */}
          <PrimaryNav canManageUsers={canManageUsers(user.role)} />
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

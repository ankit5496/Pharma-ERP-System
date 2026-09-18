'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * One entry in a {@link RowActionMenu}.
 *
 * Either `onSelect` or `href` — an entry that navigates is a link, so it keeps
 * middle-click, "open in new tab" and the status bar preview that a button
 * throws away.
 */
export interface RowAction {
  label: string;
  onSelect?: () => void;
  href?: string;
  /**
   * Why this action is unavailable. Present means disabled, and the sentence is
   * shown under the greyed entry AND as its tooltip — an action someone cannot
   * take should never leave them guessing which rule stopped them.
   */
  disabledReason?: string | null;
  tone?: 'default' | 'danger';
}

/**
 * The actions on one table row, behind a single trigger.
 *
 * POSITIONED `fixed` AGAINST THE MEASURED BUTTON, not `absolute` inside the
 * cell. Every table on these screens is a scroll container with `overflow:
 * auto`, which clips an absolutely-positioned child — so on the lower rows the
 * menu would simply be cut off.
 *
 * IT OPENS TO THE LEFT of the trigger where there is room. The actions column
 * is the last one, so every row's button sits at the same x: a downward menu
 * lands squarely on the next row's control and hides the very thing someone
 * reaches for next. Flying left puts it over the data columns, which are being
 * read rather than clicked. Near the left edge it falls back to below-right,
 * and the top is clamped so the last row's menu is never half off the bottom.
 *
 * IT CLOSES ON SCROLL, including the table's own. The menu is fixed to the
 * viewport and does not travel with its row, so leaving it open would have it
 * hovering over a different record — `capture: true` is what catches the
 * table's scrolling, which does not bubble.
 *
 * Modelled on the register grid's row menu, which solved these same problems
 * first; this is that component generalised so both screens share one.
 */
export function RowActionMenu({
  label,
  actions,
  busy = false,
  busyLabel = 'Working…',
  disabledReason = null,
}: {
  /** Names the row for assistive technology: "Actions for PO-2026-0031". */
  label: string;
  actions: readonly RowAction[];
  busy?: boolean;
  busyLabel?: string;
  /**
   * Why NOTHING can be done to this record — closes the whole menu.
   *
   * Different from a per-entry `disabledReason`, which greys one action and
   * leaves the rest. This is for a record that has reached the end of its life:
   * opening a menu to be told four separate times that nothing applies is worse
   * than a trigger that plainly cannot be opened.
   */
  disabledReason?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);

  /** Closed for good, as opposed to merely busy. */
  const locked = disabledReason !== null;
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Its own size, needed before it renders so it can be placed. Kept in step
  // with the `w-44` and the row height below by hand: measuring would mean
  // rendering it offscreen first, which is a lot of machinery for a box whose
  // contents are two or three fixed words.
  const width = 176;
  const height = 16 + actions.length * 40;

  function toggle() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();

    if (!rect) return;

    const opensLeft = rect.left >= width + 16;

    setAnchor({
      top: Math.max(
        8,
        Math.min(opensLeft ? rect.top : rect.bottom + 4, window.innerHeight - height - 8),
      ),
      right: opensLeft
        ? window.innerWidth - rect.left + 6
        : Math.max(8, window.innerWidth - rect.right),
    });

    setIsOpen(true);
  }

  useEffect(() => {
    if (!isOpen) return undefined;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;

      setIsOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      setIsOpen(false);
      buttonRef.current?.focus();
    }

    const dismiss = () => setIsOpen(false);

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={busy || locked}
        aria-expanded={locked ? undefined : isOpen}
        aria-haspopup={locked ? undefined : 'menu'}
        aria-label={`Actions for ${label}`}
        // The reason is the tooltip, so hovering the dead control answers the
        // question it raises rather than leaving it hanging.
        title={disabledReason ?? undefined}
        aria-disabled={locked || undefined}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-slate-100"
      >
        {busy ? busyLabel : 'Actions'}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
      </button>

      {isOpen && anchor && (
        <div
          ref={menuRef}
          role="menu"
          style={{ top: anchor.top, right: anchor.right }}
          // Centred, matching the column it drops out of. A menu is more
          // usually left-aligned, but this table convention centres the Actions
          // column and a left-aligned list under a centred trigger reads as a
          // misalignment rather than as a different kind of thing.
          className="fixed z-50 w-44 rounded-md border border-slate-200 bg-white p-1 text-center shadow-lg"
        >
          {actions.map((action) => (
            <MenuItem key={action.label} action={action} onDone={() => setIsOpen(false)} />
          ))}
        </div>
      )}
    </>
  );
}

function MenuItem({ action, onDone }: { action: RowAction; onDone: () => void }) {
  const disabled = Boolean(action.disabledReason);

  const base = 'block w-full rounded px-2.5 py-2 text-center text-xs font-medium transition';

  const enabled =
    action.tone === 'danger'
      ? 'text-red-700 hover:bg-red-50'
      : 'text-slate-700 hover:bg-slate-100';

  if (disabled) {
    return (
      <span
        role="menuitem"
        aria-disabled="true"
        title={action.disabledReason ?? undefined}
        className={`${base} cursor-not-allowed text-slate-400`}
      >
        {action.label}
        {/* The reason, in place. A greyed word with no explanation makes the
            reader guess which rule stopped them. */}
        <span className="mt-0.5 block text-[10px] font-normal leading-snug text-slate-400">
          {action.disabledReason}
        </span>
      </span>
    );
  }

  if (action.href) {
    return (
      <a role="menuitem" href={action.href} onClick={onDone} className={`${base} ${enabled}`}>
        {action.label}
      </a>
    );
  }

  return (
    <button
      role="menuitem"
      type="button"
      onClick={() => {
        onDone();
        action.onSelect?.();
      }}
      className={`${base} ${enabled}`}
    >
      {action.label}
    </button>
  );
}

/**
 * Wraps children that must sit beside a menu without stretching the cell.
 *
 * CENTRED, because the cell around it is. A flex container lays its children
 * out by its own alignment properties and ignores `text-align` completely, so
 * the table-wide centring has no effect in here — `justify-center` is what
 * actually puts the control under the middle of its header.
 */
export function RowActionCell({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-center gap-2">{children}</div>;
}

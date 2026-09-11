'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { APP_SECTIONS, findSectionForPath } from '@pharma-erp/types';

/**
 * The header's hamburger: the top-level section switcher.
 *
 * A disclosure button plus a list of links, NOT `role="menu"`. The ARIA menu
 * role carries a keyboard contract — arrows move between items, Tab leaves the
 * menu entirely, Home/End jump to the ends — and claiming the role without
 * implementing it is worse for a screen-reader user than plain links, because
 * their software will then announce and operate it as something it is not.
 * Links inside a nav already Tab correctly and need no script to do it.
 *
 * Client-side only for the open/closed state and dismissal. The navigations
 * themselves are ordinary <Link> ones.
 */
export function SectionMenu() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const current = findSectionForPath(pathname);

  // The header lives in a layout that stays mounted across navigations, so
  // without this the panel is still hanging open over the page it just opened.
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    // Nothing to dismiss while closed, and no reason to hold two document-level
    // listeners on every page.
    if (!isOpen) return;

    // pointerdown, not click: it fires at the START of the gesture, so the
    // panel is already gone by the time the press lands on whatever was behind
    // it. With click the panel is still covering the page during activation.
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      setIsOpen(false);
      // The panel is unmounted on close, so focus would be sitting on a removed
      // element — which drops a keyboard user back at the top of the document.
      buttonRef.current?.focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        // A stable name: the state is already carried by aria-expanded, and a
        // label that flips to "Close" makes screen readers announce the change
        // twice, in contradictory terms.
        aria-label="Sections menu"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          aria-hidden="true"
          className="h-[18px] w-[18px]"
        >
          <path d="M3 5.5h14M3 10h14M3 14.5h14" />
        </svg>
      </button>

      {isOpen && (
        <nav
          aria-label="Sections"
          className="absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          <ul>
            {APP_SECTIONS.map((section) => {
              const isCurrent = section.key === current?.key;

              return (
                <li key={section.key}>
                  <Link
                    href={section.href}
                    aria-current={isCurrent ? 'page' : undefined}
                    // The pathname effect above covers a real navigation, but
                    // choosing the section you are already on does not change
                    // the pathname — and a menu that ignores a click reads as
                    // broken.
                    onClick={() => setIsOpen(false)}
                    className={`block rounded-md px-3 py-2 transition ${
                      isCurrent ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="block text-sm font-medium text-slate-900">
                      {section.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                      {section.purpose}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}

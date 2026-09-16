'use client';

import { useEffect } from 'react';
import { formatFileSize, type CustomerDocumentSummary } from '@pharma-erp/types';

/**
 * The icon for a document, by what it is.
 *
 * Shape as well as colour: a red badge and a blue badge are the same badge to
 * roughly one man in twelve, so the PDF carries its own lettering and the image
 * carries a picture glyph. The `title` gives the same answer on hover, and the
 * cell that renders this supplies the accessible name.
 */
export function DocumentIcon({ contentType }: { contentType: string }) {
  if (contentType === 'application/pdf') {
    return (
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-5 w-5 shrink-0"
        fill="none"
        stroke="currentColor"
      >
        <title>PDF</title>
        <path
          d="M5 2.5h6.5L16 7v10.5H5z"
          className="stroke-red-600"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M11.5 2.5V7H16"
          className="stroke-red-600"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <text
          x="10"
          y="14.6"
          textAnchor="middle"
          className="fill-red-600"
          style={{ font: '600 5.2px ui-sans-serif, system-ui', stroke: 'none' }}
        >
          PDF
        </text>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
    >
      <title>Image</title>
      <rect
        x="2.5"
        y="4"
        width="15"
        height="12"
        rx="1.5"
        className="stroke-sky-600"
        strokeWidth="1.3"
      />
      <circle cx="7" cy="8.5" r="1.4" className="fill-sky-600" style={{ stroke: 'none' }} />
      <path
        d="M3.5 14.5 8 10.5l3 2.5 2.5-2 3 3"
        className="stroke-sky-600"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A document, shown in place, with a way to save it.
 *
 * PREVIEW FIRST, DOWNLOAD SECOND. Looking at a licence to check its number is
 * the common reason to open one, and a download makes that a three-step
 * detour through the operating system's file manager.
 *
 * The file is rendered from `?preview=1`, which serves it sandboxed into a
 * unique opaque origin with no access to this application's cookies or storage.
 * That is what makes showing an uploaded PDF in an iframe safe; without it, a
 * PDF carrying JavaScript would be running against the signed-in session. The
 * download link deliberately omits the flag, so it stays an attachment and is
 * never executed at all.
 */
export function DocumentPreview({
  partyId,
  document,
  onClose,
}: {
  partyId: string;
  document: CustomerDocumentSummary;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const src = `/api/documents/${partyId}/${document.id}?preview=1`;
  const isPdf = document.contentType === 'application/pdf';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-900/50"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-preview-title"
        className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <DocumentIcon contentType={document.contentType} />
            <div className="min-w-0">
              <h2
                id="document-preview-title"
                className="truncate text-sm font-semibold text-slate-900"
              >
                {document.fileName}
              </h2>
              <p className="text-xs text-slate-500">
                {formatFileSize(document.sizeBytes)}
                {document.uploadedBy && <> · {document.uploadedBy}</>} ·{' '}
                {document.uploadedAt.slice(0, 10)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* No `?preview=1`: this one is served as an attachment, so the
                browser saves it rather than rendering it. */}
            <a
              href={`/api/documents/${partyId}/${document.id}`}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Download
            </a>

            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
          {isPdf ? (
            <iframe
              src={src}
              title={document.fileName}
              // Matches the response's own CSP sandbox, from the embedding
              // side. `allow-scripts` is what lets Chrome's PDF viewer run;
              // `allow-same-origin` is deliberately absent, which is the part
              // that keeps the file away from our cookies and storage.
              sandbox="allow-scripts"
              className="h-[70vh] w-full rounded border border-slate-200 bg-white"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={document.fileName}
              className="mx-auto max-h-[70vh] rounded border border-slate-200 bg-white object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
}

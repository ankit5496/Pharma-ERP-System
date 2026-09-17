'use client';

import { useEffect, useState } from 'react';
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
 * HOW THE BYTES REACH THE FRAME, and why it is not simply `src="…?preview=1"`.
 *
 * That route answers with `Content-Security-Policy: sandbox allow-scripts`,
 * which drops the response into a unique opaque origin. For an image that is
 * exactly right. For a PDF it is fatal: Chrome does not render PDFs itself, it
 * hands them to an internal viewer extension, and that viewer cannot be
 * instantiated inside a CSP-sandboxed origin. Chrome does not fall back — it
 * refuses the navigation and paints "This page has been blocked by Chrome",
 * which is the blank grey panel this dialog used to show for every PDF.
 *
 * So a PDF is FETCHED instead, and rendered from a `blob:` URL. The request is
 * same-origin, so the httpOnly session cookie authorises it exactly as before,
 * and the bytes never touch a third party. What keeps the file walled off is
 * the iframe's own `sandbox` attribute, which still omits `allow-same-origin`:
 * the document lands in an opaque origin with no reach into our cookies, our
 * storage or our DOM. The security property is unchanged; what moved is where
 * it is enforced — the embedding side alone, rather than the embedding side
 * plus a response header the PDF viewer cannot survive.
 *
 * Images keep the plain `?preview=1` URL. They are not scripted, the response
 * header costs nothing there, and a fetch would only add a spinner.
 *
 * The download link omits the flag either way, so it stays an attachment and is
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
  const src = `/api/documents/${partyId}/${document.id}?preview=1`;
  const isPdf = document.contentType === 'application/pdf';

  // Only a PDF takes this path; see the note above. Null means "not ready yet"
  // for a PDF and "not applicable" for an image.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!isPdf) return;

    // Tracked so a dialog closed mid-download does not set state on an
    // unmounted component, and so the object URL is always revoked — a blob
    // held open pins the whole file in memory for the life of the tab.
    let url: string | null = null;
    let cancelled = false;

    // `no-store` matches what the route already sends: these are one company's
    // compliance documents and none of them belong in a disk cache.
    fetch(src, { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        // Typed explicitly rather than trusting the blob's own type: the
        // viewer picks its renderer from this, and an octet-stream would be
        // offered as a download instead of shown.
        url = URL.createObjectURL(blob.slice(0, blob.size, 'application/pdf'));
        setBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, isPdf]);

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
            failed ? (
              // A refusal is said plainly, with the way out next to it. A grey
              // panel that never fills in is the failure this dialog had
              // before, and it told nobody anything.
              <div className="flex h-[70vh] flex-col items-center justify-center gap-3 rounded border border-slate-200 bg-white text-center">
                <p className="text-sm font-medium text-slate-700">
                  This document could not be shown here.
                </p>
                <p className="max-w-sm text-sm text-slate-500">
                  Use <strong className="font-semibold">Download</strong> to open it in your usual
                  PDF reader.
                </p>
              </div>
            ) : blobUrl ? (
              <iframe
                src={blobUrl}
                title={document.fileName}
                // The sandbox now stands on its own — the response header that
                // used to back it up is what Chrome's PDF viewer could not
                // survive. `allow-scripts` lets the viewer run;
                // `allow-same-origin` is deliberately absent, and that absence
                // is what keeps the file away from our cookies and storage.
                sandbox="allow-scripts"
                className="h-[70vh] w-full rounded border border-slate-200 bg-white"
              />
            ) : (
              <div className="flex h-[70vh] items-center justify-center rounded border border-slate-200 bg-white">
                <p className="text-sm text-slate-500">Loading preview…</p>
              </div>
            )
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

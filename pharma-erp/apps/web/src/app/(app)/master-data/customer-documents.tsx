'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  formatFileSize,
  type CustomerDocumentSummary,
} from '@pharma-erp/types';

import { DocumentIcon, DocumentPreview } from '@/components/document-preview';

import { deleteCustomerDocumentAction, listCustomerDocumentsAction } from './actions';

/**
 * A customer's paperwork, inside the Party form.
 *
 * NO UPLOAD BUTTON OF ITS OWN. Choosing a file arms it; the form's own Save is
 * what sends it, alongside everything else that changed. Two save buttons in
 * one drawer is two things to remember, and the one people forget is always the
 * one that was not labelled Save.
 *
 * That works on a NEW customer too, which is the reason for the arrangement: a
 * document is filed against a party, and a party being created has no id until
 * it saves. The form creates the party first, then attaches the file to the id
 * that comes back — so from the outside it is one action.
 *
 * The chosen file is held in a ref rather than state on purpose: a `<input
 * type="file">` is uncontrolled by definition — its value cannot be set from
 * JavaScript — so mirroring it into state would create a second version of the
 * truth that can disagree with what the control shows.
 */
export function CustomerDocuments({
  partyId,
  fileRef,
  pendingName,
  onPendingNameChange,
}: {
  /** Null while creating: there is nothing to list, and nothing to attach to yet. */
  partyId: string | null;
  /** The form reads this on submit to find the chosen file. */
  fileRef: React.RefObject<HTMLInputElement | null>;
  pendingName: string | null;
  onPendingNameChange: (name: string | null) => void;
}) {
  const [documents, setDocuments] = useState<CustomerDocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<CustomerDocumentSummary | null>(null);
  const inputId = useRef(`document-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    if (!partyId) {
      setDocuments([]);
      return;
    }

    let cancelled = false;

    void listCustomerDocumentsAction(partyId).then((result) => {
      if (cancelled) return;

      if (result.ok) setDocuments(result.data);
      else setError(result.message);
    });

    return () => {
      cancelled = true;
    };
  }, [partyId]);

  const remove = async (document: CustomerDocumentSummary) => {
    if (!partyId) return;
    if (!window.confirm(`Remove "${document.fileName}" from this customer's documents?`)) return;

    setError(null);
    setIsRemoving(document.id);

    const result = await deleteCustomerDocumentAction(partyId, document.id);

    setIsRemoving(null);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setDocuments((current) => (current ?? []).filter((entry) => entry.id !== document.id));
  };

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {documents === null ? (
        <p className="text-sm text-slate-500">Loading documents…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing on file yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              {/* Opens a preview rather than downloading, matching the register.
                  The preview carries its own Download button. */}
              <button
                type="button"
                onClick={() => setPreviewing(document)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <DocumentIcon contentType={document.contentType} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">
                    {document.fileName}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {formatFileSize(document.sizeBytes)}
                    {document.uploadedBy && <> · {document.uploadedBy}</>} ·{' '}
                    {document.uploadedAt.slice(0, 10)}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => void remove(document)}
                disabled={isRemoving === document.id}
                className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
              >
                {isRemoving === document.id ? 'Removing…' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-md border border-dashed border-slate-300 p-3.5">
        <label htmlFor={inputId} className="block text-xs font-medium text-slate-600">
          Add a document
        </label>

        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept={DOCUMENT_CONTENT_TYPES.join(',')}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;

            setError(null);

            // Refused here as well as on the API so an oversized file is caught
            // before it is sent — uploading five megabytes only to be told the
            // limit is five megabytes is a slow way to learn it.
            if (file && file.size > DOCUMENT_MAX_BYTES) {
              setError(
                `That file is ${formatFileSize(file.size)}. The limit is ${formatFileSize(
                  DOCUMENT_MAX_BYTES,
                )}.`,
              );
              event.target.value = '';
              onPendingNameChange(null);
              return;
            }

            onPendingNameChange(file?.name ?? null);
          }}
          className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
        />

        <p className="mt-2 text-xs text-slate-500">
          {pendingName ? (
            <span className="font-medium text-slate-700">
              {pendingName} will be attached when you save.
            </span>
          ) : (
            <>
              PDF, JPEG, PNG or WebP, up to {formatFileSize(DOCUMENT_MAX_BYTES)}. It is attached
              when you save, and stored in the database alongside the rest of the record.
            </>
          )}
        </p>
      </div>

      {previewing && partyId && (
        <DocumentPreview
          partyId={partyId}
          document={previewing}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  );
}

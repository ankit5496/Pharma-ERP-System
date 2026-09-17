import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { getSessionToken } from '@/lib/session';

/**
 * Serves a customer document to the browser.
 *
 * WHY THIS ROUTE EXISTS. The session token is in an httpOnly cookie on the WEB
 * origin, so the browser cannot put it on a request to the API itself — that is
 * the whole point of httpOnly, and it is why every other call goes through a
 * server component or a server action. A file is different only in that a
 * browser needs a URL it can point an `<img>`, an `<iframe>` or a download at.
 *
 * It forwards, it does not decide: the API applies the role check and row-level
 * security, and a document belonging to another company is not found there
 * rather than refused here.
 *
 * TWO MODES, and the difference is a security one.
 *
 *   `?preview=1` marks the file as one that will be rendered in place. That
 *   means the browser executes it in SOME origin, and by default that origin
 *   would be this application's — where the session cookie lives. A PDF can
 *   carry JavaScript, so the file must end up in an opaque origin with no
 *   cookies, no storage and no access to anything of ours.
 *
 *   WHERE THAT IS ENFORCED DIFFERS BY TYPE, and the reason is Chrome.
 *
 *   An IMAGE is sandboxed by the response header below. It is not scripted,
 *   the header costs nothing, and belt-and-braces is free.
 *
 *   A PDF cannot be. Chrome does not render PDFs itself; it hands them to an
 *   internal viewer extension, and that viewer cannot be instantiated inside a
 *   CSP-sandboxed origin — not even with `allow-scripts`. Chrome does not fall
 *   back, it refuses the navigation and paints "This page has been blocked by
 *   Chrome". So DocumentPreview fetches the PDF instead and renders it from a
 *   blob URL inside an iframe whose own `sandbox` attribute omits
 *   `allow-same-origin`. Same opaque origin, same isolation; enforced by the
 *   embedder rather than by a header the viewer cannot survive.
 *
 *   The header below is still sent on that fetch and is simply inert: CSP
 *   sandbox governs document navigation, not a subresource `fetch()`. It is
 *   left in place so a direct hit on this URL — pasted into the address bar,
 *   say — is still sandboxed rather than rendered in our origin.
 *
 *   Without the flag it is a download, and an attachment is never executed at
 *   all — the browser hands it to the operating system.
 *
 * `nosniff` on both: the stored content type was whitelisted on upload, and
 * letting the browser disagree with it would make that whitelist decorative.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ partyId: string; documentId: string }> },
) {
  const { partyId, documentId } = await params;
  const token = await getSessionToken();

  if (!token) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  const preview = new URL(request.url).searchParams.get('preview') === '1';

  const response = await fetch(
    `${env.apiUrl}/api/v1/parties/${partyId}/documents/${documentId}/content`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) },
  );

  if (!response.ok) {
    return NextResponse.json(
      { message: 'That document could not be opened.' },
      { status: response.status },
    );
  }

  const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';

  return new NextResponse(await response.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // The API's disposition already carries the filename; only the
      // attachment/inline part changes, and only for a preview.
      'Content-Disposition': preview
        ? (response.headers.get('Content-Disposition') ?? 'inline').replace('attachment', 'inline')
        : (response.headers.get('Content-Disposition') ?? 'attachment'),
      // The opaque origin. See the note above — this is what makes rendering an
      // uploaded file in the page safe rather than merely convenient.
      // allow-scripts WITHOUT allow-same-origin: the PDF viewer needs to run,
      // and the two together would undo the sandbox entirely — a document could
      // then remove its own sandbox attribute and reach the session.
      ...(preview ? { 'Content-Security-Policy': 'sandbox allow-scripts' } : {}),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

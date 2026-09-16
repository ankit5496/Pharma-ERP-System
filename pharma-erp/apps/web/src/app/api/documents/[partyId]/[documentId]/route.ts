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
 *   `?preview=1` renders the file in place. That means the browser executes it
 *   in SOME origin, and by default that origin would be this application's —
 *   where the session cookie lives. A PDF can carry JavaScript. So the preview
 *   response is sandboxed into a unique opaque origin: no cookies, no storage,
 *   no access to anything of ours. Without that this route would be a way to
 *   run an uploaded file against the signed-in session.
 *
 *   `allow-scripts` is in the sandbox list, and has to be: Chrome renders PDFs
 *   with an internal viewer that is itself scripted, so a bare `sandbox` with
 *   no directives blocks the viewer along with everything else and the frame
 *   shows "This page has been blocked by Chrome". What matters is that
 *   `allow-same-origin` is ABSENT — that is the directive that would hand the
 *   file our origin, and without it scripts run walled off from our cookies,
 *   our storage and our DOM.
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

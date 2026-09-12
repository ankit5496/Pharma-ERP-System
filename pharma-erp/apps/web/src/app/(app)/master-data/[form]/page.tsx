import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  findMasterDataForm,
  type BomView,
  type ItemSummary,
  type PartySummary,
} from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { MasterDataWorkspace } from '@/components/master-data-workspace';
import { apiFetch } from '@/lib/api';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Entry point for the Master Data section.
 *
 * A single dynamic segment serves all six registers, driven by
 * MASTER_DATA_FORMS in @pharma-erp/types, so the rail, this route and the
 * heading all read the same list and cannot disagree.
 *
 * This route runs on the FIRST load and on a refresh or deep link. Moving
 * between registers afterwards does not come back here — see
 * MasterDataWorkspace for why that matters: this page costs five cross-region
 * database round trips through `requireSession()`, and the forms need nothing
 * from the server to render.
 */

interface PageProps {
  // Next 15 hands params in as a promise.
  params: Promise<{ form: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { form: formKey } = await params;
  const form = findMasterDataForm(formKey);

  return { title: form ? `${form.title} · Master Data` : 'Not found' };
}

export default async function MasterDataFormPage({ params }: PageProps) {
  const { form: formKey } = await params;

  // Session first: an unknown register should not be a way to find out whether
  // someone is signed in.
  const user = await requireSession();

  const form = findMasterDataForm(formKey);

  if (!form) notFound();

  // Both live registers are fetched here, whichever one is open, because
  // switching between them is client-side and must not touch the network.
  // In parallel, so the two reads cost one round trip rather than two —
  // against a cross-region database that is the difference worth having.
  const [items, boms, parties] = await Promise.all([
    apiFetch<ItemSummary[]>('/api/v1/production/items', {
      authenticated: true,
      timeoutMs: 20_000,
    }),
    apiFetch<BomView[]>('/api/v1/production/boms', { authenticated: true, timeoutMs: 20_000 }),
    apiFetch<PartySummary[]>('/api/v1/parties', { authenticated: true, timeoutMs: 20_000 }),
  ]);

  return (
    <AppShell user={user} layout="fill">
      {/* A fixed frame: the header and the register list stay put, and only
          the form scrolls. `min-h-0` on every link in this chain is what holds
          the frame at viewport height instead of letting a long form stretch
          it — miss one and the whole page scrolls again. */}
      <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-4 pb-6 pt-8 sm:px-6">
        {/* The section owns the h1 and the register is an h2 inside the panel.
            The register title alone left the page with no sign of which
            section you were in, now that the header carries no tab row here. */}
        <h1 className="flex-none text-2xl font-semibold tracking-tight text-slate-900">
          Master Data
        </h1>

        <div className="mt-6 flex min-h-0 flex-1 flex-col">
          {/* Keyed so a real navigation to a different register remounts with
              the right tab selected. Client-side switching never re-renders
              this page, so the key is stable for the whole visit. */}
          <MasterDataWorkspace
            key={form.key}
            initialKey={form.key}
            items={items}
            boms={boms}
            parties={parties}
          />
        </div>
      </main>
    </AppShell>
  );
}

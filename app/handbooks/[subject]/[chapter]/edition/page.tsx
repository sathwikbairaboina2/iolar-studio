import Link from 'next/link';
import { isSlug } from '@/lib/paths';
import { loadChapterMeta } from '@/lib/store';
import { loadEdition } from '@/lib/digital/edition';
import { EditionView } from '@/components/handbooks/EditionView';

/** Read-only preview of the web edition written for a chapter. */
export default async function EditionPage({ params }: { params: Promise<{ subject: string; chapter: string }> }) {
  const { subject, chapter } = await params;
  const edition = isSlug(subject) && isSlug(chapter) ? await loadEdition(subject, chapter) : null;
  const title = edition ? (await loadChapterMeta(subject, chapter).catch(() => null))?.title || chapter : chapter;
  return (
    <div>
      <div style={{ padding: '12px 16px' }}>
        <Link className="st-link" href={`/handbooks/${subject}`}>Back to {subject}</Link>
      </div>
      {edition ? <EditionView edition={edition} title={title} /> : <p style={{ padding: 24 }}>No edition has been written for this chapter yet. Run Review &amp; publish to write one.</p>}
    </div>
  );
}

import { promises as fs } from 'fs';
import path from 'path';
import type { Space } from './types';
import { getStores } from './stores';

/**
 * Rebuilds the stores from what is on disk and on the jobs board. Every writer is a MERGE,
 * so this is safe to run on a live graph; --wipe first is what makes it a rebuild rather
 * than a top-up.
 */
export async function reindexKnowledge(opts: { spaces: Space[]; wipe: boolean; log?: (s: string) => void }) {
  const log = opts.log ?? (() => {});
  const { graph, vectors } = getStores();
  const out = { handbooks: 0, reels: 0, jobs: 0 };

  if (opts.wipe) {
    for (const s of opts.spaces) {
      await graph.wipe(s);
      if (s === 'reels') {
        for (const c of ['passages', 'claims']) await vectors.deleteWhere(c, { space: s }).catch(() => {});
      }
      log(`wiped ${s}`);
    }
  }

  if (opts.spaces.includes('handbooks')) {
    const store = await import('@/lib/store');
    const hb = await import('./spaces/handbooks');
    const { BookSchema } = await import('@/lib/ai/book');
    const { bookFile } = await import('@/lib/paths');
    for (const meta of await store.listSubjects()) {
      const subject = await store.loadSubject(meta.slug);
      await hb.syncSubject(subject);
      for (const chapter of await store.listChapters(meta.slug)) {
        for (const part of await store.listParts(meta.slug, chapter.slug)) {
          try {
            const post = await store.loadPost(meta.slug, chapter.slug, part);
            await hb.syncChapter(meta.slug, chapter.slug, post, await store.partStatus(meta.slug, chapter.slug, part));
            out.handbooks++;
          } catch {
            /* a part without a readable post */
          }
        }
        try {
          const book = BookSchema.parse(JSON.parse(await fs.readFile(bookFile(meta.slug, chapter.slug), 'utf8')));
          await hb.syncBook(meta.slug, chapter.slug, book);
        } catch {
          /* no book yet */
        }
      }
    }
    log(`handbooks: ${out.handbooks} chapter parts`);
  }

  if (opts.spaces.includes('reels')) {
    const { dataRoot } = await import('@/lib/paths');
    const rs = await import('@/lib/reel/research/store');
    const reels = await import('./spaces/reels');
    const root = path.join(dataRoot(), 'reel');
    const slugs = await fs.readdir(root).catch(() => [] as string[]);
    for (const slug of slugs) {
      const dir = path.join(root, slug, 'research');
      if (!(await fs.stat(path.join(dir, 'brief.json')).catch(() => null))) continue;
      const brief = await rs.readBrief(slug);
      await reels.recordBrief(slug, brief);
      const cands = await rs.readCandidates(slug).catch(() => null);
      if (cands) {
        await reels.recordHunt(slug, cands);
        const selection = await rs.readSelection(slug).catch(() => null);
        if (selection) await reels.recordReview(slug, cands.candidates, selection);
        const evidence = await rs.readAllEvidence(slug).catch(() => ({}) as Awaited<ReturnType<typeof rs.readAllEvidence>>);
        for (const c of cands.candidates) if (evidence[c.id]) await reels.recordEvidence(slug, c, evidence[c.id]);
        const script = await rs.readScript(slug).catch(() => null);
        if (script) await reels.recordScript(slug, script, cands.candidates, evidence);
      }
      out.reels++;
      log(`reel ${slug}`);
    }
  }

  if (opts.spaces.includes('jobs')) {
    try {
      const board = await import('@/lib/jobs/board');
      const jobs = await import('./spaces/jobs');
      for (const w of await board.listWeeks()) {
        await jobs.recordWeek(await board.readWeek(w.week));
        out.jobs++;
      }
      log(`jobs: ${out.jobs} weeks`);
    } catch (err) {
      log(`jobs skipped: ${String(err instanceof Error ? err.message : err)}`);
    }
  }
  return out;
}

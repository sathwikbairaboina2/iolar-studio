import type { Brief } from '@/lib/reel/research/brief';
import type { ScriptLine } from '@/lib/reel/research/script';
import { getStores } from './stores';
import { safely } from './index';
import { topicKey } from './topics';

/**
 * What the research agents are allowed to remember, as text they can read.
 *
 * Every function returns a block and a count, never throws, and never exceeds
 * MAX_BLOCK_CHARS: a prompt that grows with the graph is a prompt that one day stops
 * fitting, and the agent would fail on the reel with the most history behind it.
 */

export type Recall = { block: string; count: number };
export const MAX_BLOCK_CHARS = 1800;
const NONE: Recall = { block: '', count: 0 };

const cap = (lines: string[], head: string[] = []): Recall => {
  const out: string[] = [...head];
  let n = 0;
  for (const l of lines) {
    if ([...out, l].join('\n').length > MAX_BLOCK_CHARS) break;
    out.push(l);
    n++;
  }
  return n ? { block: out.join('\n'), count: n } : NONE;
};

const STOP = new Set(['that', 'this', 'with', 'from', 'than', 'more', 'most', 'every', 'their', 'into', 'over', 'have', 'been', 'what', 'which', 'when', 'where', 'about']);
/** The words a brief is about: four letters or more, minus function words. Exact phrases never match twice. */
const wordsOf = (brief: Brief) =>
  [...new Set([brief.topic, ...brief.mustProve].flatMap((t) => topicKey(t).split(' ')).filter((w) => w.length >= 4 && !STOP.has(w)))];

export async function recallDomains(brief: Brief): Promise<Recall> {
  return (
    (await safely('recall.domains', async () => {
      const { graph } = getStores();
      const rows = await graph.query<{ host: string; kept: number; rejected: number; walled: number }>(
        `MATCH (t) WHERE (t:Topic OR t:Claim) AND any(w IN $words WHERE t.key CONTAINS w)
         MATCH (t)<-[:ABOUT|MUST_PROVE|COVERS|HIGHLIGHT]-(x)-[:HUNTED|KEPT|REJECTED]->(s:Source)-[:ON]->(d:Domain)
         WITH DISTINCT d
         RETURN d.host AS host, coalesce(d.kept, 0) AS kept, coalesce(d.rejected, 0) AS rejected, coalesce(d.walled, 0) AS walled
         ORDER BY kept - rejected DESC LIMIT 40`,
        { words: wordsOf(brief) }
      );
      if (!rows.length) return NONE;
      const good = rows
        .filter((r) => r.walled === 0 && r.kept + r.rejected > 0)
        .slice(0, 12)
        .map((r) => `  ${r.host.padEnd(28)} kept ${r.kept}, rejected ${r.rejected}`);
      const walled = rows
        .filter((r) => r.walled > 0)
        .slice(0, 6)
        .map((r) => `  ${r.host.padEnd(28)} bot wall or unreadable, ${r.walled} time${r.walled === 1 ? '' : 's'}`);
      const lines = [
        ...(good.length ? ['What worked before for topics like these:', ...good] : []),
        ...(walled.length ? ['Avoid, they did not read last time:', ...walled] : []),
      ];
      const r = cap(lines);
      if (!r.count) return NONE;
      // The count is domains, not lines: the two headings are not memories.
      const listed = r.block.split('\n').filter((l) => l.startsWith('  ')).length;
      return { block: r.block, count: listed };
    })) ?? NONE
  );
}

export async function recallVerdicts(urls: string[]): Promise<Recall> {
  return (
    (await safely('recall.verdicts', async () => {
      if (!urls.length) return NONE;
      const { graph } = getStores();
      const rows = await graph.query<{ url: string; verdict: string; reason: string; reelSlug: string; at: string }>(
        `MATCH (r:Reel)-[h:HUNTED]->(s:Source) WHERE s.url IN $urls
         WITH s, h, r ORDER BY h.at DESC
         WITH s, collect({verdict: h.verdict, reason: h.reason, reelSlug: r.slug, at: h.at})[0] AS last
         RETURN s.url AS url, last.verdict AS verdict, last.reason AS reason, last.reelSlug AS reelSlug, last.at AS at LIMIT 20`,
        { urls: urls.slice(0, 60) }
      );
      if (!rows.length) return NONE;
      const word = (v: string) => (v === 'keep' ? 'kept' : v === 'reject' ? 'rejected' : 'marked maybe');
      return cap(
        rows.map(
          (r) =>
            `  ${r.url}: ${word(r.verdict)} on ${String(r.at).slice(0, 10)} in ${r.reelSlug}${r.reason ? ` (${String(r.reason).slice(0, 80)})` : ''}`
        ),
        ['Seen before:']
      );
    })) ?? NONE
  );
}

export async function recallClaims(brief: Brief, keptUrls: string[]): Promise<Recall> {
  return (
    (await safely('recall.claims', async () => {
      const { graph, vectors, embed } = getStores();
      const kept = new Set(keptUrls);
      const seen = new Set<string>();
      const lines: string[] = [];
      for (const claim of brief.mustProve) {
        const hits = await vectors
          .search('claims', await embed.query(claim), { limit: 3, filter: { space: 'shared' } })
          .catch(() => []);
        for (const h of hits) {
          const text = String(h.payload.text ?? '');
          if (!text || seen.has(text) || h.score < 0.5) continue;
          seen.add(text);
          const proofs = await graph.query<{ claim: string; url: string; passage: string; figure: string }>(
            `MATCH (c:Claim)-[p:SUPPORTED_BY]->(s:Source) WHERE c.text = $text
             RETURN c.text AS claim, s.url AS url, p.passage AS passage, p.figure AS figure ORDER BY p.at DESC LIMIT 2`,
            { text }
          );
          for (const p of proofs) {
            const tag = kept.has(p.url)
              ? `citable: ${p.url}`
              : `already proven elsewhere, hunt this source if you want it: ${p.url}`;
            lines.push(`- "${p.claim}" — ${tag}\n    passage: ${String(p.passage ?? '').slice(0, 240)}`);
          }
          if (lines.length >= 8) break;
        }
        if (lines.length >= 8) break;
      }
      return lines.length ? cap(lines.slice(0, 8), ['Already proven, with the passage that proved it:']) : NONE;
    })) ?? NONE
  );
}

export async function recallPassages(line: ScriptLine, keptCandidateIds: string[]): Promise<Recall> {
  return (
    (await safely('recall.passages', async () => {
      if (!keptCandidateIds.length) return NONE;
      const { vectors, embed } = getStores();
      const hits = await vectors.search('passages', await embed.query(line.text), {
        limit: 3,
        filter: { candidateId: keptCandidateIds },
      });
      if (!hits.length) return NONE;
      return cap(
        hits.map((h) => `  [${String(h.payload.sourceUrl ?? '')}] ${String(h.payload.text ?? '').slice(0, 500)}`),
        ['Nearest passages in the cited sources:']
      );
    })) ?? NONE
  );
}

export async function storeCounts(): Promise<{ nodes: number; passages: number; claims: number }> {
  const { graph, vectors } = getStores();
  const [n] = await graph.query<{ n: number }>(`MATCH (n) RETURN count(n) AS n`);
  const passages = await vectors.count('passages').catch(() => 0);
  const claims = await vectors.count('claims').catch(() => 0);
  return { nodes: Number(n?.n ?? 0), passages, claims };
}

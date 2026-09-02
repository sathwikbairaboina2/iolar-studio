import type { Brief } from '@/lib/reel/research/brief';
import type { Candidate, CandidatesFile } from '@/lib/reel/research/candidate';
import type { Selection } from '@/lib/reel/research/selection';
import type { Script } from '@/lib/reel/research/script';
import type { Evidence } from '@/lib/reel/research/gather';
import { effectiveState } from '@/lib/reel/research/selection';
import { evidenceFor } from '@/lib/reel/research/agents';
import { getStores } from '../stores';
import { safely } from '../index';
import { claimId, hostOf, pointId } from '../ids';
import { topicKey } from '../topics';
import { chunkText } from '../chunk';

/**
 * The reels space: what a reel set out to prove, what it hunted, what survived review,
 * what it wrote, and which claims a verifier passed against which passage. The last of
 * those, Claim -[SUPPORTED_BY]-> Source, is the memory the writer and verifier read.
 */

const reelRef = (slug: string) => ({ label: 'Reel', key: { slug } });
const sourceRef = (url: string) => ({ label: 'Source', key: { url } });
const claimRef = (text: string) => ({ label: 'Claim', key: { id: claimId(text) } });
const lineRef = (slug: string, id: string) => ({ label: 'ScriptLine', key: { reelSlug: slug, id } });

async function mergeSource(c: Candidate) {
  const { graph } = getStores();
  const url = c.canonicalUrl || c.url;
  const host = hostOf(url);
  await graph.mergeNode(
    'Source',
    { url },
    { space: 'shared', title: c.title, publisher: c.publisher, publishedAt: c.publishedAt, assetKind: c.assetKind }
  );
  if (host) {
    await graph.mergeNode('Domain', { host }, { space: 'shared' });
    await graph.mergeEdge(sourceRef(url), 'ON', { label: 'Domain', key: { host } });
  }
  return url;
}

/** Domain counters are derived from the edges, so they are always right after any write. */
async function refreshDomainCounters(hosts: Set<string>) {
  const { graph } = getStores();
  for (const host of hosts) {
    if (!host) continue;
    await graph.query(
      `MATCH (d:Domain {host: $host})
       OPTIONAL MATCH (d)<-[:ON]-(:Source)<-[k:KEPT]-(:Reel)
       WITH d, count(DISTINCT k) AS kept
       OPTIONAL MATCH (d)<-[:ON]-(:Source)<-[r:REJECTED]-(:Reel)
       WITH d, kept, count(DISTINCT r) AS rejected
       OPTIONAL MATCH (d)<-[:ON]-(:Source)<-[h:HUNTED]-(:Reel)
       WHERE h.reason CONTAINS 'wall' OR h.reason CONTAINS 'unreadable' OR h.reason CONTAINS 'Cloudflare' OR h.reason CONTAINS 'challenge'
       WITH d, kept, rejected, count(DISTINCT h) AS walled
       SET d.kept = kept, d.rejected = rejected, d.walled = walled`,
      { host }
    );
  }
}

export async function recordBrief(slug: string, brief: Brief): Promise<void> {
  await safely('reels.recordBrief', async () => {
    const { graph } = getStores();
    await graph.mergeNode(
      'Reel',
      { slug },
      {
        space: 'reels',
        title: brief.topic,
        angle: brief.angle,
        audience: brief.audience,
        status: brief.status,
        updatedAt: new Date().toISOString(),
      }
    );
    const key = topicKey(brief.topic);
    if (key.length >= 3) {
      await graph.mergeNode('Topic', { key }, { space: 'shared', label: brief.topic.slice(0, 60) });
      await graph.mergeEdge(reelRef(slug), 'ABOUT', { label: 'Topic', key: { key } });
    }
    for (const text of brief.mustProve) {
      await graph.mergeNode('Claim', { id: claimId(text) }, { space: 'shared', text, key: topicKey(text) });
      await graph.mergeEdge(reelRef(slug), 'MUST_PROVE', claimRef(text));
    }
  });
}

export async function recordHunt(slug: string, file: CandidatesFile): Promise<void> {
  await safely('reels.recordHunt', async () => {
    const { graph } = getStores();
    const hosts = new Set<string>();
    for (const c of file.candidates) {
      const url = await mergeSource(c);
      hosts.add(hostOf(url));
      await graph.mergeEdge(reelRef(slug), 'HUNTED', sourceRef(url), {
        verdict: c.verdict,
        score: c.scoreTotal,
        reason: c.rejectReason ?? c.whyItMatters,
        hunterAgent: c.hunterAgent,
        at: file.generatedAt,
      });
    }
    await refreshDomainCounters(hosts);
  });
}

export async function recordReview(slug: string, candidates: Candidate[], selection: Selection): Promise<void> {
  await safely('reels.recordReview', async () => {
    const { graph } = getStores();
    const hosts = new Set<string>();
    for (const c of candidates) {
      const url = c.canonicalUrl || c.url;
      hosts.add(hostOf(url));
      const state = effectiveState(c, selection);
      if (state === 'keep') {
        await graph.mergeEdge(reelRef(slug), 'KEPT', sourceRef(url), { at: selection.updatedAt });
      } else if (state === 'reject') {
        const note = selection.decisions[c.id]?.note ?? c.rejectReason ?? '';
        await graph.mergeEdge(reelRef(slug), 'REJECTED', sourceRef(url), { reason: note, at: selection.updatedAt });
      }
    }
    await refreshDomainCounters(hosts);
  });
}

export async function recordEvidence(slug: string, candidate: Candidate, evidence: Evidence): Promise<void> {
  await safely('reels.recordEvidence', async () => {
    const { vectors, embed } = getStores();
    const url = candidate.canonicalUrl || candidate.url;
    const chunks = chunkText(evidence.text);
    if (!chunks.length) return;
    await vectors.ensure('passages', embed.dims);
    const vecs = await embed.docs(chunks);
    await vectors.upsert(
      'passages',
      chunks.map((text, i) => ({
        id: pointId('reels', 'passage', `${url}#${i}`),
        vector: vecs[i],
        payload: {
          space: 'reels',
          reelSlug: slug,
          sourceUrl: url,
          host: hostOf(url),
          candidateId: candidate.id,
          kind: evidence.kind,
          chunk: i,
          text,
          retrievedAt: evidence.retrievedAt,
        },
      }))
    );
  });
}

export async function recordScript(
  slug: string,
  script: Script,
  candidates: Candidate[],
  evidence: Record<string, Evidence>
): Promise<void> {
  await safely('reels.recordScript', async () => {
    const { graph, vectors, embed } = getStores();
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const flagged = new Map(script.flags.map((f) => [f.lineId, f.issue]));
    const provesByLine = new Map<string, string[]>();
    for (const cov of script.coverage) {
      for (const id of cov.lineIds) provesByLine.set(id, [...(provesByLine.get(id) ?? []), cov.claim]);
    }
    const supported: { text: string; url: string }[] = [];

    for (const line of script.lines) {
      await graph.mergeNode(
        'ScriptLine',
        { reelSlug: slug, id: line.id },
        { space: 'reels', role: line.role, text: line.text, status: script.status, order: line.order }
      );
      await graph.mergeEdge(reelRef(slug), 'HAS_LINE', lineRef(slug, line.id));
      for (const cid of line.citations) {
        const c = byId.get(cid);
        if (!c) continue;
        const url = await mergeSource(c);
        await graph.mergeEdge(lineRef(slug, line.id), 'CITES', sourceRef(url));
        const issue = flagged.get(line.id);
        if (issue) await graph.mergeEdge(lineRef(slug, line.id), 'FLAGGED', sourceRef(url), { issue });
        for (const claim of provesByLine.get(line.id) ?? []) {
          await graph.mergeNode('Claim', { id: claimId(claim) }, { space: 'shared', text: claim, key: topicKey(claim) });
          await graph.mergeEdge(lineRef(slug, line.id), 'PROVES', claimRef(claim));
          if (!issue) {
            const text = evidence[cid]?.text ?? '';
            const passage = text ? evidenceFor(line.text, text, 600) : '';
            const figure = (line.text.match(/\d[\d,.]*/) ?? [''])[0];
            await graph.mergeEdge(claimRef(claim), 'SUPPORTED_BY', sourceRef(url), {
              passage,
              figure,
              reelSlug: slug,
              lineId: line.id,
              at: script.updatedAt,
            });
            supported.push({ text: claim, url });
          }
        }
      }
    }

    if (supported.length) {
      await vectors.ensure('claims', embed.dims);
      const vecs = await embed.docs(supported.map((s) => s.text));
      await vectors.upsert(
        'claims',
        supported.map((s, i) => ({
          id: pointId('shared', 'claim', claimId(s.text)),
          vector: vecs[i],
          payload: {
            space: 'shared',
            key: claimId(s.text),
            text: s.text,
            reelSlug: slug,
            supportedBy: [s.url],
            verifiedAt: script.updatedAt,
          },
        }))
      );
    }
  });
}

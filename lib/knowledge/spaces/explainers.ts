import type { ExplainerDoc } from '@/lib/explainer/schema';
import { getStores } from '../stores';
import { safely } from '../index';
import { claimId, pointId } from '../ids';
import { topicKey } from '../topics';
import { chunkText } from '../chunk';

/**
 * The explainers space: one board, what it set out to say, and what it put on screen.
 *
 * The point of indexing these is not a fourth island. `Topic` and `Claim` are the vocabulary
 * handbooks and reels already merge into — a chapter COVERS a Topic, a reel is ABOUT one and
 * PROVES a Claim — so an explainer about CDNs lands beside the chapter that teaches CDNs and
 * the reel that proved a claim about them, and the All tab finds them without being told to.
 *
 * SHOWS is the one that is ours: the board rows are the things the reel actually drew, which is
 * how you answer "have I explained this with a cache node before" rather than "did I mention it".
 */

const explainerRef = (slug: string) => ({ label: 'Explainer', key: { slug } });
const topicRef = (key: string) => ({ label: 'Topic', key: { key } });
const beatRef = (slug: string, id: string) => ({ label: 'Beat', key: { explainerSlug: slug, id } });

/** Two characters is an axis label, not a concept. Same floor the other spaces use. */
const MIN_TOPIC = 3;

async function linkTopic(slug: string, rel: string, phrase: string, props: Record<string, string | number> = {}) {
  const { graph } = getStores();
  const key = topicKey(phrase);
  if (key.length < MIN_TOPIC) return;
  await graph.mergeNode('Topic', { key }, { space: 'shared', label: phrase.slice(0, 60) });
  await graph.mergeEdge(explainerRef(slug), rel, topicRef(key), props);
}

/**
 * Everything the graph knows about one explainer, rewritten from the document.
 *
 * `renderedAt` comes from the render log rather than the document, because whether a board has
 * been made into a reel is not something the document itself can say.
 */
export async function recordExplainer(
  slug: string,
  doc: ExplainerDoc,
  renderedAt: string | null
): Promise<void> {
  await safely('explainers.recordExplainer', async () => {
    const { graph, vectors, embed } = getStores();

    await graph.mergeNode(
      'Explainer',
      { slug },
      {
        space: 'explainers',
        title: doc.scene.title,
        subtitle: doc.scene.subtitle ?? null,
        theme: doc.theme,
        beats: doc.beats.length,
        rows: doc.scene.rows.length,
        renderedAt,
        updatedAt: new Date().toISOString(),
      }
    );

    if (doc.brief?.topic) await linkTopic(slug, 'ABOUT', doc.brief.topic);

    if (doc.brief?.claim) {
      const text = doc.brief.claim;
      await graph.mergeNode('Claim', { id: claimId(text) }, { space: 'shared', text, key: topicKey(text) });
      await graph.mergeEdge(explainerRef(slug), 'CLAIMS', { label: 'Claim', key: { id: claimId(text) } });
    }

    // What the board draws, not what the brief says it is about: these are two different questions
    // and the second one is the one nothing else in the graph can answer.
    for (const row of doc.scene.rows) {
      await linkTopic(slug, 'SHOWS', row.label, { rowId: row.id, icon: row.icon ?? 'none' });
    }

    for (const [i, beat] of doc.beats.entries()) {
      await graph.mergeNode(
        'Beat',
        { explainerSlug: slug, id: beat.id },
        {
          space: 'explainers',
          role: beat.role,
          order: i,
          seconds: beat.sec ?? null,
          mutations: beat.mutations.length,
          label: `${beat.id} ${beat.role}`,
        }
      );
      await graph.mergeEdge(explainerRef(slug), 'HAS_BEAT', beatRef(slug, beat.id), { order: i });
    }

    // The words an explainer actually says: the claim it makes, the line it leaves you with, and
    // the log under the board. Titles are already searchable by label; these are not.
    const said = [doc.brief?.claim, doc.scene.note, ...doc.scene.panel.map((p) => p.text)]
      .filter((t): t is string => !!t && t.trim().length > 0)
      .join('\n');
    const chunks = chunkText(said);
    if (!chunks.length) return;

    await vectors.ensure('explainers', embed.dims);
    const vecs = await embed.docs(chunks);
    await vectors.upsert(
      'explainers',
      chunks.map((text, i) => ({
        id: pointId('explainers', 'board', `${slug}#${i}`),
        vector: vecs[i],
        payload: {
          space: 'explainers',
          slug,
          title: doc.scene.title,
          theme: doc.theme,
          chunk: i,
          text,
        },
      }))
    );
  });
}

import { getStores } from './stores';
import type { Space } from './types';

/**
 * What the graph page draws. One space per call, capped and most-connected first, plus
 * the cross-link view and the two searches. Node ids are built in Cypher from the
 * node's own key so the page never depends on the driver's internal ids.
 */

export type ViewNode = { id: string; label: string; kind: string; space: Space; degree: number };
export type ViewEdge = { source: string; target: string; rel: string };

const idOf = (v: string) =>
  `labels(${v})[0] + ':' + coalesce(${v}.slug, ${v}.key, ${v}.url, ${v}.host, ${v}.id, ${v}.week, ${v}.name, toString(id(${v})))`;
const labelOf = (v: string) =>
  `coalesce(${v}.label, ${v}.title, ${v}.text, ${v}.name, ${v}.host, ${v}.url, ${v}.week, ${v}.slug, ${v}.key)`;

const EDGES = `
  MATCH (n)-[r]->(m)
  WHERE (${idOf('n')}) IN $ids AND (${idOf('m')}) IN $ids
  RETURN ${idOf('n')} AS source, ${idOf('m')} AS target, type(r) AS rel`;

async function withEdges(nodes: ViewNode[]) {
  const { graph } = getStores();
  const ids = nodes.map((n) => n.id);
  const edges = ids.length ? await graph.query<ViewEdge>(EDGES, { ids }) : [];
  return { nodes, edges };
}

export async function spaceGraph(space: 'handbooks' | 'reels' | 'jobs' | 'explainers', limit = 400) {
  const { graph } = getStores();
  const nodes = await graph.query<ViewNode>(
    `MATCH (n) WHERE n.space = $space OR n.space = 'shared'
     WITH n, size([(n)--(x) WHERE x.space = $space OR x.space = 'shared' | 1]) AS degree
     WHERE n.space = $space OR degree > 0
     RETURN ${idOf('n')} AS id, ${labelOf('n')} AS label, labels(n)[0] AS kind, n.space AS space, degree
     ORDER BY degree DESC LIMIT toInteger($limit)`,
    { space, limit }
  );
  return withEdges(nodes);
}

export async function crossLinks(limit = 400) {
  const { graph } = getStores();
  const nodes = await graph.query<ViewNode>(
    `MATCH (n)--(m) WHERE m.space <> 'shared'
     WITH n, collect(DISTINCT m.space) AS spaces, count(m) AS degree
     WHERE size(spaces) > 1
     RETURN ${idOf('n')} AS id, ${labelOf('n')} AS label, labels(n)[0] AS kind, n.space AS space, degree
     ORDER BY degree DESC LIMIT toInteger($limit)`,
    { limit }
  );
  return withEdges(nodes);
}

export async function labelSearch(space: string, q: string) {
  const { graph } = getStores();
  return graph.query<ViewNode>(
    `MATCH (n) WHERE (n.space = $space OR n.space = 'shared' OR $space = 'all')
       AND toLower(${labelOf('n')}) CONTAINS toLower($q)
     WITH n, size([(n)--() | 1]) AS degree
     RETURN ${idOf('n')} AS id, ${labelOf('n')} AS label, labels(n)[0] AS kind, n.space AS space, degree
     ORDER BY degree DESC LIMIT 50`,
    { space, q }
  );
}

const COLLECTIONS: Record<string, string[]> = {
  reels: ['passages', 'claims'],
  handbooks: ['chapters'],
  jobs: [],
  explainers: ['explainers'],
  all: ['passages', 'claims', 'chapters', 'explainers'],
};

/** The search the research agents use, exposed so what they would see is never a mystery. */
export async function meaningSearch(space: string, q: string) {
  const { vectors, embed } = getStores();
  const vector = await embed.query(q);
  const out: { collection: string; score: number; text: string; payload: Record<string, unknown> }[] = [];
  for (const c of COLLECTIONS[space] ?? []) {
    const hits = await vectors.search(c, vector, { limit: 8 }).catch(() => []);
    for (const h of hits) out.push({ collection: c, score: h.score, text: String(h.payload.text ?? ''), payload: h.payload });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

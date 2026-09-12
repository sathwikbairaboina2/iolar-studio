import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';
import { recordExplainer } from '@/lib/knowledge/spaces/explainers';
import { topicKey } from '@/lib/knowledge/topics';
import { claimId } from '@/lib/knowledge/ids';
import type { ExplainerDoc } from '@/lib/explainer/schema';

let graph: FakeGraph;
let vectors: FakeVectors;
beforeEach(() => {
  graph = new FakeGraph();
  vectors = new FakeVectors();
  useStoresForTests({ graph, vectors, embed: new FakeEmbed() });
});

const doc = (over: Partial<ExplainerDoc> = {}): ExplainerDoc =>
  ({
    template: 'explainer',
    theme: 'blueprint',
    ratio: '9:16',
    fps: 30,
    brand: { handle: '@stackframe', name: 'Stack Frame' },
    brief: {
      topic: 'What a CDN actually buys you',
      audience: 'backend engineers',
      claim: 'Cached bytes travel a shorter distance, so the page paints sooner.',
      seconds: 18,
    },
    scene: {
      title: 'The CDN Distance Problem',
      subtitle: 'Why your static assets are slow',
      rows: [
        { id: 'client', label: 'User Browser', value: null, unit: '', sub: 'New York', state: 'idle', tier: 0, col: 0, icon: 'client' },
        { id: 'origin', label: 'Origin Server', value: null, unit: '', sub: 'Frankfurt', state: 'idle', tier: 1, col: 0, icon: 'server' },
      ],
      links: [],
      panel: [{ text: 'RTT: 240ms (NY -> FR)', state: 'bad' }],
      note: 'Cache what you can. Serve it close.',
    },
    beats: [
      { id: 'b1', role: 'hook', sec: 3, mutations: [] },
      { id: 'b2', role: 'payoff', sec: 4, mutations: [{ op: 'set', row: 'origin', value: 12, state: 'good' }] },
    ],
    ...over,
  }) as ExplainerDoc;

describe('recording an explainer in the graph', () => {
  it('merges the explainer itself with what the shelf shows about it', async () => {
    await recordExplainer('what-a-cdn-actually-buys-you', doc(), '2026-09-12T07:00:00.000Z');
    const n = graph.node('Explainer', { slug: 'what-a-cdn-actually-buys-you' });
    expect(n?.props.space).toBe('explainers');
    expect(n?.props.title).toBe('The CDN Distance Problem');
    expect(n?.props.theme).toBe('blueprint');
    expect(n?.props.beats).toBe(2);
    expect(n?.props.renderedAt).toBe('2026-09-12T07:00:00.000Z');
  });

  it('is ABOUT the brief topic as a shared node, so a chapter on the same thing meets it', async () => {
    await recordExplainer('cdn', doc(), null);
    const key = topicKey('What a CDN actually buys you');
    expect(graph.node('Topic', { key })?.props.space).toBe('shared');
    expect([...graph.edges.values()].some((e) => e.rel === 'ABOUT' && e.to.includes(key))).toBe(true);
  });

  it('CLAIMS the brief claim against the same shared Claim a reel proves', async () => {
    await recordExplainer('cdn', doc(), null);
    const id = claimId('Cached bytes travel a shorter distance, so the page paints sooner.');
    expect(graph.node('Claim', { id })?.props.space).toBe('shared');
    expect([...graph.edges.values()].some((e) => e.rel === 'CLAIMS')).toBe(true);
  });

  it('SHOWS a shared topic per board row, which is what it actually put on screen', async () => {
    await recordExplainer('cdn', doc(), null);
    const shows = [...graph.edges.values()].filter((e) => e.rel === 'SHOWS');
    expect(shows).toHaveLength(2);
    expect(graph.node('Topic', { key: topicKey('User Browser') })?.props.label).toBe('User Browser');
  });

  it('keeps the beats, because the shape of a reel is its roles in order', async () => {
    await recordExplainer('cdn', doc(), null);
    const b2 = graph.node('Beat', { explainerSlug: 'cdn', id: 'b2' });
    expect(b2?.props.role).toBe('payoff');
    expect(b2?.props.mutations).toBe(1);
    expect([...graph.edges.values()].filter((e) => e.rel === 'HAS_BEAT')).toHaveLength(2);
  });

  it('indexes the claim, the note and the panel for the meaning search', async () => {
    await recordExplainer('cdn', doc(), null);
    const points = [...(vectors.collections.get('explainers')?.points.values() ?? [])];
    expect(points.length).toBeGreaterThan(0);
    const text = points.map((p) => String(p.payload.text)).join(' ');
    expect(text).toContain('Cache what you can');
    expect(text).toContain('RTT: 240ms');
    expect(points.every((p) => p.payload.space === 'explainers')).toBe(true);
    expect(points.every((p) => p.payload.slug === 'cdn')).toBe(true);
  });
});

describe('an explainer nobody wrote a brief for', () => {
  const briefless = () => doc({ brief: null } as Partial<ExplainerDoc>);

  it('still lands, and invents neither a topic nor a claim', async () => {
    await recordExplainer('blank', briefless(), null);
    expect(graph.node('Explainer', { slug: 'blank' })).toBeTruthy();
    expect([...graph.edges.values()].some((e) => e.rel === 'ABOUT')).toBe(false);
    expect([...graph.edges.values()].some((e) => e.rel === 'CLAIMS')).toBe(false);
  });

  it('still shows its board, because the rows are on screen either way', async () => {
    await recordExplainer('blank', briefless(), null);
    expect([...graph.edges.values()].filter((e) => e.rel === 'SHOWS')).toHaveLength(2);
  });
});

describe('a board row too short to be a topic', () => {
  it('is not merged, so the shared vocabulary does not fill with noise', async () => {
    const d = doc();
    d.scene.rows = [{ ...d.scene.rows[0], id: 'x', label: 'DB' }];
    await recordExplainer('short', d, null);
    expect([...graph.edges.values()].some((e) => e.rel === 'SHOWS')).toBe(false);
  });
});

describe('saving an explainer in the studio', () => {
  it('mirrors it into the graph, so the tab is not stale until the next reindex', async () => {
    const { mkdtempSync } = await import('fs');
    const os = await import('os');
    const path = await import('path');
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'explainer-sync-'));

    const store = await import('@/lib/explainer/store');
    await store.save('live-one', store.blankDoc('Live one', 'midnight'));

    expect(graph.node('Explainer', { slug: 'live-one' })?.props.title).toBe('Live one');
  });

  it('does not fail the save when the graph is down', async () => {
    const { mkdtempSync } = await import('fs');
    const os = await import('os');
    const path = await import('path');
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'explainer-sync-'));
    graph.mergeNode = async () => {
      throw new Error('neo4j is not running');
    };

    const store = await import('@/lib/explainer/store');
    const doc = await store.save('still-saved', store.blankDoc('Still saved', 'midnight'));

    expect(doc.scene.title).toBe('Still saved');
    await expect(store.get('still-saved')).resolves.toBeTruthy();
  });
});

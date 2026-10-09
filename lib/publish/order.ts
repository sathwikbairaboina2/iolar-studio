import { runClaude } from '@/lib/ai/claude';
import { extractJson } from '@/lib/ai/revise';
import type { OrderState } from './state';

export type OrderInput = { slug: string; title: string; summary: string; outline: string[]; studioOrder: number };

/** Problems with an order, checked without AI: every chapter once, no stranger, every prerequisite earlier (which also rules out a cycle). */
export function checkOrder(order: string[], prerequisites: Record<string, string[]>, slugs: string[]): string[] {
  const problems: string[] = [];
  const known = new Set(slugs);
  const at = new Map<string, number>();
  order.forEach((s, i) => {
    if (!known.has(s)) problems.push(`${s} is not a selected chapter`);
    else if (at.has(s)) problems.push(`${s} appears more than once`);
    else at.set(s, i);
  });
  for (const s of slugs) if (!at.has(s)) problems.push(`${s} is missing from the order`);
  for (const [slug, pres] of Object.entries(prerequisites)) {
    if (!known.has(slug)) continue;
    for (const p of pres) {
      if (!known.has(p)) continue;
      if (p === slug) problems.push(`${slug} needs itself`);
      else if (at.has(p) && at.has(slug) && at.get(p)! > at.get(slug)!) problems.push(`${slug} comes before its prerequisite ${p}`);
    }
  }
  return problems;
}

/** Edges between known chapters, minus any edge that would close a cycle (earlier edges win). */
function acyclicEdges(slugs: string[], prerequisites: Record<string, string[]>): Record<string, string[]> {
  const known = new Set(slugs);
  const kept: Record<string, string[]> = {};
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(kept[n] ?? []));
    }
    return false;
  };
  for (const slug of slugs) {
    for (const p of prerequisites[slug] ?? []) {
      if (!known.has(p) || p === slug) continue;
      if (reaches(p, slug)) continue; // p already needs slug: this edge would close a loop
      const list = (kept[slug] ??= []);
      if (!list.includes(p)) list.push(p);
    }
  }
  return kept;
}

/** Topological order (Kahn), studio order breaking ties; edges that would form a cycle are dropped. */
export function fallbackOrder(chapters: OrderInput[], prerequisites: Record<string, string[]>): string[] {
  const slugs = [...chapters].sort((a, b) => a.studioOrder - b.studioOrder).map((c) => c.slug);
  const edges = acyclicEdges(slugs, prerequisites);
  const done = new Set<string>();
  const out: string[] = [];
  while (out.length < slugs.length) {
    const next = slugs.find((s) => !done.has(s) && (edges[s] ?? []).every((p) => done.has(p)));
    if (!next) break; // unreachable: the edges are acyclic
    done.add(next);
    out.push(next);
  }
  return out;
}

type Proposal = Omit<OrderState, 'basis' | 'approvedBy'>;

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function sanitize(raw: unknown, slugs: string[]): Proposal {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const known = new Set(slugs);
  const prerequisites: Record<string, string[]> = {};
  if (o.prerequisites && typeof o.prerequisites === 'object') {
    for (const [slug, pres] of Object.entries(o.prerequisites as Record<string, unknown>)) {
      if (known.has(slug)) prerequisites[slug] = strs(pres).filter((p) => known.has(p));
    }
  }
  const c = Number(o.confidence);
  return {
    order: strs(o.order).filter((s) => known.has(s)),
    prerequisites,
    gaps: strs(o.gaps),
    overlaps: strs(o.overlaps),
    confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0,
  };
}

/** Asks Claude once for a learnable order; anything that fails the check becomes a valid fallback that waits for a person. */
export async function proposeOrder(subject: string, chapters: OrderInput[]): Promise<Proposal> {
  const slugs = chapters.map((c) => c.slug);
  const fallback = (prerequisites: Record<string, string[]>, why: string, extra: Partial<Proposal> = {}): Proposal => {
    const clean = acyclicEdges(slugs, prerequisites);
    return { order: fallbackOrder(chapters, clean), prerequisites: clean, gaps: [why, ...(extra.gaps ?? [])], overlaps: extra.overlaps ?? [], confidence: 0 };
  };

  let raw: string;
  try {
    raw = await runClaude([
      `You are ordering the chapters of the "${subject}" handbook so a learner meets each idea after the ones it needs.`,
      'Chapters:',
      chapters.map((c) => `- ${c.slug}: ${c.title}. ${c.summary}${c.outline.length ? ` Covers: ${c.outline.join('; ')}` : ''}`).join('\n'),
      'Return ONLY a JSON object, no prose and no markdown fences:',
      '{"order":[slugs, every chapter exactly once],"prerequisites":{"slug":[slugs that must be read before it]},"gaps":[topics a learner needs that no chapter covers],"overlaps":[topics several chapters repeat],"confidence":0-1}',
      'Use the slugs exactly as given. "confidence" is how sure you are the order teaches well.',
    ].join('\n\n'), { timeoutMs: 300_000 });
  } catch (err) {
    const why = err instanceof Error && err.name === 'ClaudeUnavailableError' ? 'Claude is not available' : 'the order pass failed';
    return fallback({}, `Order could not be checked: ${why}`);
  }

  let parsed: Proposal;
  try {
    parsed = sanitize(extractJson(raw), slugs);
  } catch {
    return fallback({}, 'Order could not be checked: the answer was not readable');
  }
  const problems = checkOrder(parsed.order, parsed.prerequisites, slugs);
  if (problems.length) return fallback(parsed.prerequisites, `Order could not be checked: ${problems.join('; ')}`, { gaps: parsed.gaps, overlaps: parsed.overlaps });
  return parsed;
}

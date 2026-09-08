/**
 * Rewrites the three diagram kinds the old engine drew — memory-cells, tree, compare — into
 * this engine's vocabulary, in place, across every post on disk.
 *
 * The corpus merged onto one branch carries chapters rendered before those kinds were dropped.
 * Their content is fine; only the shape is stale, so this is a deterministic translation and
 * never a re-generation:
 *   memory-cells -> array   (the cells, with the label as the caption)
 *   compare      -> cards   (one card per side, its items as lines)
 *   tree         -> flowchart when it fits the 12-node budget, else chain (root as the title,
 *                   each branch a step, its children the note beside it)
 *
 * It also re-runs safely: an array whose cells are too long for their boxes — the shape a
 * phrase-carrying memory-cells lands in — is reshaped into a matrix.
 *
 * Run: npx tsx scripts/migrate-legacy-diagrams.mts [--dry]
 */
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

type Json = Record<string, unknown>;

const dry = process.argv.includes('--dry');
const root = 'data/handbooks';

/**
 * An array draws one narrow box per cell, so it only works when the labels are short. The old
 * memory-cells often held a phrase ("[0] whole match"), which overflows its box and breaks the
 * row; those become a matrix instead, two per row, which is a grid of real cells.
 */
const ARRAY_CELL_MAX = 10;

function memoryCells(spec: Json) {
  const cells = ((spec.cells as string[]) ?? []).slice(0, 20);
  const label = typeof spec.label === 'string' ? spec.label : undefined;
  const caption = label ? { caption: label } : {};
  if (cells.every((c) => c.length <= ARRAY_CELL_MAX)) {
    return { kind: 'array', spec: { cells, ...caption } };
  }
  const rows: string[][] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
  return { kind: 'matrix', spec: { rows, ...caption } };
}

/** An array written by the first pass (or by hand) whose cells are too long for their boxes. */
function wideArray(spec: Json) {
  const cells = ((spec.cells as string[]) ?? []).slice(0, 20);
  const caption = typeof spec.caption === 'string' ? { caption: spec.caption } : {};
  const rows: string[][] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
  return { kind: 'matrix', spec: { rows, ...caption } };
}

function compare(spec: Json) {
  const side = (s: Json | undefined, fallback: string) => ({
    title: (s?.title as string) || fallback,
    lines: ((s?.items as string[]) ?? []).filter(Boolean),
  });
  return {
    kind: 'cards',
    spec: { cards: [side(spec.left as Json, 'Option A'), side(spec.right as Json, 'Option B')] },
  };
}

function tree(spec: Json) {
  const rootText = (spec.root as string) || 'root';
  const branches = ((spec.branches as { label: string; children?: string[] }[]) ?? []).filter((b) => b?.label);
  const childCount = branches.reduce((n, b) => n + (b.children?.length ?? 0), 0);

  // A flowchart keeps the split visible, but only inside its budget: 12 nodes, 7 rows, 4 per row.
  if (1 + branches.length + childCount <= 12 && branches.length <= 4 && 2 + branches.length <= 7) {
    const nodes: Record<string, { text: string; shape?: string }> = { n0: { text: rootText, shape: 'diamond' } };
    const rows: string[][] = [['n0']];
    const edges: { from: string; to: string }[] = [];
    const branchRow: string[] = [];
    branches.forEach((b, i) => {
      const id = `b${i}`;
      nodes[id] = { text: b.label };
      branchRow.push(id);
      edges.push({ from: 'n0', to: id });
    });
    rows.push(branchRow);
    branches.forEach((b, i) => {
      const kids = (b.children ?? []).filter(Boolean);
      if (!kids.length) return;
      const row: string[] = [];
      kids.forEach((c, j) => {
        const id = `c${i}_${j}`;
        nodes[id] = { text: c };
        row.push(id);
        edges.push({ from: `b${i}`, to: id });
      });
      rows.push(row);
    });
    if (rows.length <= 7) return { kind: 'flowchart', spec: { title: rootText, rows, nodes, edges } };
  }

  // Too wide to draw: keep every word as a chain of labelled steps instead.
  return {
    kind: 'chain',
    spec: {
      title: rootText,
      steps: branches.slice(0, 8).map((b) => ({
        text: b.label,
        ...(b.children?.length ? { note: b.children.join(' · ') } : {}),
      })),
    },
  };
}

const CONVERT: Record<string, (spec: Json) => { kind: string; spec: unknown } | null> = {
  'memory-cells': memoryCells,
  compare,
  tree,
  // Idempotent clean-up: an array whose cells never fit their boxes is really a matrix.
  array: (spec) => {
    const cells = (spec.cells as string[]) ?? [];
    if (!cells.length || cells.every((c) => c.length <= ARRAY_CELL_MAX)) return null;
    if ((spec.pointers as unknown[])?.length || (spec.highlight as unknown[])?.length) return null;
    return wideArray(spec);
  },
};

let files = 0;
const counts: Record<string, number> = {};

for (const subject of readdirSync(root)) {
  const sd = path.join(root, subject);
  for (const chapter of readdirSync(sd)) {
    const parts = path.join(sd, chapter, 'parts');
    if (!existsSync(parts)) continue;
    for (const part of readdirSync(parts)) {
      const file = path.join(parts, part, 'post.json');
      if (!existsSync(file)) continue;
      const post = JSON.parse(readFileSync(file, 'utf8'));
      let touched = false;
      for (const slide of post.slides ?? []) {
        for (const block of slide.blocks ?? []) {
          if (block?.type !== 'diagram') continue;
          const convert = CONVERT[block.kind as string];
          if (!convert) continue;
          const next = convert((block.spec ?? {}) as Json);
          if (!next) continue;
          counts[`${block.kind} -> ${next.kind}`] = (counts[`${block.kind} -> ${next.kind}`] ?? 0) + 1;
          block.kind = next.kind;
          block.spec = next.spec;
          touched = true;
        }
      }
      if (touched) {
        files += 1;
        if (!dry) writeFileSync(file, JSON.stringify(post, null, 2));
      }
    }
  }
}

console.log(dry ? 'would rewrite' : 'rewrote', files, 'post(s):', JSON.stringify(counts));

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
 * Run: npx tsx scripts/migrate-legacy-diagrams.mts [--dry]
 */
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

type Json = Record<string, unknown>;

const dry = process.argv.includes('--dry');
const root = 'data/handbooks';

function memoryCells(spec: Json) {
  const cells = (spec.cells as string[]) ?? [];
  const label = typeof spec.label === 'string' ? spec.label : undefined;
  return { kind: 'array', spec: { cells: cells.slice(0, 20), ...(label ? { caption: label } : {}) } };
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

const CONVERT: Record<string, (spec: Json) => { kind: string; spec: unknown }> = {
  'memory-cells': memoryCells,
  compare,
  tree,
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
          counts[block.kind] = (counts[block.kind] ?? 0) + 1;
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

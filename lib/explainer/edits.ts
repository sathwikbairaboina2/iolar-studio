import type { ExplainerDoc, Link, Mutation, Role, Row, RowState } from './schema';

/**
 * Pure functions over a document. Every one returns a new document and none mutates its input.
 *
 * There is no validation here on purpose: `commands.ts` owns argument parsing, the reference
 * checks and the fold. Keeping this layer dumb is what lets it be read at a glance.
 */

const clone = (doc: ExplainerDoc): ExplainerDoc => ({
  ...doc,
  scene: {
    ...doc.scene,
    rows: doc.scene.rows.map((r) => ({ ...r })),
    links: doc.scene.links.map((l) => ({ ...l })),
    panel: doc.scene.panel.map((p) => ({ ...p })),
  },
  beats: doc.beats.map((b) => ({ ...b, mutations: b.mutations.map((m) => ({ ...m })) as Mutation[] })),
});

export function setTheme(doc: ExplainerDoc, theme: string): ExplainerDoc {
  return { ...clone(doc), theme };
}

/** The JSON escape hatch. It is a command so that even a wholesale paste is undoable. */
export function replaceDoc(_doc: ExplainerDoc, next: ExplainerDoc): ExplainerDoc {
  return clone(next);
}

export function setSceneText(
  doc: ExplainerDoc, field: 'title' | 'subtitle' | 'note', to: string | null
): ExplainerDoc {
  const out = clone(doc);
  if (field === 'title') out.scene.title = to ?? '';
  else if (field === 'subtitle') out.scene.subtitle = to;
  else out.scene.note = to;
  return out;
}

export function addSceneRow(doc: ExplainerDoc, row: Row): ExplainerDoc {
  const out = clone(doc);
  out.scene.rows.push({ ...row });
  return out;
}

export function setSceneRow(doc: ExplainerDoc, rowId: string, patch: Partial<Row>): ExplainerDoc {
  const out = clone(doc);
  const row = out.scene.rows.find((r) => r.id === rowId);
  if (row) Object.assign(row, patch);
  return out;
}

export function removeSceneRow(doc: ExplainerDoc, rowId: string): ExplainerDoc {
  const out = clone(doc);
  out.scene.rows = out.scene.rows.filter((r) => r.id !== rowId);
  out.scene.links = out.scene.links.filter((l) => l.from !== rowId && l.to !== rowId);
  return out;
}

/** Matching is on the pair, so restating a link edits the one already drawn. */
export function setSceneLink(
  doc: ExplainerDoc, from: string, to: string, state: RowState, label: string | null | undefined
): ExplainerDoc {
  const out = clone(doc);
  const existing = out.scene.links.find((l) => l.from === from && l.to === to);
  if (existing) {
    existing.state = state;
    if (label !== undefined) existing.label = label;
  } else {
    out.scene.links.push({ from, to, label: label ?? null, state } as Link);
  }
  return out;
}

export function addScenePanel(doc: ExplainerDoc, text: string, state: RowState): ExplainerDoc {
  const out = clone(doc);
  out.scene.panel.push({ text, state });
  return out;
}

/** `b1`, `b2`, … skipping anything taken, so ids stay readable and stay unique. */
function freeBeatId(doc: ExplainerDoc): string {
  const taken = new Set(doc.beats.map((b) => b.id));
  for (let n = 1; ; n += 1) {
    const id = `b${n}`;
    if (!taken.has(id)) return id;
  }
}

export function addBeat(doc: ExplainerDoc, role: Role, after: string | undefined): ExplainerDoc {
  const out = clone(doc);
  const beat = { id: freeBeatId(doc), role, sec: null, mutations: [] as Mutation[] };
  const at = after ? out.beats.findIndex((b) => b.id === after) : -1;
  if (at === -1) out.beats.push(beat);
  else out.beats.splice(at + 1, 0, beat);
  return out;
}

export function removeBeat(doc: ExplainerDoc, beatId: string): ExplainerDoc {
  const out = clone(doc);
  out.beats = out.beats.filter((b) => b.id !== beatId);
  return out;
}

export function moveBeat(doc: ExplainerDoc, beatId: string, toIndex: number): ExplainerDoc {
  const out = clone(doc);
  const from = out.beats.findIndex((b) => b.id === beatId);
  if (from === -1) return out;
  const [beat] = out.beats.splice(from, 1);
  out.beats.splice(Math.max(0, Math.min(toIndex, out.beats.length)), 0, beat);
  return out;
}

export function setBeatSec(doc: ExplainerDoc, beatId: string, sec: number | null): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (beat) beat.sec = sec;
  return out;
}

export function setBeatRole(doc: ExplainerDoc, beatId: string, role: Role): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (beat) beat.role = role;
  return out;
}

export function addMutation(doc: ExplainerDoc, beatId: string, mutation: Mutation): ExplainerDoc {
  const out = clone(doc);
  out.beats.find((b) => b.id === beatId)?.mutations.push(mutation);
  return out;
}

export function updateMutation(
  doc: ExplainerDoc, beatId: string, index: number, mutation: Mutation
): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (beat && beat.mutations[index]) beat.mutations[index] = mutation;
  return out;
}

export function removeMutation(doc: ExplainerDoc, beatId: string, index: number): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (beat) beat.mutations = beat.mutations.filter((_, i) => i !== index);
  return out;
}

export function moveMutation(
  doc: ExplainerDoc, beatId: string, from: number, to: number
): ExplainerDoc {
  const out = clone(doc);
  const beat = out.beats.find((b) => b.id === beatId);
  if (!beat || !beat.mutations[from]) return out;
  const [m] = beat.mutations.splice(from, 1);
  beat.mutations.splice(Math.max(0, Math.min(to, beat.mutations.length)), 0, m);
  return out;
}

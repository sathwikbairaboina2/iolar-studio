import { applyBeat, type ExplainerDoc, type Row } from './schema';

/**
 * Where a field edit lands, given where you are standing.
 *
 * An explainer is one scene that mutates, so "edit this node" means two different things depending
 * on the beat: at the first beat the node is the scene, and at any later beat the node is what that
 * beat does to the scene. Getting this wrong writes a second `set` for the same row in the same
 * beat, which folds cleanly, renders cleanly, and is wrong.
 *
 * Pure, and it names a command rather than applying one: the caller sends it through the same
 * `/edit` route everything else uses.
 */

export type RowPatch = Partial<Pick<Row, 'label' | 'value' | 'unit' | 'sub' | 'state' | 'tier' | 'col' | 'icon'>>;
export type Edit = { op: string; args: Record<string, unknown> };

/** The scene as it stands at a beat, including what that beat itself does. */
function sceneAt(doc: ExplainerDoc, beatId: string) {
  let scene = doc.scene;
  for (const beat of doc.beats) {
    scene = applyBeat(scene, beat);
    if (beat.id === beatId) return scene;
  }
  return null;
}

export function rowsAt(doc: ExplainerDoc, beatId: string): Row[] {
  return sceneAt(doc, beatId)?.rows ?? [];
}

export function rowAt(doc: ExplainerDoc, beatId: string, rowId: string): Row | null {
  return rowsAt(doc, beatId).find((r) => r.id === rowId) ?? null;
}

export function editRow(doc: ExplainerDoc, beatId: string, rowId: string, patch: RowPatch): Edit | null {
  const index = doc.beats.findIndex((b) => b.id === beatId);
  if (index === -1) return null;

  // The first beat is the scene as it opens: there is nothing before it for a change to be a
  // change against.
  if (index === 0) return { op: 'scene.row.set', args: { rowId, ...patch } };

  const beat = doc.beats[index];

  // A row this beat adds is edited where it is added. Writing a `set` beside the `add` would be
  // two changes in one beat that the viewer sees as one.
  const added = beat.mutations.findIndex((m) => m.op === 'add' && m.row.id === rowId);
  if (added !== -1) {
    const m = beat.mutations[added];
    if (m.op === 'add') {
      return {
        op: 'mutation.update',
        args: { beatId, index: added, mutation: { op: 'add', row: { ...m.row, ...patch } } },
      };
    }
  }

  const already = beat.mutations.findIndex((m) => m.op === 'set' && m.row === rowId);
  if (already !== -1) {
    return {
      op: 'mutation.update',
      args: { beatId, index: already, mutation: { ...beat.mutations[already], ...patch } },
    };
  }

  return { op: 'mutation.add', args: { beatId, mutation: { op: 'set', row: rowId, ...patch } } };
}

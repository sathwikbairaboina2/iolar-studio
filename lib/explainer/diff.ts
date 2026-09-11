import type { ExplainerDoc, Row } from './schema';

/**
 * What changed, in the words the editor uses.
 *
 * This diffs the document rather than the folded boards: a board diff would be more precise and
 * much harder to read, and the document is what the user is approving. It exists so a model's
 * proposal can be looked at before it is applied.
 */

const quoted = (s: string | null | undefined) => (s == null ? 'nothing' : `"${s}"`);

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The fields of a row worth mentioning when it changes. */
function rowChanges(before: Row, after: Row): string[] {
  const out: string[] = [];
  if (before.label !== after.label) out.push(`label ${quoted(before.label)} -> ${quoted(after.label)}`);
  if (before.value !== after.value) out.push(`value ${before.value ?? 'none'} -> ${after.value ?? 'none'}`);
  if (before.state !== after.state) out.push(`${before.state} -> ${after.state}`);
  if (before.sub !== after.sub) out.push(`sub ${quoted(before.sub)} -> ${quoted(after.sub)}`);
  return out;
}

export function diff(before: ExplainerDoc, after: ExplainerDoc): string[] {
  const lines: string[] = [];

  if (before.theme !== after.theme) lines.push(`theme ${before.theme} -> ${after.theme}`);
  if (before.scene.title !== after.scene.title) {
    lines.push(`title ${quoted(before.scene.title)} -> ${quoted(after.scene.title)}`);
  }
  if (before.scene.subtitle !== after.scene.subtitle) {
    lines.push(`subtitle ${quoted(before.scene.subtitle)} -> ${quoted(after.scene.subtitle)}`);
  }
  if (before.scene.note !== after.scene.note) {
    lines.push(`note ${quoted(before.scene.note)} -> ${quoted(after.scene.note)}`);
  }

  const was = new Map(before.scene.rows.map((r) => [r.id, r]));
  const now = new Map(after.scene.rows.map((r) => [r.id, r]));
  for (const row of after.scene.rows) {
    const old = was.get(row.id);
    if (!old) {
      lines.push(`+ row "${row.id}"`);
      continue;
    }
    const changes = rowChanges(old, row);
    if (changes.length) lines.push(`row "${row.id}": ${changes.join(', ')}`);
  }
  for (const row of before.scene.rows) {
    if (!now.has(row.id)) lines.push(`- row "${row.id}"`);
  }

  if (before.scene.links.length !== after.scene.links.length) {
    lines.push(`${plural(before.scene.links.length, 'link')} -> ${after.scene.links.length}`);
  }
  if (before.scene.panel.length !== after.scene.panel.length) {
    lines.push(`${plural(before.scene.panel.length, 'panel line')} -> ${after.scene.panel.length}`);
  }

  const beatsWas = new Map(before.beats.map((b) => [b.id, b]));
  const beatsNow = new Map(after.beats.map((b) => [b.id, b]));
  for (const beat of after.beats) {
    const old = beatsWas.get(beat.id);
    if (!old) {
      lines.push(`+ beat ${beat.id} (${beat.role}, ${plural(beat.mutations.length, 'change')})`);
      continue;
    }
    if (old.role !== beat.role) lines.push(`${beat.id}: ${old.role} -> ${beat.role}`);
    if (old.sec !== beat.sec) lines.push(`${beat.id}: ${old.sec ?? 'default'}s -> ${beat.sec ?? 'default'}s`);
    if (old.mutations.length !== beat.mutations.length) {
      lines.push(`${beat.id}: ${plural(old.mutations.length, 'change')} -> ${beat.mutations.length}`);
    } else if (JSON.stringify(old.mutations) !== JSON.stringify(beat.mutations)) {
      lines.push(`${beat.id}: its changes are different`);
    }
  }
  for (const beat of before.beats) {
    if (!beatsNow.has(beat.id)) lines.push(`- beat ${beat.id}`);
  }

  const order = (d: ExplainerDoc) => d.beats.map((b) => b.id).join(',');
  if (lines.length === 0 && order(before) !== order(after)) lines.push('the beats are in a different order');

  return lines;
}

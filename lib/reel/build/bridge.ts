import { planFromScript } from '@/lib/ai/reel/plan';
import { loadReel, saveReel } from '../store';
import { normaliseScript } from '@/lib/ai/reel/plan';
import type { Reel, ShotKind } from '../schema';
import type { Script, ScriptLine } from '../research/script';

/**
 * The crossing from an approved script to a reel that can be built.
 *
 * The research workflow produces lines; the reel is made of beats. Nothing
 * connected them, deliberately — until there was somewhere for a built reel to
 * go. Both halves already existed: `planFromScript` splits a script into beats
 * in paste mode, and paste mode promises the words come back untouched, with
 * `wordingDrift` refusing the plan if they do not. An approved script that the
 * planner paraphrased is no longer the approved script.
 *
 * What is added here is provenance. The planner returns beats; it does not know
 * which line each came from, and a `screen` beat has to find its line's
 * citations to know which page to visit.
 */

/**
 * Shot kinds a researched reel may use.
 *
 * `broll` is missing because neither renderer makes generic b-roll: pages come
 * from `webpage-mp4`, talking heads from the lipsync graph, and titles are
 * overlays that were never generated. Narrowing the palette is what lets every
 * beat find a renderer instead of stranding one on a human.
 */
export const RESEARCHED_KINDS: readonly ShotKind[] = ['title', 'talking-head', 'screen'];

/**
 * The lines in the order they are spoken.
 *
 * `order` is the authority, not array position: it comes from the model and is
 * only re-derived from the array when a line is dropped or moved. If the two
 * disagree, sorting by array position builds the script in the wrong sequence
 * and hands every beat the wrong line — so each page shot would visit a source
 * that proves a different sentence.
 */
export function orderedLines<T extends { order?: number }>(lines: T[]): T[] {
  return [...lines].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** The spoken script, exactly as approved: every line, in order, nothing else. */
export function scriptText(script: Pick<Script, 'lines'>): string {
  return orderedLines(script.lines).map((l) => l.text.trim()).join(' ');
}

/**
 * Works out which line each beat came from, by position rather than by asking.
 *
 * Paste mode guarantees the beats concatenate back to the script, so both are
 * the same string cut in two different places. Walking the normalised text once
 * and recording where each line starts and each beat starts is therefore exact,
 * and needs no model, no matching heuristic and no id the planner could invent.
 *
 * A beat that spans a line boundary belongs to the line it starts in: that is
 * the line whose citations its opening claim came from.
 */
export function attachSourceLines<T extends { id: string; shot: { sourceLineId: string | null } & Record<string, unknown> }>(
  lines: Pick<ScriptLine, 'id' | 'text'>[],
  beats: (T & { text: string })[]
): T[] {
  const bounds: { id: string; start: number }[] = [];
  let at = 0;
  for (const line of lines) {
    bounds.push({ id: line.id, start: at });
    at += normaliseScript(line.text).length + 1; // + the space that joined it
  }

  let cursor = 0;
  return beats.map((beat) => {
    const start = cursor;
    cursor += normaliseScript(beat.text).length + 1;
    // The last line starting at or before this beat is the one it opens in.
    let owner: string | null = null;
    for (const b of bounds) {
      if (b.start <= start) owner = b.id;
      else break;
    }
    return { ...beat, shot: { ...beat.shot, sourceLineId: owner } };
  });
}

/**
 * Forces every beat onto a kind something can actually render.
 *
 * The palette is in the prompt, and on the first live run the planner used
 * `broll` anyway for three beats out of fourteen. A prompt is a request; this is
 * the guarantee. A beat whose line cites something becomes a page visit, because
 * showing that source is the strongest thing the reel can do with it; a beat with
 * no citation becomes the presenter, who can say anything.
 */
export function coerceKinds<T extends { shot: { kind: string; sourceLineId: string | null } & Record<string, unknown> }>(
  lines: Pick<ScriptLine, 'id' | 'citations'>[],
  beats: T[],
  /** Ids still in the pack. A citation can point at a source dropped in review. */
  known?: Set<string>
): T[] {
  const cited = new Set(
    lines
      .filter((l) => l.citations.some((id) => !known || known.has(id)))
      .map((l) => l.id)
  );
  return beats.map((beat) => {
    if (RESEARCHED_KINDS.includes(beat.shot.kind as ShotKind)) return beat;
    const kind = beat.shot.sourceLineId && cited.has(beat.shot.sourceLineId) ? 'screen' : 'talking-head';
    return { ...beat, shot: { ...beat.shot, kind } };
  });
}

/**
 * Plans the reel from the approved script and records where each beat came from.
 *
 * Throws rather than half-writing: `planFromScript` already refuses a plan whose
 * wording drifted, and a reel built from words the user did not approve is worse
 * than no reel.
 */
export async function buildBeatsFromScript(slug: string, script: Pick<Script, 'lines'>): Promise<Reel> {
  if (script.lines.length === 0) throw new Error('the approved script has no lines');

  const source = scriptText(script);
  await planFromScript(slug, source, { kinds: RESEARCHED_KINDS });

  const reel = await loadReel(slug);
  const ordered = orderedLines(script.lines);
  const beats = coerceKinds(ordered, attachSourceLines(ordered, reel.beats));
  await saveReel(slug, { ...reel, beats });
  return loadReel(slug);
}

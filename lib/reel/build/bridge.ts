import { planFromScript } from '@/lib/ai/reel/plan';
import { loadReel, saveReel } from '../store';
import { normaliseScript } from '@/lib/ai/reel/plan';
import type { Reel, ShotKind } from '../schema';
import { planShotMix, type MixOptions } from '../shotmix';
import type { Script, ScriptLine } from '../research/script';
import { readCandidates } from '../research/store';

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
/** Speaking pace, for sizing beats before there is a take to measure. */
const WORDS_PER_SECOND = 2.6;

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
/**
 * Decides who is on screen for each beat, then coerces the kinds to match.
 *
 * `coerceKinds` answers only "can this line be shown?". This answers the question after it:
 * of the lines that could go either way, which are worth a face. The presenter is rationed —
 * a reel that is a talking head end to end is the one nobody watches — so most beats end up
 * on their source and the face is spent on the hook, the close, and anything with nothing to
 * show. See `shotmix.ts`.
 */
export function applyShotMix<T extends { id: string; role: 'hook' | 'body' | 'close'; shot: { kind: string; sourceLineId: string | null } & Record<string, unknown> }>(
  lines: Pick<ScriptLine, 'id' | 'citations'>[],
  beats: T[],
  spans: Map<string, { start: number; end: number }>,
  opts: MixOptions = {},
  known?: Set<string>
): T[] {
  const cited = new Set(
    lines.filter((l) => l.citations.some((id) => !known || known.has(id))).map((l) => l.id)
  );
  const spoken = beats.filter((b) => b.shot.kind !== 'title');
  // The hook is often a title card, which is an overlay rather than a shot. Without this the
  // opening has no candidate for a face at all and the whole allowance lands on the close,
  // so the reel starts on a document and only meets the person as it ends.
  const opensOnTitle = spoken.length > 0 && !spoken.some((b) => b.role === 'hook');
  const mix = planShotMix(
    spoken.map((b, i) => ({
      beatId: b.id,
      role: opensOnTitle && i === 0 ? 'hook' : b.role,
      seconds: Math.max(0.2, (spans.get(b.id)?.end ?? 0) - (spans.get(b.id)?.start ?? 0)),
      cites: Boolean(b.shot.sourceLineId && cited.has(b.shot.sourceLineId)),
    })),
    opts
  );
  const kindOf = new Map(mix.map((m) => [m.beatId, m.kind]));
  return beats.map((b) =>
    b.shot.kind === 'title' ? b : ({ ...b, shot: { ...b.shot, kind: kindOf.get(b.id) ?? b.shot.kind } } as T)
  );
}

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
    const showable = Boolean(beat.shot.sourceLineId && cited.has(beat.shot.sourceLineId));

    // A page shot needs a page. A screen beat whose line cites nothing — or whose
    // only citation was dropped in review — can never be rendered and would wait
    // for a human for ever. The presenter can always say the line.
    if (beat.shot.kind === 'screen' && !showable) {
      return { ...beat, shot: { ...beat.shot, kind: 'talking-head' } };
    }
    if (RESEARCHED_KINDS.includes(beat.shot.kind as ShotKind)) return beat;

    return { ...beat, shot: { ...beat.shot, kind: showable ? 'screen' : 'talking-head' } };
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
  // Which sources survived review: a citation can point at one that did not.
  const known = new Set((await readCandidates(slug).catch(() => null))?.candidates.map((c) => c.id) ?? []);
  const kept = known.size ? known : undefined;
  const showable = coerceKinds(ordered, attachSourceLines(ordered, reel.beats), kept);
  // Before the voiceover exists a beat's length is its word count at speaking pace, which is
  // close enough to ration the presenter by. The mix is what keeps a reel from being a
  // talking head end to end.
  const spans = new Map(
    showable.map((b) => {
      const words = b.text.trim().split(/\s+/).filter(Boolean).length;
      return [b.id, { start: 0, end: Math.max(0.4, words / WORDS_PER_SECOND) }] as const;
    })
  );
  const beats = applyShotMix(ordered, showable, new Map(spans), {}, kept);
  await saveReel(slug, { ...reel, beats });
  return loadReel(slug);
}

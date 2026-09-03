import { planFromScript } from '@/lib/ai/reel/plan';
import { loadReel, saveReel } from '../store';
import { normaliseScript } from '@/lib/ai/reel/plan';
import type { Reel, ShotKind } from '../schema';
import { planShotMix, type MixOptions } from '../shotmix';
import type { Script, ScriptLine } from '../research/script';
import { readCandidates, readScript } from '../research/store';
import { beatSpans } from '../assemble';
import { loadStyle } from '../styles';

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
/**
 * Whether a line finishes its sentence — the trailing quote or bracket after the full stop
 * still counts as the sentence ending.
 *
 * The follower gets a say because hooks are often punctuation-free ("POV: you ship on a
 * Friday") without being half of anything: a beat with no full stop whose successor opens
 * with a capital ended its thought, whatever the punctuation says. Only a successor that
 * opens lowercase marks a sentence genuinely left hanging.
 */
export function finishesSentence(text: string, nextText?: string): boolean {
  if (/[.!?…:]["'’”)\]»]*$/.test(text.trim())) return true;
  if (nextText === undefined) return true;
  return /^["'“‘(\[«]*[^a-z]/.test(nextText.trim());
}

export function applyShotMix<T extends { id: string; role: 'hook' | 'body' | 'close'; text: string; shot: { kind: string; sourceLineId: string | null } & Record<string, unknown> }>(
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
      endsSentence: finishesSentence(b.text, spoken[i + 1]?.text),
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
  // The style's cadence rides along, so a long middle is not left faceless.
  const style = await loadStyle(reel.style).catch(() => null);
  const mixOpts = style ? { anchorEverySec: style.shotMix.anchorEverySec } : {};
  const beats = applyShotMix(ordered, showable, new Map(spans), mixOpts, kept);
  await saveReel(slug, { ...reel, beats });
  return loadReel(slug);
}

/**
 * The same deal, re-dealt from the measured audio.
 *
 * `buildBeatsFromScript` rations the presenter before the voiceover exists, on word counts
 * at speaking pace. Word counts are close, but they are not the take: a line read slowly
 * grows, a rattled-off aside shrinks, and a bite planned at five seconds can land at four —
 * or the boundaries can drift off the sentences as spoken. Once whisper has placed the
 * words, this re-runs the mix on what the audio actually says, so the bites are planned
 * from the take rather than from a guess at it.
 *
 * It refuses quietly once footage exists: a beat pointing at an asset has been rendered
 * (or queued) as one kind, and re-dealing under it would orphan the render.
 */
export async function remixFromAudio(slug: string, opts: MixOptions = {}): Promise<Reel> {
  const reel = await loadReel(slug);
  if (!reel.vo.words.length) return reel;
  if (reel.beats.some((b) => b.shot.assetId)) return reel;

  const script = await readScript(slug).catch(() => null);
  if (!script || script.lines.length === 0) return reel;

  const ordered = orderedLines(script.lines);
  const known = new Set((await readCandidates(slug).catch(() => null))?.candidates.map((c) => c.id) ?? []);
  const kept = known.size ? known : undefined;

  const spans = beatSpans(reel);
  const style = await loadStyle(reel.style).catch(() => null);
  const mixOpts = { ...(style ? { anchorEverySec: style.shotMix.anchorEverySec } : {}), ...opts };
  const mixed = applyShotMix(ordered, reel.beats, spans, mixOpts, kept);
  // Only the two kinds the mix deals in move. A researched kind, a title, or anything a
  // person set to something else is not this function's to re-deal.
  const dealable = new Set(['screen', 'talking-head']);
  const kindOf = new Map(mixed.map((b) => [b.id, b.shot.kind]));
  const beats = reel.beats.map((b) =>
    dealable.has(b.shot.kind) && dealable.has(kindOf.get(b.id) ?? '')
      ? { ...b, shot: { ...b.shot, kind: kindOf.get(b.id)! } }
      : b
  );
  await saveReel(slug, { ...reel, beats });
  return loadReel(slug);
}

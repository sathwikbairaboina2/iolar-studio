import { extractJson } from '@/lib/ai/revise';
import { thinker, type Runner } from '@/lib/ai/runner';
import {
  DEFAULT_SECS, ExplainerDocSchema, ICONS, ROLES, ROW_STATES, foldDoc, totalSeconds,
  type Brief, type ExplainerDoc,
} from './schema';

/**
 * The writing stage: a brief in, a document out, nothing written to disk.
 *
 * The model never touches the explainer. `draft` and `revise` hand back a document, the route
 * hands it to the page as a proposal, and approving it goes through the command layer as `agent` —
 * so an AI pass lands in the same history as a human edit and undoes the same way.
 *
 * Validation is the fold. A document that parses but cannot fold is not a document, and the model
 * is asked again once with its own error quoted back at it before anyone sees a failure.
 */

export type { Brief };
export type AuthorDeps = { run?: Runner };

export class AuthorError extends Error {
  constructor(message: string, readonly said: string) {
    super(message);
    this.name = 'AuthorError';
  }
}

const BEATS_PER_SECOND = 1 / 3;

/**
 * The one rule that makes an explainer an explainer.
 *
 * It is the finding ten reels off the reference channel were measured for: not a single scene cut
 * in any of them. Everything else in this prompt is vocabulary; this is the shape.
 */
const THE_RULE = [
  'An explainer is ONE board that mutates. There is never a second scene, never a cut, never a',
  'slide that replaces the last one. The board is built once in `scene`, and each beat changes what',
  'is already on it: a number drops, a row turns green, a link is drawn, a line is added to the',
  'panel. A viewer watching it sees one picture the whole time and watches it change.',
].join(' ');

function vocabulary(): string {
  return [
    'The document:',
    '{',
    '  "template": "explainer",',
    '  "theme": "midnight" | "slate" | "carbon" | "paper" | "daylight" | "blueprint",',
    '  "brand": { "handle": "@stackframe", "name": "Stack Frame" },',
    '  "scene": {',
    '    "title": string (<= 48 chars),',
    '    "subtitle": string | null (<= 90),',
    '    "note": string | null (<= 90),',
    '    "rows": [ { "id": short-slug, "label": string (<= 28), "value": number | null,',
    '                "unit": string (<= 8, e.g. " ms", "%"), "sub": string | null (<= 40),',
    `                "state": ${ROW_STATES.join(' | ')}, "tier": 0-3, "col": 0-5,`,
    `                "icon": ${ICONS.join(' | ')} } ],`,
    '    "links": [ { "from": rowId, "to": rowId, "label": string | null (<= 16), "state": rowState } ],',
    '    "panel": [ { "text": string (<= 48), "state": rowState } ]',
    '  },',
    `  "beats": [ { "id": "b1", "role": ${ROLES.join(' | ')}, "sec": number | null, "mutations": [ ... ] } ]`,
    '}',
    '',
    'The five mutations, and nothing else:',
    '- { "op": "set", "row": rowId | "*", ...any row field } — change a row already on the board',
    '- { "op": "add", "row": { full row } } — put a new row on the board',
    '- { "op": "link", "from": rowId, "to": rowId, "label": string | null, "state": rowState }',
    '- { "op": "text", "field": "title" | "subtitle" | "note", "to": string | null }',
    '- { "op": "panel", "text": string (<= 48), "state": rowState }',
    '',
    'Rules:',
    `- ${THE_RULE}`,
    '- Every row a mutation names must already exist on the board at that beat: it is either in',
    '  `scene.rows` or added by an earlier beat (or by an earlier mutation in the same beat).',
    '- Beat ids are b1, b2, b3 ... in order. The first beat is the hook. There is exactly one payoff',
    '  and it is the one the claim lands on. A cta, if there is one, is last.',
    '- Every beat changes something. A beat with no mutations is a still frame and is wrong.',
    `- "sec" is null unless a beat needs its own length. Defaults: ${Object.entries(DEFAULT_SECS).map(([r, s]) => `${r} ${s}s`).join(', ')}.`,
    '- Four to six rows, spread over two or three tiers. Two rows is a comparison; five on three',
    '  tiers is a system with something flowing through it, which is what fills a vertical frame.',
    '  `tier` is the band top to bottom, `col` the slot within it: a client on tier 0, what it talks',
    '  to on tier 1, what that fans out to on tier 2.',
    '- Link the rows that talk to each other. An unlinked board is a list.',
    '- Three or four panel lines in total, added over the beats: the panel is the log of what just',
    '  happened, and it is what fills the bottom of the frame. It holds FOUR lines and no more —',
    '  a fifth is rejected, and lines in `scene.panel` count towards the four.',
    '- Numbers beat adjectives: a row with a value and a unit says more than a row with a longer',
    '  label. A value with a "%" unit is drawn as a meter.',
    'Return ONLY the JSON document. No prose, no markdown fences.',
  ].join('\n');
}

function briefPrompt(brief: Brief): string {
  const beats = Math.max(3, Math.round(brief.seconds * BEATS_PER_SECOND));
  return [
    'You write short vertical explainer videos as a JSON document that a renderer animates.',
    '',
    vocabulary(),
    '',
    `TOPIC: ${brief.topic}`,
    `AUDIENCE: ${brief.audience}`,
    `THE ONE THING THAT MUST LAND: ${brief.claim}`,
    `LENGTH: about ${brief.seconds} seconds, so roughly ${beats} beats. Beat lengths add up:`,
    `default ${Object.entries(DEFAULT_SECS).map(([r, sec]) => `${r} ${sec}s`).join(', ')}, and "sec" overrides one.`,
    `The total must land within a second of ${brief.seconds}s — count it before you answer.`,
    '',
    'Write the board so the claim is something the viewer watches happen, not something they read.',
  ].join('\n');
}

function revisePrompt(doc: ExplainerDoc, instruction: string): string {
  const brief = doc.brief;
  return [
    'You edit short vertical explainer videos stored as a JSON document.',
    '',
    vocabulary(),
    '',
    brief
      ? `It was written to this brief — TOPIC: ${brief.topic}; AUDIENCE: ${brief.audience}; ` +
        `THE ONE THING THAT MUST LAND: ${brief.claim}; LENGTH: about ${brief.seconds}s.`
      : '',
    `It currently runs ${Math.round(totalSeconds(doc) * 10) / 10}s.`,
    '',
    'Current document:',
    JSON.stringify(doc),
    '',
    `CHANGE: ${instruction}`,
    '',
    'Change what was asked for and leave the rest alone. Keep every row id that still exists.',
  ].filter(Boolean).join('\n');
}

/** The panel holds four lines, and a model told that still writes five about half the time. */
const PANEL_LINES = 4;

/**
 * Trim the surplus a model writes past a hard limit, rather than spending a retry on it.
 *
 * Only additive things are dropped, never rewritten: panel lines past the fourth and links past
 * the twelfth. Everything else that will not fold is still the model's problem to fix, because
 * a row that does not exist cannot be trimmed into one that does.
 */
function tidy(doc: ExplainerDoc): ExplainerDoc {
  let panel = doc.scene.panel.length;
  let links = doc.scene.links.length;
  const beats = doc.beats.map((beat) => ({
    ...beat,
    mutations: beat.mutations.filter((m) => {
      if (m.op === 'panel') {
        if (panel >= PANEL_LINES) return false;
        panel += 1;
      }
      if (m.op === 'link') {
        if (links >= 12) return false;
        links += 1;
      }
      return true;
    }),
  }));
  return { ...doc, beats };
}

/** Parse, validate, fold. Whichever step fails, the message is what goes back to the model. */
function accept(said: string): ExplainerDoc {
  const parsed = tidy(ExplainerDocSchema.parse(extractJson(said)));
  foldDoc(parsed);
  return parsed;
}

async function think(prompt: string, deps: AuthorDeps): Promise<ExplainerDoc> {
  const run = deps.run ?? thinker({ timeoutMs: 240_000 });
  const first = await run(prompt);
  try {
    return accept(first);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    // One more try, with its own error quoted. Handbooks repair the same way and for the same
    // reason: the second answer is usually right, and a third is usually the same as the second.
    const second = await run(`${prompt}\n\nYour previous answer was rejected: ${why}\nFix it and return the whole document again.`);
    try {
      return accept(second);
    } catch (again) {
      throw new AuthorError(
        `the model could not write a document that folds: ${again instanceof Error ? again.message : String(again)}`,
        second
      );
    }
  }
}

export async function draft(brief: Brief, deps: AuthorDeps = {}): Promise<ExplainerDoc> {
  const doc = await think(briefPrompt(brief), deps);
  // The brief travels with the document, so a later revise knows what was asked for without the
  // user restating it.
  return { ...doc, brief };
}

export async function revise(doc: ExplainerDoc, instruction: string, deps: AuthorDeps = {}): Promise<ExplainerDoc> {
  const next = await think(revisePrompt(doc, instruction), deps);
  return { ...next, brief: next.brief ?? doc.brief };
}

import { promises as fs } from 'fs';
import path from 'path';
import { explainer2File } from '@/lib/paths';
import type { RunClaudeOpts } from '@/lib/ai/claude';
import type { Brief, Script, Timing } from './schema';
import { chooseBed, readManifest, readSound, soundBrief, writeSound, type AudioEntry } from './sound';
import type { Strip } from './strips';
import { beatMiddle } from './timing';
import { renderRoot, syncIn, syncOut } from './workspace';

/**
 * The designer is an agent working inside the plugin's Remotion project. It may read and write files and run
 * three commands: the type check, a still render, and the script that registers its video. There is no network.
 */
export const DESIGN_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash(npx tsc:*)',
  'Bash(npx remotion still:*)',
  // A new Video.tsx has to be registered before a still of it can be drawn.
  'Bash(node scripts/designed-index.mjs:*)',
];

const DESIGN_TIMEOUT_MS = 30 * 60_000;

export type DesignContext = {
  slug: string;
  brief: Brief;
  script: Script;
  timing: Timing;
  /** The kit README text. */
  readme: string;
  /** The current Video.tsx, when this is a revision. */
  existing: string | null;
  notes?: string;
  gateErrors?: string[];
  /** The sound part of the prompt: the beds and effects the library has (see `soundBrief`). */
  sound?: string;
  /** The music bed chosen for sound.json. */
  bed?: string | null;
  /** Motion strips of the previous version (workspace paths), for a round that fixes what the critic found. */
  strips?: readonly Strip[];
};

/** The timing as the designer reads it: the words of each beat are in the file beside the video, so only their count is shown here. */
function timingForPrompt(t: Timing) {
  return { ...t, beats: t.beats.map(({ words, ...b }) => (words ? { ...b, words: `${words.length} words (in timing.json)` } : b)) };
}

export function designPrompt(c: DesignContext): string {
  const file = `src/designed/videos/${c.slug}/Video.tsx`;
  const id = `designed-${c.slug}`;
  const stills = c.timing.beats
    .map((b, i) => `npx remotion still src/index.ts ${id} out/designed/${c.slug}/${b.id}.png --frame=${beatMiddle(c.timing, i)}`)
    .join('\n');
  const hookStills = [4, 14, 40]
    .map((n) => `npx remotion still src/index.ts ${id} out/designed/${c.slug}/hook-${n}.png --frame=${(c.timing.beats[0]?.start ?? 0) + n}`)
    .join('\n');
  const inStills = c.timing.beats
    .slice(1)
    .map((b) => `npx remotion still src/index.ts ${id} out/designed/${c.slug}/${b.id}-in.png --frame=${b.start + 10}`)
    .join('\n');
  const emphasis = [...new Set(c.script.beats.flatMap((b) => b.emphasis ?? []))];
  const lines = [
    'You design one short vertical explainer video as a Remotion composition, in the aiiolar look, using the kit in src/designed/kit.',
    `Your working directory is the Remotion project. You write exactly one file: ${file}`,
    '',
    '## Brief',
    JSON.stringify(c.brief, null, 2),
    '',
    '## Script (what is said and what must change on screen in each beat)',
    JSON.stringify(c.script, null, 2),
    '',
    '## Timing (frames at 30 fps; each beat starts and ends exactly here; this is the voiceover timing)',
    `The same data, with every spoken word's frames, is in src/designed/videos/${c.slug}/timing.json (beside your file). "voice" is how many frames the clip plays.`,
    JSON.stringify(timingForPrompt(c.timing), null, 2),
    '',
    '## Sound',
    c.sound ?? soundBrief(null),
    `The chosen bed is in src/designed/videos/${c.slug}/sound.json as { "bed": ${JSON.stringify(c.bed ?? null)} } (the studio can change it later; never hard-code it).`,
    '',
    '## Kit README',
    c.readme,
    '',
    'The reference reel is src/designed/examples/RequestJourney.tsx; src/designed/examples/MaxShowcase.tsx uses the newer parts (moving hook, karaoke captions, camera, charts, sound, end card). Read both first and imitate their structure and spacing.',
    '',
    '## Rules',
    `- ${file} must \`export default\` the component and \`export const meta = { id: '${id}', durationInFrames: timing.totalFrames, fps: 30, width: 1080, height: 1920 }\` (${c.timing.totalFrames} frames), with \`import timing from './timing.json'\` and \`import sound from './sound.json'\`. Use timing.beats[i].start for every beat's start frame; never hard-code seconds. Pass \`timing\` to the kit components that take it.`,
    '- Open with the hook: show the DeltaHook at the first frame of beat b1 (`at` = that start) so something moves from frame 0, with a one-line `note`. Pass `handoffAt` (the start of beat b2) so it shrinks into a corner badge that stays as context; keep it mounted outside the Camera. Then one visual idea per beat, matching its "visual" sentence. Each beat\'s main visual change starts at `timing.beats[i].start` and settles within 9 frames; by `start + 9` nothing from the previous beat\'s layout is still visible unless it carries over on purpose (a card that moves on with `move` keyframes). Never delay a beat\'s change to a later word, except for the build-up inside the beat.',
    `- Captions: use KaraokeCaption with timing and emphasis={${JSON.stringify(emphasis)}} (not CaptionTrack). Put KaraokeCaption, ProgressDots, Handle, VoiceTrack (slug "${c.slug}") and SoundTrack (bed={sound.bed}) in every video, outside the Camera.`,
    '- Wrap the diagram in Camera with shots (zoom 1 to 1.6) so a dense diagram is brought close to the part that matters; Camera draws the Backdrop, so do not add another. Move cards to their next place with the Card `move` keyframes instead of making them pop in elsewhere. Use the chart widgets (LatencyChart, Gauge, QueueFill, Timeline) where they say the point. End on EndCard (takeaway line plus the follow line) mounted with `frame >= lastBeatStart &&`; hold the final layout through the last frame; do not fade back to the hook or draw your own loop.',
    '- Sound effects: place Sfx on key events (a packet lands, a counter settles, a hit or a miss, a card lights) using only events the library has; never more than one sound in any 6 frames; volumes at most 0.5.',
    '- Imports only from remotion, @remotion/*, react, ../../kit, ./timing.json and ./sound.json. No Math.random, Date, fetch, CSS transition or animation, setTimeout, setInterval or useEffect. Everything is driven by the current frame.',
    '- Positions are reference pixels on a 1080 x 1920 frame. Keep text clear of the top 140 px and bottom 260 px. Caption at least 44 px; every other text at least 40 px.',
    '- No overlap, no clipped text, no large empty areas, readable contrast, and the right thing emphasised in each beat.',
    '- Use the width as well as the height. Small cards floating in a big violet frame is the most common mistake: a vertical stack of 2 to 4 cards uses cards about 620 to 760 px wide, and a diagram spans at least x = 90..990.',
    '- Keep it moving: no stretch longer than about 2 seconds where nothing changes on screen (a packet travels, a number counts, a card lights up, a bar grows, the camera glides).',
    '- Secondary text (card subs, tags, chart and bar labels) is at least 40 px, and muted text stays readable against the violet ground.',
    '- Use Card\'s own label and sub: it sizes itself to fit them. Never wrap a Card to blank its sub and paint text over it; for a sub that changes, pass the new string as `sub`.',
    '- Packets and pulses travel in clear lanes: they never cross a label or a value. Connectors run straight, centre to centre.',
    '- Numbers that have settled hold still: no value that flickers between nearby numbers. A queue shows at most 8 dots plus a "+N" count, so nothing spills over its box.',
    '- Every card says what is true at that moment in the narration: do not show the next beat\'s state early, and fade out anything left over from the previous beat.',
    '',
    '## Process (at most 4 rounds)',
    `1. Write ${file}.`,
    '2. Register it: node scripts/designed-index.mjs',
    '3. Type check: npx tsc --noEmit  (fix every error in your file)',
    `4. Render a still at the middle of every beat and Read each png (they are 1080 x 1920):\n${stills}`,
    `   Also check the hook moves from the first frame (it should differ between these):\n${hookStills}`,
    `   And a still 10 frames after each later beat starts; the new beat's layout must already be in place in each, with nothing of the previous beat left unless it carries over on purpose:\n${inStills}`,
    '5. Fix what is off (overlap, text under 40 px, empty space, unreadable contrast, the wrong thing emphasised, a static hook) and repeat from step 3. Stop after 4 rounds or when every still is right.',
    'Finish with one sentence saying what you made.',
  ];
  if (c.existing !== null) {
    lines.push(
      '',
      '## Existing video',
      `${file} already exists. Edit the existing file (do not start over) to apply the notes below; keep what works.`,
      '```tsx',
      c.existing,
      '```',
    );
  }
  if (c.strips?.length) {
    lines.push(
      '',
      '## Motion strips of the current version',
      'One png per beat: 6 frames evenly spaced from the first to the last frame of the beat, tiled three across (time runs left to right, top to bottom), each frame 540 x 960. Read them to see how each beat moves, not only how it looks at its middle:',
      ...c.strips.map((s) => `- ${s.beat}: ${s.file}`),
    );
  }
  if (c.notes?.trim()) lines.push('', '## Notes to apply', c.notes.trim());
  if (c.gateErrors?.length) {
    lines.push('', '## The last attempt failed these checks. Fix every one:', ...c.gateErrors.map((e) => `- ${e}`));
  }
  return lines.join('\n');
}

export type DesignDeps = {
  run: (prompt: string, opts?: RunClaudeOpts) => Promise<string>;
  /** The Remotion project; defaults to the plugin's render/. */
  root?: string;
};

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

/** The music bed for sound.json: the one already chosen (a person may have changed it), else a new pick that suits the video. */
async function ensureSound(slug: string, manifest: AudioEntry[] | null): Promise<string | null> {
  const have = await readSound(slug);
  if (have) return have.bed;
  const bed = chooseBed(manifest, slug);
  await writeSound(slug, { bed });
  return bed;
}

/** One design round: copy the video into the workspace, let the agent work there, copy Video.tsx back. */
export async function runDesign(
  slug: string,
  deps: DesignDeps,
  opts: { notes?: string; gateErrors?: string[]; strips?: readonly Strip[] } = {},
): Promise<{ wrote: boolean }> {
  const root = deps.root ?? renderRoot();
  const manifest = await readManifest(root);
  const bed = await ensureSound(slug, manifest);
  const w = await syncIn(slug, root);
  const [brief, script, timing] = await Promise.all([
    readJson<Brief>(explainer2File(slug, 'brief.json')),
    readJson<Script>(explainer2File(slug, 'script.json')),
    readJson<Timing>(explainer2File(slug, 'timing.json')),
  ]);
  const readme = await fs.readFile(path.join(root, 'src', 'designed', 'kit', 'README.md'), 'utf8').catch(() => '(the kit README is missing: Read src/designed/kit/README.md)');
  const existing = await fs.readFile(w.videoFile, 'utf8').catch(() => null);
  const prompt = designPrompt({ slug, brief, script, timing, readme, existing, notes: opts.notes, gateErrors: opts.gateErrors, sound: soundBrief(manifest), bed, strips: opts.strips });
  await deps.run(prompt, { cwd: root, model: 'opus', allowedTools: DESIGN_TOOLS, permissionMode: 'acceptEdits', timeoutMs: DESIGN_TIMEOUT_MS });
  return { wrote: await syncOut(slug, root) };
}

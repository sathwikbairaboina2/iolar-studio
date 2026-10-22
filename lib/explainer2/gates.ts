import type { Timing } from './schema';
import { beatMiddle } from './timing';

/**
 * The deterministic checks between the designer and a render. The model is trusted to design, not to
 * keep a video renderable: a video that reads the clock, rolls dice or animates with CSS renders differently
 * on every frame, so those are refused here rather than found in the mp4.
 */

const RULES: { name: string; re: RegExp; why: string }[] = [
  { name: 'Math.random', re: /\bMath\s*\.\s*random\b/, why: 'frames must be deterministic' },
  { name: 'Date', re: /\bDate\b/, why: 'frames must not read the clock' },
  { name: 'fetch', re: /\bfetch\s*\(/, why: 'no network in a render' },
  { name: 'transition', re: /\btransition\s*:|\btransition(Duration|Property|Delay)\b/, why: 'CSS transitions do not render; drive motion from the frame' },
  { name: 'animation', re: /\banimation(Name|Duration|Delay)?\s*:|@keyframes/, why: 'CSS animations do not render; drive motion from the frame' },
  { name: 'setTimeout', re: /\bsetTimeout\b/, why: 'no timers; drive motion from the frame' },
  { name: 'setInterval', re: /\bsetInterval\b/, why: 'no timers; drive motion from the frame' },
  { name: 'requestAnimationFrame', re: /\brequestAnimationFrame\b/, why: 'no timers; drive motion from the frame' },
  { name: 'useEffect', re: /\buseEffect\b/, why: 'effects and timers are not frame-driven' },
];

/** Strips comments so a rule written in prose ("never use Math.random") is not read as code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** The two files that sit beside Video.tsx (copied into the workspace with it): the timing and the chosen music bed. */
const SIBLING_JSON = ['./timing.json', './sound.json'];

const allowedImport = (spec: string) =>
  spec === 'remotion' || spec === 'react' || spec === 'react/jsx-runtime' || spec === '../../kit' || spec.startsWith('@remotion/') || SIBLING_JSON.includes(spec);

/** The problems in a Video.tsx's source, as sentences the designer can act on. Empty means clean. */
export function scanSource(source: string): string[] {
  const src = stripComments(source);
  const errors: string[] = [];
  for (const r of RULES) if (r.re.test(src)) errors.push(`uses ${r.name}: ${r.why}`);

  const specs = new Set<string>();
  for (const m of src.matchAll(/\bimport\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of src.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
  for (const spec of specs) {
    if (!allowedImport(spec)) errors.push(`imports '${spec}': only remotion, @remotion/*, react, ../../kit, ./timing.json and ./sound.json are allowed`);
  }

  if (!/\bexport\s+default\b/.test(src)) errors.push('has no default export (the video component)');
  if (!/\bexport\s+(const|let)\s+meta\b/.test(src)) errors.push('has no `export const meta`');
  return errors;
}

/** Smallest font size the kit draws, in reference pixels; the generated video holds to it too. */
const TEXT_FLOOR = 40;

/** The source with comments blanked but their newlines kept, so line numbers still match the file. */
function blankComments(source: string): string {
  return stripComments(source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')));
}

/** Every numeric literal bound to `name`: `const name = N`, a default `name = N`, or a JSX attribute `name={N}`. */
function numericBindings(src: string, name: string): number[] {
  const out: number[] = [];
  const patterns = [new RegExp(String.raw`\b${name}\s*=\s*(\d+(?:\.\d+)?)(?![\w.])`, 'g'), new RegExp(String.raw`\b${name}\s*=\s*\{\s*(\d+(?:\.\d+)?)\s*\}`, 'g')];
  for (const re of patterns) for (const m of src.matchAll(re)) out.push(Number(m[1]));
  return out;
}

/** The size of a `fontSize` expression made only of numbers, `U` and identifiers; null when it is anything else or an identifier has no numeric binding. */
function evalFontSize(expr: string, src: string): { px: number; binding: string | null } | null {
  const factors = expr.split('*').map((f) => f.trim());
  let px = 1;
  let binding: string | null = null;
  for (const f of factors) {
    if (/^\d+(?:\.\d+)?$/.test(f)) px *= Number(f);
    else if (f === 'U') continue;
    else if (/^[A-Za-z_$][\w$]*$/.test(f)) {
      const candidates = numericBindings(src, f);
      if (candidates.length === 0) return null;
      const smallest = Math.min(...candidates);
      px *= smallest;
      binding = `${f} = ${smallest}`;
    } else return null;
  }
  return { px, binding };
}

const trimNum = (n: number) => String(Math.round(n * 100) / 100);

/** Every `fontSize` under the floor, as a sentence with its line number. Handles literals (`N`, `N * U`) and products of numbers, `U` and named numbers (`labelSize * U`, `size * 0.4 * U`); the smallest number bound to a name counts. Other expressions are skipped. Comments are ignored. */
export function checkTextFloor(source: string): string[] {
  const src = blankComments(source);
  const errors: string[] = [];
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\bfontSize\s*:\s*([\w$.\s*]+?)\s*(?=[,}]|$)/g)) {
      const expr = m[1].trim();
      if (/^\d+(?:\.\d+)?(?:\s*\*\s*U)?$/.test(expr)) {
        const n = Number(expr.split('*')[0]);
        if (n < TEXT_FLOOR) errors.push(`line ${i + 1}: fontSize ${expr.split('*')[0].trim()} is too small; every text must be at least ${TEXT_FLOOR} px at the 1080 x 1920 reference (captions 44 px)`);
        continue;
      }
      const v = evalFontSize(expr, src);
      if (v && v.px < TEXT_FLOOR) {
        const why = v.binding ? ` (${v.binding})` : '';
        errors.push(`line ${i + 1}: fontSize ${expr} is ${trimNum(v.px)} px${why}; every text must be at least ${TEXT_FLOOR} px at the 1080 x 1920 reference (captions 44 px)`);
      }
    }
  });
  return errors;
}

/** Video layouts must sit in `<BeatLayer>` so two beats never show together, and must not hand-roll a fade out at a beat boundary (`opacity: 1 - t01(frame, B3 - LEAD, ...)`). Conservative: only a one-line opacity that subtracts a `t01(`/`interpolate(` from 1 using a beat start as a frame is flagged. */
export function checkBeatLayers(source: string): string[] {
  const src = blankComments(source);
  const errors: string[] = [];
  if (!/<BeatLayer\b/.test(src)) errors.push('has no <BeatLayer>: put everything that belongs to a beat inside <BeatLayer timing={timing} beats="bN"> so beats never overlap');
  const beatStart = /\bB\d+\b|\bbeats\s*\[[^\]]*\]\s*\.start\b|\.start\b/;
  // A layer's beats are written as ids ("b2" or ['b2', 'b4']); a computed range can open a beat early and bring the overlap back.
  const literalBeats = /^(?:"[\w-]+"|'[\w-]+'|\{\s*(?:"[\w-]+"|'[\w-]+')\s*\}|\{\s*\[\s*(?:"[\w-]+"|'[\w-]+')(?:\s*,\s*(?:"[\w-]+"|'[\w-]+'))?\s*\]\s*\})/;
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/<BeatLayer\b[^>]*?\bbeats\s*=\s*/g)) {
      if (!literalBeats.test(line.slice(m.index + m[0].length))) errors.push(`line ${i + 1}: <BeatLayer beats> must be literal beat ids ("b2" or {['b2', 'b4']}), not computed, so a layer cannot open a beat early`);
    }
  });
  src.split('\n').forEach((line, i) => {
    const op = line.match(/\bopacity\s*:(.*)$/);
    if (!op) return;
    for (const m of op[1].matchAll(/(?<![\w.])1\s*-\s*(?:t01|interpolate)\s*\(/g)) {
      // The call's arguments run to its matching close paren; an unbalanced (multi-line) call is skipped.
      let depth = 1;
      let j = m.index + m[0].length;
      const from = j;
      while (j < op[1].length && depth > 0) {
        if (op[1][j] === '(') depth++;
        else if (op[1][j] === ')') depth--;
        j++;
      }
      if (depth === 0 && beatStart.test(op[1].slice(from, j - 1))) {
        errors.push(`line ${i + 1}: hand-rolled fade out at a beat boundary (\`${m[0].trim()}...\`); wrap the beat's layout in <BeatLayer> instead of writing your own opacity between beats`);
        break;
      }
    }
  });
  return errors;
}

/** meta.durationInFrames must equal timing.json's total, read as a literal or through `X.totalFrames`. */
export function checkDuration(source: string, timing: Timing): string[] {
  const src = stripComments(source);
  const m = src.match(/durationInFrames\s*:\s*([^,}\n]+)/);
  if (!m) return ['meta.durationInFrames not found'];
  const expr = m[1].trim();
  let found: number | null = null;
  if (/^\d+$/.test(expr)) found = Number(expr);
  else if (/\.totalFrames$/.test(expr)) {
    // `durationInFrames: timing.totalFrames` where `timing` is `import timing from './timing.json'` is right by construction.
    const json = src.match(/import\s+(\w+)\s+from\s+['"]\.\/timing\.json['"]/);
    if (json && expr === `${json[1]}.totalFrames`) return [];
    const t = src.match(/\btotalFrames\s*:\s*(\d+)/);
    if (t) found = Number(t[1]);
  }
  if (found === null) return [`meta.durationInFrames is \`${expr}\`; write the number ${timing.totalFrames} or point it at a TIMING constant with a literal totalFrames`];
  return found === timing.totalFrames ? [] : [`meta.durationInFrames is ${found} but timing.json says ${timing.totalFrames}`];
}

export type CmdResult = { ok: boolean; output: string };
export type GateDeps = {
  readVideo: () => Promise<string>;
  tsc: () => Promise<CmdResult>;
  /** Renders one still for a beat; resolves with how it went. */
  still: (beatId: string, frame: number) => Promise<CmdResult>;
  /** The video being checked. tsc covers the whole workspace, so errors in another video's folder (one being designed at the same time) are not this video's. */
  slug?: string;
};

/** The failed tsc output that counts against `slug`: errors inside another video's folder are dropped. Null when only those were left. */
export function ownTscErrors(output: string, slug?: string): string | null {
  const isTsError = (l: string) => /error TS\d+/.test(l);
  if (!slug || !output.split('\n').some(isTsError)) return output;
  const own = output.split('\n').filter((l) => {
    const m = l.match(/src[\\/]designed[\\/]videos[\\/]([^\\/]+)[\\/]/);
    return !m || m[1] === slug;
  });
  return own.some(isTsError) ? own.join('\n') : null;
}
export type GateResult = { ok: boolean; errors: string[] };

export async function runGates(timing: Timing, deps: GateDeps): Promise<GateResult> {
  const errors: string[] = [];
  let source: string | null = null;
  try {
    source = await deps.readVideo();
  } catch {
    return { ok: false, errors: ['Video.tsx was not written'] };
  }
  errors.push(...scanSource(source), ...checkDuration(source, timing), ...checkTextFloor(source), ...checkBeatLayers(source));

  const run = await deps.tsc();
  const failed = run.ok ? null : ownTscErrors(run.output, deps.slug);
  const tsc = { ok: failed === null };
  if (failed !== null) errors.push(`type check failed:\n${failed.trim().slice(-1500)}`);

  // A still is only worth drawing for code that compiles; its failure would just repeat the tsc errors.
  if (tsc.ok) {
    for (let i = 0; i < timing.beats.length; i++) {
      const b = timing.beats[i];
      const r = await deps.still(b.id, beatMiddle(timing, i));
      if (!r.ok) errors.push(`the still for ${b.id} did not render:\n${r.output.trim().slice(-800)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

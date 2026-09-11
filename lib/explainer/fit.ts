import { foldDoc, totalSeconds, type ExplainerDoc, type Mutation } from './schema';

/**
 * What a careful person would say reading the board back.
 *
 * Arithmetic, not opinion, and no model: length against the target, how crowded the busiest board
 * gets, beats that change nothing, rows nothing ever touches, and whether the thing has the shape
 * of a reel at all. It blocks nothing — it is the report you read before you render.
 */

export type Level = 'good' | 'warn' | 'bad';
export type Note = { level: Level; text: string };

export type FitReport = {
  seconds: number;
  target: number | null;
  /** The most rows that are ever on the board at once. */
  busiestBoard: number;
  notes: Note[];
};

/** Six reads at a glance, eight is full, past that the renderer is laying out a spreadsheet. */
const COMFORTABLE_ROWS = 6;
const CROWDED_ROWS = 8;

/** A fifth over the target is a warning; half over is wrong. */
const WARN_OVER = 0.2;
const BAD_OVER = 0.5;

const rowsNamed = (m: Mutation): string[] => {
  if (m.op === 'set') return [m.row];
  if (m.op === 'add') return [m.row.id];
  if (m.op === 'link') return [m.from, m.to];
  return [];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function fit(doc: ExplainerDoc, target: number | null = null): FitReport {
  const seconds = Math.round(totalSeconds(doc) * 10) / 10;
  const notes: Note[] = [];

  // Length. Always said, whether or not there is a target to say it against.
  if (target && target > 0) {
    const over = (seconds - target) / target;
    const level: Level = over > BAD_OVER || over < -BAD_OVER ? 'bad' : Math.abs(over) > WARN_OVER ? 'warn' : 'good';
    notes.push({
      level,
      text: level === 'good'
        ? `${seconds}s, against a target of ${target}s`
        : `${seconds}s against a target of ${target}s`,
    });
  } else {
    notes.push({ level: 'good', text: `${seconds}s` });
  }

  let steps: ReturnType<typeof foldDoc>;
  try {
    steps = foldDoc(doc);
  } catch (err) {
    // A document that will not fold has no board to report on, and the editor says so already.
    return { seconds, target, busiestBoard: doc.scene.rows.length, notes: [
      ...notes, { level: 'bad', text: String(err instanceof Error ? err.message : err) },
    ] };
  }

  const busiestBoard = steps.reduce((most, s) => Math.max(most, s.scene.rows.length), doc.scene.rows.length);
  if (busiestBoard > CROWDED_ROWS) {
    notes.push({ level: 'bad', text: `${busiestBoard} rows on the board at once; past ${CROWDED_ROWS} nothing reads on a phone` });
  } else if (busiestBoard > COMFORTABLE_ROWS) {
    notes.push({ level: 'warn', text: `${busiestBoard} rows on the board at once; ${COMFORTABLE_ROWS} is what reads comfortably` });
  }

  const still = doc.beats.filter((b) => b.mutations.length === 0).map((b) => b.id);
  if (still.length) {
    notes.push({
      level: 'warn',
      text: `${still.join(', ')} ${still.length === 1 ? 'changes' : 'change'} nothing — a beat that changes nothing is a still frame`,
    });
  }

  // A row that is never mutated is decoration the viewer still has to read — unless something is
  // drawn to it, because a hub everything links through is structure rather than decoration.
  const touched = new Set([
    ...doc.beats.flatMap((b) => b.mutations.flatMap(rowsNamed)),
    ...doc.scene.links.flatMap((l) => [l.from, l.to]),
  ]);
  const wildcard = doc.beats.some((b) => b.mutations.some((m) => m.op === 'set' && m.row === '*'));
  const dead = wildcard ? [] : doc.scene.rows.filter((r) => !touched.has(r.id)).map((r) => r.id);
  if (dead.length) {
    notes.push({
      level: 'warn',
      text: `${dead.map((id) => `"${id}"`).join(', ')} never ${dead.length === 1 ? 'changes' : 'change'}; either move it or cut it`,
    });
  }

  // A board of two or three rows with nothing linking them is a list on a phone screen, and it
  // leaves most of a vertical frame empty. The reference channel's boards run four to six.
  if (busiestBoard < 4 && doc.scene.links.length === 0) {
    notes.push({
      level: 'warn',
      text: `${busiestBoard} rows and no links; a board this thin leaves most of the frame empty`,
    });
  }
  const panelLines = steps[steps.length - 1]?.scene.panel.length ?? 0;
  if (panelLines >= 4) {
    notes.push({ level: 'warn', text: 'the panel is full; a fifth line is refused by the fold' });
  } else if (panelLines < 2) {
    notes.push({ level: 'warn', text: `${panelLines} panel lines; the panel is what fills the bottom of the frame` });
  }

  if (doc.beats[0]?.role !== 'hook') {
    notes.push({ level: 'bad', text: 'the first beat is not a hook; the first second is the whole reel' });
  }
  if (!doc.beats.some((b) => b.role === 'payoff')) {
    notes.push({ level: 'bad', text: 'no payoff beat; nothing lands' });
  }
  const cta = doc.beats.findIndex((b) => b.role === 'cta');
  if (cta !== -1 && cta !== doc.beats.length - 1) {
    notes.push({ level: 'warn', text: 'the cta is not last' });
  }

  // Text the renderer will clip. The limits are the schema's, quoted once here.
  const long = steps.flatMap((s) => s.scene.rows.filter((r) => r.label.length > 24).map((r) => r.id));
  if (long.length) {
    notes.push({ level: 'warn', text: `${plural(new Set(long).size, 'label')} close to the 28-character limit` });
  }

  return { seconds, target, busiestBoard, notes };
}

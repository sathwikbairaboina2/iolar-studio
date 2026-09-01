/**
 * Who is on screen, and for how long.
 *
 * A reel that is a talking head from end to end is the thing nobody watches: the same photo
 * animated over and over, cutting to itself. The presenter gets fifteen seconds of any reel,
 * however long it runs, in bites of at least five — the hook, a turn in the argument, the
 * close — and the rest is spent on what is being talked about.
 *
 * So the face is rationed. It goes first to the lines that need a person saying them, then
 * to the lines that have nothing to show, and the rest of the reel is the sources on screen.
 */

export type MixBeat = {
  beatId: string;
  role: 'hook' | 'body' | 'close';
  seconds: number;
  /** Whether this line has a page behind it. A beat with none cannot be a page shot. */
  cites: boolean;
  /**
   * Whether the spoken line finishes its sentence.
   *
   * The planner splits scripts into beats, and nothing stops a sentence landing across two
   * of them. A bite that ends on the first half is a presenter cut off mid-thought — the
   * audio for it stops before the words do. Absent means "assume it does", so callers that
   * have no text to look at keep today's behaviour.
   */
  endsSentence?: boolean;
};

export type Mixed = MixBeat & { kind: 'talking-head' | 'screen' };

export type MixOptions = {
  /**
   * Shortest stretch worth pointing the renderer at.
   *
   * Beats cut to speech run one to two seconds, and a bite that short came back as a face
   * restarting: no gesture, the pose reset before it began. Five seconds is where a take
   * starts to look like someone talking.
   */
  minBiteSec?: number;
  /**
   * The most face a reel gets, in seconds, however long it runs.
   *
   * Fifteen seconds, not a proportion of the runtime: a share means a longer reel earns more
   * talking head, when a longer reel is exactly where that palls.
   */
  presenterMaxSec?: number;
};

/** A run of neighbouring presenter lines, rendered as one continuous bite. */
export type Bite = { beatIds: string[]; seconds: number; startsAt: number };

const DEFAULT_MIN_BITE = 5;
const DEFAULT_MAX_PRESENTER = 15;

/**
 * Ranks the lines by how much a face would add.
 *
 * The opening comes first: a reel that meets its presenter only as it ends has spent the
 * whole thing on documents. Then the lines with no source behind them, which have to be the
 * presenter because the alternative is a page shot with no page — they are taken whatever
 * the budget says, and left to rank below the hook so they cannot crowd it out. Then the
 * close. Everything else is better spent on the thing being described.
 */
function worth(b: MixBeat): number {
  if (b.role === 'hook') return 3;
  if (!b.cites) return 2;
  if (b.role === 'close') return 1;
  return 0;
}

export function planShotMix(beats: MixBeat[], opts: MixOptions = {}): Mixed[] {
  const minBite = opts.minBiteSec ?? DEFAULT_MIN_BITE;
  const budget = opts.presenterMaxSec ?? DEFAULT_MAX_PRESENTER;

  const presenter = new Set<string>();
  const spent = () => beats.filter((b) => presenter.has(b.beatId)).reduce((s, b) => s + b.seconds, 0);

  /**
   * Takes an anchor and the beats either side of it until the stretch is long enough.
   *
   * Neighbours are taken alternately so the face lands around the line that earned it rather
   * than drifting off one end of it.
   */
  const grow = (index: number): string[] => {
    let first = index;
    let last = index;
    let length = beats[index].seconds;
    while (length < minBite && (first > 0 || last < beats.length - 1)) {
      const before = first > 0 ? beats[first - 1] : null;
      const after = last < beats.length - 1 ? beats[last + 1] : null;
      // Prefer whichever neighbour is shorter, so the bite overshoots the floor as little
      // as it can and the budget stretches to another one.
      const takeBefore = before && (!after || before.seconds <= after.seconds);
      if (takeBefore && before) {
        first -= 1;
        length += before.seconds;
      } else if (after) {
        last += 1;
        length += after.seconds;
      } else break;
    }
    // A bite opens where a sentence opens and closes where one closes. Length is settled;
    // this walks each end out to the nearest sentence boundary, overshooting the budget
    // rather than cutting the presenter off mid-thought.
    //
    // The walk is bounded, because the flag comes from a heuristic reading of the text: a
    // script with no full stops at all would otherwise square every bite out to the whole
    // reel and put the face back on screen end to end. Three beats without finding a
    // boundary means the detection is not to be trusted, and the edge goes back where the
    // length put it.
    const HUNT = 3;
    let end = last;
    for (let step = 0; step <= HUNT && end < beats.length; step += 1) {
      // The reel's last beat is a boundary whatever its flag says: the sentence has nowhere
      // left to go.
      if (end === beats.length - 1 || (beats[end].endsSentence ?? true)) {
        last = end;
        break;
      }
      end += 1;
    }
    let begin = first;
    for (let step = 0; step <= HUNT && begin >= 0; step += 1) {
      if (begin === 0 || (beats[begin - 1].endsSentence ?? true)) {
        first = begin;
        break;
      }
      begin -= 1;
    }
    return beats.slice(first, last + 1).map((b) => b.beatId);
  };

  const anchors = beats
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => worth(b) > 0)
    .sort((x, y) => worth(y.b) - worth(x.b));

  for (const { b, i } of anchors) {
    if (presenter.has(b.beatId)) continue;
    const bite = grow(i);
    const cost = bite
      .filter((id) => !presenter.has(id))
      .reduce((s, id) => s + beats.find((x) => x.beatId === id)!.seconds, 0);
    // A line with nothing to show has to be carried whatever the budget says: the
    // alternative is a page shot with no page, which never renders at all.
    const forced = !b.cites;
    if (!forced && presenter.size > 0 && spent() + cost > budget) continue;
    for (const id of bite) presenter.add(id);
  }

  // A reel with no face at all reads as a slideshow. The opening keeps one.
  if (presenter.size === 0 && beats.length) for (const id of grow(0)) presenter.add(id);

  return beats.map((b) => ({ ...b, kind: presenter.has(b.beatId) ? 'talking-head' : 'screen' }));
}

/**
 * The presenter lines gathered into bites.
 *
 * Neighbours share one: every cut between two separate generations of the same photo is
 * where the pose resets and the hands teleport, so the renderer is handed the whole stretch
 * and the timeline cuts inside what comes back.
 */
export function presenterBites(plan: Mixed[]): Bite[] {
  const bites: Bite[] = [];
  let at = 0;
  let open: Bite | null = null;

  for (const b of plan) {
    if (b.kind === 'talking-head') {
      if (open) {
        open.beatIds.push(b.beatId);
        open.seconds += b.seconds;
      } else {
        open = { beatIds: [b.beatId], seconds: b.seconds, startsAt: at };
        bites.push(open);
      }
    } else {
      open = null;
    }
    at += b.seconds;
  }

  return bites.map((b) => ({ ...b, seconds: Math.round(b.seconds * 1e3) / 1e3 }));
}

/** One request covering a run of neighbouring beats that share a picture. */
export type Group = { key: string; beatIds: string[]; seconds: number; startsAt: number };

/**
 * Collapses neighbours that would show the same thing.
 *
 * Four beats spoken over one document is one recording of that document, not four: each
 * extra render is another cut on the same page, which reads as a stutter rather than an
 * edit. Cutting away and coming back is a different matter — that is a return, and it gets
 * its own visit.
 */
export function groupAdjacent(
  segments: { beatId: string; key: string; seconds: number; startsAt?: number }[]
): Group[] {
  const out: Group[] = [];
  let at = 0;
  for (const s of segments) {
    // Where a beat sits on the reel's clock, when the caller knows it. Summing durations
    // instead put every group at the wrong offset — the audio for the closing bite was cut
    // from the opening of the voiceover, and two groups collided on the same filename.
    const startsAt = s.startsAt ?? at;
    const endsAt = startsAt + s.seconds;
    const open = out.at(-1);
    if (open && open.key === s.key) {
      open.beatIds.push(s.beatId);
      // The clock, not the sum. Beats do not butt together — there is breath between them,
      // and adding their durations asked the renderer for a recording two seconds shorter
      // than the words it had to cover, which then froze at the end.
      open.seconds = Math.round((endsAt - open.startsAt) * 1e3) / 1e3;
    } else {
      out.push({ key: s.key, beatIds: [s.beatId], seconds: s.seconds, startsAt: Math.round(startsAt * 1e3) / 1e3 });
    }
    at = endsAt;
  }
  return out;
}

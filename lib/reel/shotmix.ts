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
    const taken = [index];
    let lo = index - 1;
    let hi = index + 1;
    let length = beats[index].seconds;
    while (length < minBite && (lo >= 0 || hi < beats.length)) {
      const before = lo >= 0 ? beats[lo] : null;
      const after = hi < beats.length ? beats[hi] : null;
      // Prefer whichever neighbour is shorter, so the bite overshoots the floor as little
      // as it can and the budget stretches to another one.
      const takeBefore = before && (!after || before.seconds <= after.seconds);
      if (takeBefore && before) {
        taken.unshift(lo);
        length += before.seconds;
        lo -= 1;
      } else if (after) {
        taken.push(hi);
        length += after.seconds;
        hi += 1;
      } else break;
    }
    return taken.map((i) => beats[i].beatId);
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
    const open = out.at(-1);
    if (open && open.key === s.key) {
      open.beatIds.push(s.beatId);
      open.seconds = Math.round((open.seconds + s.seconds) * 1e3) / 1e3;
    } else {
      out.push({ key: s.key, beatIds: [s.beatId], seconds: s.seconds, startsAt: Math.round(startsAt * 1e3) / 1e3 });
    }
    at = startsAt + s.seconds;
  }
  return out;
}

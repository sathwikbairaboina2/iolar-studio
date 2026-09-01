/**
 * Who is on screen, and for how long.
 *
 * A reel that is a talking head from end to end is the thing nobody watches: the same photo
 * animated over and over, cutting to itself. The reference these are measured against gives
 * the presenter roughly a quarter of the runtime — the hook, a turn or two in the argument,
 * the close — and spends the rest on what is being talked about.
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
  /** Share of the runtime the presenter may hold. The reference sits near a quarter. */
  presenterShare?: number;
};

/** A run of neighbouring presenter lines, rendered as one continuous bite. */
export type Bite = { beatIds: string[]; seconds: number; startsAt: number };

const DEFAULT_SHARE = 0.25;

/**
 * Ranks the lines by how much a face would add.
 *
 * The hook and the close carry the argument and are worth a person. After that, a line with
 * no source behind it has to be the presenter, because the alternative is a page shot with
 * no page. Everything else is better spent on the thing being described.
 */
function worth(b: MixBeat): number {
  if (!b.cites) return 3;
  if (b.role === 'hook') return 2;
  if (b.role === 'close') return 1;
  return 0;
}

export function planShotMix(beats: MixBeat[], opts: MixOptions = {}): Mixed[] {
  const share = opts.presenterShare ?? DEFAULT_SHARE;
  const total = beats.reduce((s, b) => s + b.seconds, 0);
  const budget = total * share;

  const ranked = [...beats].sort((a, b) => worth(b) - worth(a) || a.seconds - b.seconds);
  const presenter = new Set<string>();
  let spent = 0;
  for (const b of ranked) {
    // A line with nothing to show is not optional: it takes the face whatever the budget
    // says, because a page shot without a page is a beat that never renders.
    const forced = !b.cites;
    if (!forced && spent + b.seconds > budget) continue;
    presenter.add(b.beatId);
    spent += b.seconds;
  }

  // A reel with no face at all reads as a slideshow. The hook keeps one.
  if (presenter.size === 0 && beats.length) presenter.add(beats[0].beatId);

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
export function groupAdjacent(segments: { beatId: string; key: string; seconds: number }[]): Group[] {
  const out: Group[] = [];
  let at = 0;
  for (const s of segments) {
    const open = out.at(-1);
    if (open && open.key === s.key) {
      open.beatIds.push(s.beatId);
      open.seconds = Math.round((open.seconds + s.seconds) * 1e3) / 1e3;
    } else {
      out.push({ key: s.key, beatIds: [s.beatId], seconds: s.seconds, startsAt: Math.round(at * 1e3) / 1e3 });
    }
    at += s.seconds;
  }
  return out;
}

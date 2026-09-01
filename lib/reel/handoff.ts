import { promises as fs } from 'fs';
import path from 'path';
import { loadReel } from './store';
import { reelDir, reelVoFile } from '../paths';
import type { Reel } from './schema';
import { REEL_RATIOS } from './schema';
import { beatSpans } from './assemble';

/**
 * The reel, handed to whoever is actually cutting it.
 *
 * The studio's job ends at the pieces: the recordings the plugins made, the voiceover they
 * were rendered against, and the script that was approved. Deciding how those are joined is
 * editing, and it is done in an editor.
 *
 * What goes over is a folder anyone can open — the clips named in the order they were made
 * for, the voice, the words, and a project file that places each recording at the moment it
 * was cut for. Opening it lands on the reel as it stands rather than an empty timeline, and
 * everything after that is the editor's call.
 */

export type HandoffClip = {
  file: string;
  startsAt: number;
  seconds: number;
  /** A take of the presenter saying these words, so it carries its own voice. */
  speaks?: boolean;
  /**
   * How long the take actually speaks, when that is shorter than the file.
   *
   * A recording is padded past its words — the renderer's half-second grid, the breath at
   * the end of a cut — and the surplus is silence. The voice track has to come back when
   * the WORDS end, not when the file does: gapping the voiceover for the whole file length
   * swallowed the onset of the next word ("read" came back as "ead").
   */
  speaksSec?: number;
};

export type Handoff = { dir: string; clips: HandoffClip[] };

/**
 * Where the music should sit, written as volume keyframes against the spoken words.
 *
 * A bed at one level end to end is the tell of an unedited export: real edits ride the
 * music under the voice and let it up in the pauses. The word timings already say exactly
 * where the voice is, so the automation is derived rather than guessed — duck a beat
 * before a run of words, hold through it, and ease back up when the silence is long
 * enough to enjoy.
 *
 * Values are decibels, because that is what MLT's volume filter reads `level` as — a
 * linear gain written here comes out as a fraction of one dB and the duck disappears
 * (measured: 0.44 dB of movement instead of 12).
 */
export function duckKeyframes(
  words: { start: number; end: number }[],
  gainDb: number,
  duckDb: number
): string {
  const bed = gainDb.toFixed(2);
  const duck = (gainDb + duckDb).toFixed(2);
  if (!words.length) return `0=${bed}`;

  // Words merge into speech runs: a breath between sentences is not an invitation to
  // swell the music. Only a silence past 1.2 seconds gets the bed back.
  const runs: { start: number; end: number }[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = runs[runs.length - 1];
    if (last && w.start - last.end <= 1.2) last.end = Math.max(last.end, w.end);
    else runs.push({ start: w.start, end: w.end });
  }

  const RAMP = 0.4;
  const LEAD = 0.1;
  const HOLD = 0.25;
  const frames: [number, string][] = [];
  for (const { start, end } of runs) {
    const dip = Math.max(0, start - LEAD);
    frames.push([Math.max(0, dip - RAMP), bed]);
    frames.push([dip, duck]);
    frames.push([end + HOLD, duck]);
    frames.push([end + HOLD + RAMP, bed]);
  }
  // Clamped starts can land two keyframes on the same instant; the later intent wins.
  const clean: [number, string][] = [];
  for (const [t, v] of frames) {
    const prev = clean[clean.length - 1];
    if (prev && t <= prev[0] + 1e-3) clean[clean.length - 1] = [prev[0], v];
    else clean.push([t, v]);
  }
  return clean.map(([t, v]) => `${timecode(t)}=${v}`).join(';');
}

const pad = (n: number, width = 2) => String(Math.floor(n)).padStart(width, '0');

/** MLT counts in hours, minutes, seconds and milliseconds. */
export function timecode(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${pad(ms / 3600000)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)}.${String(ms % 1000).padStart(3, '0')}`;
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The recordings, in the order they play, each knowing where it belongs. */
function placed(reel: Reel) {
  const seen = new Set<string>();
  const out: { asset: Reel['assets'][number]; startsAt: number }[] = [];
  for (const beat of reel.beats) {
    const id = beat.shot.assetId;
    if (!id || seen.has(id)) continue;
    const asset = reel.assets.find((a) => a.id === id);
    if (!asset || asset.origin !== 'plugin') continue;
    seen.add(id);
    out.push({ asset, startsAt: asset.takeStart ?? 0 });
  }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}

/** A stable number for this project, so sending a reel twice does not look like two projects. */
function documentId(reel: Reel): number {
  let h = 7;
  for (const ch of reel.title) h = (h * 31 + ch.charCodeAt(0)) % 1e9;
  return h;
}

/**
 * The same project, in the two shapes the two editors open.
 *
 * Shotcut reads plain MLT. Kdenlive does not — twice over. Its open dialog filters to
 * `*.kdenlive`, so a `.mlt` is invisible there; and renaming alone is not enough, because a
 * timeline clip that is not also in the project bin is dropped on load, one line of
 * "without bin reference found and removed" per clip and an empty timeline at the end of it.
 * So the Kdenlive flavour carries a `main_bin` listing every clip with the `kdenlive:id`
 * its timeline entry points back at, a black track beneath the rest, and the voice marked
 * as an audio track rather than a second video one.
 */
export function buildProject(
  reel: Reel,
  laidClips: HandoffClip[],
  flavour: 'mlt' | 'kdenlive' = 'mlt',
  extras: { music?: string } = {}
): string {
  const [width, height] = REEL_RATIOS[reel.ratio];
  const kden = flavour === 'kdenlive';
  const voiceSec = reel.vo.durationSec;
  const nl = '\n';

  /**
   * A recording may now run a breath past its span — the cut chases the silence after the
   * last word, and a presenter take is padded up to the renderer's half-second grid rather
   * than cut short of its words. On the timeline that surplus is only silence and a held
   * face, so a clip that would run into its neighbour is trimmed to the neighbour's start:
   * a blank of negative length is not a gap, it is a broken project file.
   */
  const clips = laidClips.map((c, i) => {
    const next = laidClips[i + 1];
    const room = next ? next.startsAt - c.startsAt : c.seconds;
    // The floor is one frame — MLT cannot play less — not some larger nicety: a floor
    // above the available room would itself overlap the neighbour it is trimming for.
    return { ...c, seconds: Math.round(Math.max(1 / reel.fps, Math.min(c.seconds, room)) * 1e3) / 1e3 };
  });

  /**
   * MLT's `out` is the last frame that plays, not the length.
   *
   * Handing it the full duration makes every clip one frame too long, so each one overlaps
   * the next. Kdenlive resolves that by shuffling clips onto a second playlist and, on the
   * way, dropped the voiceover ten seconds down the timeline.
   */
  const lastFrame = (seconds: number) => timecode(Math.max(0, seconds - 1 / reel.fps));

  /** Bin ids start at 2 — Kdenlive keeps the lower ones for itself. */
  const binId = (i: number) => i + 2;
  const named = (file: string) => file.split('/').pop() ?? file;

  const producer = (id: string, file: string, seconds: number, bin: number, fades = '') =>
    `  <producer id="${id}" in="00:00:00.000" out="${lastFrame(seconds)}">` + nl +
    `    <property name="resource">${escape(file)}</property>` + nl +
    (kden
      ? `    <property name="mlt_service">avformat-novalidate</property>` + nl +
        `    <property name="length">${timecode(seconds)}</property>` + nl +
        `    <property name="kdenlive:id">${bin}</property>` + nl +
        `    <property name="kdenlive:clipname">${escape(named(file))}</property>` + nl
      : '') +
    fades +
    `  </producer>`;

  /**
   * The gaps, made to look deliberate.
   *
   * Nothing covers the stretches between takes — the reel opens on two and a half seconds of
   * narration with no footage, and there are shorter holes between the page visits. Cutting
   * from picture to black and back reads as a fault; arriving out of black and leaving into
   * it reads as an edit. A dissolve would mean overlapping the takes, which means dragging
   * them off the words they were rendered against, so black it is.
   *
   * Half the gap on each side, never more than half a second, and nothing at all for a gap
   * too short to see.
   */
  const frames = (seconds: number) => Math.round(seconds * reel.fps);
  const MAX_FADE = 0.5;
  const fadeFor = (gap: number, clipSec: number) => {
    const wanted = Math.min(MAX_FADE, gap / 2, clipSec / 3);
    return frames(wanted) >= 2 ? frames(wanted) : 0;
  };

  const fade = (kind: 'from' | 'to', at: number, length: number) => {
    const to = at + length;
    const ramp = kind === 'from' ? `${at}=0;${to}=1` : `${at}=1;${to}=0`;
    return (
      `    <filter id="${kind}_black_${at}" in="${at}" out="${to}">` + nl +
      `      <property name="mlt_service">brightness</property>` + nl +
      `      <property name="level">${ramp}</property>` + nl +
      `      <property name="kdenlive:id">fade_${kind === 'from' ? 'from' : 'to'}_black</property>` + nl +
      `    </filter>` + nl
    );
  };

  const producers = clips
    .map((c, i) => {
      const before = c.startsAt - (i === 0 ? 0 : clips[i - 1].startsAt + clips[i - 1].seconds);
      const ends = c.startsAt + c.seconds;
      const after = (i === clips.length - 1 ? Math.max(voiceSec, ends) : clips[i + 1].startsAt) - ends;
      const last = frames(c.seconds) - 1;

      const inFrames = fadeFor(before, c.seconds);
      const outFrames = fadeFor(after, c.seconds);
      const fades =
        (inFrames ? fade('from', 0, inFrames) : '') +
        (outFrames ? fade('to', Math.max(0, last - outFrames), outFrames) : '');

      return producer(`clip${i}`, c.file, c.seconds, binId(i), fades);
    })
    .join(nl);

  const voiceProducer = producer('voice', 'voice.mp3', voiceSec, binId(clips.length));

  /**
   * The audio half of a take, for the one editor that needs it spelled out.
   *
   * Kdenlive plays no audio from a video track — it writes `hide="audio"` onto every video
   * track it saves — so a lipsync take on the picture track is a presenter miming. The same
   * recording goes on the voice track as an audio-only producer, sharing the take's bin id so
   * Kdenlive still treats the two halves as one clip.
   */
  const speakingHalves = kden
    ? clips
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.speaks)
        .map(
          ({ c, i }) =>
            `  <producer id="clip${i}_audio" in="00:00:00.000" out="${lastFrame(c.seconds)}">` + nl +
            `    <property name="resource">${escape(c.file)}</property>` + nl +
            `    <property name="mlt_service">avformat-novalidate</property>` + nl +
            `    <property name="length">${timecode(c.seconds)}</property>` + nl +
            `    <property name="video_index">-1</property>` + nl +
            `    <property name="kdenlive:id">${binId(i)}</property>` + nl +
            `    <property name="kdenlive:clipname">${escape(named(c.file))}</property>` + nl +
            `  </producer>`
        )
        .join(nl)
    : '';

  // Every clip on the timeline has to be in the bin as well, or Kdenlive removes it on load.
  const bin = kden
    ? `  <playlist id="main_bin">` + nl +
      `    <property name="kdenlive:docproperties.version">1.1</property>` + nl +
      `    <property name="kdenlive:docproperties.profile">${width}x${height} ${reel.fps}fps</property>` + nl +
      `    <property name="kdenlive:docproperties.documentid">${documentId(reel)}</property>` + nl +
      `    <property name="xml_retain">1</property>` + nl +
      clips.map((_, i) => `    <entry producer="clip${i}"/>` + nl).join('') +
      `    <entry producer="voice"/>` + nl +
      (extras.music ? `    <entry producer="bed"/>` + nl : '') +
      `  </playlist>` + nl
    : '';

  // Gaps are left as gaps. A recording sits where its audio was cut from, and closing the
  // space before it by hand would be this studio making an edit again.
  let at = 0;
  const entries = clips
    .map((c, i) => {
      const gap = c.startsAt - at > 0.001 ? `    <blank length="${timecode(c.startsAt - at)}"/>` + nl : '';
      at = c.startsAt + c.seconds;
      return `${gap}    <entry producer="clip${i}" in="00:00:00.000" out="${lastFrame(c.seconds)}"/>`;
    })
    .join(nl);

  const runs = Math.max(voiceSec, at);
  const black = kden
    ? `  <producer id="black_track" in="00:00:00.000" out="${lastFrame(runs)}">` + nl +
      `    <property name="mlt_service">color</property>` + nl +
      `    <property name="resource">black</property>` + nl +
      `    <property name="length">${timecode(runs)}</property>` + nl +
      `  </producer>` + nl
    : '';

  /**
   * The voiceover, out of the presenter's way.
   *
   * A lipsync take is the presenter saying that stretch of the script, and it comes back with
   * that audio on it. Laying the voiceover across it too plays the same line twice, a frame
   * apart — so the voice track holds a gap wherever a take speaks for itself, and the take is
   * left alone.
   */
  const voiceLine = () => {
    const rows: string[] = [];
    let from = 0;
    const speaking = clips
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.speaks)
      .sort((a, b) => a.c.startsAt - b.c.startsAt);
    for (const { c, i } of speaking) {
      const until = Math.min(c.startsAt, voiceSec);
      if (until - from > 0.001) {
        rows.push(`    <entry producer="voice" in="${timecode(from)}" out="${lastFrame(until)}"/>`);
      }
      // The gap runs for as long as the take SPEAKS, not as long as its file: the file is
      // padded past the words with silence, and holding the voiceover out for the padding
      // clipped the onset of whatever word came next.
      const speaks = Math.min(c.speaksSec ?? c.seconds, c.seconds);
      const held = Math.min(speaks, Math.max(0, voiceSec - c.startsAt));
      rows.push(
        kden
          ? `    <entry producer="clip${i}_audio" in="00:00:00.000" out="${lastFrame(speaks)}"/>`
          : `    <blank length="${timecode(held)}"/>`
      );
      from = c.startsAt + speaks;
    }
    if (voiceSec - from > 0.001) {
      rows.push(`    <entry producer="voice" in="${timecode(from)}" out="${lastFrame(voiceSec)}"/>`);
    }
    return rows.join(nl);
  };

  const track = (name: string, audio = false) =>
    kden
      ? `    <property name="kdenlive:track_name">${name}</property>` + nl +
        (audio ? `    <property name="kdenlive:audio_track">1</property>` + nl : '')
      : '';

  /**
   * The music bed, already ridden under the voice.
   *
   * The bed producer carries a volume filter whose keyframes are derived from the word
   * timings — ducked while the voice speaks, back up in the real pauses. The editor gets a
   * mix that already behaves, and every keyframe is theirs to drag. A bed shorter than the
   * reel simply ends; looping it is an edit, and edits belong to the editor.
   */
  const musicRuns = () => Math.max(voiceSec, clips.length ? clips[clips.length - 1].startsAt + clips[clips.length - 1].seconds : 0);
  const musicProducer = extras.music
    ? `  <producer id="bed" in="00:00:00.000" out="${lastFrame(musicRuns())}">` + nl +
      `    <property name="resource">${escape(extras.music)}</property>` + nl +
      (kden
        ? `    <property name="mlt_service">avformat-novalidate</property>` + nl +
          `    <property name="kdenlive:id">${binId(clips.length + 1)}</property>` + nl +
          `    <property name="kdenlive:clipname">${escape(extras.music)}</property>` + nl
        : '') +
      `    <filter id="music_duck">` + nl +
      `      <property name="mlt_service">volume</property>` + nl +
      `      <property name="level">${duckKeyframes(reel.vo.words ?? [], reel.timeline.music.gainDb, reel.timeline.music.duckDb)}</property>` + nl +
      `    </filter>` + nl +
      `  </producer>` + nl
    : '';
  const musicPlaylist = extras.music
    ? `  <playlist id="music">` + nl +
      track('Music', true) +
      `    <entry producer="bed" in="00:00:00.000" out="${lastFrame(musicRuns())}"/>` + nl +
      `  </playlist>` + nl
    : '';

  return `<?xml version="1.0" standalone="no"?>
<mlt LC_NUMERIC="C" version="7.0.0" title="${escape(reel.title)}" producer="main">
  <profile description="${width}x${height} ${reel.fps}fps" width="${width}" height="${height}" progressive="1"
    sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="9" display_aspect_den="16"
    frame_rate_num="${reel.fps}" frame_rate_den="1" colorspace="709"/>
${black}${producers}
${speakingHalves ? speakingHalves + nl : ''}${voiceProducer}
${musicProducer}${bin}  <playlist id="video">
${track('Shots')}${entries}
  </playlist>
  <playlist id="audio">
${track('Voice', true)}${voiceLine()}
  </playlist>
${musicPlaylist}  <tractor id="main" title="${escape(reel.title)}">
${kden ? '    <track producer="black_track"/>\n' : ''}    <track producer="video"/>
    <track producer="audio" hide="video"/>
${extras.music ? '    <track producer="music" hide="video"/>\n' : ''}  </tractor>
</mlt>
`;
}

/** SRT counts in comma-separated milliseconds. */
const srtTime = (seconds: number) => timecode(seconds).replace('.', ',');

/**
 * The words as subtitles, cut where the speech cuts.
 *
 * The studio burns no captions — that call belongs to the editor — but the word timings
 * already exist, and typing them back in by hand is the single most tedious job in the
 * edit. A cue breaks where a sentence ends, where the speaker pauses, or where the line
 * would run wider than a phone: whichever comes first.
 */
export function buildSrt(words: { w: string; start: number; end: number }[]): string {
  const MAX_CHARS = 38;
  const PAUSE = 0.6;

  // Sorted defensively: an unsorted list would defeat the pause detection and write cues
  // out of chronological order, which players refuse.
  const inOrder = [...words].sort((a, b) => a.start - b.start);

  const cues: { start: number; end: number; text: string }[] = [];
  let open: { start: number; end: number; parts: string[] } | null = null;

  const close = () => {
    if (open) cues.push({ start: open.start, end: open.end, text: open.parts.join(' ') });
    open = null;
  };

  for (const w of inOrder) {
    const word = w.w.trim();
    if (!word) continue;
    const wide = open && open.parts.join(' ').length + word.length + 1 > MAX_CHARS;
    // A word that finishes its sentence may overflow the width a little: "reference /
    // list." as two cues is worse than one line a few characters wide.
    const finishes = /[.!?…]["'’”)\]»]*$/.test(word);
    const overflowOk = finishes && open && open.parts.join(' ').length + word.length + 1 <= MAX_CHARS + 8;
    if (open && (w.start - open.end > PAUSE || (wide && !overflowOk))) {
      close();
    }
    if (!open) open = { start: w.start, end: w.end, parts: [] };
    open.parts.push(word);
    open.end = Math.max(open.end, w.end);
    if (/[.!?…]["'’”)\]»]*$/.test(word)) close();
  }
  close();

  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

/** The script as words on a page: who says what, and what is on screen while they do. */
export function buildScript(reel: Reel): string {
  const lines = reel.beats.map((b) => {
    const asset = reel.assets.find((a) => a.id === b.shot.assetId);
    const shows = asset?.provider ? `${b.shot.kind} · ${asset.provider}` : b.shot.kind;
    return `[${b.id}] (${shows})\n${b.text}\n`;
  });
  return `${reel.title}\n${'='.repeat(reel.title.length)}\n\nVoiceover: voice.mp3 (${reel.vo.durationSec.toFixed(1)}s)\n\n${lines.join('\n')}`;
}

/** Writes the folder. Nothing is joined, nothing is re-encoded. */
export async function writeHandoff(slug: string): Promise<Handoff> {
  const reel = await loadReel(slug);
  const pieces = placed(reel);
  if (!pieces.length) throw new Error('nothing to hand over — no recordings have landed yet');

  const unfinished = pieces.filter((p) => p.asset.status !== 'ready' || !p.asset.path);
  if (unfinished.length) {
    throw new Error(
      `${unfinished.length} shot${unfinished.length === 1 ? ' is' : 's are'} still rendering — hand it over once they land`
    );
  }

  const dir = path.join(reelDir(slug), 'edit');
  // Windows will not delete a file the editor still has open, and half a rebuilt folder is
  // worse than none — so say which one, rather than leaving a gutted folder behind.
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    const locked = (err as NodeJS.ErrnoException).code;
    if (locked !== 'EBUSY' && locked !== 'EPERM') throw err;
    throw new Error('the edit folder is open in an editor — close it and send again');
  }
  await fs.mkdir(path.join(dir, 'clips'), { recursive: true });

  // Where each take's WORDS end, from the aligned spans of the beats it covers — the file
  // itself runs longer, padded with silence, and the voice track resumes on the words.
  const spans = beatSpans(reel);
  const spokenEnd = (assetId: string) => {
    let end = 0;
    for (const b of reel.beats) {
      if (b.shot.assetId !== assetId) continue;
      const span = spans.get(b.id);
      if (span) end = Math.max(end, span.end);
    }
    return end;
  };

  const clips: Handoff['clips'] = [];
  for (const [i, { asset, startsAt }] of pieces.entries()) {
    const name = `${String(i + 1).padStart(2, '0')}-${asset.provider ?? 'clip'}-${asset.id}.mp4`;
    await fs.copyFile(path.join(reelDir(slug), asset.path), path.join(dir, 'clips', name));
    const seconds = asset.durationSec ?? 0;
    const spoken = spokenEnd(asset.id) - startsAt;
    clips.push({
      file: `clips/${name}`,
      startsAt,
      seconds,
      speaks: asset.provider === 'lipsync',
      ...(spoken > 0.05 && spoken < seconds ? { speaksSec: Math.round(spoken * 1e3) / 1e3 } : {}),
    });
  }

  await fs.copyFile(reelVoFile(slug), path.join(dir, 'voice.mp3'));

  // The bed travels with the project when the reel has one; a music path that cannot be
  // copied is treated as no music rather than a project pointing at a file that is not
  // there.
  let music: string | undefined;
  if (reel.timeline.music.path) {
    const name = `music${path.extname(reel.timeline.music.path) || '.mp3'}`;
    music = await fs
      .copyFile(path.join(reelDir(slug), reel.timeline.music.path), path.join(dir, name))
      .then(() => name)
      .catch(() => undefined);
  }

  await fs.writeFile(path.join(dir, 'script.txt'), buildScript(reel), 'utf8');
  // The editor's call whether these burn in; the timings are too tedious to retype.
  if (reel.vo.words.length) {
    await fs.writeFile(path.join(dir, 'captions.srt'), buildSrt(reel.vo.words), 'utf8');
  }
  await fs.writeFile(path.join(dir, 'project.mlt'), buildProject(reel, clips, 'mlt', { music }), 'utf8');
  await fs.writeFile(path.join(dir, 'project.kdenlive'), buildProject(reel, clips, 'kdenlive', { music }), 'utf8');

  return { dir, clips };
}

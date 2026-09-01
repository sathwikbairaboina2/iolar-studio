import { promises as fs } from 'fs';
import path from 'path';
import { loadReel } from './store';
import { reelDir, reelVoFile } from '../paths';
import type { Reel } from './schema';
import { REEL_RATIOS } from './schema';

/**
 * The reel, handed to whoever is actually cutting it.
 *
 * The studio's job ends at the pieces: the recordings the plugins made, the voiceover they
 * were rendered against, and the script that was approved. Deciding how those are joined is
 * editing, and it is done in an editor.
 *
 * What goes over is a folder anyone can open — the clips named in the order they were made
 * for, the voice, the words, and an MLT project (Shotcut and Kdenlive both read it) that
 * places each recording at the moment it was cut for. Opening it lands on the reel as it
 * stands rather than an empty timeline, and everything after that is the editor's call.
 */

export type Handoff = { dir: string; clips: { file: string; startsAt: number; seconds: number }[] };

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

export function buildProject(
  reel: Reel,
  clips: { file: string; startsAt: number; seconds: number }[]
): string {
  const [width, height] = REEL_RATIOS[reel.ratio];
  const producers = clips
    .map(
      (c, i) =>
        `  <producer id="clip${i}">\n` +
        `    <property name="resource">${escape(c.file)}</property>\n` +
        `  </producer>`
    )
    .join('\n');

  // Gaps are left as gaps. A recording sits where its audio was cut from, and closing the
  // space before it by hand would be this studio making an edit again.
  let at = 0;
  const entries = clips
    .map((c, i) => {
      const gap = c.startsAt - at > 0.001 ? `    <blank length="${timecode(c.startsAt - at)}"/>\n` : '';
      at = c.startsAt + c.seconds;
      return `${gap}    <entry producer="clip${i}" in="00:00:00.000" out="${timecode(c.seconds)}"/>`;
    })
    .join('\n');

  return `<?xml version="1.0" standalone="no"?>
<mlt LC_NUMERIC="C" version="7.0.0" title="${escape(reel.title)}" producer="main">
  <profile description="${width}x${height} ${reel.fps}fps" width="${width}" height="${height}" progressive="1"
    sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="9" display_aspect_den="16"
    frame_rate_num="${reel.fps}" frame_rate_den="1" colorspace="709"/>
${producers}
  <producer id="voice">
    <property name="resource">voice.mp3</property>
  </producer>
  <playlist id="video">
${entries}
  </playlist>
  <playlist id="audio">
    <entry producer="voice" in="00:00:00.000" out="${timecode(reel.vo.durationSec)}"/>
  </playlist>
  <tractor id="main" title="${escape(reel.title)}">
    <track producer="video"/>
    <track producer="audio"/>
  </tractor>
</mlt>
`;
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
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'clips'), { recursive: true });

  const clips: Handoff['clips'] = [];
  for (const [i, { asset, startsAt }] of pieces.entries()) {
    const name = `${String(i + 1).padStart(2, '0')}-${asset.provider ?? 'clip'}-${asset.id}.mp4`;
    await fs.copyFile(path.join(reelDir(slug), asset.path), path.join(dir, 'clips', name));
    clips.push({ file: `clips/${name}`, startsAt, seconds: asset.durationSec ?? 0 });
  }

  await fs.copyFile(reelVoFile(slug), path.join(dir, 'voice.mp3'));
  await fs.writeFile(path.join(dir, 'script.txt'), buildScript(reel), 'utf8');
  await fs.writeFile(path.join(dir, 'project.mlt'), buildProject(reel, clips), 'utf8');

  return { dir, clips };
}

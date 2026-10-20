import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { explainer2File } from '@/lib/paths';

/**
 * The sound library the plugin's Remotion project holds under `public/designed/_audio/`: music beds and sound effects
 * generated locally, listed in `manifest.json`. The studio only reads it: it picks a bed for each video into `sound.json`
 * and tells the designer which beds and effects exist. The video's `SoundTrack` does the rest.
 */

export const SFX_EVENTS = ['whoosh', 'pop', 'tick', 'chime-good', 'buzz-bad', 'count', 'swish', 'land'] as const;

const EntrySchema = z.object({
  file: z.string().min(1),
  kind: z.enum(['music', 'sfx']),
  mood: z.string().optional(),
  event: z.string().optional(),
  durationSec: z.number().optional(),
  source: z.string().optional(),
  license: z.string().optional(),
});
export type AudioEntry = z.infer<typeof EntrySchema>;

/** The manifest's usable entries, with `music/` or `sfx/` put in front of a bare file name. Null when it is not a manifest at all. */
export function parseManifest(raw: unknown): AudioEntry[] | null {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { files?: unknown }).files) ? (raw as { files: unknown[] }).files : null;
  if (!list) return null;
  const out: AudioEntry[] = [];
  for (const item of list) {
    const e = EntrySchema.safeParse(item);
    if (!e.success) continue;
    const file = e.data.file.replace(/\\/g, '/');
    out.push({ ...e.data, file: file.startsWith(`${e.data.kind}/`) ? file : `${e.data.kind}/${file}` });
  }
  return out;
}

export async function readManifest(root: string): Promise<AudioEntry[] | null> {
  try {
    return parseManifest(JSON.parse(await fs.readFile(path.join(root, 'public', 'designed', '_audio', 'manifest.json'), 'utf8')));
  } catch {
    return null;
  }
}

export const musicBeds = (m: readonly AudioEntry[]): AudioEntry[] => m.filter((e) => e.kind === 'music');

/** Moods that suit an explainer, best first. */
export const PREFERRED_MOODS = ['focused', 'calm', 'curious', 'steady', 'ambient', 'minimal'];

/** A bed of the most preferred mood the library has; the same slug always gets the same one, different slugs spread over them. Null when there is no music. */
export function chooseBed(m: readonly AudioEntry[] | null, slug: string, moods: readonly string[] = PREFERRED_MOODS): string | null {
  const beds = m ? musicBeds(m) : [];
  if (!beds.length) return null;
  const mood = moods.find((x) => beds.some((b) => b.mood?.toLowerCase() === x));
  const pool = mood ? beds.filter((b) => b.mood?.toLowerCase() === mood) : beds;
  const n = createHash('sha1').update(slug).digest().readUInt32BE(0);
  return pool[n % pool.length].file;
}

/** The part of the design prompt about sound: which beds and effects exist. */
export function soundBrief(m: readonly AudioEntry[] | null): string {
  if (!m || !m.length) return 'There is no audio library yet: still put SoundTrack (with bed from sound.json) and Sfx in the video, they stay silent until files exist.';
  const beds = musicBeds(m).map((b) => `- ${b.file} (${b.mood ?? 'no mood'}${b.durationSec ? `, ${Math.round(b.durationSec)} s` : ''})`);
  const have = new Set(m.filter((e) => e.kind === 'sfx').map((e) => e.event ?? path.basename(e.file).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]\d+$/, '')));
  const events = SFX_EVENTS.filter((e) => have.has(e));
  return [`Music beds in the library (the studio has chosen one for sound.json):`, ...(beds.length ? beds : ['- none']), `Sound effect events with a file: ${events.length ? events.join(', ') : 'none'}.`].join('\n');
}

export type Sound = { bed: string | null };

export async function readSound(slug: string): Promise<Sound | null> {
  try {
    const raw = JSON.parse(await fs.readFile(explainer2File(slug, 'sound.json'), 'utf8')) as { bed?: unknown };
    return { bed: typeof raw.bed === 'string' ? raw.bed : null };
  } catch {
    return null;
  }
}

export async function writeSound(slug: string, sound: Sound): Promise<void> {
  await fs.mkdir(path.dirname(explainer2File(slug, 'sound.json')), { recursive: true });
  await fs.writeFile(explainer2File(slug, 'sound.json'), JSON.stringify(sound, null, 2));
}

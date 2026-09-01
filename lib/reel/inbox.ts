import { promises as fs } from 'fs';
import path from 'path';
import { beatInboxDir } from '../paths';
import { loadReel } from './store';
import { attachAsset, type DropRole } from './shots';
import type { Reel } from './schema';

/**
 * A folder per beat, for footage you already have.
 *
 * Dropping files through the browser is fine for one shot and miserable for fifteen, and a
 * reel that is half your own clips is the normal case rather than the exception. The inbox
 * is a plain folder on disk: fill it however you like, then adopt what you want. Adopting
 * copies, so the folder stays yours to re-use or re-adopt from.
 */

const VIDEO = /\.(mp4|webm|mkv|mov|m4v)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

export type InboxFile = { name: string; bytes: number; kind: 'video' | 'image'; modified: number };
export type BeatInbox = { beatId: string; dir: string; files: InboxFile[] };

async function readBox(slug: string, beatId: string): Promise<BeatInbox> {
  const dir = beatInboxDir(slug, beatId);
  await fs.mkdir(dir, { recursive: true });
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const files: InboxFile[] = [];
  for (const name of names) {
    const kind = VIDEO.test(name) ? 'video' : IMAGE.test(name) ? 'image' : null;
    // Anything else is a note to self, not footage: listing it would only invite adopting it.
    if (!kind) continue;
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!stat?.isFile()) continue;
    files.push({ name, bytes: stat.size, kind, modified: stat.mtimeMs });
  }
  return { beatId, dir, files: files.sort((a, b) => b.modified - a.modified) };
}

/** Every beat's folder, created if it does not exist yet, with whatever is sitting in it. */
export async function openInbox(slug: string): Promise<BeatInbox[]> {
  const reel = await loadReel(slug);
  const out: BeatInbox[] = [];
  for (const beat of reel.beats) out.push(await readBox(slug, beat.id));
  return out;
}

/** A name that names one file in one folder — never a path into somewhere else. */
function safeName(name: string): string {
  if (!name || name !== path.basename(name) || name === '.' || name === '..') {
    throw new Error(`"${name}" is not a file name inside the beat's folder`);
  }
  return name;
}

/**
 * Takes one file out of a beat's folder and makes it that beat's footage.
 *
 * `role` carries the same meaning it has for a browser drop: a video is always the shot,
 * an image is a still to animate unless you say otherwise.
 */
export async function adoptFromInbox(
  slug: string,
  beatId: string,
  name: string,
  role: DropRole = 'still'
): Promise<Reel> {
  const reel = await loadReel(slug);
  if (!reel.beats.some((b) => b.id === beatId)) throw new Error(`no beat ${beatId} in this reel`);
  const safe = safeName(name);
  const file = path.join(beatInboxDir(slug, beatId), safe);
  const bytes = await fs.readFile(file).catch(() => null);
  if (!bytes) throw new Error(`${safe} is not in that beat's folder`);
  return attachAsset(slug, beatId, { name: safe, bytes }, role);
}

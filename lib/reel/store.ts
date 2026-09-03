import { promises as fs } from 'fs';
import path from 'path';
import { Reel, ReelAsset, emptyReel, validateReel } from './schema';
import { reelAssetsDir, reelDir, reelExportDir, reelFile, reelsRoot } from '../paths';

export type ReelStatus = 'draft' | 'voiced' | 'assembled' | 'exported';
export type ReelMeta = {
  slug: string;
  title: string;
  style: string;
  beats: number;
  durationSec: number;
  status: ReelStatus;
  updatedAt: string;
};

export function reelStatus(reel: Reel, exported = false): ReelStatus {
  if (exported) return 'exported';
  if (reel.timeline.clips.length) return 'assembled';
  if (reel.vo.words.length) return 'voiced';
  return 'draft';
}

export async function createReel(slug: string, over: Partial<Reel> = {}): Promise<Reel> {
  const reel = emptyReel(slug, over);
  await fs.mkdir(reelAssetsDir(slug), { recursive: true });
  await saveReel(slug, reel);
  return reel;
}

export async function loadReel(slug: string): Promise<Reel> {
  return validateReel(JSON.parse(await fs.readFile(reelFile(slug), 'utf8')));
}

export async function saveReel(slug: string, reel: Reel): Promise<void> {
  const valid = validateReel(reel);
  await fs.mkdir(reelDir(slug), { recursive: true });
  // Reels are filesystem-only on purpose: the knowledge graph and its SQLite index
  // belong to handbooks, and a reel has no chapters or topics to contribute to them.
  await fs.writeFile(reelFile(slug), JSON.stringify(valid, null, 2));
}

export async function deleteReel(slug: string): Promise<void> {
  await fs.rm(reelDir(slug), { recursive: true, force: true });
}

export async function listReels(): Promise<ReelMeta[]> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(reelsRoot(), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: ReelMeta[] = [];
  for (const slug of names) {
    try {
      const reel = await loadReel(slug);
      const stat = await fs.stat(reelFile(slug));
      const exported = await fs
        .access(path.join(reelExportDir(slug), 'reel.mp4'))
        .then(() => true)
        .catch(() => false);
      const last = reel.timeline.clips.at(-1);
      out.push({
        slug,
        title: reel.title,
        style: reel.style,
        beats: reel.beats.length,
        durationSec: last ? last.end : reel.vo.durationSec,
        status: reelStatus(reel, exported),
        updatedAt: stat.mtime.toISOString(),
      });
    } catch {
      // A half-written reel folder never breaks the list.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type NewAsset = Omit<ReelAsset, 'id' | 'status' | 'brief'> &
  Partial<Pick<ReelAsset, 'status' | 'brief'>>;

export async function addAsset(slug: string, asset: NewAsset): Promise<ReelAsset> {
  const reel = await loadReel(slug);
  const n = reel.assets.reduce((m, a) => Math.max(m, Number(a.id.slice(1)) || 0), 0) + 1;
  const next = validateReel({ ...reel, assets: [...reel.assets, { ...asset, id: `a${n}` }] });
  await saveReel(slug, next);
  return next.assets.at(-1)!;
}

export async function updateAsset(slug: string, id: string, patch: Partial<ReelAsset>): Promise<ReelAsset> {
  const reel = await loadReel(slug);
  const assets = reel.assets.map((a) => (a.id === id ? { ...a, ...patch } : a));
  const found = assets.find((a) => a.id === id);
  if (!found) throw new Error(`asset ${id} not found in ${slug}`);
  await saveReel(slug, { ...reel, assets });
  return found;
}

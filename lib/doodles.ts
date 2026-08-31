import { promises as fs } from 'fs';
import path from 'path';

/**
 * The doodle library on disk.
 *
 * These used to be generated through a local ComfyUI checkpoint. That path is
 * gone with the rest of the generation code, but the files it already wrote are
 * still the assets the studio draws with — so they are still listed and served,
 * and new ones are added by dropping PNGs into the folder.
 */
export function doodleDir() {
  return path.join(process.cwd(), 'assets', 'doodles');
}

export async function listDoodles(): Promise<string[]> {
  try {
    return (await fs.readdir(doodleDir())).filter((f) => f.endsWith('.png'));
  } catch {
    return [];
  }
}

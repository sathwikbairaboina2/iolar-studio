import { promises as fs } from 'fs';
import path from 'path';
import { explainer2Dir, explainer2VideoDir, explainer2VoiceDir, isSlug } from '@/lib/paths';

/**
 * The Remotion workspace is the plugin's `render/` project. The studio owns every video's files; the workspace
 * only ever holds a copy, put there before a design or render and (for Video.tsx) copied back after.
 */

const PLUGIN_ROOT = process.env.PLUGIN_ROOT ?? 'C:/Users/sathwik/projects';

export function renderRoot(): string {
  return process.env.REELS_RENDER_DIR ?? `${PLUGIN_ROOT}/plugins/main-reels-templates-plugin/render`;
}

export type WorkspacePaths = {
  root: string;
  videoDir: string;
  videoFile: string;
  publicDir: string;
  stillsDir: string;
  indexScript: string;
};

export function workspacePaths(root: string, slug: string): WorkspacePaths {
  if (!isSlug(slug)) throw new Error(`bad slug: ${slug}`);
  const videoDir = path.join(root, 'src', 'designed', 'videos', slug);
  return {
    root,
    videoDir,
    videoFile: path.join(videoDir, 'Video.tsx'),
    publicDir: path.join(root, 'public', 'designed', slug),
    stillsDir: path.join(root, 'out', 'designed', slug),
    indexScript: path.join(root, 'scripts', 'designed-index.mjs'),
  };
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** Files the designer reads for context. They sit beside Video.tsx and are never imported. */
const CONTEXT = ['brief.json', 'script.json', 'timing.json', 'sound.json'];

/** Studio -> workspace: voice clips, context files, and the current Video.tsx (or none, for a first design). */
export async function syncIn(slug: string, root: string = renderRoot()): Promise<WorkspacePaths> {
  const w = workspacePaths(root, slug);
  const studio = explainer2Dir(slug);
  await fs.mkdir(w.videoDir, { recursive: true });
  await fs.mkdir(w.publicDir, { recursive: true });

  for (const name of CONTEXT) {
    const from = path.join(studio, name);
    if (await exists(from)) await fs.copyFile(from, path.join(w.videoDir, name));
  }

  const voice = explainer2VoiceDir(slug);
  if (await exists(voice)) {
    for (const f of await fs.readdir(voice)) if (f.endsWith('.mp3')) await fs.copyFile(path.join(voice, f), path.join(w.publicDir, f));
  }

  const video = path.join(explainer2VideoDir(slug), 'Video.tsx');
  if (await exists(video)) await fs.copyFile(video, w.videoFile);
  else await fs.rm(w.videoFile, { force: true });
  return w;
}

/** Workspace -> studio: the designer's Video.tsx becomes the source of truth. False when none was written. */
export async function syncOut(slug: string, root: string = renderRoot()): Promise<boolean> {
  const w = workspacePaths(root, slug);
  if (!(await exists(w.videoFile))) return false;
  await fs.mkdir(explainer2VideoDir(slug), { recursive: true });
  await fs.copyFile(w.videoFile, path.join(explainer2VideoDir(slug), 'Video.tsx'));
  return true;
}

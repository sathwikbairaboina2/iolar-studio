import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { writeHandoff } from '@/lib/reel/handoff';
import { reelDir, reelExportDir, isSlug } from '@/lib/paths';
import { serveMedia } from '@/lib/reel/serveMedia';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 300;

/** A reel is 70MB of clips; a cut of it is another 60. */
const MAX_CUT_BYTES = 400 * 1024 * 1024;

/**
 * The handoff, both ways.
 *
 * POST writes the folder an editor opens — clips, voice, script, project file. PUT takes the
 * finished cut back and stores it as the reel's export, which is the one thing the studio
 * cares about once the editing is done elsewhere.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const out = await writeHandoff(slug);
    return NextResponse.json({ dir: out.dir, clips: out.clips.length, project: path.join(out.dir, 'project.mlt') });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });

  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: 'no video in the request body' }, { status: 400 });
  if (bytes.length > MAX_CUT_BYTES) return NextResponse.json({ error: 'that cut is too large' }, { status: 413 });

  const dest = path.join(reelExportDir(slug), 'reel.mp4');
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);
  return NextResponse.json({ ok: true, bytes: bytes.length, path: 'export/reel.mp4' });
}

/** The folder listing, so the studio can say what was handed over and when. */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dir = path.join(reelDir(slug), 'edit');
  try {
    const stat = await fs.stat(dir);
    const clips = await fs.readdir(path.join(dir, 'clips')).catch(() => [] as string[]);
    const url = new URL(req.url);
    if (url.searchParams.get('project')) return serveMedia(path.join(dir, 'project.mlt'), req);
    return NextResponse.json({ dir, handedOverAt: stat.mtime.toISOString(), clips });
  } catch {
    return NextResponse.json({ error: 'nothing has been handed over yet' }, { status: 404 });
  }
}

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { explainer2VoiceDir, isSlug } from '@/lib/paths';
import { ScriptSchema } from '@/lib/explainer2/schema';
import { isRunning, scriptEdited } from '@/lib/explainer2/job';
import { musicBeds, readManifest, readSound } from '@/lib/explainer2/sound';
import { listStills, listStrips, readBrief, readCritic, readFactcheck, readJob, readScript, readTiming, writeScript } from '@/lib/explainer2/store';
import { renderRoot } from '@/lib/explainer2/workspace';

type Ctx = { params: Promise<{ slug: string }> };

async function clips(slug: string): Promise<string[]> {
  try {
    return (await fs.readdir(explainer2VoiceDir(slug))).filter((f) => f.endsWith('.mp3')).sort();
  } catch {
    return [];
  }
}

/** Everything the detail page shows, in one read. The page polls this while a run is going. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  const [brief, job] = await Promise.all([readBrief(slug), readJob(slug)]);
  if (!brief || !job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const [script, factcheck, timing, stills, voice, critic, strips, sound, manifest] = await Promise.all([
    readScript(slug), readFactcheck(slug), readTiming(slug), listStills(slug), clips(slug), readCritic(slug), listStrips(slug), readSound(slug), readManifest(renderRoot()),
  ]);
  const beds = musicBeds(manifest ?? []).map((b) => ({ file: b.file, mood: b.mood ?? null }));
  return NextResponse.json({ slug, brief, job, script, factcheck, timing, stills, voice, critic, strips, sound: { bed: sound?.bed ?? null, beds }, running: isRunning(slug) });
}

/** A person edits the script. It is validated like the model's, and the fact check and everything after it become pending. */
export async function PUT(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  if (!(await readJob(slug))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (isRunning(slug)) return NextResponse.json({ error: 'it is running; wait for it to finish' }, { status: 409 });
  const parsed = ScriptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  }
  await writeScript(slug, parsed.data);
  await scriptEdited(slug);
  return NextResponse.json({ ok: true });
}

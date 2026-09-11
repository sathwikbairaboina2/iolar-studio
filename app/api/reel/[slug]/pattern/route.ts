import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { loadReel, saveReel } from '@/lib/reel/store';
import { patternDef, SectionError, templateFor } from '@/lib/reel/pattern';
import { patternState, pollRender, type PatternState } from '@/lib/reel/pattern/run';
import { candidateRefs } from '@/lib/reel/pattern/document';
import { templates, ServiceDown } from '@/lib/templates/service';
import * as research from '@/lib/reel/research/store';

type Ctx = { params: Promise<{ slug: string }> };

const failed = (err: unknown) => {
  if (err instanceof SectionError) return NextResponse.json({ error: err.message, path: err.path }, { status: 400 });
  if (err instanceof ServiceDown) return NextResponse.json({ error: err.message }, { status: 503 });
  return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
};

/** The state plus what the board needs to draw it in one call: the lines, the limits, the themes. */
async function view(slug: string, state: PatternState) {
  const reel = await loadReel(slug);
  const script = await research.readScript(slug).catch(() => null);
  const lines = Object.fromEntries((script?.lines ?? []).map((l) => [l.id, l.text]));
  let limits: Record<string, number> = {};
  let themes: string[] = [];
  try {
    const t = templateFor(reel.pattern!.name, await templates());
    limits = t.limits;
    themes = t.themes;
  } catch {
    // The service is down; the state already says so.
  }
  return { ...state, pattern: reel.pattern, lines, limits, themes };
}

/** Where the pattern build is; polls the service while a job is running. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  try {
    const reel = await loadReel(slug);
    if (!reel.pattern) return NextResponse.json({ error: 'not a pattern reel' }, { status: 404 });
    const live = reel.pattern.job && ['queued', 'preparing', 'rendering'].includes(reel.pattern.job.state);
    let state: PatternState;
    try {
      state = live ? await pollRender(slug) : await patternState(slug);
    } catch (err) {
      // A busy service (capturing pages in Chromium) can miss one poll; the last known
      // state is still the truth on disk, so the board keeps drawing rather than erroring.
      if (!(err instanceof ServiceDown) || !live) throw err;
      state = { ...(await patternState(slug, { provider: null })), blocked: err.message };
    }
    return NextResponse.json(await view(slug, state));
  } catch (err) {
    return failed(err);
  }
}

/** Edits to the pattern: theme, presenter source, sections (checked by the definition). */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { theme?: string; presenter?: 'lipsync' | 'upload'; sections?: unknown[] };
  try {
    const reel = await loadReel(slug);
    if (!reel.pattern) return NextResponse.json({ error: 'not a pattern reel' }, { status: 404 });
    let next = { ...reel.pattern };
    if (typeof body.theme === 'string' && body.theme) next.theme = body.theme;
    if (body.presenter === 'lipsync' || body.presenter === 'upload') next.presenter = body.presenter;
    if (Array.isArray(body.sections)) {
      const def = patternDef(next.name);
      const script = await research.readScript(slug);
      const limits = templateFor(next.name, await templates()).limits;
      const errs = def.check(body.sections, script, await candidateRefs(slug), limits);
      if (errs.length) throw errs[0];
      next = { ...next, sections: def.SectionsSchema.parse(body.sections) as Record<string, unknown>[] };
    }
    await saveReel(slug, { ...reel, pattern: next });
    return NextResponse.json(await view(slug, await patternState(slug, { provider: null })));
  } catch (err) {
    return failed(err);
  }
}

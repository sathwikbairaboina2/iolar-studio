import { NextResponse } from 'next/server';
import { blankDoc, freeSlug, list, save } from '@/lib/explainer/store';
import { contract } from '@/lib/explainer/service';

/**
 * The shelf, and the one way onto it.
 *
 * A new explainer starts from a blank board rather than an empty file: two rows, a hook and a
 * payoff. An empty document is a form to fill in; a small working one is something to change,
 * which is a much easier thing to be handed.
 */

export async function GET() {
  const [explainers, spec] = await Promise.all([list(), contract()]);
  return NextResponse.json({
    explainers,
    // Null when the service is down. The page says so rather than offering a theme that
    // cannot render.
    contract: spec,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string; theme?: string };
  const title = (body.title ?? '').trim();
  if (!title) return NextResponse.json({ error: 'a title is required' }, { status: 400 });

  const spec = await contract();
  const theme = body.theme && spec?.themes.includes(body.theme) ? body.theme : (spec?.themes[0] ?? 'midnight');

  const slug = await freeSlug(title);
  const doc = await save(slug, blankDoc(title, theme));
  return NextResponse.json({ slug, doc }, { status: 201 });
}

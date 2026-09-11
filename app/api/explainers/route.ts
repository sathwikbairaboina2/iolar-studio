import { NextResponse } from 'next/server';
import { blankDoc, freeSlug, list, save } from '@/lib/explainer/store';
import { contract } from '@/lib/explainer/service';
import { AuthorError, draft } from '@/lib/explainer/author';
import { BriefSchema } from '@/lib/explainer/schema';

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
  const body = (await req.json().catch(() => ({}))) as { title?: string; theme?: string; brief?: unknown };
  const title = (body.title ?? '').trim();
  if (!title) return NextResponse.json({ error: 'a title is required' }, { status: 400 });

  const spec = await contract();
  const theme = body.theme && spec?.themes.includes(body.theme) ? body.theme : (spec?.themes[0] ?? 'midnight');
  const slug = await freeSlug(title);

  // With a brief, the explainer starts as something written about the topic rather than as two
  // rows called Before and After. A model that will not answer is not a reason to lose the
  // explainer, so the blank board is still saved and the page says what happened.
  const brief = BriefSchema.safeParse(body.brief);
  if (brief.success) {
    try {
      const doc = await save(slug, { ...(await draft(brief.data)), theme });
      return NextResponse.json({ slug, doc, drafted: true }, { status: 201 });
    } catch (err) {
      const doc = await save(slug, { ...blankDoc(title, theme), brief: brief.data });
      const said = err instanceof AuthorError ? err.said.slice(0, 2000) : null;
      return NextResponse.json(
        { slug, doc, drafted: false, error: String(err instanceof Error ? err.message : err), said },
        { status: 201 }
      );
    }
  }

  const doc = await save(slug, blankDoc(title, theme));
  return NextResponse.json({ slug, doc, drafted: false }, { status: 201 });
}

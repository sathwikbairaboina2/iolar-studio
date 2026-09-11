import { NextResponse } from 'next/server';
import { AuthorError, draft, revise, type Brief } from '@/lib/explainer/author';
import { diff } from '@/lib/explainer/diff';
import { fit } from '@/lib/explainer/fit';
import { BriefSchema } from '@/lib/explainer/schema';
import { get } from '@/lib/explainer/store';

/**
 * Think about this explainer, and answer with what would change.
 *
 * Nothing here writes. The page shows the diff and the user approves it, which goes back through
 * the command layer as `agent` — so an AI pass is one undoable step like any other edit.
 *
 * This is a plain request, not a job: unlike a render there is nothing to keep and nothing to lose
 * if the tab closes, because a proposal nobody approved was never worth saving.
 */

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const doc = await get(slug);
  if (!doc) return NextResponse.json({ error: `no explainer "${slug}"` }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    mode?: string; brief?: unknown; instruction?: string;
  };

  try {
    let proposed;
    if (body.mode === 'revise') {
      const instruction = (body.instruction ?? '').trim();
      if (!instruction) return NextResponse.json({ error: 'say what to change' }, { status: 400 });
      proposed = await revise(doc, instruction);
    } else {
      const parsed = BriefSchema.safeParse(body.brief ?? doc.brief);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'a brief is four fields: topic, audience, claim, seconds', issues: parsed.error.issues },
          { status: 400 }
        );
      }
      proposed = await draft(parsed.data as Brief);
    }

    return NextResponse.json({
      doc: proposed,
      diff: diff(doc, proposed),
      fit: fit(proposed, proposed.brief?.seconds ?? null),
    });
  } catch (err) {
    if (err instanceof AuthorError) {
      // What the model said goes back with the error: a writer can usually see what went wrong
      // faster than a retry can fix it.
      return NextResponse.json({ error: err.message, said: err.said.slice(0, 4000) }, { status: 502 });
    }
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 502 }
    );
  }
}

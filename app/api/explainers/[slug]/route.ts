import { NextResponse } from 'next/server';
import { ExplainerDocSchema, FoldError, foldDoc, totalSeconds } from '@/lib/explainer/schema';
import { get, remove, save } from '@/lib/explainer/store';

/**
 * One explainer. Reading it folds it too, so the editor is handed the board as it stands at each
 * beat and never has to compute that itself — and a document that cannot fold is reported as a
 * named beat rather than as a blank page.
 */

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const doc = await get(slug);
  if (!doc) return NextResponse.json({ error: `no explainer "${slug}"` }, { status: 404 });

  try {
    const steps = foldDoc(doc);
    return NextResponse.json({
      slug,
      doc,
      seconds: Math.round(totalSeconds(doc) * 10) / 10,
      steps: steps.map((s) => ({
        id: s.beat.id, role: s.beat.role, startFrame: s.startFrame, durationFrames: s.durationFrames,
        mutations: s.beat.mutations.length, scene: s.scene,
      })),
      foldError: null,
    });
  } catch (err) {
    const fold = err instanceof FoldError ? { beatId: err.beatId, message: err.message } : null;
    if (!fold) throw err;
    return NextResponse.json({ slug, doc, seconds: null, steps: [], foldError: fold });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!(await get(slug))) return NextResponse.json({ error: `no explainer "${slug}"` }, { status: 404 });

  const parsed = ExplainerDocSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'the document is not valid', issues: parsed.error.issues }, { status: 422 });
  }
  // Fold before writing: a document that cannot fold cannot render, and it is better to refuse
  // it here than to store something the service will reject later.
  try {
    foldDoc(parsed.data);
  } catch (err) {
    const fold = err instanceof FoldError ? err : null;
    if (!fold) throw err;
    return NextResponse.json({ error: fold.message, beatId: fold.beatId }, { status: 422 });
  }

  const doc = await save(slug, parsed.data);
  return NextResponse.json({ slug, doc, seconds: Math.round(totalSeconds(doc) * 10) / 10 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  return NextResponse.json({ removed: await remove(slug) });
}

import { NextResponse } from 'next/server';
import { CommandError, applyCommand } from '@/lib/explainer/commands';
import { FoldError, foldDoc, totalSeconds } from '@/lib/explainer/schema';
import { get, remove } from '@/lib/explainer/store';

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
  const body = await req.json().catch(() => null);
  try {
    const { doc } = await applyCommand(slug, { op: 'doc.replace', args: { doc: body }, actor: 'ui' });
    return NextResponse.json({ slug, doc, seconds: Math.round(totalSeconds(doc) * 10) / 10 });
  } catch (err) {
    if (err instanceof CommandError) {
      return NextResponse.json({ error: err.message, ...err.detail }, { status: err.status });
    }
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  return NextResponse.json({ removed: await remove(slug) });
}

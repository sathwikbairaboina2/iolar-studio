import { NextResponse } from 'next/server';
import * as history from '@/lib/explainer/history';
import { foldDoc } from '@/lib/explainer/schema';

type Ctx = { params: Promise<{ slug: string }> };

const stepsOf = (doc: Parameters<typeof foldDoc>[0]) =>
  foldDoc(doc).map((s) => ({
    id: s.beat.id, role: s.beat.role, startFrame: s.startFrame,
    durationFrames: s.durationFrames, mutations: s.beat.mutations.length, scene: s.scene,
  }));

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  return NextResponse.json(await history.read(slug));
}

/** Undo and redo are the only moves; there is no jump-to-cursor and nothing has asked for one. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  const move = body?.move;
  if (move !== 'undo' && move !== 'redo') {
    return NextResponse.json({ error: "body must be {move: 'undo' | 'redo'}" }, { status: 400 });
  }

  try {
    const { doc } = move === 'undo' ? await history.undo(slug) : await history.redo(slug);
    return NextResponse.json({ doc, log: await history.read(slug), steps: stepsOf(doc) });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 409 });
  }
}

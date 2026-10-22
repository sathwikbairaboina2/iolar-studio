import { NextResponse } from 'next/server';
import { isReferenceId, pacingOf, readReference, setReferenceStatus } from '@/lib/launch/inbox';
import { BriefInputSchema } from '@/lib/launch/schema';
import { createLaunch, listLaunches } from '@/lib/launch/store';
import { startLaunch } from '@/lib/launch/start';

/** The launch reels: a list read off disk, and the one way onto it (a title and links). */

export async function GET() {
  return NextResponse.json({ launches: await listLaunches() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // A reference from the inbox stands in for the title and links: its topic names the launch, its pacing guides the cut.
  let fromRef: Awaited<ReturnType<typeof readReference>> = null;
  let input: Record<string, unknown> = body;
  if (body.referenceId !== undefined) {
    if (typeof body.referenceId !== 'string' || !isReferenceId(body.referenceId)) return NextResponse.json({ error: 'bad referenceId' }, { status: 400 });
    fromRef = await readReference(body.referenceId);
    if (!fromRef) return NextResponse.json({ error: 'no such reference' }, { status: 404 });
    const { hookSec, medianShotSec } = pacingOf(fromRef);
    input = {
      ...(body.seconds === undefined ? {} : { seconds: body.seconds }),
      title: fromRef.topic, links: [],
      reference: { id: fromRef.id, creator: fromRef.creator, url: fromRef.url, topic: fromRef.topic, hookSec, medianShotSec },
    };
  }
  const brief = BriefInputSchema.safeParse(input);
  if (!brief.success) {
    return NextResponse.json({ error: brief.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  }
  const slug = await createLaunch(brief.data);
  if (fromRef) await setReferenceStatus(fromRef.id, 'made', slug);
  // Starting is optional so a brief can be saved and run later; the usual path starts it.
  if (body.start === true) await startLaunch(slug).catch((err) => console.error('[instastudio] launch start failed', err));
  return NextResponse.json({ slug }, { status: 201 });
}

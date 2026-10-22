import { NextResponse } from 'next/server';
import { isReferenceId, setReferenceStatus } from '@/lib/launch/inbox';

type Ctx = { params: Promise<{ id: string }> };

/** The one change a person makes to a reference by hand: dismiss it. (Making a reel marks it made, in POST /api/launch.) */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isReferenceId(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { status?: unknown };
  if (body.status !== 'dismissed') return NextResponse.json({ error: 'status must be "dismissed"' }, { status: 400 });
  const ref = await setReferenceStatus(id, 'dismissed');
  return ref ? NextResponse.json({ reference: ref }) : NextResponse.json({ error: 'not found' }, { status: 404 });
}

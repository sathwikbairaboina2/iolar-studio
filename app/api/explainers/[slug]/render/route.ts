import { NextResponse } from 'next/server';
import * as renders from '@/lib/explainer/renders';
import { get } from '@/lib/explainer/store';
import { ServiceDown, ServiceRejected } from '@/lib/templates/service';

/**
 * A render is a job now: `POST` submits and answers at once, `GET` says where every job got to.
 *
 * The three ways submitting fails are three different answers, because they need three different
 * things from the user: the service is not running, the document is wrong, or there is no such
 * explainer. Collapsing them into one "render failed" is what makes a studio frustrating.
 */

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const doc = await get(slug);
  if (!doc) return NextResponse.json({ error: `no explainer "${slug}"` }, { status: 404 });

  try {
    const record = await renders.start(slug, doc);
    // 202: the answer is "this is now a job", not "here is your video".
    return NextResponse.json({ slug, render: record }, { status: 202 });
  } catch (err) {
    if (err instanceof ServiceDown) {
      return NextResponse.json({ error: err.message, service: 'down' }, { status: 503 });
    }
    if (err instanceof ServiceRejected) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422 });
    }
    throw err;
  }
}

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const doc = await get(slug);
  if (!doc) return NextResponse.json({ error: `no explainer "${slug}"` }, { status: 404 });

  try {
    await renders.poll(slug);
  } catch (err) {
    // A service that has gone away does not empty the list: what was rendered is still on disk,
    // and the page should keep showing it.
    if (!(err instanceof ServiceDown)) throw err;
  }
  const log = await renders.read(slug, doc);
  return NextResponse.json(log);
}

/** Stop a render. The body names which one, because a second may have been queued behind it. */
export async function DELETE(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : null;
  if (!id) return NextResponse.json({ error: 'body must be {id}' }, { status: 400 });

  try {
    return NextResponse.json(await renders.cancel(slug, id));
  } catch (err) {
    if (err instanceof ServiceDown) {
      return NextResponse.json({ error: err.message, service: 'down' }, { status: 503 });
    }
    throw err;
  }
}

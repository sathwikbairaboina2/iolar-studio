import { NextResponse } from 'next/server';
import { get } from '@/lib/explainer/store';
import { ServiceDown, ServiceRejected, render } from '@/lib/explainer/service';

/**
 * Render this explainer and keep the mp4 beside it.
 *
 * The three ways this fails are three different answers, because they need three different
 * things from the user: the service is not running, the document is wrong, or the render itself
 * broke. Collapsing them into one "render failed" is what makes a studio frustrating.
 */

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const doc = await get(slug);
  if (!doc) return NextResponse.json({ error: `no explainer "${slug}"` }, { status: 404 });

  try {
    const result = await render(slug, doc);
    if (!result.ok) return NextResponse.json({ error: result.error, jobId: result.jobId }, { status: 502 });
    return NextResponse.json({
      slug, jobId: result.jobId, seconds: result.seconds,
      mp4: `/api/explainers/${slug}/mp4`,
    });
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

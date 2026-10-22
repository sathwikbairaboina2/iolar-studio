import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { isLaunchRunning } from '@/lib/launch/job';
import { readSpend } from '@/lib/launch/spend';
import { readAssets, readBrief, readClaims, readCritic, readFactcheck, readJob, readProps, readReceipts, readScript } from '@/lib/launch/store';

type Ctx = { params: Promise<{ slug: string }> };

/** Everything the reel page shows, in one read. The page polls this while a run is going. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  const [brief, job] = await Promise.all([readBrief(slug), readJob(slug)]);
  if (!brief || !job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const [claims, script, factcheck, receipts, props, spend, assets, critic] = await Promise.all([
    readClaims(slug), readScript(slug), readFactcheck(slug), readReceipts(slug), readProps(slug), readSpend(slug), readAssets(slug), readCritic(slug),
  ]);
  return NextResponse.json({ slug, brief, job, claims, script, factcheck, receipts, props, spend, assets, critic, running: isLaunchRunning(slug) });
}

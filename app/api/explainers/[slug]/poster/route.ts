import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import { explainerMp4, explainerRenderPoster, isSlug } from '@/lib/paths';
import { latestDone } from '@/lib/explainer/renders';
import * as poster from '@/lib/explainer/poster';

/**
 * The still the shelf draws for one explainer.
 *
 * Written when a render lands, so this route normally only reads. It will take one on demand for
 * an explainer rendered before posters existed, which is the difference between a shelf that fills
 * in as you browse it and one that stays grey until every reel is rendered again.
 */

type Ctx = { params: Promise<{ slug: string }> };

/** Where the poster for this explainer's newest mp4 lives, and which mp4 that is. */
async function which(slug: string): Promise<{ mp4: string; jpg: string } | null> {
  const newest = await latestDone(slug);
  if (newest) {
    return { mp4: '', jpg: explainerRenderPoster(slug, newest.id) };
  }
  // Rendered before renders were jobs: a plain `reel.mp4` with no record naming it.
  try {
    await fs.access(explainerMp4(slug));
    return { mp4: explainerMp4(slug), jpg: explainerRenderPoster(slug, 'reel') };
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });

  const newest = await latestDone(slug);
  const target = await which(slug);
  if (!target) return NextResponse.json({ error: 'nothing rendered yet' }, { status: 404 });

  let have = await fs.access(target.jpg).then(() => true, () => false);
  if (!have) {
    have = !!(newest
      ? await poster.write(slug, newest.id)
      : await poster.still(target.mp4, target.jpg));
  }
  if (!have) return NextResponse.json({ error: 'no poster for this render' }, { status: 404 });

  const bytes = await fs.readFile(target.jpg);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/jpeg',
      // Held for an hour, which is only safe because the shelf asks with `?v=<renderedAt>`: a new
      // render changes the query and so misses this cache instead of showing the old board.
      'cache-control': 'private, max-age=3600',
    },
  });
}

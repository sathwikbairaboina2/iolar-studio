import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { imagePath } from '@/lib/jobcard/store';

type Ctx = { params: Promise<{ id: string }> };

/** The rendered card. Never cached: a re-render replaces the file at the same address. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const buf = await fs.readFile(imagePath(path.basename(id)));
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: `no card image for ${id}` }, { status: 404 });
  }
}

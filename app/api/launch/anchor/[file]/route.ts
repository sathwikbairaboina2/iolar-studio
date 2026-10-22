import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';
import { launchAnchorDir, launchRoot } from '@/lib/paths';

type Ctx = { params: Promise<{ file: string }> };

/** The locked portrait (portrait.png) or one candidate (<job id>.png), by file name only. */
export async function GET(_req: Request, { params }: Ctx) {
  const { file } = await params;
  if (!/^(portrait|[A-Za-z0-9-]{8,64})\.png$/.test(file)) return NextResponse.json({ error: 'bad name' }, { status: 400 });
  const full = file === 'portrait.png' ? path.join(launchRoot(), 'anchor', 'portrait.png') : path.join(launchAnchorDir(), 'candidates', file);
  try {
    const bytes = await fs.readFile(full);
    return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}

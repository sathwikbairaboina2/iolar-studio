import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { listDoodles, doodleDir } from '@/lib/doodles';

export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get('file');
  if (file) {
    try {
      const safe = path.basename(file);
      const buf = await fs.readFile(path.join(doodleDir(), safe));
      return new NextResponse(new Uint8Array(buf), { headers: { 'content-type': 'image/png' } });
    } catch {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  }
  return NextResponse.json({ files: await listDoodles() });
}

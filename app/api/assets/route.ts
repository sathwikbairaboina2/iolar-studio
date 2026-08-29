import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { generateDoodle, listDoodles, doodleDir } from '@/lib/comfy/assets';
import { getStats } from '@/lib/comfy/client';

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

export async function POST(req: Request) {
  try {
    const { prompt, name } = await req.json();
    if (!prompt || !/^[a-z0-9-]+$/.test(name ?? '')) {
      return NextResponse.json({ error: 'prompt and slug-style name required' }, { status: 400 });
    }
    if (!(await getStats()).up) {
      return NextResponse.json({ error: 'comfyui offline' }, { status: 503 });
    }
    const file = await generateDoodle(prompt, name);
    return NextResponse.json({ file: path.basename(file) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

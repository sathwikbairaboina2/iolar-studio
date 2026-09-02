import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

/** What is implemented, from a file every feature task updates, plus the handbook itself. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('handbook') === '1') {
    const html = await fs.readFile(path.join(process.cwd(), 'docs', 'handbooks', 'reels-engine-handbook.html'), 'utf8');
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const raw = await fs.readFile(path.join(process.cwd(), 'docs', 'implementation.json'), 'utf8');
  return NextResponse.json(JSON.parse(raw));
}

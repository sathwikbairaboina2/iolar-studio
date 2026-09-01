import { NextResponse } from 'next/server';
import { readHealth } from '@/lib/plugins/health';

/** Which renderers are up, and whether they can actually render. */
export async function GET() {
  return NextResponse.json({ plugins: await readHealth() });
}

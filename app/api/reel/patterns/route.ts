import { NextResponse } from 'next/server';
import { availablePatterns } from '@/lib/reel/pattern';

/** Patterns the studio can offer: known here and rendered by the templates service. */
export async function GET() {
  return NextResponse.json({ patterns: await availablePatterns() });
}

import { NextResponse } from 'next/server';
import { listPatterns } from '@/lib/reel/patterns';

export async function GET() {
  return NextResponse.json({ patterns: await listPatterns() });
}

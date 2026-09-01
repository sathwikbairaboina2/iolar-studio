import { NextResponse } from 'next/server';
import { readJobs } from '@/lib/plugins/jobs';

/** Every render across every reel, plus what is waiting on a person. */
export async function GET() {
  try {
    return NextResponse.json(await readJobs());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

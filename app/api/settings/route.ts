import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings';

export async function GET() {
  return NextResponse.json(getSettings());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    return NextResponse.json(saveSettings(body));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

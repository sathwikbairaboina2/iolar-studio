import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { createSubject, listSubjects } from '@/lib/store';
import { isSlug, subjectDir } from '@/lib/paths';
import { builtTemplates } from '@/lib/renderer/page';

export async function GET() {
  return NextResponse.json({ subjects: await listSubjects(), templates: builtTemplates() });
}

export async function POST(req: Request) {
  try {
    const { slug, name, emoji, description } = await req.json();
    if (typeof slug !== 'string' || !isSlug(slug)) {
      return NextResponse.json({ error: 'slug must match [a-z0-9-]+' }, { status: 400 });
    }
    if (existsSync(subjectDir(slug))) {
      return NextResponse.json({ error: 'subject already exists' }, { status: 400 });
    }
    return NextResponse.json(await createSubject(slug, { name, emoji, description }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

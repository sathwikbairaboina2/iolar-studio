import { NextResponse } from 'next/server';
import { createPost, listPosts, postDir } from '@/lib/store';
import { builtTemplates } from '@/lib/renderer/page';
import { existsSync } from 'fs';

export async function GET() {
  return NextResponse.json({ posts: await listPosts(), templates: builtTemplates() });
}

export async function POST(req: Request) {
  try {
    const { slug } = await req.json();
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: 'slug must match [a-z0-9-]+' }, { status: 400 });
    }
    if (existsSync(postDir(slug))) {
      return NextResponse.json({ error: 'post already exists' }, { status: 400 });
    }
    const post = await createPost(slug);
    return NextResponse.json(post);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

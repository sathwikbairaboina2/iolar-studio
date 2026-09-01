import { NextResponse } from 'next/server';
import { startPlugin, PluginStartError } from '@/lib/plugins/start';

type Ctx = { params: Promise<{ name: string }> };

/** Starts one registered service. The recipe comes from the registry, never from the caller. */
export async function POST(_req: Request, ctx: Ctx) {
  const { name } = await ctx.params;
  try {
    return NextResponse.json(await startPlugin(name));
  } catch (err) {
    const status = err instanceof PluginStartError ? 400 : 500;
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status });
  }
}

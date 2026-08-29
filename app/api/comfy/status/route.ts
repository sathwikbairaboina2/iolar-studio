import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/settings';

export async function GET() {
  const { comfyUrl } = getSettings();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch(`${comfyUrl}/system_stats`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`status ${r.status}`);
    const stats = await r.json();
    const dev = stats.devices?.[0];
    return NextResponse.json({
      up: true,
      gpu: dev?.name?.split(':')[1]?.trim().split(' ').slice(0, 4).join(' ') ?? dev?.name ?? 'GPU',
      vramFreeGb: dev ? +(dev.vram_free / 1e9).toFixed(1) : undefined,
      vramTotalGb: dev ? +(dev.vram_total / 1e9).toFixed(1) : undefined,
    });
  } catch {
    return NextResponse.json({ up: false });
  }
}

import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings';
import { provider, stopLocalModels, tellResearchService } from '@/lib/ai/runner';

export async function GET() {
  return NextResponse.json(getSettings());
}

/**
 * Saving the provider switch is the whole move: once the thinking is remote — Claude's or
 * OpenRouter's — nothing local should still be holding the card, so the research ollama is
 * asked to drop what it has. An ollama that is down or slow does not fail the save — it is an ollama holding no
 * VRAM — so the freed list rides along with the settings rather than replacing them.
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const before = provider(getSettings());
    const saved = saveSettings(body);
    const after = provider(saved);

    if (before === after) return NextResponse.json({ ...saved, freed: [], toldResearch: false });

    // The research service pins the model for its own runs, so it is told which way the
    // switch went before anything is unloaded — otherwise it just loads it again.
    // The service knows 'claude' and 'local' only, and what the word means to it is
    // whether to go on pinning the 27B; OpenRouter wants the same answer Claude does.
    const research = await tellResearchService(after === 'local' ? 'local' : 'claude').catch(() => ({
      told: false,
      freed: [],
    }));
    const freed = after === 'local' ? [] : await stopLocalModels().catch(() => []);
    return NextResponse.json({
      ...saved,
      freed: [...new Set([...research.freed, ...freed])],
      toldResearch: research.told,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

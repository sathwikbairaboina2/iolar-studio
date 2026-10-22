import { describe, expect, it } from 'vitest';
import { checkLaunchScript } from '@/lib/launch/factcheck';
import { scriptSchemaFor } from '@/lib/launch/schema';

const claim = { id: 'c1', text: 'Gemini 4 costs $3 per 1M input tokens', value: 3, unit: '$', url: 'https://ai.google.dev/pricing', quote: '$3.00 / 1M tokens' };
const script = scriptSchemaFor(['c1']).parse({
  headline: 'Gemini 4 is here', kicker: 'BREAKING',
  beats: ['hook', 'numbers', 'catch', 'cta'].map((id) => ({ id, narration: `${id} words.`, claims: id === 'numbers' ? ['c1'] : [] })),
});

describe('launch fact check', () => {
  it('counts ok-with-issues as not ok and passes the sources to the checker', async () => {
    let prompt = '';
    const r = await checkLaunchScript(script, { claims: [claim] }, { run: async (p) => { prompt = p; return JSON.stringify({ ok: true, issues: [{ beat: 'numbers', claim: '$3', correction: 'It is $3.50.' }] }); } });
    expect(r.ok).toBe(false);
    expect(prompt).toContain('https://ai.google.dev/pricing');
  });
});

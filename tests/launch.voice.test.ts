import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { HfUnreachable, type Hf } from '@/lib/launch/higgsfield';
import { createLaunch } from '@/lib/launch/store';
import { hfSpeak, withKokoroFallback } from '@/lib/launch/voice';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'voice-'));
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'voice-data-'));
});

function fakeHf(over: Partial<Hf> = {}) {
  const submitted: object[] = [];
  const hf: Hf = {
    balance: async () => 100,
    cost: async () => 0.11,
    uploadFile: async () => 'm',
    generateVideo: async () => 'v',
    generateImage: async () => 'i',
    generateAudio: async (p) => { submitted.push(p); return 'a-1'; },
    wait: async (ids) => ({ [ids[0]]: { status: 'completed', url: 'https://cdn/a.mp3' } }),
    ...over,
  };
  return { hf, submitted };
}

describe('hfSpeak', () => {
  it('submits the qwen params, waits, and writes the mp3', async () => {
    const slug = await createLaunch({ title: 'Voice test', links: ['https://example.com/x'], creditBudget: 5 });
    const { hf, submitted } = fakeHf();
    const http = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch;
    const out = path.join(dir, 'hook.mp3');
    await hfSpeak(hf, slug, http)('Hello there', out);
    expect(await fs.readFile(out)).toEqual(Buffer.from([1, 2, 3]));
    expect(submitted[0]).toMatchObject({
      model: 'qwen_audio_tts', prompt: 'Hello there', voice_type: 'preset', voice_id: '6f98d3dd-324f-4845-8c28-c1d1647a06cd',
      language: 'en', speech_rate: 1.15, format: 'mp3',
    });
    expect(String((submitted[0] as { instruction: string }).instruction)).toMatch(/Indian/);
  });

  it('throws when the budget refuses the line', async () => {
    const slug = await createLaunch({ title: 'Voice test', links: ['https://example.com/x'], creditBudget: 1 });
    const { hf } = fakeHf({ cost: async () => 999 });
    await expect(hfSpeak(hf, slug, fetch)('x', path.join(dir, 'a.mp3'))).rejects.toThrow();
  });
});

describe('withKokoroFallback', () => {
  it('falls back to Kokoro once, keeps using it, and notes it', async () => {
    const notes: string[] = [];
    const used: string[] = [];
    const speak = withKokoroFallback(
      async () => { throw new HfUnreachable(); },
      async (t, _p, o) => { used.push(`${t}|${o?.voice}|${o?.speed}`); },
      { voice: 'hm_psi', speed: 1.12 },
      (n) => notes.push(n),
    );
    await speak('one', 'a.mp3');
    await speak('two', 'b.mp3');
    expect(used).toEqual(['one|hm_psi|1.12', 'two|hm_psi|1.12']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/Kokoro/);
  });
  it('does not touch Kokoro when Higgsfield works', async () => {
    const used: string[] = [];
    const speak = withKokoroFallback(async () => undefined, async (t) => { used.push(t); }, { voice: 'hm_psi', speed: 1.12 }, () => undefined);
    await speak('one', 'a.mp3');
    expect(used).toEqual([]);
  });
});

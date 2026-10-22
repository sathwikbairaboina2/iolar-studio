import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { speakBeats } from '@/lib/explainer2/voice';
import type { Script } from '@/lib/explainer2/schema';

const beat = (i: number) => ({ id: `b${i}`, caption: `C${i}`, narration: `Narration number ${i}.`, visual: 'v' });
const SCRIPT: Script = {
  title: 'T',
  hook: { before: { value: 1, unit: 'ms', label: 'a' }, after: { value: 2, unit: 'ms', label: 'b' } },
  beats: [1, 2, 3, 4].map(beat),
  facts: [],
};

let data: string;
beforeEach(() => {
  data = mkdtempSync(path.join(os.tmpdir(), 'x2-voice-'));
  process.env.IOLAR_DATA_DIR = data;
});

describe('speakBeats', () => {
  it('speaks each beat to voice/<id>.mp3, measures the clips and writes timing.json', async () => {
    const speak = vi.fn(async (_text: string, mp3: string) => {
      await fs.mkdir(path.dirname(mp3), { recursive: true });
      await fs.writeFile(mp3, 'x');
      return { provider: 'kokoro' as const };
    });
    const lengths: Record<string, number> = { 'b1.mp3': 1, 'b2.mp3': 3, 'b3.mp3': 1, 'b4.mp3': 6 };
    const probe = vi.fn(async (file: string) => lengths[path.basename(file)]);
    const timing = await speakBeats('caching', SCRIPT, { speak, probe });

    expect(speak).toHaveBeenCalledTimes(4);
    expect(speak.mock.calls[1][0]).toBe('Narration number 2.');
    expect(speak.mock.calls[1][1]).toBe(path.join(data, 'explainer-v2', 'caching', 'voice', 'b2.mp3'));
    expect(timing.beats.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(timing.beats[0].end).toBe(75); // hook floor
    expect(timing.beats[2].end - timing.beats[2].start).toBe(66); // beat floor
    const written = JSON.parse(await fs.readFile(path.join(data, 'explainer-v2', 'caching', 'timing.json'), 'utf8'));
    expect(written).toEqual(timing);
  });
  it('speaks at the explainer pace unless told otherwise', async () => {
    const speak = vi.fn(async (_t: string, mp3: string) => { await fs.mkdir(path.dirname(mp3), { recursive: true }); await fs.writeFile(mp3, 'x'); });
    const probe = vi.fn(async () => 2);
    await speakBeats('caching', SCRIPT, { speak, probe });
    expect(speak.mock.calls.every((c) => (c as unknown[])[2] && ((c as unknown[])[2] as { speed: number }).speed === 1.08)).toBe(true);
    speak.mockClear();
    await speakBeats('caching', SCRIPT, { speak, probe, speed: 1.2 });
    expect(((speak.mock.calls[0] as unknown[])[2] as { speed: number }).speed).toBe(1.2);
  });

  it('records the voice length and the spoken words per beat, from whisper when it works', async () => {
    const speak = vi.fn(async (_t: string, mp3: string) => { await fs.mkdir(path.dirname(mp3), { recursive: true }); await fs.writeFile(mp3, 'x'); });
    const probe = vi.fn(async () => 2);
    const align = vi.fn(async (_mp3: string, text: string) => text.split(' ').map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.4 })));
    const timing = await speakBeats('caching', SCRIPT, { speak, probe, align });
    expect(timing.beats[0].voice).toBe(60);
    expect(timing.beats[0].method).toBe('whisper');
    expect(timing.beats[0].words![0]).toEqual({ w: 'Narration', startFrame: 0, endFrame: 12 });
    // Absolute frames: beat 2 starts where beat 1 ends.
    expect(timing.beats[1].words![0].startFrame).toBe(timing.beats[1].start);
    const written = JSON.parse(await fs.readFile(path.join(data, 'explainer-v2', 'caching', 'timing.json'), 'utf8'));
    expect(written.beats[2].words.length).toBe(3);
  });

  it('falls back to an even spread when whisper fails, and records that', async () => {
    const speak = vi.fn(async (_t: string, mp3: string) => { await fs.mkdir(path.dirname(mp3), { recursive: true }); await fs.writeFile(mp3, 'x'); });
    const probe = vi.fn(async () => 3);
    const align = vi.fn(async () => { throw new Error('whisper missing'); });
    const timing = await speakBeats('caching', SCRIPT, { speak, probe, align });
    expect(timing.beats.every((b) => b.method === 'even')).toBe(true);
    const b = timing.beats[0];
    expect(b.words![0].startFrame).toBe(0);
    expect(b.words![b.words!.length - 1].endFrame).toBe(b.voice);
  });

  it('fails clearly when a clip cannot be measured', async () => {
    const speak = vi.fn(async () => ({ provider: 'kokoro' as const }));
    const probe = vi.fn(async () => 0);
    await expect(speakBeats('caching', SCRIPT, { speak, probe })).rejects.toThrow(/b1/);
  });

  it('writes the clips and timing.json where it is told to', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'launch-voice-'));
    const out = { voiceDir: path.join(dir, 'voice'), timingFile: path.join(dir, 'timing.json') };
    const script = { beats: [{ id: 'hook', narration: 'Google just shipped Gemini 4.' }, { id: 'cta', narration: 'Follow for more.' }] };
    const fakeSpeak = async (_t: string, p: string) => fs.writeFile(p, '');
    const timing = await speakBeats('any-slug', script, { speak: fakeSpeak, probe: async () => 2 }, out);
    expect(timing.beats.map((b) => b.id)).toEqual(['hook', 'cta']);
    expect(await fs.readdir(out.voiceDir)).toEqual(['cta.mp3', 'hook.mp3']);
    expect(JSON.parse(await fs.readFile(out.timingFile, 'utf8')).totalFrames).toBe(timing.totalFrames);
  });
});

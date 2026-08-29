import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-voice-'));
});

async function seed(slug = 'grok') {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  await createReel(slug);
  const reel = await loadReel(slug);
  await saveReel(slug, {
    ...reel,
    beats: [
      { id: 'b1', role: 'hook', text: 'One two.', shot: { kind: 'title', brief: 'x', hero: false } },
      { id: 'b2', role: 'close', text: 'Three four.', shot: { kind: 'broll', brief: 'y', hero: false } },
    ],
  });
}

const WORDS = [
  { w: 'One', start: 0, end: 0.3 },
  { w: 'two.', start: 0.3, end: 0.7 },
  { w: 'Three', start: 0.8, end: 1.1 },
  { w: 'four.', start: 1.1, end: 1.5 },
];

/** The local engine is the default path, so that is what these mock. */
function mockTts() {
  vi.doMock('@/lib/reel/tts', () => ({
    speak: vi.fn(async (_text: string, dest: string) => {
      writeFileSync(dest, 'audio');
      return { provider: 'piper' };
    }),
    TtsUnavailableError: class extends Error {},
  }));
  vi.doMock('@/lib/reel/probe', () => ({
    ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 1.5, width: 0, height: 0, fps: 0, hasAudio: true }),
  }));
}

describe('voice stage', () => {
  it('joins beat text into one voiceover script', async () => {
    await seed();
    const { voScript } = await import('@/lib/reel/voice');
    const { loadReel } = await import('@/lib/reel/store');
    expect(voScript(await loadReel('grok'))).toBe('One two. Three four.');
  });

  it('speaks the script locally, aligns it and stores the words', async () => {
    await seed();
    mockTts();
    vi.doMock('@/lib/reel/align', () => ({
      alignVoice: vi.fn().mockResolvedValue(WORDS),
      WhisperUnavailableError: class extends Error {},
    }));
    const { synthesizeVoice } = await import('@/lib/reel/voice');
    const reel = await synthesizeVoice('grok');
    expect(reel.vo.words).toHaveLength(4);
    expect(reel.vo.durationSec).toBeCloseTo(1.5, 3);
    expect(reel.vo.provider).toBe('local');
    expect(reel.vo.voiceId).toBe('piper');
    const { reelWordsFile } = await import('@/lib/paths');
    expect(existsSync(reelWordsFile('grok'))).toBe(true);
  });

  it('only calls higgsfield when the setting names it', async () => {
    await seed();
    const hfGenerateAudio = vi.fn().mockResolvedValue({ url: 'https://cdn/vo.mp3' });
    vi.doMock('@/lib/higgsfield/client', () => ({
      hfGenerateAudio,
      downloadTo: vi.fn(async (_u: string, dest: string) => {
        writeFileSync(dest, 'audio');
      }),
      HiggsfieldUnavailableError: class extends Error {},
    }));
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 1.5, width: 0, height: 0, fps: 0, hasAudio: true }),
    }));
    vi.doMock('@/lib/reel/align', () => ({
      alignVoice: vi.fn().mockResolvedValue(WORDS),
      WhisperUnavailableError: class extends Error {},
    }));

    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ voiceProvider: 'higgsfield' });
    const { synthesizeVoice } = await import('@/lib/reel/voice');
    const reel = await synthesizeVoice('grok');
    expect(hfGenerateAudio).toHaveBeenCalled();
    expect(reel.vo.provider).toBe('higgsfield');
  });

  it('passes the script to alignment as the decoder context', async () => {
    await seed();
    mockTts();
    const alignVoice = vi.fn().mockResolvedValue(WORDS);
    vi.doMock('@/lib/reel/align', () => ({ alignVoice, WhisperUnavailableError: class extends Error {} }));
    const { synthesizeVoice } = await import('@/lib/reel/voice');
    await synthesizeVoice('grok');
    expect(alignVoice.mock.calls[0][1]).toBe('One two. Three four.');
  });

  it('keeps the audio when alignment is unavailable', async () => {
    await seed();
    mockTts();
    class WhisperUnavailableError extends Error {}
    vi.doMock('@/lib/reel/align', () => ({
      alignVoice: vi.fn().mockRejectedValue(new WhisperUnavailableError()),
      WhisperUnavailableError,
    }));
    const { synthesizeVoice } = await import('@/lib/reel/voice');
    await expect(synthesizeVoice('grok')).rejects.toBeInstanceOf(WhisperUnavailableError);
    const { reelVoFile } = await import('@/lib/paths');
    expect(existsSync(reelVoFile('grok'))).toBe(true);
  });

  it('returns 503 from the route when higgsfield is unreachable', async () => {
    await seed();
    class HiggsfieldUnavailableError extends Error {}
    vi.doMock('@/lib/higgsfield/client', () => ({ HiggsfieldUnavailableError }));
    vi.doMock('@/lib/reel/voice', () => ({
      synthesizeVoice: vi.fn().mockRejectedValue(new HiggsfieldUnavailableError()),
      alignExistingVoice: vi.fn(),
    }));
    const { POST } = await import('@/app/api/reel/[slug]/voice/route');
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ slug: 'grok' }),
    });
    expect(res.status).toBe(503);
  });
});

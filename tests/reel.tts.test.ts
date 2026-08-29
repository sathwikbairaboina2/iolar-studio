import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-tts-'));
});

describe('local text to speech', () => {
  it('defaults to the local engine, so a reel never reaches a paid service by itself', async () => {
    const { getSettings } = await import('@/lib/settings');
    expect(getSettings().voiceProvider).toBe('piper');
    expect(getSettings().heroProvider).toBe('comfy');
  });

  it('resolves the voice model next to the repo', async () => {
    const { piperPaths } = await import('@/lib/reel/tts');
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ piperDataDir: 'models/piper', piperVoice: 'en_US-ryan-high' });
    const p = piperPaths();
    expect(p.dataDir).toBe(path.join(process.cwd(), 'models', 'piper'));
    expect(p.voice).toBe('en_US-ryan-high');
  });

  it('reports piper missing rather than throwing', async () => {
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ piperDataDir: path.join(tmpdir(), 'no-voices-here') });
    const { piperAvailable } = await import('@/lib/reel/tts');
    expect(await piperAvailable()).toBe(false);
  });

  it('refuses an empty script with a typed error', async () => {
    const { speak, TtsUnavailableError } = await import('@/lib/reel/tts');
    await expect(speak('   ', path.join(process.env.IOLAR_DATA_DIR!, 'vo.mp3'))).rejects.toBeInstanceOf(
      TtsUnavailableError
    );
  });

  it('says what to do when the provider is manual', async () => {
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ voiceProvider: 'manual' });
    const { speak } = await import('@/lib/reel/tts');
    await expect(speak('hello', path.join(process.env.IOLAR_DATA_DIR!, 'vo.mp3'))).rejects.toThrow(
      /drop a vo\.mp3/i
    );
  });

  it('really speaks a line and leaves an mp3 behind', async () => {
    const { piperAvailable, speak } = await import('@/lib/reel/tts');
    if (!(await piperAvailable())) return;
    const { ffprobeMedia } = await import('@/lib/reel/probe');
    const { existsSync } = await import('fs');
    const out = path.join(process.env.IOLAR_DATA_DIR!, 'vo.mp3');
    const { provider } = await speak('Grok Bot ships today.', out);
    expect(provider).toBe('piper');
    expect(existsSync(out)).toBe(true);
    const info = await ffprobeMedia(out);
    expect(info.durationSec).toBeGreaterThan(0.5);
    expect(info.hasAudio).toBe(true);
    // the intermediate wav is cleaned up
    expect(existsSync(out.replace('.mp3', '.wav'))).toBe(false);
  }, 180_000);
});

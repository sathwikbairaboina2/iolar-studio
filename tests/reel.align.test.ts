import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-align-'));
});

describe('alignment', () => {
  it('reports unavailability instead of throwing when python is missing', async () => {
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ whisperPython: path.join(tmpdir(), 'definitely-not-python.exe') });
    const { whisperAvailable } = await import('@/lib/reel/align');
    expect(await whisperAvailable()).toBe(false);
  });

  it('throws a typed error when asked to align without whisper', async () => {
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ whisperPython: path.join(tmpdir(), 'definitely-not-python.exe') });
    const { alignVoice, WhisperUnavailableError } = await import('@/lib/reel/align');
    await expect(alignVoice(path.join(tmpdir(), 'x.mp3'), 'hello')).rejects.toBeInstanceOf(
      WhisperUnavailableError
    );
  });

  it('parses the python payload into words', async () => {
    const { parseAlignOutput } = await import('@/lib/reel/align');
    const out = parseAlignOutput(
      '{"text":"hi there","words":[{"w":"hi","start":0,"end":0.2},{"w":"there","start":0.2,"end":0.5}]}'
    );
    expect(out.words).toHaveLength(2);
    expect(out.words[1]).toEqual({ w: 'there', start: 0.2, end: 0.5 });
  });

  it('rejects a payload with no words rather than returning an empty timeline', async () => {
    const { parseAlignOutput } = await import('@/lib/reel/align');
    expect(() => parseAlignOutput('{"text":"","words":[]}')).toThrow(/no words/i);
  });
});

describe('vocabulary hint', () => {
  it('keeps names and odd spellings but not the running script', async () => {
    const { vocabHint } = await import('@/lib/reel/align');
    const hint = vocabHint("Elon Musk's xAI just dropped Grok Bot, and it uses MCP to work across apps.");
    expect(hint).toContain('xAI');
    expect(hint).toContain('MCP');
    expect(hint).toContain('Grok');
    expect(hint).not.toContain('just');
    expect(hint).not.toContain('across');
  });

  it('caps the hint so it never becomes the script again', async () => {
    const { vocabHint } = await import('@/lib/reel/align');
    const many = Array.from({ length: 60 }, (_, i) => `Name${i}`).join(' ');
    expect(vocabHint(many).split(', ')).toHaveLength(24);
  });
});

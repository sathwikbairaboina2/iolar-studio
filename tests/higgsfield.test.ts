import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('higgsfield adapter', () => {
  it('asks the CLI for audio and returns the media url', async () => {
    const runClaude = vi.fn().mockResolvedValue('Here you go: {"url":"https://cdn.example/vo.mp3"}');
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { hfGenerateAudio } = await import('@/lib/higgsfield/client');
    const out = await hfGenerateAudio({ text: 'hello world', voiceId: 'v1' });
    expect(out.url).toBe('https://cdn.example/vo.mp3');
    const prompt = runClaude.mock.calls[0][0] as string;
    expect(prompt).toContain('hello world');
    expect(prompt).toContain('v1');
    expect(runClaude.mock.calls[0][1].allowedTools).toContain('mcp__claude_ai_Higgsfield__generate_audio');
  });

  it('falls back to a bare url in prose', async () => {
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue('Done! It is at https://cdn.example/clip.mp4 now.'),
      ClaudeUnavailableError: class extends Error {},
    }));
    const { hfGenerateVideo } = await import('@/lib/higgsfield/client');
    expect((await hfGenerateVideo({ prompt: 'stage b-roll', seconds: 5 })).url).toBe(
      'https://cdn.example/clip.mp4'
    );
  });

  it('surfaces a typed error when the CLI is missing', async () => {
    class ClaudeUnavailableError extends Error {}
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockRejectedValue(new ClaudeUnavailableError()),
      ClaudeUnavailableError,
    }));
    const { hfGenerateVideo, HiggsfieldUnavailableError } = await import('@/lib/higgsfield/client');
    await expect(hfGenerateVideo({ prompt: 'stage b-roll', seconds: 5 })).rejects.toBeInstanceOf(
      HiggsfieldUnavailableError
    );
  });

  it('fails loudly when the reply carries no url', async () => {
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue('I could not generate that.'),
      ClaudeUnavailableError: class extends Error {},
    }));
    const { hfGenerateAudio } = await import('@/lib/higgsfield/client');
    await expect(hfGenerateAudio({ text: 'x', voiceId: '' })).rejects.toThrow(/no media url/i);
  });
});

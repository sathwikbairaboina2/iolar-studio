import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-plan-'));
  // These mock the Claude CLI, so the studio's provider switch is pinned to Claude here;
  // the local model has its own tests.
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude' }));
});

const BEATS = JSON.stringify({
  title: 'xAI drops Grok Bot',
  beats: [
    { id: 'b1', role: 'hook', text: 'xAI just dropped Grok Bot.', shot: { kind: 'title', brief: 'Elon on stage', hero: true, alsoAssetIds: [], sourceLineId: null } },
    { id: 'b2', role: 'body', text: 'It is an agent with its own computer.', shot: { kind: 'screen', brief: 'chat list UI' , alsoAssetIds: [], sourceLineId: null } },
    { id: 'b3', role: 'close', text: 'Beta today for Heavy subscribers.', shot: { kind: 'talking-head', brief: 'creator to camera' , alsoAssetIds: [], sourceLineId: null } },
  ],
  caption: { text: 'Grok Bot is here.', hashtags: ['#ai', '#xai'] },
});

describe('reel plan', () => {
  it('writes beats from a topic into the reel', async () => {
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(BEATS),
      ClaudeUnavailableError: class extends Error {},
    }));
    const { createReel } = await import('@/lib/reel/store');
    await createReel('grok');
    const { planFromTopic } = await import('@/lib/ai/reel/plan');
    const reel = await planFromTopic('grok', 'xAI released Grok Bot today');
    expect(reel.beats).toHaveLength(3);
    expect(reel.beats[0].role).toBe('hook');
    expect(reel.beats[0].shot.hero).toBe(true);
    expect(reel.title).toBe('xAI drops Grok Bot');
    expect(reel.caption.hashtags).toContain('#ai');
  });

  it('persists the plan so a reload sees it', async () => {
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(BEATS),
      ClaudeUnavailableError: class extends Error {},
    }));
    const { createReel, loadReel } = await import('@/lib/reel/store');
    await createReel('grok');
    const { planFromTopic } = await import('@/lib/ai/reel/plan');
    await planFromTopic('grok', 'anything');
    expect((await loadReel('grok')).beats).toHaveLength(3);
  });

  it('keeps pasted wording verbatim across the beats', async () => {
    const script = 'One. Two. Three.';
    const runClaude = vi.fn().mockResolvedValue(
      JSON.stringify({
        title: 'T',
        caption: { text: '', hashtags: [] },
        beats: [
          { id: 'b1', role: 'hook', text: 'One.', shot: { kind: 'broll', brief: 'x' , alsoAssetIds: [], sourceLineId: null } },
          { id: 'b2', role: 'body', text: 'Two.', shot: { kind: 'screen', brief: 'y' , alsoAssetIds: [], sourceLineId: null } },
          { id: 'b3', role: 'close', text: 'Three.', shot: { kind: 'talking-head', brief: 'z' , alsoAssetIds: [], sourceLineId: null } },
        ],
      })
    );
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createReel } = await import('@/lib/reel/store');
    await createReel('paste');
    const { planFromScript } = await import('@/lib/ai/reel/plan');
    const reel = await planFromScript('paste', script);
    expect(reel.beats.map((b) => b.text).join(' ')).toBe(script);
    expect(runClaude.mock.calls[0][0]).toContain('Do not rewrite');
  });

  it('retries once with the validation error when the first reply is unusable', async () => {
    const runClaude = vi
      .fn()
      .mockResolvedValueOnce('{"title":"x","beats":[]}')
      .mockResolvedValueOnce(BEATS);
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createReel } = await import('@/lib/reel/store');
    await createReel('grok');
    const { planFromTopic } = await import('@/lib/ai/reel/plan');
    const reel = await planFromTopic('grok', 'topic');
    expect(reel.beats).toHaveLength(3);
    expect(runClaude).toHaveBeenCalledTimes(2);
    expect(runClaude.mock.calls[1][0]).toContain('failed validation');
  });

  it('gives every beat a shot brief and a unique id', async () => {
    const { parseBeats } = await import('@/lib/ai/reel/plan');
    const out = parseBeats(BEATS);
    expect(new Set(out.beats.map((b) => b.id)).size).toBe(3);
    for (const b of out.beats) expect(b.shot.brief.length).toBeGreaterThan(0);
  });

  it('tells Claude the style pacing so beats land near the shot length', async () => {
    const { beatsPrompt } = await import('@/lib/ai/reel/plan');
    const { loadStyle } = await import('@/lib/reel/styles');
    const p = await loadStyle('armand');
    const prompt = beatsPrompt(p, 'topic', 'anything');
    expect(prompt).toContain(`${p.pacing.shotSec[0]}-${p.pacing.shotSec[1]} seconds`);
    expect(prompt).toContain('hook');
    expect(prompt).toContain('Armand Segall');
  });

  it('rejects a reply with no beats', async () => {
    const { parseBeats } = await import('@/lib/ai/reel/plan');
    expect(() => parseBeats('{"title":"x","beats":[]}')).toThrow(/beat/i);
  });

  it('returns 503 from the route when the claude CLI is missing', async () => {
    vi.doMock('@/lib/ai/reel/plan', () => ({
      planFromTopic: vi.fn().mockRejectedValue(new Error('Claude CLI not found. Install Claude Code.')),
      planFromScript: vi.fn(),
      planFromReference: vi.fn(),
    }));
    const { POST } = await import('@/app/api/reel/[slug]/plan/route');
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ mode: 'topic', topic: 'x' }) }),
      { params: Promise.resolve({ slug: 'grok' }) }
    );
    expect(res.status).toBe(503);
  });
});

describe('paste mode keeps the script word for word', () => {
  // an earlier test mocks this module wholesale; these need the real thing
  beforeEach(() => {
    vi.doUnmock('@/lib/ai/reel/plan');
    vi.resetModules();
  });

  it('accepts a faithful split and names where an unfaithful one diverges', async () => {
    const { wordingDrift } = await import('@/lib/ai/reel/plan');
    const script = 'One two three. Four five six.';
    const faithful = [
      { id: 'b1', role: 'hook' as const, text: 'One two three.', shot: { kind: 'broll' as const, brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
      { id: 'b2', role: 'close' as const, text: 'Four five six.', shot: { kind: 'broll' as const, brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
    ];
    expect(wordingDrift(script, faithful)).toBeNull();

    // the real failure: a clause repeated across two beats
    const duplicated = [
      faithful[0],
      { ...faithful[1], text: 'three. Four five six.' },
    ];
    expect(wordingDrift(script, duplicated)).toMatch(/stop matching/);
  });

  it('ignores whitespace differences', async () => {
    const { wordingDrift, normaliseScript } = await import('@/lib/ai/reel/plan');
    expect(normaliseScript('  a   b \n c ')).toBe('a b c');
    expect(
      wordingDrift('a b\nc', [
        { id: 'b1', role: 'hook', text: 'a b', shot: { kind: 'broll', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
        { id: 'b2', role: 'close', text: 'c', shot: { kind: 'broll', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
      ])
    ).toBeNull();
  });

  it('retries when the model drops or repeats words, and fails loudly if it keeps doing it', async () => {
    const bad = JSON.stringify({
      title: 'T', caption: { text: '', hashtags: [] },
      beats: [
        { id: 'b1', role: 'hook', text: 'One two', shot: { kind: 'broll', brief: 'x' , alsoAssetIds: [], sourceLineId: null } },
        { id: 'b2', role: 'close', text: 'two three.', shot: { kind: 'broll', brief: 'y' , alsoAssetIds: [], sourceLineId: null } },
      ],
    });
    const runClaude = vi.fn().mockResolvedValue(bad);
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createReel } = await import('@/lib/reel/store');
    await createReel('paste2');
    const { planFromScript } = await import('@/lib/ai/reel/plan');
    await expect(planFromScript('paste2', 'One two three.')).rejects.toThrow(/word for word/);
    expect(runClaude).toHaveBeenCalledTimes(2);
  });
});

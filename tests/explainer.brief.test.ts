import { describe, expect, it } from 'vitest';
import { missingForDraft } from '@/lib/explainer/brief';

const brief = (over: Record<string, unknown> = {}) => ({
  topic: 'What a CDN actually buys you',
  audience: 'backend engineers',
  claim: 'Distance is the latency.',
  seconds: 18,
  ...over,
});

describe('what a draft is still waiting for', () => {
  it('is nothing when the brief is complete', () => {
    expect(missingForDraft(brief())).toBeNull();
  });

  it('names the topic, because a disabled button that says nothing is a dead end', () => {
    expect(missingForDraft(brief({ topic: '   ' }))).toBe('Needs a topic.');
  });

  it('names the claim', () => {
    expect(missingForDraft(brief({ claim: '' }))).toBe('Needs the one thing that must land.');
  });

  it('names both when both are empty, rather than one at a time', () => {
    expect(missingForDraft(brief({ topic: '', claim: '' })))
      .toBe('Needs a topic and the one thing that must land.');
  });

  it('does not hold a draft back for an audience it can assume', () => {
    expect(missingForDraft(brief({ audience: '' }))).toBeNull();
  });
});

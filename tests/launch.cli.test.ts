import { describe, expect, it } from 'vitest';
import { parseLaunchArgs } from '@/lib/launch/cli';

describe('parseLaunchArgs', () => {
  it('reads a brief file', () => {
    expect(parseLaunchArgs(['brief.json'])).toEqual({ brief: 'brief.json', approve: false });
  });
  it('resumes a slug from a stage', () => {
    expect(parseLaunchArgs(['--slug', 'gemini-4', '--from', 'edit'])).toEqual({ slug: 'gemini-4', from: 'edit', approve: false });
  });
  it('approves a slug', () => {
    expect(parseLaunchArgs(['--slug', 'g', '--approve'])).toEqual({ slug: 'g', approve: true });
  });
  it('refuses a stage that does not exist, listing the stages', () => {
    expect(() => parseLaunchArgs(['--slug', 'g', '--from', 'nope'])).toThrow(/stages are brief, research/);
  });
  it('refuses neither or both of a brief and a slug', () => {
    expect(() => parseLaunchArgs([])).toThrow(/usage/);
    expect(() => parseLaunchArgs(['brief.json', '--slug', 'g'])).toThrow(/usage/);
  });
});

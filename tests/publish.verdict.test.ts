import { describe, expect, it } from 'vitest';
import { chapterVerdict } from '@/lib/publish/verdict';

const f = (pass: string, severity: 'blocker' | 'major' | 'minor', rule = `${pass}.ai`) => ({ pass, rule, severity, page: 1, summary: '', evidence: '', fix: '' });
describe('chapterVerdict', () => {
  it('passes with only minor findings', () => expect(chapterVerdict([[f('pedagogy', 'minor')]], [f('digital', 'minor')])).toBe('pass'));
  it('fails on a blocker anywhere or a major facts finding', () => {
    expect(chapterVerdict([[f('visual', 'blocker')]], [])).toBe('fail');
    expect(chapterVerdict([[f('facts', 'major')]], [])).toBe('fail');
    expect(chapterVerdict([[]], [f('digital', 'blocker')])).toBe('fail');
  });
  it('is unsure on a major from another pass, or when a pass could not run', () => {
    expect(chapterVerdict([[f('pedagogy', 'major')]], [])).toBe('unsure');
    expect(chapterVerdict([[f('facts', 'minor', 'facts.unavailable')]], [])).toBe('unsure');
    expect(chapterVerdict([[]], [f('digital', 'minor', 'digital.unavailable')])).toBe('unsure');
  });
});

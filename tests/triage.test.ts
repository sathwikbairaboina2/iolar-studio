import { describe, it, expect } from 'vitest';
import { disposition, triageOrder, requestFor } from '@/lib/verify/triage';
import type { Finding } from '@/lib/verify/gates';

const f = (over: Partial<Finding>): Finding => ({
  pass: 'facts', rule: 'facts.ai', severity: 'major', page: 1,
  summary: 'a claim is wrong', evidence: 'the text', fix: 'say the other thing', ...over,
});

describe('disposition', () => {
  it('auto-applies cosmetic passes', () => {
    expect(disposition(f({ pass: 'visual' }))).toBe('auto');
    expect(disposition(f({ pass: 'brand' }))).toBe('auto');
  });

  it('gates factual and pedagogical rewrites', () => {
    expect(disposition(f({ pass: 'facts', severity: 'blocker' }))).toBe('approve');
    expect(disposition(f({ pass: 'pedagogy', severity: 'major' }))).toBe('approve');
  });

  it('skips minors and the passes the gates already own', () => {
    expect(disposition(f({ pass: 'facts', severity: 'minor' }))).toBe('skip');
    expect(disposition(f({ pass: 'code', severity: 'blocker' }))).toBe('skip');
    expect(disposition(f({ pass: 'coverage', severity: 'blocker' }))).toBe('skip');
  });

  it('does not send a deterministic minor brand gate finding to the AI', () => {
    // runGates emits pass 'brand' at minor severity for things like a settings mismatch.
    // Rewriting those through revisePost would spend a model call on a one-field edit.
    expect(disposition(f({ pass: 'brand', rule: 'brand.handle', severity: 'minor' }))).toBe('skip');
    expect(disposition(f({ pass: 'visual', severity: 'minor' }))).toBe('skip');
  });
});

describe('triageOrder', () => {
  it('puts blockers first and facts before pedagogy within a severity', () => {
    const out = triageOrder([
      f({ pass: 'pedagogy', severity: 'major', summary: 'pm' }),
      f({ pass: 'facts', severity: 'major', summary: 'fm' }),
      f({ pass: 'pedagogy', severity: 'blocker', summary: 'pb' }),
    ]);
    expect(out.map((x) => x.summary)).toEqual(['pb', 'fm', 'pm']);
  });
});

describe('requestFor', () => {
  it('names the page, the defect and the fix, and forbids removal', () => {
    const r = requestFor(f({ page: 4, summary: 'closures cannot be pickled', fix: 'say they cannot' }));
    expect(r).toContain('page 4');
    expect(r).toContain('closures cannot be pickled');
    expect(r).toContain('say they cannot');
    expect(r.toLowerCase()).toContain('do not remove');
  });
});

describe('findingKey', () => {
  it('is stable for the same finding regardless of its position in the review', async () => {
    const { findingKey } = await import('@/lib/verify/triage');
    const a = f({ pass: 'facts', rule: 'facts.ai', page: 4, summary: 'closures cannot be pickled' });
    const b = f({ pass: 'facts', rule: 'facts.ai', page: 4, summary: 'closures cannot be pickled' });
    expect(findingKey(a)).toBe(findingKey(b));
  });

  it('differs when the finding differs', async () => {
    const { findingKey } = await import('@/lib/verify/triage');
    expect(findingKey(f({ summary: 'one' }))).not.toBe(findingKey(f({ summary: 'two' })));
    expect(findingKey(f({ page: 1 }))).not.toBe(findingKey(f({ page: 2 })));
    expect(findingKey(f({ pass: 'facts' }))).not.toBe(findingKey(f({ pass: 'pedagogy' })));
  });

  it('is short enough to paste on a command line', async () => {
    const { findingKey } = await import('@/lib/verify/triage');
    expect(findingKey(f({}))).toMatch(/^[0-9a-f]{8}$/);
  });
});

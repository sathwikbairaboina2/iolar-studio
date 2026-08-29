import { describe, it, expect } from 'vitest';
import { runPython, expectedOutput, outputMatches } from '@/lib/verify/sandbox';

describe('runPython', () => {
  it('runs a correct snippet and captures stdout', async () => {
    const r = await runPython('xs = [1, 2]\nxs.append(3)\nprint(xs)\n');
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe('[1, 2, 3]');
  }, 30_000);

  it('reports a runtime error without throwing', async () => {
    const r = await runPython('raise ValueError("boom")\n');
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain('ValueError');
  }, 30_000);

  it('times out an infinite loop instead of hanging', async () => {
    const r = await runPython('while True:\n    pass\n');
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
  }, 30_000);

  it('cannot reach the network', async () => {
    const r = await runPython(
      'import urllib.request\n' +
      'urllib.request.urlopen("http://example.com", timeout=2)\n' +
      'print("reached")\n'
    );
    expect(r.ok).toBe(false);
    expect(r.stdout).not.toContain('reached');
  }, 30_000);
});

describe('expectedOutput', () => {
  it('reads a value claim from a print comment', () => {
    expect(expectedOutput(['print(xs)   # [1, 2, 3]'])).toBe('[1, 2, 3]');
    expect(expectedOutput(['print(n)  # → 42'])).toBe('42');
  });

  it('ignores prose comments and prints without claims', () => {
    expect(expectedOutput(['print(x)  # shows the current value'])).toBeNull();
    expect(expectedOutput(['print(x)'])).toBeNull();
    expect(expectedOutput(['xs = [1]'])).toBeNull();
  });
});

describe('outputMatches', () => {
  it('ignores quote style and spacing', () => {
    expect(outputMatches("{'a': 1}", '{"a": 1}')).toBe(true);
    expect(outputMatches('[1, 2, 3]', '[1,2,3]')).toBe(false); // spacing inside the value still differs
    expect(outputMatches('hello world', 'hello  world')).toBe(true);
  });

  it('rejects a genuinely different value', () => {
    expect(outputMatches('[1, 2]', '[1, 2, 3]')).toBe(false);
  });
});

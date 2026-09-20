import { describe, it, expect } from 'vitest';
import {
  runPython, expectedOutput, outputMatches, buildPrelude, runPythonWithPrelude,
} from '@/lib/verify/sandbox';

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

describe('buildPrelude', () => {
  it('is empty for no preceding blocks', () => {
    expect(buildPrelude([])).toBe('');
  });

  it('lets a later block see names the earlier block defined', async () => {
    const prelude = buildPrelude([["d = {'a': 1}"]]);
    const r = await runPythonWithPrelude(prelude, "print('a' in d)\n");
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe('True');
  }, 30_000);

  it('suppresses the prelude own output so only the block under test prints', async () => {
    const prelude = buildPrelude([['print("NOISE")', 'v = 7']]);
    const r = await runPythonWithPrelude(prelude, 'print(v)\n');
    expect(r.stdout).not.toContain('NOISE');
    expect(r.stdout.trim()).toBe('7');
  }, 30_000);

  it('survives a prelude block that raises', async () => {
    const prelude = buildPrelude([['    def __next__(s):', '        return 1'], ['w = 3']]);
    const r = await runPythonWithPrelude(prelude, 'print(w)\n');
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe('3');
  }, 30_000);

  it('still reports a genuine error in the block under test', async () => {
    const r = await runPythonWithPrelude(buildPrelude([['x = 1']]), 'raise ValueError("boom")\n');
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain('ValueError');
  }, 30_000);
});

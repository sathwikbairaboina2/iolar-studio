import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
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

  it('starts python with a minimal environment and temp dirs inside the sandbox', async () => {
    process.env.SANDBOX_SECRET_TEST = 'leak';
    try {
      const code = [
        'import os',
        'print(sorted(k.upper() for k in os.environ))',
        'print(os.environ.get("TEMP") == os.getcwd(), os.environ.get("TMP") == os.getcwd())',
      ].join('\n');
      const r = await runPython(code);
      expect(r.ok).toBe(true);
      expect(r.stdout).not.toContain('SANDBOX_SECRET_TEST');
      expect(r.stdout).toContain('PYTHONIOENCODING');
      expect(r.stdout).toContain('True True');
    } finally {
      delete process.env.SANDBOX_SECRET_TEST;
    }
  }, 30_000);

  it('kills the whole process tree on a timeout', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tree-'));
    const marker = path.join(dir, 'marker.txt').split(path.sep).join('/');
    const code = [
      'import subprocess, sys, time',
      `subprocess.Popen([sys.executable, "-c", "import time; time.sleep(2.5); open('${marker}', 'w').write('x')"])`,
      'time.sleep(30)',
    ].join('\n');
    try {
      const r = await runPython(code, { timeoutMs: 1000 });
      expect(r.timedOut).toBe(true);
      await new Promise((res) => setTimeout(res, 3500));
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect(outputMatches('[1, 2, 3]', '[1,2,3]')).toBe(true); // a writer omits the spaces python prints
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

describe('output claim matching', () => {
  it('accepts a claim written without the spaces python prints', () => {
    expect(outputMatches('[1, 3, 5, 8, 10]\n[3, 5, 8]', '[3,5,8]')).toBe(true);
  });

  it('accepts a hedged claim about an unordered value', () => {
    expect(expectedOutput(['s = {10,20,30,40}', 'print(s)  # {40,10,20,30} order varies']))
      .toBe('{40,10,20,30}');
    expect(outputMatches('{40, 10, 20, 30}', '{40,10,20,30}')).toBe(true);
  });

  it('ignores a wildcard claim entirely', () => {
    expect(expectedOutput(['print(bits)   # 000001xx'])).toBeNull();
    expect(expectedOutput(['print(xs)     # [1, 2, ...]'])).toBeNull();
  });

  it('reads a slash-separated claim as one value per printed line', () => {
    // "print(k, d[k])  # b 20 / c 3" summarises a two-line loop print.
    expect(outputMatches('b 20\nc 3\n', 'b 20 / c 3')).toBe(true);
    expect(outputMatches('b 20\nc 9\n', 'b 20 / c 3')).toBe(false);
  });

  it('does not split a slash that is part of the value', () => {
    expect(outputMatches('usr\n', 'a/b')).toBe(false);
  });

  it('still fails a genuinely wrong output', () => {
    expect(outputMatches('[1, 2, 4]', '[1,2,3]')).toBe(false);
  });

  it('still reads a plain claim', () => {
    expect(expectedOutput(['print(n)   # 42'])).toBe('42');
  });
});

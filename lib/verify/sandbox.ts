import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

export type RunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const TIMEOUT_MS = 5_000;
const MAX_OUTPUT = 8 * 1024;

/**
 * Runs a snippet in a throwaway directory with an isolated interpreter, no site
 * packages, no inherited PYTHONPATH, and proxies pointed at a dead address so a
 * snippet cannot quietly reach the network. Output and runtime are both capped.
 */
export async function runPython(code: string, opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  const timeout = opts.timeoutMs ?? TIMEOUT_MS;
  const dir = await mkdtemp(path.join(tmpdir(), 'instastudio-sandbox-'));
  const file = path.join(dir, 'snippet.py');
  await fs.writeFile(file, code, 'utf8');

  try {
    return await new Promise<RunResult>((resolve) => {
      const child = execFile(
        'python',
        ['-I', '-S', file],
        {
          cwd: dir,
          timeout,
          maxBuffer: MAX_OUTPUT,
          windowsHide: true,
          env: {
            ...process.env,
            PATH: process.env.PATH ?? '',
            SYSTEMROOT: process.env.SYSTEMROOT ?? '',
            PYTHONPATH: '',
            PYTHONHOME: '',
            PYTHONDONTWRITEBYTECODE: '1',
            // Point every proxy at a closed port so a snippet cannot reach the network.
            HTTP_PROXY: 'http://127.0.0.1:9',
            HTTPS_PROXY: 'http://127.0.0.1:9',
            NO_PROXY: '',
          },
        },
        (err, stdout, stderr) => {
          const timedOut = !!err && (err as NodeJS.ErrnoException).code === undefined && /timed?.?out|ETIMEDOUT/i.test(String(err));
          resolve({
            ok: !err,
            stdout: String(stdout).slice(0, MAX_OUTPUT),
            stderr: String(stderr).slice(0, MAX_OUTPUT),
            timedOut: timedOut || (!!err && (err as { killed?: boolean }).killed === true),
          });
        }
      );
      child.on('error', () => resolve({ ok: false, stdout: '', stderr: 'python not available', timedOut: false }));
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Pulls an expected value out of a trailing output comment, e.g.
 *   print(xs)   # [1, 2, 3]      ->  "[1, 2, 3]"
 *   print(n)    # → 42           ->  "42"
 * Returns null when the snippet makes no claim about its output.
 */
export function expectedOutput(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!/\bprint\s*\(/.test(line)) continue;
    const m = line.match(/#\s*(?:→|->)?\s*(.+)$/);
    if (!m) return null;
    const claim = m[1].trim();
    // Ignore prose comments; an output claim looks like a value.
    if (/^[a-z][a-z ]{6,}$/i.test(claim)) return null;
    return claim;
  }
  return null;
}

/** Loose comparison: whitespace and quote style should not fail a correct snippet. */
export function outputMatches(actual: string, expected: string): boolean {
  const norm = (s: string) => s.replace(/['"]/g, '"').replace(/\s+/g, ' ').trim();
  return norm(actual).includes(norm(expected));
}

/**
 * Replays the Python blocks that came before this one so a fragment can see the names its
 * page already defined. The source is base64'd rather than interpolated: handbook snippets
 * contain every quote style, and a raw triple-quoted wrapper would collide with them.
 *
 * Each block is replayed independently and its failure swallowed — severed fragments are
 * legal handbook content, and one that cannot run must not fail the block under test.
 */
export function buildPrelude(blocks: string[][]): string {
  const sources = blocks.map((lines) => lines.join('\n')).filter((s) => s.trim());
  if (!sources.length) return '';
  const encoded = sources.map((s) => JSON.stringify(Buffer.from(s, 'utf8').toString('base64')));
  return [
    'import base64 as _b64, io as _io, contextlib as _ctx',
    `_pre = [${encoded.join(', ')}]`,
    'for _src in _pre:',
    '    try:',
    '        with _ctx.redirect_stdout(_io.StringIO()), _ctx.redirect_stderr(_io.StringIO()):',
    '            exec(compile(_b64.b64decode(_src).decode("utf-8"), "<prelude>", "exec"), globals())',
    '    except BaseException:',
    '        pass',
    'del _b64, _io, _ctx, _pre, _src',
  ].join('\n');
}

/** Runs `code` with `prelude` replayed first. An empty prelude is just `runPython`. */
export async function runPythonWithPrelude(
  prelude: string,
  code: string,
  opts: { timeoutMs?: number } = {}
): Promise<RunResult> {
  return runPython(prelude ? `${prelude}\n${code}` : code, opts);
}

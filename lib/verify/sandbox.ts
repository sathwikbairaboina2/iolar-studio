import { spawn } from 'child_process';
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

/** Stops the interpreter and everything it started. */
function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    else process.kill(-pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

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
      const child = spawn('python', ['-I', '-S', file], {
        cwd: dir,
        windowsHide: true,
        // Its own process group off Windows, so a timeout can take the whole tree down.
        detached: process.platform !== 'win32',
        // Only what the interpreter needs; nothing else of ours (tokens, API keys) is passed on.
        env: {
          PATH: process.env.PATH ?? '',
          SYSTEMROOT: process.env.SYSTEMROOT ?? '',
          TEMP: dir,
          TMP: dir,
          PYTHONIOENCODING: 'utf-8',
          PYTHONDONTWRITEBYTECODE: '1',
          // Point every proxy at a closed port so a snippet cannot reach the network.
          HTTP_PROXY: 'http://127.0.0.1:9',
          HTTPS_PROXY: 'http://127.0.0.1:9',
          NO_PROXY: '',
        } as unknown as NodeJS.ProcessEnv,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let overflow = false;
      let spawnFailed = false;
      let done = false;
      const finish = (exit: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({
          ok: !spawnFailed && exit === 0 && !timedOut && !overflow,
          stdout: stdout.slice(0, MAX_OUTPUT),
          stderr: spawnFailed ? 'python not available' : stderr.slice(0, MAX_OUTPUT),
          timedOut: timedOut || overflow,
        });
      };
      const take = (which: 'out' | 'err') => (chunk: Buffer) => {
        if (which === 'out') stdout += chunk.toString('utf8');
        else stderr += chunk.toString('utf8');
        if (!overflow && (stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT)) {
          overflow = true;
          killTree(child.pid);
        }
      };
      child.stdout?.on('data', take('out'));
      child.stderr?.on('data', take('err'));
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid);
        // A grandchild that survived could keep the pipes open; do not wait for it.
        setTimeout(() => finish(null), 2_000).unref();
      }, timeout);
      child.on('error', () => { spawnFailed = true; finish(null); });
      child.on('close', (c) => finish(c));
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** A claim that stands for a shape rather than a value cannot be compared. */
const WILDCARD = /\bxx\b|x{2,}|\.\.\.|…/;

/** Prose a writer appends to a value to say the order is not guaranteed. */
const HEDGE = /[,;]?\s*\(?\b(?:order\s+)?varies\b\)?\s*$/i;

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
    const claim = m[1].trim().replace(HEDGE, '').trim();
    // Ignore prose comments; an output claim looks like a value.
    if (/^[a-z][a-z ]{6,}$/i.test(claim)) return null;
    if (!claim || WILDCARD.test(claim)) return null;
    return claim;
  }
  return null;
}

/**
 * Loose comparison: a writer types `[3,5,8]` where python prints `[3, 5, 8]`, and neither
 * spacing nor quote style should fail a correct snippet. Whitespace is removed rather than
 * collapsed for exactly that reason — collapsing still leaves `[3, 5, 8]` unequal to
 * `[3,5,8]`. A wrong value is still a wrong value once the spaces are gone.
 *
 * A claim separated by " / " summarises one printed line per piece ("# b 20 / c 3" for a
 * two-line loop print), so every piece must appear. The spaces matter: they are what
 * distinguishes the separator from a slash inside a value such as a path.
 */
export function outputMatches(actual: string, expected: string): boolean {
  const norm = (s: string) => s.replace(/['"]/g, '"').replace(/\s+/g, '');
  const haystack = norm(actual);
  const pieces = expected.includes(' / ') ? expected.split(' / ') : [expected];
  return pieces.every((p) => p.trim() && haystack.includes(norm(p)));
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

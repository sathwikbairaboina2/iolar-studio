import { spawn } from 'child_process';

export class ClaudeUnavailableError extends Error {
  constructor() {
    super('Claude CLI not found. Install Claude Code and ensure `claude` is on PATH.');
    this.name = 'ClaudeUnavailableError';
  }
}

/**
 * Runs the Claude CLI headlessly. The prompt goes over stdin, never argv:
 * on Windows the CLI is a .cmd shim that needs shell:true, and a shell
 * concatenates argv, which mangles multi-line prompts.
 */
export function runClaude(
  prompt: string,
  opts: { timeoutMs?: number; allowedTools?: string[] } = {}
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const args = ['-p', '--output-format', 'text'];
  if (opts.allowedTools?.length) args.push('--allowedTools', opts.allowedTools.join(','));

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new ClaudeUnavailableError());
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 400)}`));
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

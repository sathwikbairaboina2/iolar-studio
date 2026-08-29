import { execFile } from 'child_process';

export class ClaudeUnavailableError extends Error {
  constructor() {
    super('Claude CLI not found. Install Claude Code and ensure `claude` is on PATH.');
    this.name = 'ClaudeUnavailableError';
  }
}

export function runClaude(prompt: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise((resolve, reject) => {
    execFile(
      'claude',
      ['-p', prompt, '--output-format', 'text'],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32' },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') return reject(new ClaudeUnavailableError());
          return reject(new Error(`claude failed: ${stderr?.slice(0, 400) || err.message}`));
        }
        resolve(stdout);
      }
    );
  });
}

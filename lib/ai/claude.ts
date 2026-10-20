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
export type ToolCall = { name: string; input: Record<string, unknown> };

/**
 * One line of `--output-format stream-json`, reduced to what a caller can use.
 *
 * Assistant turns carry `tool_use` blocks — the searches, fetches and subagent dispatches
 * the run is making — and the final `result` line carries the answer. Everything else
 * (hooks, system notes, user echoes) is noise here. A line that is not JSON is skipped
 * rather than fatal: the CLI prints the odd warning on stdout.
 */
export function parseStreamLine(line: string): { tools: ToolCall[]; result?: string } {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(line);
  } catch {
    return { tools: [] };
  }
  if (data.type === 'result' && typeof data.result === 'string') return { tools: [], result: data.result };
  if (data.type !== 'assistant') return { tools: [] };
  const message = data.message as { content?: unknown } | undefined;
  const content = Array.isArray(message?.content) ? (message!.content as Record<string, unknown>[]) : [];
  const tools = content
    .filter((b) => b.type === 'tool_use' && typeof b.name === 'string')
    .map((b) => ({ name: b.name as string, input: (b.input as Record<string, unknown>) ?? {} }));
  return { tools };
}

export type RunClaudeOpts = {
  timeoutMs?: number;
  allowedTools?: string[];
  onTool?: (call: ToolCall) => void;
  /** Where the CLI runs: an agentic caller points it at the project it is allowed to edit. */
  cwd?: string;
  /** `--model`: an alias such as `opus`, or a full model name. */
  model?: string;
  /** `--permission-mode`, for a run that has to write files without anyone to approve each one. */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
};

export function runClaude(prompt: string, opts: RunClaudeOpts = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  // A caller that wants to watch the tools go by gets the streamed form; the answer is
  // then the `result` line rather than everything printed.
  const streaming = Boolean(opts.onTool);
  const args = streaming ? ['-p', '--output-format', 'stream-json', '--verbose'] : ['-p', '--output-format', 'text'];
  if (opts.allowedTools?.length) args.push('--allowedTools', opts.allowedTools.join(','));
  if (opts.model) args.push('--model', opts.model);
  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      shell: process.platform === 'win32',
      windowsHide: true,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let result: string | undefined;
    let pending = '';

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;
      if (!streaming) return;
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseStreamLine(line);
        for (const call of parsed.tools) opts.onTool?.(call);
        if (parsed.result !== undefined) result = parsed.result;
      }
    });
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
      // In -p mode the CLI prints API errors and limits to stdout, leaving stderr empty.
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(stderr.trim() || stdout.trim().slice(-400)).slice(0, 400)}`));
      if (streaming) {
        if (pending.trim()) {
          const parsed = parseStreamLine(pending);
          if (parsed.result !== undefined) result = parsed.result;
        }
        if (result === undefined) return reject(new Error('claude streamed no result line'));
        return resolve(result);
      }
      resolve(stdout);
    });

    // A CLI that dies before reading its prompt breaks the pipe. Unhandled, that EPIPE is an
    // uncaught error event that takes the whole caller down — a campaign hours into its run.
    child.stdin.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error(`claude stdin failed: ${err.message}${stderr ? ` — ${stderr.slice(0, 400)}` : ''}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

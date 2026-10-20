import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

/** A child process whose stdin breaks the moment it is written to. */
function brokenChild() {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as EventEmitter & Record<string, unknown>;
  stdin.write = () => { queueMicrotask(() => stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))); return false; };
  stdin.end = () => {};
  child.stdin = stdin;
  child.kill = vi.fn();
  return child;
}

beforeEach(() => { vi.resetModules(); });

describe('runClaude', () => {
  it('rejects with the cause when the CLI closes its stdin, instead of crashing the process', async () => {
    const child = brokenChild();
    const spawn = vi.fn(() => child);
    vi.doMock('child_process', () => ({ spawn, default: { spawn } }));
    const { runClaude } = await import('@/lib/ai/claude');
    await expect(runClaude('prompt', { timeoutMs: 5_000 })).rejects.toThrow(/stdin.*EPIPE/);
    expect(child.kill).toHaveBeenCalled();
  });

  it('reports what the CLI printed on stdout when it fails with nothing on stderr', async () => {
    const child = brokenChild();
    const stdin = child.stdin as Record<string, unknown>;
    stdin.write = () => true;
    stdin.end = () => {
      queueMicrotask(() => {
        (child.stdout as EventEmitter).emit('data', Buffer.from('API Error: Request too large\n'));
        child.emit('close', 1);
      });
    };
    const spawn = vi.fn(() => child);
    vi.doMock('child_process', () => ({ spawn, default: { spawn } }));
    const { runClaude } = await import('@/lib/ai/claude');
    await expect(runClaude('prompt', { timeoutMs: 5_000 })).rejects.toThrow(/exited 1: API Error: Request too large/);
  });
});

/** A CLI that answers immediately, recording how it was spawned. */
function answeringChild(text: string) {
  const child = brokenChild();
  const stdin = child.stdin as Record<string, unknown>;
  stdin.write = () => true;
  stdin.end = () => {
    queueMicrotask(() => {
      (child.stdout as EventEmitter).emit('data', Buffer.from(text));
      child.emit('close', 0);
    });
  };
  return child;
}

describe('runClaude options', () => {
  it('passes the model, permission mode and tool list on the command line and runs in cwd', async () => {
    const spawn = vi.fn(() => answeringChild('ok'));
    vi.doMock('child_process', () => ({ spawn, default: { spawn } }));
    const { runClaude } = await import('@/lib/ai/claude');
    const out = await runClaude('prompt', {
      cwd: 'C:/work/render',
      model: 'opus',
      permissionMode: 'acceptEdits',
      allowedTools: ['Read', 'Write', 'Bash(npx tsc:*)'],
      timeoutMs: 5_000,
    });
    expect(out).toBe('ok');
    const [bin, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { cwd?: string }];
    expect(bin).toBe('claude');
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus', '--permission-mode', 'acceptEdits']));
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Write,Bash(npx tsc:*)');
    expect(options.cwd).toBe('C:/work/render');
  });

  it('adds none of them when they are not asked for', async () => {
    const spawn = vi.fn(() => answeringChild('ok'));
    vi.doMock('child_process', () => ({ spawn, default: { spawn } }));
    const { runClaude } = await import('@/lib/ai/claude');
    await runClaude('prompt', { timeoutMs: 5_000 });
    const [, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { cwd?: string }];
    expect(args).toEqual(['-p', '--output-format', 'text']);
    expect(options.cwd).toBeUndefined();
  });

  it('honours a long timeout for the design step', async () => {
    vi.useFakeTimers();
    try {
      const child = brokenChild();
      (child.stdin as Record<string, unknown>).write = () => true;
      const spawn = vi.fn(() => child);
      vi.doMock('child_process', () => ({ spawn, default: { spawn } }));
      const { runClaude } = await import('@/lib/ai/claude');
      const p = runClaude('prompt', { timeoutMs: 1_800_000 });
      const settled = vi.fn();
      p.catch(settled);
      await vi.advanceTimersByTimeAsync(1_000_000);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(900_000);
      expect(settled).toHaveBeenCalled();
      await expect(p).rejects.toThrow(/timed out after 1800000ms/);
    } finally {
      vi.useRealTimers();
    }
  });
});

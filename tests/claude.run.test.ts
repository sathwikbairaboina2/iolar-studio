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
});

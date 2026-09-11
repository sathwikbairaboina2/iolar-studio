import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'explainer-apply-'));
  process.env.IOLAR_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.IOLAR_DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('applyCommand', () => {
  it('writes the document and records the entry', async () => {
    const { applyCommand } = await import('@/lib/explainer/commands');
    const store = await import('@/lib/explainer/store');
    await store.save('x', store.blankDoc('Indexes', 'midnight'));

    const { doc, entry } = await applyCommand('x', { op: 'doc.theme', args: { theme: 'paper' }, actor: 'ui' });
    expect(doc.theme).toBe('paper');
    expect(entry.actor).toBe('ui');
    expect((await store.get('x'))!.theme).toBe('paper');
  });

  it('a rejected command writes nothing', async () => {
    const { applyCommand, CommandError } = await import('@/lib/explainer/commands');
    const store = await import('@/lib/explainer/store');
    await store.save('x', store.blankDoc('Indexes', 'midnight'));

    await expect(
      applyCommand('x', { op: 'beat.sec', args: { beatId: 'nope', sec: 2 }, actor: 'ui' })
    ).rejects.toBeInstanceOf(CommandError);
    expect((await store.get('x'))!.beats).toHaveLength(2);
  });

  it('404s for an explainer that is not there', async () => {
    const { applyCommand } = await import('@/lib/explainer/commands');
    await expect(
      applyCommand('ghost', { op: 'doc.theme', args: { theme: 'paper' }, actor: 'ui' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('undo puts the document back', async () => {
    const { applyCommand } = await import('@/lib/explainer/commands');
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', store.blankDoc('Indexes', 'midnight'));

    await applyCommand('x', { op: 'doc.theme', args: { theme: 'paper' }, actor: 'ui' });
    await history.undo('x');
    expect((await store.get('x'))!.theme).toBe('midnight');
  });

  it('an agent edit is labelled as one', async () => {
    const { applyCommand } = await import('@/lib/explainer/commands');
    const store = await import('@/lib/explainer/store');
    await store.save('x', store.blankDoc('Indexes', 'midnight'));

    const { entry } = await applyCommand('x', {
      op: 'scene.text', args: { field: 'subtitle', to: 'written by a model' }, actor: 'agent',
    });
    expect(entry.actor).toBe('agent');
    expect(entry.summary).toContain('subtitle');
  });
});

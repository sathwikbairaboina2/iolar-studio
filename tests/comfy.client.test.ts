import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const realStats = {
  system: { ram_total: 67737395200, ram_free: 51553329152 },
  devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', vram_total: 25757220864, vram_free: 21400000000 }],
};

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-comfy-'));
  vi.restoreAllMocks();
});

describe('comfy client', () => {
  it('getStats maps system_stats shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => realStats }) as unknown as typeof fetch;
    const { getStats } = await import('@/lib/comfy/client');
    const s = await getStats();
    expect(s.up).toBe(true);
    expect(s.vramTotalGb).toBeCloseTo(25.8, 1);
    expect(s.vramFreeGb).toBeCloseTo(21.4, 1);
  });

  it('getStats reports down on fetch failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const { getStats } = await import('@/lib/comfy/client');
    expect((await getStats()).up).toBe(false);
  });

  it('queuePrompt posts {prompt} envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ prompt_id: 'abc' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { queuePrompt } = await import('@/lib/comfy/client');
    const r = await queuePrompt({ '1': { class_type: 'X', inputs: {} } });
    expect(r.prompt_id).toBe('abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/prompt');
    expect(JSON.parse(init.body).prompt['1'].class_type).toBe('X');
  });

  it('buildDoodleWorkflow wires sampler to checkpoint and prompt', async () => {
    const { buildDoodleWorkflow } = await import('@/lib/comfy/assets');
    const wf = buildDoodleWorkflow('model.safetensors', 'a lightbulb');
    expect(wf['1'].inputs.ckpt_name).toBe('model.safetensors');
    expect(wf['2'].inputs.text).toContain('a lightbulb');
    expect(wf['5'].inputs.model).toEqual(['1', 0]);
    expect(wf['7'].inputs.filename_prefix).toBe('iolar-doodle');
  });
});

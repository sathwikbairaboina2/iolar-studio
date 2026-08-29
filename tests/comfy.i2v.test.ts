import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-i2v-'));
});

describe('comfy image-to-video', () => {
  it('addresses the template slots the MiniMax H3 workflow actually exposes', async () => {
    const { I2V_SLOTS, templatePath } = await import('@/lib/comfy/i2v');
    const tpl = JSON.parse(readFileSync(templatePath(), 'utf8'));
    const ids = new Set<string>((tpl.nodes ?? []).map((n: { id: number | string }) => String(n.id)));
    // Top-level slots must name real nodes; subgraph slots carry an instance prefix.
    for (const addr of [I2V_SLOTS.image, I2V_SLOTS.aspect, I2V_SLOTS.filenamePrefix]) {
      expect(ids.has(addr.split('.')[0])).toBe(true);
    }
    for (const addr of [I2V_SLOTS.prompt, I2V_SLOTS.seed, I2V_SLOTS.seconds]) {
      expect(addr).toMatch(/^\d+\/\d+\./);
    }
  });

  it('builds slot overrides carrying the brief, seed, seconds and vertical aspect', async () => {
    const { slotOverrides } = await import('@/lib/comfy/i2v');
    const out = slotOverrides({
      imageName: 'shot.png', brief: 'slow zoom over a chat UI', seconds: 5, seed: 7,
      ratio: '9:16', megapixels: 0.4, prefix: 'video/reel-7',
    });
    const joined = out.join(' ');
    expect(joined).toContain('slow zoom over a chat UI');
    expect(joined).toContain('shot.png');
    expect(joined).toContain('105/15.noise_seed=7');
    expect(joined).toContain('105/111.value=5');
    expect(joined).toContain('9:16 (Portrait Widescreen)');
  });

  it('writes a parameterised copy without touching the template on disk', async () => {
    const { writeParameterisedWorkflow, templatePath } = await import('@/lib/comfy/i2v');
    const before = readFileSync(templatePath(), 'utf8');
    const out = await writeParameterisedWorkflow({
      imagePath: 'shot.png', brief: 'chat ui pans up', seconds: 4, seed: 3, prefix: 'video/reel-3',
    });
    expect(existsSync(out)).toBe(true);
    const written = readFileSync(out, 'utf8');
    expect(written).toContain('chat ui pans up');
    expect(readFileSync(templatePath(), 'utf8')).toBe(before);
  }, 120_000);

  it('finds the prompt id in comfy run NDJSON', async () => {
    const { parsePromptId } = await import('@/lib/comfy/i2v');
    const nd = [
      '{"event":"submitted","data":{"prompt_id":"abc-123"}}',
      'some human line',
      '{"event":"progress","data":{"value":1}}',
    ].join('\n');
    expect(parsePromptId(nd)).toBe('abc-123');
    expect(() => parsePromptId('nothing here')).toThrow(/no prompt id/i);
  });

  it('picks the video file out of a history entry', async () => {
    const { pickVideoOutput } = await import('@/lib/comfy/i2v');
    const entry = {
      outputs: {
        '92': { videos: [{ filename: 'reel-7_00001.mp4', subfolder: 'video', type: 'output' }] },
        '80': { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] },
      },
    };
    expect(pickVideoOutput(entry)?.filename).toBe('reel-7_00001.mp4');
    expect(pickVideoOutput({ outputs: {} })).toBeNull();
  });

  it('reports unavailable rather than throwing when comfy is down', async () => {
    vi.doMock('@/lib/comfy/client', () => ({
      getStats: vi.fn().mockResolvedValue({ up: false }),
      uploadImage: vi.fn(),
      comfyUrl: () => 'http://127.0.0.1:8188',
    }));
    const { i2vAvailable } = await import('@/lib/comfy/i2v');
    expect(await i2vAvailable()).toBe(false);
  });

  it('uploads the still then submits, returning the prompt id', async () => {
    const uploadImage = vi.fn().mockResolvedValue({ name: 'shot.png' });
    vi.doMock('@/lib/comfy/client', () => ({
      getStats: vi.fn().mockResolvedValue({ up: true }),
      uploadImage,
      comfyUrl: () => 'http://127.0.0.1:8188',
    }));
    vi.doMock('@/lib/reel/probe', () => ({
      run: vi.fn().mockResolvedValue({ code: 0, stdout: '{"data":{"prompt_id":"p-9"}}', stderr: '' }),
    }));
    const dir = process.env.IOLAR_DATA_DIR!;
    const img = path.join(dir, 'shot.png');
    writeFileSync(img, 'x');
    const { animateImage } = await import('@/lib/comfy/i2v');
    const out = await animateImage({ imagePath: img, brief: 'chat ui', seconds: 4, seed: 1 });
    expect(out.promptId).toBe('p-9');
    expect(uploadImage).toHaveBeenCalled();
  });
});

describe('scene prompting', () => {
  it('states the brief as a scene and rules out the text the model would otherwise draw', async () => {
    const { scenePrompt } = await import('@/lib/comfy/i2v');
    const p = scenePrompt('slow, steady push in on a phone chat interface');
    expect(p).toContain('Live footage of: slow, steady push in on a phone chat interface.');
    expect(p).toMatch(/no captions/i);
    expect(p).toMatch(/no subtitles/i);
    expect(p).toMatch(/do not add or alter any text/i);
  });

  it('sends the wrapped prompt to the workflow, not the bare brief', async () => {
    const { slotOverrides, scenePrompt } = await import('@/lib/comfy/i2v');
    const out = slotOverrides({
      imageName: 'shot.png', brief: 'chat list UI', seconds: 4, seed: 1,
      ratio: '9:16', megapixels: 0.9, prefix: 'video/x',
    }).join(' ');
    expect(out).toContain('Live footage of: chat list UI.');
    expect(out).toContain(JSON.stringify(scenePrompt('chat list UI')).slice(1, 40));
  });

  it('asks for enough pixels to scale into a 1080x1920 frame', async () => {
    const { writeParameterisedWorkflow } = await import('@/lib/comfy/i2v');
    const { readFileSync } = await import('fs');
    const out = await writeParameterisedWorkflow({
      imagePath: 'shot.png', brief: 'x', seconds: 4, seed: 1, prefix: 'video/x',
    });
    expect(readFileSync(out, 'utf8')).toContain('0.9');
  }, 120_000);
});

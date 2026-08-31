import { describe, it, expect, vi } from 'vitest';
import { createWebpageProvider } from '@/lib/reel/providers/webpage';
import { createLipsyncProvider } from '@/lib/reel/providers/lipsync';

/** Both adapters are mocked at the HTTP boundary; neither plugin is ever called. */
const reply = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Response;

const req = {
  audioPath: 'C:/r/assets/beat-audio/b1.wav',
  seconds: 6,
  seed: 42,
  ratio: '9:16',
  brief: 'the source page, scrolled',
};

describe('webpage provider', () => {
  it('submits one link with the beat audio, and no dwell', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return reply({ id: 'job-1' });
    }) as unknown as typeof fetch;

    const p = createWebpageProvider({ baseUrl: 'http://x:8080', fetchImpl });
    const out = await p.animate({ ...req, url: 'https://example.com/a', highlight: 'the phrase' });

    expect(out.jobId).toBe('job-1');
    const body = JSON.parse(String(calls[0][1]!.body));
    expect(body.links).toEqual([{ url: 'https://example.com/a', highlight: 'the phrase', audio: req.audioPath }]);
    // The audio's duration is the page's screen time; a dwell would fight it.
    expect(body.links[0].dwell).toBeUndefined();
  });

  it('refuses a page visit with no page', async () => {
    const p = createWebpageProvider({ fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(p.animate(req)).rejects.toThrow(/needs a url/);
  });

  it('maps the plugin statuses onto job states', async () => {
    const state = async (status: string) => {
      const fetchImpl = vi.fn(async () => reply({ id: 'j', status })) as unknown as typeof fetch;
      return createWebpageProvider({ fetchImpl }).jobState('j');
    };
    expect(await state('succeeded')).toBe('ready');
    expect(await state('failed')).toBe('failed');
    expect(await state('running')).toBe('running');
    expect(await state('queued')).toBe('running');
  });

  it('is unavailable when the service does not answer', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await createWebpageProvider({ fetchImpl }).available()).toBe(false);
  });
});

describe('lipsync provider', () => {
  it('submits the presenter image and the beat audio as paths', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return reply({ id: 42 });
    }) as unknown as typeof fetch;

    const p = createLipsyncProvider({ baseUrl: 'http://x:8300', fetchImpl });
    const out = await p.animate({ ...req, imagePath: 'C:/p/madhu_desk.png' });

    expect(out.jobId).toBe('42');
    const body = JSON.parse(String(calls[0][1]!.body));
    expect(body.type).toBe('lipsync');
    expect(body.params.image_path).toBe('C:/p/madhu_desk.png');
    expect(body.params.audio_path).toBe(req.audioPath);
    // A dozen renders a reel: four steps rather than ten decides whether this is usable.
    expect(body.params.fast).toBe(true);
    expect(body.params.preset).toBe('portrait');
  });

  it('refuses a talking head with no presenter', async () => {
    const p = createLipsyncProvider({ fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(p.animate(req)).rejects.toThrow(/presenter image/);
  });

  it('maps the plugin statuses onto job states', async () => {
    const state = async (status: string) => {
      const fetchImpl = vi.fn(async () => reply({ id: 'j', status })) as unknown as typeof fetch;
      return createLipsyncProvider({ fetchImpl }).jobState('j');
    };
    expect(await state('succeeded')).toBe('ready');
    expect(await state('cancelled')).toBe('failed');
    expect(await state('queued')).toBe('running');
  });

  // Its health check also reports on ComfyUI, which reports unhealthy while it
  // is busy rendering. Gating on that stranded five beats on a human because the
  // first one was still going, so answering at all is the bar.
  it('stays available while it is busy, and only goes away when it stops answering', async () => {
    const busy = vi.fn(async () => reply({ ok: false, checks: { comfyui: { ok: false } } })) as unknown as typeof fetch;
    const down = vi.fn(async () => { throw new Error('refused'); }) as unknown as typeof fetch;
    expect(await createLipsyncProvider({ fetchImpl: busy }).available()).toBe(true);
    expect(await createLipsyncProvider({ fetchImpl: down }).available()).toBe(false);
  });
});

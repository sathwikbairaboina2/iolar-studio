import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { HfUnreachable, createHf, hfCall } from '@/lib/launch/higgsfield';

type Call = { tool: string; args: unknown };

/** A fake Claude CLI: answers by the one tool the call allows. */
function fakeRun(answers: Record<string, unknown[] | string>) {
  const calls: Call[] = [];
  const run = async (prompt: string, opts?: { allowedTools?: string[]; model?: string; timeoutMs?: number }) => {
    const tool = opts?.allowedTools?.[0] ?? '';
    const args = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
    calls.push({ tool, args });
    const a = answers[tool.replace('mcp__claude_ai_Higgsfield__', '')];
    if (typeof a === 'string') return a;
    if (!a?.length) return 'NO_TOOL';
    return JSON.stringify(a.length > 1 ? a.shift() : a[0]);
  };
  return { run, calls };
}

const noSleep = async () => undefined;

describe('hfCall', () => {
  it('allows exactly one tool and asks for its raw JSON', async () => {
    let seen: { prompt: string; opts?: { allowedTools?: string[]; model?: string } } | null = null;
    const out = await hfCall(async (prompt, opts) => { seen = { prompt, opts }; return 'Here: {"credits": 5}'; }, 'mcp__claude_ai_Higgsfield__balance', {});
    expect(out).toEqual({ credits: 5 });
    expect(seen!.opts?.allowedTools).toEqual(['mcp__claude_ai_Higgsfield__balance']);
    expect(seen!.prompt).toContain('exactly once');
  });
  it('throws HfUnreachable when the tool is missing or the reply has no JSON', async () => {
    await expect(hfCall(async () => 'NO_TOOL', 'mcp__claude_ai_Higgsfield__balance', {})).rejects.toBeInstanceOf(HfUnreachable);
    await expect(hfCall(async () => 'I do not have a tool called that.', 'mcp__claude_ai_Higgsfield__balance', {})).rejects.toBeInstanceOf(HfUnreachable);
  });
});

describe('createHf', () => {
  it('reads the balance', async () => {
    const { run } = fakeRun({ balance: [{ credits: 1166.52, subscription_plan_type: 'plus' }] });
    expect(await createHf({ run, http: fetch, sleep: noSleep }).balance()).toBe(1166.52);
  });

  it('reads a cost preflight for video and for image', async () => {
    const { run, calls } = fakeRun({ generate_video: [{ cost: { credits: 30 } }], generate_image: [{ cost: { credits: 0.12 } }] });
    const hf = createHf({ run, http: fetch, sleep: noSleep });
    expect(await hf.cost({ kind: 'video', model: 'seedance_2_5', duration: 10 })).toBe(30);
    expect(await hf.cost({ kind: 'image', model: 'soul_2' })).toBe(0.12);
    expect(calls[0].tool).toBe('mcp__claude_ai_Higgsfield__generate_video');
    expect(calls[0].args).toEqual({ params: { model: 'seedance_2_5', duration: 10, get_cost: true } });
    expect(calls[1].tool).toBe('mcp__claude_ai_Higgsfield__generate_image');
  });

  it('uploads: asks for a URL, PUTs the bytes, then confirms the same media id', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hf-'));
    const file = path.join(dir, 'a.mp3');
    await fs.writeFile(file, 'bytes');
    const { run, calls } = fakeRun({ media_upload: [{ uploads: [{ upload_url: 'https://up.example/x', media_id: 'm-1' }] }], media_confirm: [{ ok: true }] });
    const puts: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => { puts.push({ url, init }); return new Response('', { status: 200 }); }) as unknown as typeof fetch;
    const id = await createHf({ run, http, sleep: noSleep }).uploadFile(file, 'audio/mpeg');
    expect(id).toBe('m-1');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe('https://up.example/x');
    expect(puts[0].init.method).toBe('PUT');
    expect((puts[0].init.headers as Record<string, string>)['content-type']).toBe('audio/mpeg');
    expect(calls.map((c) => c.tool.split('__').pop())).toEqual(['media_upload', 'media_confirm']);
    expect(calls[0].args).toEqual({ filename: 'a.mp3', content_type: 'audio/mpeg' });
    expect(calls[1].args).toEqual({ type: 'audio', media_id: 'm-1' });
  });

  it('throws on a failed PUT and does not confirm', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hf-'));
    const file = path.join(dir, 'a.png');
    await fs.writeFile(file, 'bytes');
    const { run, calls } = fakeRun({ media_upload: [{ uploads: [{ upload_url: 'https://up.example/x', media_id: 'm-1' }] }] });
    const http = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch;
    await expect(createHf({ run, http, sleep: noSleep }).uploadFile(file, 'image/png')).rejects.toThrow(/403/);
    expect(calls).toHaveLength(1);
  });

  it('submits a video and an image and returns the job id', async () => {
    const { run, calls } = fakeRun({ generate_video: [{ job_ids: ['j-1'] }], generate_image: [{ jobs: [{ id: 'j-2' }] }] });
    const hf = createHf({ run, http: fetch, sleep: noSleep });
    expect(await hf.generateVideo({ kind: 'video', model: 'seedance_2_5' })).toBe('j-1');
    expect(await hf.generateImage({ kind: 'image', model: 'soul_2' })).toBe('j-2');
    expect(JSON.stringify(calls[0].args)).not.toContain('get_cost');
  });

  it('submits audio through generate_audio, prices it there, and waits on result_url', async () => {
    const { run, calls } = fakeRun({
      generate_audio: [{ cost: { credits: 0.11 } }, { job_ids: ['a-1'] }],
      jobs_wait: [{ all_terminal: true, jobs: [{ index: 0, job_id: 'a-1', status: 'completed', result_url: 'https://cdn/a.mp3' }] }],
    });
    const hf = createHf({ run, http: fetch, sleep: noSleep });
    expect(await hf.cost({ kind: 'audio', model: 'qwen_audio_tts' })).toBe(0.11);
    expect(await hf.generateAudio({ model: 'qwen_audio_tts', prompt: 'hi' })).toBe('a-1');
    expect(calls[0].tool).toBe('mcp__claude_ai_Higgsfield__generate_audio');
    expect(calls[0].args).toEqual({ params: { model: 'qwen_audio_tts', get_cost: true } });
    expect(calls[1].args).toEqual({ params: { model: 'qwen_audio_tts', prompt: 'hi' } });
    expect(await hf.wait(['a-1'], 60_000)).toEqual({ 'a-1': { status: 'completed', url: 'https://cdn/a.mp3' } });
  });

  it('reads the job id from the results shape generate_video answers with', async () => {
    const { run } = fakeRun({ generate_video: [{ results: [{ id: 'ccaa39ba', type: 'video', status: 'pending' }] }] });
    expect(await createHf({ run, http: fetch, sleep: noSleep }).generateVideo({ kind: 'video' })).toBe('ccaa39ba');
  });

  it('declines a preset recommendation and asks again literally, for the cost and the submit', async () => {
    const notice = { notice: { type: 'preset_recommendation', data: { preset: { id: 'p-1' }, retry_literal_with: { declined_preset_id: 'p-1' } } } };
    const { run, calls } = fakeRun({ generate_video: [notice, { cost: { credits: 15 } }, notice, { results: [{ id: 'j-9' }] }] });
    const hf = createHf({ run, http: fetch, sleep: noSleep });
    expect(await hf.cost({ kind: 'video', prompt: 'x' })).toBe(15);
    expect(await hf.generateVideo({ kind: 'video', prompt: 'x' })).toBe('j-9');
    expect(calls.map((c) => (c.args as { params: { declined_preset_id?: string } }).params.declined_preset_id)).toEqual([undefined, 'p-1', undefined, 'p-1']);
  });

  it('is unreachable when the connector is missing', async () => {
    const { run } = fakeRun({});
    await expect(createHf({ run, http: fetch, sleep: noSleep }).balance()).rejects.toBeInstanceOf(HfUnreachable);
  });

  it('waits across two polls until the job completes', async () => {
    const { run, calls } = fakeRun({ jobs_wait: [
      { all_terminal: false, poll_after_seconds: 5, jobs: [{ index: 0, job_id: 'j-1', status: 'in_progress' }] },
      { all_terminal: true, jobs: [{ index: 0, job_id: 'j-1', status: 'completed', result_url: 'https://cdn/x.mp4' }] },
    ] });
    const slept: number[] = [];
    const out = await createHf({ run, http: fetch, sleep: async (ms) => { slept.push(ms); } }).wait(['j-1'], 60_000);
    expect(out).toEqual({ 'j-1': { status: 'completed', url: 'https://cdn/x.mp4' } });
    expect(calls).toHaveLength(2);
    expect(slept).toEqual([5000]);
  });

  it('splits more than 12 ids over several calls and gives up at the timeout', async () => {
    const ids = Array.from({ length: 13 }, (_, i) => `j-${i}`);
    const { run, calls } = fakeRun({ jobs_wait: [{ all_terminal: false, poll_after_seconds: 1, jobs: [] }] });
    let now = 0;
    const out = await createHf({ run, http: fetch, sleep: async (ms) => { now += ms; }, clock: () => now }).wait(ids, 3000);
    expect(Object.values(out).every((j) => j.status === 'in_progress')).toBe(true);
    expect((calls[0].args as { jobs: unknown[] }).jobs).toHaveLength(12);
    expect((calls[1].args as { jobs: unknown[] }).jobs).toHaveLength(1);
  });
});

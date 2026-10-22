import { promises as fs } from 'fs';
import path from 'path';
import { extractJson } from '@/lib/ai/revise';
import type { ClaudeRun } from '@/lib/explainer2/script';

/**
 * The studio reaches Higgsfield through the Claude CLI's Higgsfield connector: each call is one headless run that may use
 * exactly one tool and returns that tool's raw JSON. Uploads are the exception: the studio PUTs the bytes itself.
 */

export type JobResult = { status: 'completed' | 'failed' | 'in_progress'; url?: string };

export type Hf = {
  balance(): Promise<number>;
  /** Credits the call would cost, without submitting it. `params.kind` picks the tool. */
  cost(params: object): Promise<number>;
  /** Uploads a local file; returns the media id to reference in a generation. */
  uploadFile(file: string, contentType: string): Promise<string>;
  generateVideo(params: object): Promise<string>;
  generateImage(params: object): Promise<string>;
  generateAudio(params: object): Promise<string>;
  wait(jobIds: string[], timeoutMs: number): Promise<Record<string, JobResult>>;
};

export class HfUnreachable extends Error {
  constructor(message = 'Higgsfield is not reachable from the studio') {
    super(message);
    this.name = 'HfUnreachable';
  }
}

const TOOL = (name: string) => `mcp__claude_ai_Higgsfield__${name}`;

export async function hfCall(run: ClaudeRun, tool: string, args: object): Promise<unknown> {
  const prompt = `Call the tool ${tool} exactly once with these arguments, then reply with only the tool's raw JSON result and nothing else:\n${JSON.stringify(args)}`;
  let said: string;
  try {
    said = await run(prompt, { allowedTools: [tool], timeoutMs: 180_000, model: 'sonnet' });
  } catch (err) {
    throw new HfUnreachable(`Higgsfield is not reachable from the studio (${err instanceof Error ? err.message.slice(0, 120) : String(err)})`);
  }
  let json: unknown;
  try {
    json = extractJson(said);
  } catch {
    throw new HfUnreachable();
  }
  return json;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

/** The job id of a submission, from whichever of the shapes the connector answers with. */
function jobIdOf(res: unknown): string {
  const r = obj(res);
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : undefined);
  const cand = first(r.job_ids) ?? first(r.jobs) ?? first(r.results) ?? r.job_id ?? r.id ?? first(r.generations);
  const id = typeof cand === 'string' ? cand : obj(cand).job_id ?? obj(cand).id;
  if (typeof id !== 'string' || !id) throw new Error('Higgsfield accepted the request but returned no job id');
  return id;
}

function statusOf(raw: unknown): JobResult['status'] {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'completed' || s === 'complete' || s === 'succeeded' || s === 'success') return 'completed';
  if (['failed', 'error', 'nsfw', 'canceled', 'cancelled', 'rejected'].includes(s)) return 'failed';
  return 'in_progress';
}

function urlOf(j: Obj): string | undefined {
  const results = Array.isArray(j.results) ? obj(j.results[0]) : {};
  const u = j.result_url ?? j.url ?? results.url ?? results.result_url;
  return typeof u === 'string' ? u : undefined;
}

export type HfDeps = {
  run: ClaudeRun;
  http: typeof fetch;
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<unknown>;
  clock?: () => number;
};

export function createHf(deps: HfDeps): Hf {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const clock = deps.clock ?? Date.now;
  const call = (name: string, args: object) => hfCall(deps.run, TOOL(name), args);
  // Higgsfield may answer a generation with a preset suggestion instead of doing it; the reel wants the literal request.
  const generate = async (tool: string, params: Obj): Promise<unknown> => {
    let res = await call(tool, { params });
    const n = obj(obj(res).notice);
    if (n.type === 'preset_recommendation') {
      const declined = obj(obj(n.data).retry_literal_with).declined_preset_id ?? obj(obj(n.data).preset).id;
      if (typeof declined === 'string') res = await call(tool, { params: { ...params, declined_preset_id: declined } });
    }
    return res;
  };
  const split = (params: object) => {
    const { kind, ...rest } = params as { kind?: string } & Obj;
    return { tool: kind === 'image' ? 'generate_image' : kind === 'audio' ? 'generate_audio' : 'generate_video', rest };
  };

  return {
    async balance() {
      const credits = obj(await call('balance', {})).credits;
      if (typeof credits !== 'number') throw new HfUnreachable('Higgsfield did not report a balance');
      return credits;
    },

    async cost(params) {
      const { tool, rest } = split(params);
      const res = obj(await generate(tool, { ...rest, get_cost: true }));
      const credits = obj(res.cost).credits ?? res.credits;
      if (typeof credits !== 'number') throw new Error('Higgsfield did not report a cost for this request');
      return credits;
    },

    async uploadFile(file, contentType) {
      const up = obj(await call('media_upload', { filename: path.basename(file), content_type: contentType }));
      const slot = obj(Array.isArray(up.uploads) ? up.uploads[0] : up);
      const url = slot.upload_url;
      const mediaId = slot.media_id ?? slot.id;
      if (typeof url !== 'string' || typeof mediaId !== 'string') throw new Error('Higgsfield returned no upload slot');
      const res = await deps.http(url, { method: 'PUT', headers: { 'content-type': contentType }, body: new Uint8Array(await fs.readFile(file)) });
      if (res.status !== 200) throw new Error(`the upload of ${path.basename(file)} failed with ${res.status}`);
      const type = contentType.startsWith('audio') ? 'audio' : contentType.startsWith('video') ? 'video' : 'image';
      await call('media_confirm', { type, media_id: mediaId });
      return mediaId;
    },

    async generateVideo(params) {
      const { rest } = split({ ...params, kind: 'video' });
      return jobIdOf(await generate('generate_video', rest));
    },

    async generateImage(params) {
      const { rest } = split({ ...params, kind: 'image' });
      return jobIdOf(await generate('generate_image', rest));
    },

    async generateAudio(params) {
      const { rest } = split({ ...params, kind: 'audio' });
      return jobIdOf(await generate('generate_audio', rest));
    },

    async wait(jobIds, timeoutMs) {
      const out: Record<string, JobResult> = Object.fromEntries(jobIds.map((id) => [id, { status: 'in_progress' } as JobResult]));
      const started = clock();
      for (;;) {
        const open = jobIds.filter((id) => out[id].status === 'in_progress');
        if (!open.length) return out;
        let pause = 5;
        for (let i = 0; i < open.length; i += 12) {
          const chunk = open.slice(i, i + 12);
          const res = obj(await call('jobs_wait', { jobs: chunk.map((job_id, index) => ({ index, job_id })), timeout_seconds: 15 }));
          if (typeof res.poll_after_seconds === 'number') pause = res.poll_after_seconds;
          for (const j of Array.isArray(res.jobs) ? res.jobs.map(obj) : []) {
            const id = typeof j.job_id === 'string' ? j.job_id : typeof j.id === 'string' ? j.id : '';
            if (!(id in out)) continue;
            const status = statusOf(j.status);
            out[id] = { status, ...(status === 'completed' && urlOf(j) ? { url: urlOf(j) } : {}) };
          }
        }
        if (jobIds.every((id) => out[id].status !== 'in_progress') || clock() - started >= timeoutMs) return out;
        await sleep(pause * 1000);
      }
    },
  };
}

/** The real bridge: the Claude CLI for the connector, fetch for the uploads. Loaded lazily so tests never import the CLI. */
export async function realHf(): Promise<Hf> {
  const { runClaude } = await import('@/lib/ai/claude');
  return createHf({ run: runClaude, http: fetch });
}

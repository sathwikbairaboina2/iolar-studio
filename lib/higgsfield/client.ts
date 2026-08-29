import { promises as fs } from 'fs';
import path from 'path';
import { ClaudeUnavailableError, runClaude } from '../ai/claude';
import { extractJson } from '../ai/revise';

export class HiggsfieldUnavailableError extends Error {
  constructor(detail = '') {
    super(
      `Higgsfield is unreachable. Generate the asset in Claude and drop the file into the reel instead.${
        detail ? ` (${detail})` : ''
      }`
    );
    this.name = 'HiggsfieldUnavailableError';
  }
}

const AUDIO_TOOL = 'mcp__claude_ai_Higgsfield__generate_audio';
const VIDEO_TOOL = 'mcp__claude_ai_Higgsfield__generate_video';
const JOB_TOOLS = [
  'mcp__claude_ai_Higgsfield__jobs_wait',
  'mcp__claude_ai_Higgsfield__job_status',
  'mcp__claude_ai_Higgsfield__show_generation_by_ids',
];

/**
 * Higgsfield lives behind MCP, which only a Claude session has. The app borrows one
 * through the same headless CLI it already uses for planning.
 */
async function ask(prompt: string, tools: string[]): Promise<{ url: string }> {
  let out: string;
  try {
    out = await runClaude(prompt, { timeoutMs: 900_000, allowedTools: tools });
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) throw new HiggsfieldUnavailableError('claude CLI not found');
    throw err;
  }
  let url = '';
  try {
    const parsed = extractJson(out) as { url?: string };
    url = parsed?.url ?? '';
  } catch {
    // Not JSON — fall through to the url regex.
  }
  if (!url) url = out.match(/https?:\/\/\S+?\.(?:mp4|mp3|wav|m4a|webm)/i)?.[0] ?? '';
  if (!url) throw new Error(`higgsfield returned no media url: ${out.slice(0, 200)}`);
  return { url };
}

export async function hfAvailable(): Promise<boolean> {
  try {
    const out = await runClaude('Call the Higgsfield balance tool and reply with ONLY its JSON result.', {
      timeoutMs: 120_000,
      allowedTools: ['mcp__claude_ai_Higgsfield__balance'],
    });
    return /credits/i.test(out);
  } catch {
    return false;
  }
}

export function hfGenerateAudio(opts: { text: string; voiceId: string }): Promise<{ url: string }> {
  return ask(
    `Use the Higgsfield generate_audio tool to speak this script${
      opts.voiceId ? ` with voice id ${opts.voiceId}` : ''
    }. Wait for the job to finish, then reply with ONLY {"url":"<direct media url>"} and no other text.\n\nSCRIPT:\n${opts.text}`,
    [AUDIO_TOOL, ...JOB_TOOLS]
  );
}

export function hfGenerateVideo(opts: { prompt: string; seconds: number }): Promise<{ url: string }> {
  return ask(
    `Use the Higgsfield generate_video tool to make a ${opts.seconds}-second vertical 9:16 clip: ${opts.prompt}. ` +
      `Wait for the job to finish, then reply with ONLY {"url":"<direct media url>"} and no other text.`,
    [VIDEO_TOOL, ...JOB_TOOLS]
  );
}

export async function downloadTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url} -> ${r.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

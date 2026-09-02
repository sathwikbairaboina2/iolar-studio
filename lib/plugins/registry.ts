/**
 * The services the studio renders through, and how to bring them back.
 *
 * Every one of them is the user's own machine — a queue on 8300, a browser recorder on 8080,
 * ComfyUI holding the weights, Ollama for the edit agent. The studio has always assumed they
 * were up and reported a shot that never rendered when they were not. This is the list that
 * lets a page say which one is missing, and start the two that can be started from here.
 */

export type PluginName = 'lipsync' | 'webpage' | 'comfyui' | 'ollama' | 'research' | 'jobsreel';

export type StartRecipe = {
  command: string;
  args: string[];
  cwd: string;
  /** Shown next to the button, so a start that fails can be run by hand. */
  hint: string;
};

export type Plugin = {
  name: PluginName;
  label: string;
  port: number;
  healthUrl: string;
  /** One line: what this service does for a reel. */
  what: string;
  openUrl?: string;
  start?: StartRecipe;
};

const lipsyncBase = (process.env.LIPSYNC_URL ?? 'http://127.0.0.1:8300').replace(/\/$/, '');
const webpageBase = (process.env.WEBPAGE_MP4_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const comfyBase = (process.env.COMFY_URL ?? 'http://127.0.0.1:8189').replace(/\/$/, '');
const ollamaBase = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11436').replace(/\/$/, '');
const researchBase = (process.env.RESEARCH_URL ?? 'http://127.0.0.1:25100').replace(/\/$/, '');
const jobsReelBase = (process.env.JOBS_REEL_URL ?? 'http://127.0.0.1:26100').replace(/\/$/, '');

const port = (url: string) => Number(new URL(url).port || 80);

const PLUGIN_ROOT = process.env.PLUGIN_ROOT ?? 'C:/Users/sathwik/projects';

export const PLUGINS: Plugin[] = [
  {
    name: 'lipsync',
    label: 'lipsync',
    port: port(lipsyncBase),
    healthUrl: `${lipsyncBase}/healthz`,
    what: 'Talking-head shots. Drives ComfyUI through a Celery queue, one render at a time.',
    start: {
      command: 'powershell.exe',
      args: ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', 'scripts/serve.ps1'],
      cwd: `${PLUGIN_ROOT}/comfYUI-plugins`,
      hint: String.raw`.\scripts\serve.ps1`,
    },
  },
  {
    name: 'webpage',
    label: 'webpage-mp4',
    port: port(webpageBase),
    healthUrl: `${webpageBase}/healthz`,
    what: 'Page shots. Records a phone browsing the source a line cites.',
    openUrl: `${webpageBase}/docs`,
    start: {
      command: 'npm',
      args: ['start'],
      cwd: `${PLUGIN_ROOT}/webpage-mp4-plugin`,
      hint: 'npm start',
    },
  },
  {
    name: 'comfyui',
    label: 'ComfyUI',
    port: port(comfyBase),
    healthUrl: `${comfyBase}/system_stats`,
    what: 'Holds the weights the lipsync queue renders with.',
    openUrl: comfyBase,
    // Desktop is an application the user launches. A Start button here would be a button
    // that lies, so there is not one.
  },
  {
    name: 'ollama',
    label: 'Ollama',
    port: port(ollamaBase),
    healthUrl: `${ollamaBase}/api/tags`,
    what: 'The local model behind the edit agent. Nothing renders without it; nothing stops either.',
  },
  {
    name: 'research',
    label: 'research',
    port: port(researchBase),
    healthUrl: `${researchBase}/api/health`,
    what: 'The local researcher behind the Research tab. Hunts sources through searxng, jina, yt-dlp and gh on qwen.',
    openUrl: researchBase,
    // The script brings up its docker side (research-ollama, research-searxng) first, then
    // the service. Turbopack only: --webpack dies on node:crypto in its instrumentation.
    start: {
      command: 'powershell.exe',
      args: ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', 'scripts/serve.ps1'],
      cwd: `${PLUGIN_ROOT}/research-plugin`,
      hint: String.raw`.\scripts\serve.ps1`,
    },
  },
  {
    name: 'jobsreel',
    label: 'jobs-reel',
    port: port(jobsReelBase),
    healthUrl: `${jobsReelBase}/healthz`,
    what: 'The weekly jobs reel. Turns the sheet of open roles into one sixty-second reel; the Jobs tab reads its board.',
    openUrl: jobsReelBase,
    start: {
      command: 'npm',
      args: ['run', 'dev'],
      cwd: `${PLUGIN_ROOT}/plugins/jobs-reel-plugin`,
      hint: 'npm run dev',
    },
  },
];

export function pluginByName(name: string): Plugin | undefined {
  return PLUGINS.find((p) => p.name === name);
}

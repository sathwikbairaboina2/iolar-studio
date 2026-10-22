import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * Who does the thinking. Two of the three are remote and one is not, which is the
 * distinction every stage actually cares about; `lib/ai/runner.ts` reads it.
 */
export type LlmProvider = 'claude' | 'local' | 'openrouter';

export type Settings = {
  brand: string;
  defaultTemplate: string;
  defaultRatio: string;
  whisperPython: string;
  whisperModel: string;
  whisperDevice: 'cuda' | 'cpu';
  voiceProvider: 'kokoro' | 'piper' | 'sapi' | 'manual';
  kokoroDir: string;
  kokoroVoice: string;
  kokoroSpeed: number;
  piperVoice: string;
  piperDataDir: string;
  presenterImage: string;
  /** Sampling steps for a talking head. 4 is the draft LoRA; 10 is full quality. */
  lipsyncSteps: number;
  /** Frame rate to render talking heads at. 0 follows the reel's own rate. */
  lipsyncFps: number;
  reelFps: number;
  reelRatio: string;
  reelStyle: string;
  agentProvider: LlmProvider;
  agentUrl: string;
  agentOllamaUrl: string;
  agentModel: string;
  agentNumPredict: number;
  agentMaxRevisions: number;
  /**
   * Who hunts the sources.
   *
   * `claude` dispatches headless Claude subagents with WebSearch. `local` sends the plan to
   * the research service — a local model, SearXNG and a page reader that leaves nothing
   * off the machine and pays nobody. The critic, the writer and the coverage judge stay on
   * Claude either way; only the hunt moves.
   */
  researchProvider: LlmProvider;
  /**
   * The one switch. Every LLM call in the studio — the handbook planner, the reel
   * writer, the research hunt, the reel agent, the job card reader — goes to headless
   * Claude when this is `claude`, to the local model on `researchOllamaUrl` when it is
   * `local`, and to `openrouterModel` over the network when it is `openrouter`. Either
   * remote setting unloads the local model, so the card is free; switching back to local
   * loads it again on the first call.
   *
   * OpenRouter is remote like Claude but toolless like the local model: a stage that
   * needs the web refuses there rather than answering from memory, and the reel agent,
   * which has only a Claude and an ollama backend, refuses too.
   *
   * `researchProvider` and `agentProvider` are kept in step with it, so an older
   * settings file and the tests that write those keys still say the same thing.
   */
  llmProvider: LlmProvider;
  /**
   * The model OpenRouter is asked for, in its own `vendor/model` spelling, and the API it
   * is asked through. The key is never kept here: it is read from OPENROUTER_API_KEY in
   * the environment, so it stays out of the settings file and out of the browser.
   */
  openrouterModel: string;
  openrouterUrl: string;
  researchUrl: string;
  /** The SearXNG the research stack runs. A job card searches it for a company's own site. */
  searxngUrl: string;
  /** The ollama the local research agents think on. The research service's own, by default. */
  researchOllamaUrl: string;
  researchModel: string;
  /** The knowledge graph. bolt, not http; the browser UI is on the next port. */
  neo4jUrl: string;
  neo4jUser: string;
  neo4jPassword: string;
  /** Passages and claims, for the agents' memory. */
  qdrantUrl: string;
  /** The ollama that embeds. The host Ollama by default, like everything else here. */
  embedOllamaUrl: string;
  embedModel: string;
  /** Off restores the pipeline exactly as it was before the knowledge layer. */
  knowledgeMemory: boolean;
  /** The jobs bridge: which slice of the research pool feeds the reel, and how small a cut is too small. */
  jobsCategory: 'india' | 'global-remote' | 'other' | 'all';
  jobsTechOnly: boolean;
  jobsThinBelow: number;
  /** The style pack a cut is planned and rendered in, and who records its lines. */
  jobsStyle: string;
  jobsVoice: 'studio' | 'plugin';
  /** The kokoro voice and pace the studio reads a jobs reel in; hf_alpha is Indian English. */
  jobsKokoroVoice: string;
  jobsKokoroSpeed: number;
  /** The kokoro pace for designed explainers: slower than a reel's, so a 30 second brief stays near 30 seconds. */
  explainerKokoroSpeed: number;
  /** Who speaks a launch reel: Higgsfield's qwen TTS, or local Kokoro. Kokoro is also the fallback for qwen. */
  launchVoice: 'qwen' | 'kokoro';
  /** The Kokoro voice for a launch reel; hm_psi is Indian English, male. */
  launchKokoroVoice: string;
};

const DEFAULTS: Settings = {
  brand: 'iolar',
  defaultTemplate: 'spiral-notes',
  defaultRatio: '3:4',
  whisperPython: path.join(process.cwd(), '.venv-whisper', 'Scripts', 'python.exe'),
  whisperModel: 'small',
  whisperDevice: 'cpu',
  // Local by default: no cloud generation happens unless it is turned on explicitly.
  voiceProvider: 'kokoro',
  kokoroDir: 'models/kokoro',
  kokoroVoice: 'am_michael',
  // Kokoro reads at about 155 wpm unprompted; the reference reel runs at 239. A reel is
  // paced faster than an audiobook, and this is where it lands close to the reference.
  kokoroSpeed: 1.35,
  piperVoice: 'en_US-ryan-high',
  piperDataDir: 'models/piper',
  presenterImage: '',
  lipsyncSteps: 10,
  lipsyncFps: 0,
  reelFps: 30,
  reelRatio: '9:16',
  reelStyle: 'armand',
  agentProvider: 'local',
  agentUrl: 'http://127.0.0.1:3121',
  // The Ollama installed on the host, shared by every project on this machine.
  agentOllamaUrl: 'http://127.0.0.1:11434',
  // The one generative model the host Ollama serves for every project.
  agentModel: 'qwen3.8:27b',
  // A thinking model spends tokens before it calls. At 200 it never reaches the
  // tool call and looks like a model that cannot tool-call at all.
  agentNumPredict: 1200,
  agentMaxRevisions: 3,
  // Local by default: the research runs on qwen through the research service, and
  // nothing about a reel's topic leaves the machine unless this is turned to claude.
  researchProvider: 'local',
  llmProvider: 'local',
  // DeepSeek's fast line: a megatoken of context at a fraction of a cent, which is what
  // a handbook part's prompt wants. Any id from the router's catalogue goes here instead.
  openrouterModel: 'deepseek/deepseek-v4.1-flash',
  openrouterUrl: 'https://openrouter.ai/api/v1',
  researchUrl: 'http://127.0.0.1:25100',
  searxngUrl: 'http://127.0.0.1:25180',
  researchOllamaUrl: 'http://127.0.0.1:11434',
  researchModel: 'qwen3.8:27b',
  neo4jUrl: 'bolt://127.0.0.1:3124',
  neo4jUser: 'neo4j',
  neo4jPassword: 'iolar-local',
  qdrantUrl: 'http://127.0.0.1:3126',
  embedOllamaUrl: 'http://127.0.0.1:11434',
  embedModel: 'nomic-embed-text',
  knowledgeMemory: true,
  jobsCategory: 'india',
  jobsTechOnly: false,
  jobsThinBelow: 20,
  jobsStyle: 'paper-doodle',
  jobsVoice: 'studio',
  jobsKokoroVoice: 'hf_alpha',
  // The plugin cuts each slide to its line, so a jobs reel can take a presenter's pace
  // rather than the 1.35 a fixed-length reel needs.
  jobsKokoroSpeed: 1.1,
  explainerKokoroSpeed: 1.08,
  launchVoice: 'qwen',
  launchKokoroVoice: 'hm_psi',
};

function file() {
  return path.join(process.env.IOLAR_DATA_DIR ?? path.join(process.cwd(), 'data'), 'settings.json');
}

/**
 * The three provider keys are one decision. A settings file written before the switch
 * existed says it through `researchProvider` (or `agentProvider`); a client that sets
 * either one means the whole studio. Whichever arrives, all three end up agreeing.
 */
const PROVIDER_KEYS = ['llmProvider', 'researchProvider', 'agentProvider'] as const;
const PROVIDERS = ['claude', 'local', 'openrouter'] as const;
const isProvider = (v: unknown): v is LlmProvider => PROVIDERS.includes(v as LlmProvider);

function agreeOnProvider(raw: Record<string, unknown>, previous?: Settings): Record<string, unknown> {
  const named = (k: (typeof PROVIDER_KEYS)[number]) => isProvider(raw[k]);
  // A save that moves one of the three keys is the ask, whichever key it was; a save that
  // moves none (or a file being read) is answered by the switch itself.
  const moved = previous && PROVIDER_KEYS.find((k) => named(k) && raw[k] !== previous[k]);
  const provider = moved ? raw[moved] : (raw.llmProvider ?? raw.researchProvider ?? raw.agentProvider);
  if (!isProvider(provider)) return raw;
  return { ...raw, llmProvider: provider, researchProvider: provider, agentProvider: provider };
}

export function getSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>;
    // The preset key was renamed on 3 September 2026; an old settings file still reads.
    if (typeof raw.reelPattern === 'string' && raw.reelStyle === undefined) raw.reelStyle = raw.reelPattern;
    delete raw.reelPattern;
    return { ...DEFAULTS, ...agreeOnProvider(raw) } as Settings;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Partial<Settings>): Settings {
  mkdirSync(path.dirname(file()), { recursive: true });
  const previous = getSettings();
  const merged = { ...previous, ...agreeOnProvider(s as Record<string, unknown>, previous) } as Settings;
  writeFileSync(file(), JSON.stringify(merged, null, 2));
  return merged;
}

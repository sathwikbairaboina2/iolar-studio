import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

export type Settings = {
  brand: string;
  defaultTemplate: string;
  defaultRatio: string;
  whisperPython: string;
  whisperModel: string;
  whisperDevice: 'cuda' | 'cpu';
  voiceProvider: 'kokoro' | 'piper' | 'sapi' | 'higgsfield' | 'manual';
  kokoroDir: string;
  kokoroVoice: string;
  kokoroSpeed: number;
  piperVoice: string;
  piperDataDir: string;
  heroProvider: 'plugin' | 'higgsfield';
  reelFps: number;
  reelRatio: string;
  reelPattern: string;
  agentProvider: 'local' | 'claude';
  agentUrl: string;
  agentOllamaUrl: string;
  agentModel: string;
  agentNumPredict: number;
  agentMaxRevisions: number;
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
  heroProvider: 'plugin',
  reelFps: 30,
  reelRatio: '9:16',
  reelPattern: 'armand',
  agentProvider: 'local',
  agentUrl: 'http://127.0.0.1:3121',
  // The model lives in the invisible-ollama container, which already holds it.
  agentOllamaUrl: 'http://127.0.0.1:11436',
  agentModel: 'lfm2.5',
  // lfm2.5 thinks before it calls. At 200 it never reaches the tool call and
  // looks like a model that cannot tool-call at all; 1200 answers in 1-2s.
  agentNumPredict: 1200,
  agentMaxRevisions: 3,
};

function file() {
  return path.join(process.env.IOLAR_DATA_DIR ?? path.join(process.cwd(), 'data'), 'settings.json');
}

export function getSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Partial<Settings>): Settings {
  mkdirSync(path.dirname(file()), { recursive: true });
  const merged = { ...getSettings(), ...s };
  writeFileSync(file(), JSON.stringify(merged, null, 2));
  return merged;
}

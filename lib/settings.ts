import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

export type Settings = {
  brand: string;
  defaultTemplate: string;
  defaultRatio: string;
  comfyUrl: string;
  comfyCheckpoint: string;
  polishDenoise: number;
  desktopWorkflowsDir: string;
  whisperPython: string;
  whisperModel: string;
  whisperDevice: 'cuda' | 'cpu';
  i2vModel: string;
  i2vTurbo: boolean;
  voiceProvider: 'kokoro' | 'piper' | 'sapi' | 'higgsfield' | 'manual';
  kokoroDir: string;
  kokoroVoice: string;
  kokoroSpeed: number;
  piperVoice: string;
  piperDataDir: string;
  heroProvider: 'comfy' | 'higgsfield';
  reelFps: number;
  reelRatio: string;
  reelPattern: string;
};

const DEFAULTS: Settings = {
  brand: 'iolar',
  defaultTemplate: 'spiral-notes',
  defaultRatio: '3:4',
  comfyUrl: 'http://127.0.0.1:8188',
  comfyCheckpoint: '',
  polishDenoise: 0.12,
  desktopWorkflowsDir:
    'C:\\Users\\sathwik\\AppData\\Local\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\user\\default\\workflows',
  whisperPython: path.join(process.cwd(), '.venv-whisper', 'Scripts', 'python.exe'),
  whisperModel: 'small',
  whisperDevice: 'cpu',
  i2vModel: '',
  i2vTurbo: false,
  // Local by default: no cloud generation happens unless it is turned on explicitly.
  voiceProvider: 'kokoro',
  kokoroDir: 'models/kokoro',
  kokoroVoice: 'am_michael',
  kokoroSpeed: 1.0,
  piperVoice: 'en_US-ryan-high',
  piperDataDir: 'models/piper',
  heroProvider: 'comfy',
  reelFps: 30,
  reelRatio: '9:16',
  reelPattern: 'armand',
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

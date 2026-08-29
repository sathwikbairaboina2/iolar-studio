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

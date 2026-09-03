import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { dataRoot } from '@/lib/paths';

/**
 * A voice the user recorded for a cut, optional. One file per period, kept on disk under
 * the data dir beside everything else the studio owns; the ledger stays as it is. Submit
 * sends it to the board's PUT /api/weeks/{week}/voice after the script, and the plugin
 * cuts the slides to it instead of hearing the studio read the lines.
 */

export const OWN_VOICE_FORMATS = ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac', 'webm'] as const;
export type OwnVoiceFormat = (typeof OWN_VOICE_FORMATS)[number];

export type OwnVoice = {
  format: OwnVoiceFormat;
  bytes: number;
  /** The name it was dropped as, for the person looking at the cut. */
  name: string;
  at: string;
};

/** A reel's narration is a minute or two of speech. Anything vastly larger is a mistake. */
export const MAX_OWN_VOICE_BYTES = 100 * 1024 * 1024;

const SAFE_KEY = /^\d{4}-W\d{2}$|^\d{4}-\d{2}-\d{2}$/;

export function ownVoiceDir(periodKey: string) {
  if (!SAFE_KEY.test(periodKey)) throw new Error(`"${periodKey}" is not a period key`);
  return path.join(dataRoot(), 'jobs', 'voice', periodKey);
}

const metaFile = (periodKey: string) => path.join(ownVoiceDir(periodKey), 'voice.json');

export function formatOf(name: string): OwnVoiceFormat | null {
  const ext = path.extname(name).slice(1).toLowerCase();
  return (OWN_VOICE_FORMATS as readonly string[]).includes(ext) ? (ext as OwnVoiceFormat) : null;
}

export function readOwnVoice(periodKey: string): (OwnVoice & { path: string }) | null {
  const meta = metaFile(periodKey);
  if (!existsSync(meta)) return null;
  try {
    const m = JSON.parse(readFileSync(meta, 'utf8')) as OwnVoice;
    const file = path.join(ownVoiceDir(periodKey), `vo.${m.format}`);
    if (!existsSync(file)) return null;
    return { ...m, path: file };
  } catch {
    return null;
  }
}

export function saveOwnVoice(periodKey: string, bytes: Buffer, name: string, now = new Date()): OwnVoice {
  const format = formatOf(name);
  if (!format) throw new Error(`"${name}" is not one of ${OWN_VOICE_FORMATS.join(', ')}`);
  if (bytes.length === 0) throw new Error('no audio in the request body');
  if (bytes.length > MAX_OWN_VOICE_BYTES) throw new Error('that recording is too large');
  const dir = ownVoiceDir(periodKey);
  clearOwnVoice(periodKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `vo.${format}`), bytes);
  const meta: OwnVoice = { format, bytes: bytes.length, name: path.basename(name), at: now.toISOString() };
  writeFileSync(metaFile(periodKey), JSON.stringify(meta, null, 2));
  return meta;
}

export function clearOwnVoice(periodKey: string): boolean {
  const dir = ownVoiceDir(periodKey);
  if (!existsSync(dir)) return false;
  const had = readdirSync(dir).some((f) => f.startsWith('vo.'));
  rmSync(dir, { recursive: true, force: true });
  return had;
}

export function ownVoiceBytes(periodKey: string): { bytes: Buffer; format: OwnVoiceFormat } | null {
  const v = readOwnVoice(periodKey);
  if (!v) return null;
  return { bytes: readFileSync(v.path), format: v.format };
}

export function ownVoiceSize(periodKey: string): number {
  const v = readOwnVoice(periodKey);
  return v ? statSync(v.path).size : 0;
}

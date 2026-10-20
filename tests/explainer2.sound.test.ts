import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SFX_EVENTS, chooseBed, musicBeds, parseManifest, readManifest, readSound, soundBrief, writeSound } from '@/lib/explainer2/sound';

const MANIFEST = {
  files: [
    { file: 'music/calm-1.mp3', kind: 'music', mood: 'calm', durationSec: 75, source: 'comfy', license: 'generated' },
    { file: 'music/focused-1.mp3', kind: 'music', mood: 'focused', durationSec: 80, source: 'comfy', license: 'generated' },
    { file: 'music/focused-2.mp3', kind: 'music', mood: 'focused', durationSec: 62, source: 'comfy', license: 'generated' },
    { file: 'sfx/pop.wav', kind: 'sfx', event: 'pop', durationSec: 0.3, source: 'comfy', license: 'generated' },
    { file: 'sfx/land.wav', kind: 'sfx', event: 'land', durationSec: 0.4, source: 'comfy', license: 'generated' },
  ],
};

let data: string;
let root: string;
beforeEach(() => {
  data = mkdtempSync(path.join(os.tmpdir(), 'x2-snd-'));
  root = mkdtempSync(path.join(os.tmpdir(), 'x2-sndr-'));
  process.env.IOLAR_DATA_DIR = data;
});

describe('parseManifest', () => {
  it('reads the list of files, bare or under "files"', () => {
    expect(parseManifest(MANIFEST)?.length).toBe(5);
    expect(parseManifest(MANIFEST.files)?.length).toBe(5);
  });
  it('drops entries it cannot use and returns null for junk', () => {
    expect(parseManifest({ files: [{ file: 'a.mp3' }, MANIFEST.files[0]] })?.length).toBe(1);
    expect(parseManifest('nope')).toBeNull();
  });
  it('puts music under music/ and effects under sfx/ when the name is bare', () => {
    const m = parseManifest([{ file: 'x.mp3', kind: 'music', mood: 'calm' }, { file: 'y.wav', kind: 'sfx', event: 'pop' }])!;
    expect(m.map((e) => e.file)).toEqual(['music/x.mp3', 'sfx/y.wav']);
  });
});

describe('readManifest', () => {
  it('is null when the library has no manifest', async () => expect(await readManifest(root)).toBeNull());
  it('reads public/designed/_audio/manifest.json', async () => {
    await fs.mkdir(path.join(root, 'public', 'designed', '_audio'), { recursive: true });
    await fs.writeFile(path.join(root, 'public', 'designed', '_audio', 'manifest.json'), JSON.stringify(MANIFEST));
    expect((await readManifest(root))?.length).toBe(5);
  });
});

describe('musicBeds and chooseBed', () => {
  const m = parseManifest(MANIFEST)!;
  it('lists the music beds with their mood', () => expect(musicBeds(m).map((b) => b.file)).toEqual(['music/calm-1.mp3', 'music/focused-1.mp3', 'music/focused-2.mp3']));
  it('picks a bed of a preferred mood, the same one for the same slug', () => {
    const a = chooseBed(m, 'caching');
    expect(a).toMatch(/^music\/focused-/);
    expect(chooseBed(m, 'caching')).toBe(a);
  });
  it('spreads different slugs over the beds of that mood', () => {
    const picks = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s) => chooseBed(m, s)));
    expect(picks.size).toBe(2);
  });
  it('falls back to any music, and to none when there is none', () => {
    expect(chooseBed(m, 'x', ['jazzy'])).toMatch(/^music\//);
    expect(chooseBed(parseManifest(MANIFEST.files.slice(3))!, 'x')).toBeNull();
    expect(chooseBed(null, 'x')).toBeNull();
  });
});

describe('soundBrief', () => {
  it('lists the beds and the effects the library has, and says so when it has none', () => {
    const t = soundBrief(parseManifest(MANIFEST)!);
    expect(t).toContain('music/calm-1.mp3');
    expect(t).toContain('focused');
    expect(t).toContain('pop');
    expect(t).toContain('land');
    expect(t).not.toContain('whoosh');
    expect(soundBrief(null)).toMatch(/no audio library/i);
  });
  it('knows the eight events', () => expect(SFX_EVENTS).toHaveLength(8));
});

describe('sound.json', () => {
  it('is read back as written, and null when absent', async () => {
    expect(await readSound('caching')).toBeNull();
    await writeSound('caching', { bed: 'music/calm-1.mp3' });
    expect(await readSound('caching')).toEqual({ bed: 'music/calm-1.mp3' });
    await writeSound('caching', { bed: null });
    expect(await readSound('caching')).toEqual({ bed: null });
  });
});

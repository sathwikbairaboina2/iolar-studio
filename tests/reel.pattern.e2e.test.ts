import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedPatternReel } from './helpers/pattern';

/**
 * One real pattern reel through the live service on 26200. Opt in with RUN_E2E=1 and point
 * E2E_PRESENTER at an mp4 and E2E_VO at an mp3 of the fixture script being read; whisper
 * and ffmpeg must be on this machine. Everything else in the suite fakes the service.
 */
const live = process.env.RUN_E2E === '1';

describe.skipIf(!live)('pattern reel end to end (RUN_E2E=1, reels-templates on 26200)', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'e2e-'));
  });

  it('validates, renders and brings the mp4 home', async () => {
    await seedPatternReel({ sections: true });
    const { reelPresenterFile, reelVoFile, reelExportDir } = await import('@/lib/paths');
    const clip = process.env.E2E_PRESENTER;
    const vo = process.env.E2E_VO;
    if (!clip || !vo) throw new Error('set E2E_PRESENTER and E2E_VO to an mp4 and an mp3 on disk');
    writeFileSync(reelPresenterFile('t'), readFileSync(clip));
    writeFileSync(reelVoFile('t'), readFileSync(vo));
    const { alignExistingVoice } = await import('@/lib/reel/voice');
    await alignExistingVoice('t');
    const { renderPattern, pollRender } = await import('@/lib/reel/pattern/run');
    let s = await renderPattern('t');
    expect(s.stage).toBe('rendering');
    for (let i = 0; i < 120 && s.stage === 'rendering'; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      s = await pollRender('t');
    }
    expect(s.stage).toBe('done');
    expect(existsSync(path.join(reelExportDir('t'), 'reel.mp4'))).toBe(true);
  }, 900_000);
});

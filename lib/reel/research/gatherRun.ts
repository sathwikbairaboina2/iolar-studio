import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { getSettings } from '@/lib/settings';
import { reelEvidenceDir } from '@/lib/paths';
import type { Candidate } from './candidate';
import { assertNoMediaDownload, buildTranscriptArgs, evidenceFromVtt } from './gather';
import { writeEvidence } from './store';

/**
 * Reads every kept source. Downloads none of them.
 *
 * A YouTube source contributes its subtitle track, so the script can quote what
 * was actually said with a timestamp, having fetched no video. Everything else
 * contributes its page text.
 *
 * A source that cannot be read is recorded as `summary-only` and the run
 * continues: that candidate still carries the critic's pull quotes, so it can be
 * cited, it simply cannot be quoted verbatim. One unreachable page must not cost
 * the whole stage.
 */

const YOUTUBE = /(?:youtube\.com|youtu\.be)/i;
const FETCH_TIMEOUT_MS = 30_000;

function ytDlp(args: string[], ytDlpPath: string): Promise<void> {
  // The guard runs before the spawn, never after: its whole purpose is to sit
  // between an argument list and a process that could download a video.
  assertNoMediaDownload(args);

  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, { windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('yt-dlp timed out'));
    }, FETCH_TIMEOUT_MS * 4);

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 200)}`));
      resolve();
    });
  });
}

/** Whatever subtitle file yt-dlp settled on for this candidate. */
async function findVtt(dir: string, candidateId: string): Promise<string | null> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const hit = names.find((n) => n.startsWith(candidateId) && n.endsWith('.vtt'));
  return hit ? path.join(dir, hit) : null;
}

async function pageText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // 200k, not 20k: NIST SP 800-63B is 354 KB and its memorized-secrets section sat past
    // the old cap, so the verifier flagged true lines. Passages are chunked from all of
    // this; only the prompt window stays small.
    .slice(0, 200_000);
}

export type GatherReport = { transcript: number; pagetext: number; summaryOnly: number };

export async function gatherEvidence(slug: string, candidates: Candidate[]): Promise<GatherReport> {
  const dir = reelEvidenceDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const { ytDlpPath } = { ytDlpPath: 'yt-dlp', ...(getSettings() as { ytDlpPath?: string }) };
  const report: GatherReport = { transcript: 0, pagetext: 0, summaryOnly: 0 };

  for (const candidate of candidates) {
    const at = new Date();
    try {
      if (YOUTUBE.test(candidate.canonicalUrl)) {
        await ytDlp(buildTranscriptArgs(candidate.canonicalUrl, path.join(dir, candidate.id)), ytDlpPath);
        const vtt = await findVtt(dir, candidate.id);
        if (!vtt) throw new Error('no subtitle track available');
        await writeEvidence(slug, evidenceFromVtt(candidate.id, await fs.readFile(vtt, 'utf8'), at));
        await fs.rm(vtt, { force: true });
        report.transcript += 1;
      } else {
        await writeEvidence(slug, {
          candidateId: candidate.id,
          kind: 'pagetext',
          retrievedAt: at.toISOString(),
          text: await pageText(candidate.canonicalUrl),
          segments: null,
        });
        report.pagetext += 1;
      }
    } catch {
      await writeEvidence(slug, {
        candidateId: candidate.id,
        kind: 'summary-only',
        retrievedAt: at.toISOString(),
        text: '',
        segments: null,
      });
      report.summaryOnly += 1;
    }
  }

  return report;
}

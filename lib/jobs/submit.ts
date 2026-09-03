import * as ledger from './ledger';
import {
  BoardDown, readLines, runStage, submitJobs, submitScript, submitVoice, type BoardOpts,
} from './board';
import { ownVoiceBytes } from './ownVoice';
import { recordLines, type Speaker } from './voice';
import { speak } from '@/lib/reel/tts';
import { getSettings } from '@/lib/settings';
import type { RejectedRow, ReelJob } from './reelSchema';

/**
 * Submit: the studio's whole job for a cut, in order. Post the prepared list as the
 * board's jobs.json; summarise; plan for the chosen style; let the plugin write the
 * lines; record every line with the studio's voice; post the lines with their
 * recordings (the plugin cuts the slides to them); start the build. Every reply is
 * recorded. A thin cut is refused before any call unless forced. The cut's status
 * follows the board: submitted, summarised, planned, scripted, voiced, building, or
 * failed with the message in the last submission.
 */

export class CutNotSubmittable extends Error {}

export type SubmitOpts = BoardOpts & {
  force?: boolean;
  now?: Date;
  /** The style pack to plan and render in; settings.jobsStyle by default. */
  style?: string;
  /**
   * 'own' sends the recording dropped on the cut; 'studio' records the lines here;
   * 'plugin' leaves the voice to the plugin's own synthesiser. Unset: 'own' when a
   * recording was dropped, else settings.jobsVoice.
   */
  voice?: 'own' | 'studio' | 'plugin';
  speaker?: Speaker;
  record?: (cut: ledger.Cut, pullId: number | null) => Promise<void>;
};

export async function submitCut(id: number, opts: SubmitOpts = {}): Promise<{ cut: ledger.Cut; submissions: ledger.Submission[] }> {
  const cut = ledger.getCut(id);
  if (!cut) throw new CutNotSubmittable(`no cut ${id}`);
  if (cut.status === 'thin' && !opts.force) {
    throw new CutNotSubmittable(`cut ${cut.periodKey} is thin (${cut.counted} rows); submit with force to send it anyway`);
  }
  const settings = getSettings();
  const style = opts.style ?? settings.jobsStyle;
  const own = ownVoiceBytes(cut.periodKey);
  const voice = opts.voice ?? (own ? 'own' : settings.jobsVoice);
  if (voice === 'own' && !own) throw new CutNotSubmittable(`cut ${cut.periodKey} has no recording dropped on it`);
  const now = (opts.now ?? new Date()).toISOString();
  const rows = ledger.cutRows(id);
  const jobs = rows.filter((r) => r.row).map((r) => r.row as unknown as ReelJob);
  const rejected: RejectedRow[] = rows
    .filter((r) => !r.row)
    .map((r, i) => ({ row: i + 1, why: r.rejectReason ?? 'rejected', raw: { researchId: String(r.researchId) } }));
  const pull = ledger.lastPull();

  const body = {
    importedAt: now,
    source: { kind: 'studio', cutId: cut.id, pulledAt: pull?.at ?? now },
    jobs,
    rejected,
    warnings: cut.status === 'thin' ? [`thin cut: ${cut.counted} rows`] : [],
    brief: cut.briefMd ?? undefined,
    force: opts.force === true,
  };

  const record = (accepted: number, stage: string | null, reply: unknown, error: string | null) =>
    ledger.addSubmission({ cutId: id, at: new Date().toISOString(), accepted, rejected: rejected.length, stage, reply, error });
  const fail = (stage: string | null, reply: unknown, error: string) => {
    record(jobs.length, stage, reply, error);
    ledger.setCutStatus(id, 'failed');
    return done(id);
  };
  const oops = (err: unknown) => (err instanceof BoardDown ? err.message : String(err instanceof Error ? err.message : err));

  // 1. the list
  let reply;
  try {
    reply = await submitJobs(cut.periodKey, body, opts);
  } catch (err) {
    return fail(null, null, oops(err));
  }
  if (!reply.ok) return fail(null, reply, reply.message ?? `the board answered ${reply.status}`);
  record(reply.counted ?? jobs.length, 'imported', reply, null);
  ledger.setCutStatus(id, 'submitted');

  // 2. summarise, 3. plan for the style, 4. script: the board's own stages, one call each
  for (const [stage, status] of [
    ['summarise', 'summarised'],
    ['plan', 'planned'],
    ['script', 'scripted'],
  ] as const) {
    let out;
    try {
      out = await runStage(cut.periodKey, stage, { ...opts, style: stage === 'plan' ? style : undefined });
    } catch (err) {
      return fail(stage, null, oops(err));
    }
    if (!out.ok) return fail(stage, out, out.message ?? `${stage} refused`);
    record(jobs.length, stage, out, null);
    ledger.setCutStatus(id, status);
  }

  // 5. the voice: the user's own recording of the whole reel, sent as it is...
  if (voice === 'own' && own) {
    try {
      const out = await submitVoice(cut.periodKey, own, opts);
      if (!out.ok) return fail('voice', out, out.message ?? 'the board refused the recording');
      record(jobs.length, 'voice', { ...out, provider: 'own', format: own.format, bytes: own.bytes.length }, null);
      ledger.setCutStatus(id, 'voiced');
    } catch (err) {
      return fail('voice', null, oops(err));
    }
  }

  // ...or the studio reads every line and sends the recordings back
  if (voice === 'studio') {
    try {
      const lines = await readLines(cut.periodKey, opts);
      const speaker: Speaker = opts.speaker
        ?? ((text, mp3) => speak(text, mp3, { voice: settings.jobsKokoroVoice, speed: settings.jobsKokoroSpeed }));
      const recorded = await recordLines(lines.lines, { speaker });
      const out = await submitScript(cut.periodKey, { style, provider: `studio-${recorded.provider ?? 'voice'}`, lines: recorded.lines }, opts);
      if (!out.ok) return fail('voice', out, out.message ?? 'the board refused the recordings');
      record(jobs.length, 'voice', { ...out, provider: recorded.provider, lines: recorded.lines.length }, null);
      ledger.setCutStatus(id, 'voiced');
    } catch (err) {
      return fail('voice', null, oops(err));
    }
  }

  // 6. the build, detached on the board; the week row reports where it is
  try {
    const out = await runStage(cut.periodKey, 'build', opts);
    if (!out.ok) return fail('build', out, out.message ?? 'the board refused to build');
    record(jobs.length, 'build', out, null);
    ledger.setCutStatus(id, 'building');
  } catch (err) {
    return fail('build', null, oops(err));
  }

  const final = ledger.getCut(id)!;
  if (opts.record) await opts.record(final, pull?.id ?? null).catch(() => {});
  return done(id);
}

function done(id: number) {
  return { cut: ledger.getCut(id)!, submissions: ledger.submissionsFor(id) };
}

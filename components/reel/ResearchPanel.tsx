'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Select, Space, Steps, Tag, Tooltip, Typography } from 'antd';
import type { Brief } from '@/lib/reel/research/brief';
import { SOURCE_CLASSES } from '@/lib/reel/research/brief';
import type { Candidate } from '@/lib/reel/research/candidate';
import type { Script, ScriptLine } from '@/lib/reel/research/script';
import { canApprove, citationsFor, dropLine, spokenWordCount, uncitedLines } from '@/lib/reel/research/scriptBoard';

/**
 * Topic to approved script, inside the studio.
 *
 * The server owns the state machine; this panel asks where the run stopped and
 * draws that stage. It never decides what runs next, so a refresh mid-research
 * loses nothing.
 *
 * It ends at an approved script. Turning that script into a reel is the next
 * thing you do, not something this panel does for you.
 */

type Status = Brief['status'] | null;

const STAGES = ['briefed', 'critiqued', 'reviewed', 'gathered', 'drafted', 'approved'] as const;
const STEP_LABELS = ['Brief', 'Research', 'Review', 'Evidence', 'Script', 'Done'];

/** What the five questions collect, before it becomes a Brief. */
type Answers = {
  angle: string;
  audience: string;
  mustProve: string;
  mustInclude: string;
  avoid: string;
  recencyWindowDays: number;
  sourceClasses: string[];
};

const EMPTY: Answers = {
  angle: '',
  audience: '',
  mustProve: '',
  mustInclude: '',
  avoid: '',
  recencyWindowDays: 90,
  sourceClasses: ['youtube', 'news', 'blog', 'github', 'docs'],
};

const QUESTIONS: { key: keyof Answers; label: string; hint: string }[] = [
  { key: 'angle', label: 'What is this video arguing, beyond the subject?', hint: 'The claim, not the topic.' },
  { key: 'audience', label: 'Who is it for?', hint: 'Who needs to already care.' },
  {
    key: 'mustProve',
    label: 'What must the sources prove? One per line, two to five.',
    hint: 'If the research cannot back these, you want to know early.',
  },
  { key: 'mustInclude', label: 'Which names, products or people must appear?', hint: 'Comma separated. Optional.' },
  { key: 'avoid', label: 'Anything to avoid?', hint: 'A framing already used, a stale narrative. Optional.' },
];

export default function ResearchPanel({ slug, onApproved }: { slug: string; onApproved?: (script: Script) => void }) {
  const [status, setStatus] = useState<Status>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [keeps, setKeeps] = useState<Record<string, boolean>>({});
  const [script, setScript] = useState<Script | null>(null);
  const [lines, setLines] = useState<ScriptLine[]>([]);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const data = await fetch(`/api/reel/${slug}/research`).then((r) => r.json());
    setStatus(data.status ?? null);
    setBrief(data.brief ?? null);
    setCandidates(data.candidates ?? []);
    if (data.script) {
      setScript(data.script);
      setLines(data.script.lines);
    }
    if (data.candidates?.length && Object.keys(keeps).length === 0) {
      setKeeps(
        Object.fromEntries(
          (data.candidates as Candidate[]).map((c) => [
            c.id,
            data.selection?.decisions?.[c.id]?.state
              ? data.selection.decisions[c.id].state === 'keep'
              : c.verdict !== 'reject',
          ])
        )
      );
    }
    setLoaded(true);
  }, [slug, keeps]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Only on mount: load() closes over keeps, and re-running would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const call = async (path: string, init: RequestInit, label: string) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(`/api/reel/${slug}/research${path}`, {
        headers: { 'content-type': 'application/json' },
        ...init,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `${label} failed`);
        return null;
      }
      return data;
    } finally {
      setBusy(null);
    }
  };

  const saveBrief = async () => {
    const mustProve = answers.mustProve.split('\n').map((s) => s.trim()).filter(Boolean);
    if (mustProve.length < 2) return setError('Give at least two things the sources must prove.');

    const payload = {
      runId: slug,
      createdAt: new Date().toISOString(),
      topic: brief?.topic ?? slug.replace(/-/g, ' '),
      angle: answers.angle.trim(),
      audience: answers.audience.trim(),
      videoFormat: 'reel',
      mustProve,
      mustInclude: answers.mustInclude.split(',').map((s) => s.trim()).filter(Boolean),
      avoid: answers.avoid.split(',').map((s) => s.trim()).filter(Boolean),
      recencyWindowDays: answers.recencyWindowDays,
      sourceClasses: answers.sourceClasses,
      // Claude drafts the real queries during the hunt; these seed each class.
      searchQueries: answers.sourceClasses.map((c) => ({ class: c, queries: [answers.angle.trim() || slug] })),
      referenceReel: null,
      status: 'briefed',
    };
    if (await call('/run', { method: 'POST', body: JSON.stringify({ brief: payload }) }, 'brief')) await load();
  };

  const advance = async () => {
    if (await call('/run', { method: 'POST', body: JSON.stringify({}) }, 'run')) await load();
  };

  const saveReview = async () => {
    const decisions = Object.fromEntries(
      candidates.map((c) => [c.id, { state: keeps[c.id] ? 'keep' : 'reject', starred: false, note: null }])
    );
    if (await call('/selection', { method: 'PUT', body: JSON.stringify({ decisions }) }, 'review')) await load();
  };

  const saveScript = async () =>
    call('/script', { method: 'PUT', body: JSON.stringify({ lines }) }, 'script').then(async (d) => {
      if (d) await load();
      return d;
    });

  const approve = async () => {
    if (!(await saveScript())) return;
    const done = await call('/script/approve', { method: 'POST' }, 'approve');
    if (done) {
      await load();
      if (script) onApproved?.({ ...script, lines, status: 'approved' });
    }
  };

  const stepIndex = status ? STAGES.indexOf(status as (typeof STAGES)[number]) + 1 : 0;
  const uncited = useMemo(() => new Set(uncitedLines(lines)), [lines]);
  const keptCount = Object.values(keeps).filter(Boolean).length;

  if (!loaded) return <Empty description="loading research…" />;

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle" data-testid="research-panel">
      <Steps
        size="small"
        current={Math.max(0, stepIndex - 1)}
        items={STEP_LABELS.map((title) => ({ title }))}
      />

      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} />}

      {/* Stage 1 — the five questions, one at a time. */}
      {!status && (
        <Card size="small" title={`Brief · question ${step + 1} of ${QUESTIONS.length}`}>
          <Space orientation="vertical" style={{ width: '100%' }} size="small">
            <Typography.Text strong>{QUESTIONS[step].label}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {QUESTIONS[step].hint}
            </Typography.Text>
            <Input.TextArea
              data-testid={`brief-${QUESTIONS[step].key}`}
              autoSize={{ minRows: 2, maxRows: 6 }}
              value={String(answers[QUESTIONS[step].key] ?? '')}
              onChange={(e) => setAnswers({ ...answers, [QUESTIONS[step].key]: e.target.value })}
            />

            {step === QUESTIONS.length - 1 && (
              <>
                <Typography.Text strong>Where should it look?</Typography.Text>
                <Select
                  mode="multiple"
                  style={{ width: '100%' }}
                  value={answers.sourceClasses}
                  options={SOURCE_CLASSES.map((c) => ({ label: c, value: c }))}
                  onChange={(v) => setAnswers({ ...answers, sourceClasses: v })}
                />
              </>
            )}

            <Space>
              <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
                Back
              </Button>
              {step < QUESTIONS.length - 1 ? (
                <Button type="primary" onClick={() => setStep(step + 1)}>
                  Next
                </Button>
              ) : (
                <Button data-testid="brief-save" type="primary" loading={busy === 'brief'} onClick={saveBrief}>
                  Save brief
                </Button>
              )}
            </Space>
          </Space>
        </Card>
      )}

      {status === 'briefed' && (
        <Card size="small" title="Ready to research">
          <Typography.Paragraph type="secondary">
            Claude will dispatch one hunter per source class, then judge everything it found. This takes a
            few minutes.
          </Typography.Paragraph>
          <Button data-testid="research-run" type="primary" loading={busy === 'run'} onClick={advance}>
            Research {brief?.sourceClasses.length ?? 0} source classes
          </Button>
        </Card>
      )}

      {/* Gate — nothing is gathered or written until you have kept something. */}
      {(status === 'critiqued' || status === 'hunted') && (
        <Card size="small" title={`Review · keeping ${keptCount} of ${candidates.length}`}>
          <Space orientation="vertical" style={{ width: '100%' }} size="small">
            {candidates.map((c) => (
              <div
                key={c.id}
                style={{
                  border: '1px solid var(--border, #e5e5e7)',
                  borderRadius: 6,
                  padding: 8,
                  opacity: keeps[c.id] ? 1 : 0.45,
                }}
              >
                <Space wrap>
                  <Tag>{c.sourceClass}</Tag>
                  <Tag color={c.verdict === 'keep' ? 'green' : c.verdict === 'maybe' ? 'gold' : 'red'}>
                    {c.verdict} · {c.scoreTotal}
                  </Tag>
                  <Typography.Text strong>{c.title}</Typography.Text>
                  <Typography.Text type="secondary">{c.publisher}</Typography.Text>
                </Space>
                <div style={{ fontSize: 12, margin: '4px 0' }}>{c.summary}</div>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {c.whyItMatters}
                </Typography.Text>
                <div style={{ marginTop: 6 }}>
                  <Button size="small" onClick={() => setKeeps({ ...keeps, [c.id]: !keeps[c.id] })}>
                    {keeps[c.id] ? 'drop' : 'keep'}
                  </Button>
                </div>
              </div>
            ))}
            <Button
              data-testid="review-save"
              type="primary"
              disabled={keptCount === 0}
              loading={busy === 'review'}
              onClick={saveReview}
            >
              Keep {keptCount} and continue
            </Button>
          </Space>
        </Card>
      )}

      {status === 'reviewed' && (
        <Card size="small" title="Read the sources">
          <Typography.Paragraph type="secondary">
            Transcripts and page text, so the script can quote what was actually said. No video is
            downloaded.
          </Typography.Paragraph>
          <Button type="primary" loading={busy === 'run'} onClick={advance}>
            Gather evidence
          </Button>
        </Card>
      )}

      {status === 'gathered' && (
        <Card size="small" title="Write the script">
          <Button data-testid="script-draft" type="primary" loading={busy === 'run'} onClick={advance}>
            Draft from {candidates.filter((c) => keeps[c.id]).length} sources
          </Button>
        </Card>
      )}

      {(status === 'drafted' || status === 'approved') && script && (
        <Card
          size="small"
          title={`Script · ${lines.length} lines · ${spokenWordCount(lines)} words`}
          extra={<Tag color={status === 'approved' ? 'green' : 'default'}>{script.status}</Tag>}
        >
          <Space orientation="vertical" style={{ width: '100%' }} size="small">
            {uncited.size > 0 && (
              <Alert
                type="error"
                showIcon
                message={`${uncited.size} line(s) claim something with no source.`}
                description="Cite them, or mark them as commentary if they are your opinion rather than a finding."
              />
            )}
            {script.unsupported.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="The brief asked this script to prove things it does not say"
                description={
                  <ul style={{ margin: '4px 0 0 16px' }}>
                    {script.unsupported.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                }
              />
            )}

            {lines.map((line) => (
              <div
                key={line.id}
                style={{
                  border: `1px solid ${uncited.has(line.id) ? '#ff4d4f' : 'var(--border, #e5e5e7)'}`,
                  borderRadius: 6,
                  padding: 8,
                }}
              >
                <Space wrap size={4} style={{ marginBottom: 4 }}>
                  <Tag>{line.role}</Tag>
                  {uncited.has(line.id) && <Tag color="red">needs a source</Tag>}
                  {line.commentary && <Tag>commentary</Tag>}
                  {citationsFor(line, candidates).map((c) => (
                    <Tooltip key={c.id} title={c.title}>
                      <Tag color={c.missing ? 'red' : 'blue'}>{c.publisher}</Tag>
                    </Tooltip>
                  ))}
                </Space>
                <Input.TextArea
                  data-testid={`research-line-${line.id}`}
                  value={line.text}
                  readOnly={status === 'approved'}
                  autoSize={{ minRows: 1, maxRows: 5 }}
                  onChange={(e) =>
                    setLines(lines.map((l) => (l.id === line.id ? { ...l, text: e.target.value } : l)))
                  }
                />
                {status !== 'approved' && (
                  <Space size={4} style={{ marginTop: 4 }}>
                    <Button
                      size="small"
                      onClick={() =>
                        setLines(lines.map((l) => (l.id === line.id ? { ...l, commentary: !l.commentary } : l)))
                      }
                    >
                      {line.commentary ? 'mark as claim' : 'mark as commentary'}
                    </Button>
                    <Button size="small" danger onClick={() => setLines(dropLine(lines, line.id))}>
                      drop
                    </Button>
                  </Space>
                )}
              </div>
            ))}

            {status !== 'approved' && (
              <Space>
                <Button loading={busy === 'script'} onClick={saveScript}>
                  Save
                </Button>
                <Tooltip title={canApprove({ lines, status: script.status }) ? '' : 'Every line needs a source'}>
                  <Button
                    data-testid="research-approve"
                    type="primary"
                    disabled={!canApprove({ lines, status: script.status })}
                    loading={busy === 'approve'}
                    onClick={approve}
                  >
                    Approve script
                  </Button>
                </Tooltip>
              </Space>
            )}

            {status === 'approved' && (
              <Alert
                type="success"
                showIcon
                message="Script approved"
                description="This is where the research ends. Take it to Voice, then Shots, to build the reel."
              />
            )}
          </Space>
        </Card>
      )}
    </Space>
  );
}

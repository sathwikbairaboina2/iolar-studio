'use client';
import React from 'react';
import { Alert, Button, Card, Col, Empty, Input, Row, Segmented, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ago } from '@/lib/explainer/browse';
import { CRITERIA } from '@/lib/explainer2/rubric';
import { scriptWords, wordBudget } from '@/lib/explainer2/budget';
import { STAGES, type Stage } from '@/lib/explainer2/schema';
import { captionMethod, type CaptionMethod } from '@/lib/explainer2/timing';
import ScriptEditor from './ScriptEditor';
import { useDesigned } from './useDesigned';

const COLOUR: Record<string, string> = { pending: 'default', running: 'processing', done: 'green', failed: 'red', blocked: 'orange' };
const LABEL: Record<Stage, string> = { brief: 'Brief', script: 'Script', factcheck: 'Fact check', voice: 'Voice', design: 'Design', gates: 'Checks', critic: 'Critic', render: 'Render' };

const METHOD: Record<CaptionMethod, { label: string; color: string }> = {
  whisper: { label: 'whisper', color: 'green' },
  even: { label: 'even spread (whisper not used)', color: 'orange' },
  mixed: { label: 'mixed whisper and even', color: 'orange' },
  none: { label: 'no word timing (older video)', color: 'default' },
};

export default function DesignedExplainer() {
  const { slug } = useParams<{ slug: string }>();
  const { data, missing, busy, act, saveScript } = useDesigned(slug);
  const [saving, setSaving] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [kind, setKind] = React.useState<'visual' | 'wording'>('visual');
  const [from, setFrom] = React.useState<Stage>('design');
  const [pickedBed, setPickedBed] = React.useState<string | null | undefined>(undefined);

  if (missing) return <Empty description="There is no explainer with that name." />;
  if (!data) return <Typography.Text type="secondary">Loading…</Typography.Text>;

  const { job, script, factcheck, timing, stills, voice, critic, strips, sound } = data;
  const method = METHOD[captionMethod(timing)];
  const bed = pickedBed ?? sound.bed;
  const stamp = encodeURIComponent(job.updatedAt);
  const failed = STAGES.map((s) => [s, job.stages[s]] as const).find(([, st]) => st.status === 'failed');
  const blocked = job.stages.factcheck.status === 'blocked';
  const rendered = Boolean(job.renderId);
  const pending = STAGES.some((s) => job.stages[s].status !== 'done');

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Link href="/explainers" style={{ fontSize: 12 }}>← Explainers</Link>
        <Typography.Title level={3} style={{ margin: 0 }}>{script?.title ?? data.brief.topic}</Typography.Title>
        <Typography.Text type="secondary">
          {data.brief.audience} · {data.brief.seconds}s target · {data.brief.claim} · updated {ago(job.updatedAt)}
          {script ? ` · ${scriptWords(script)} words of ${wordBudget(data.brief.seconds)}` : ''}
          {timing ? ` · ${(timing.totalFrames / timing.fps).toFixed(1)}s` : ''}
        </Typography.Text>
      </div>

      <Card size="small">
        <Space wrap size={[8, 8]}>
          {STAGES.map((s) => (
            <Tag key={s} color={COLOUR[job.stages[s].status]} style={{ marginInlineEnd: 0 }}>
              {LABEL[s]} · {job.stages[s].status}
            </Tag>
          ))}
        </Space>
        <div style={{ marginTop: 12 }}>
          <Space wrap>
            <Button type="primary" disabled={busy || !pending} loading={busy} onClick={() => void act('run', {}, 'running the pending stages')}>
              {busy ? 'Running' : failed ? 'Retry' : 'Run pending stages'}
            </Button>
            <Select<Stage>
              value={from}
              onChange={setFrom}
              disabled={busy}
              style={{ width: 150 }}
              options={STAGES.filter((s) => s !== 'brief').map((s) => ({ value: s, label: `from ${LABEL[s]}` }))}
            />
            <Button disabled={busy} onClick={() => void act('run', { from }, `running from ${LABEL[from]}`)}>Re-run</Button>
          </Space>
        </div>
      </Card>

      {failed ? (
        <Alert type="error" showIcon title={`${LABEL[failed[0]]} failed`} description={<pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{failed[1].error}</pre>} />
      ) : null}

      {factcheck && (!factcheck.ok || blocked) ? (
        <Alert
          type={blocked ? 'warning' : 'info'}
          showIcon
          title={blocked ? 'The fact check found problems that remain after a rewrite. Rendering is blocked.' : 'The fact check found problems'}
          description={
            <Space orientation="vertical" size={6}>
              {factcheck.issues.map((i, n) => (
                <div key={n}><Tag>{i.beat}</Tag><b>{i.claim}</b> {i.correction}</div>
              ))}
              {blocked ? (
                <Space>
                  <Typography.Text type="secondary">Edit the script below and save, or accept them as they are.</Typography.Text>
                  <Button size="small" disabled={busy} onClick={() => void act('override', undefined, 'accepted; continuing')}>Override and continue</Button>
                </Space>
              ) : null}
            </Space>
          }
        />
      ) : factcheck ? (
        <Alert type="success" showIcon title="The fact check found nothing to correct" />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          {script ? (
            <ScriptEditor
              script={script}
              disabled={busy}
              saving={saving}
              onSave={async (s) => { setSaving(true); try { await saveScript(s); } finally { setSaving(false); } }}
            />
          ) : (
            <Card size="small" title="Script"><Typography.Text type="secondary">Not written yet.</Typography.Text></Card>
          )}
        </Col>
        <Col xs={24} lg={10}>
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" title="Video">
              {rendered ? (
                <video key={job.renderId} controls style={{ width: '100%', maxHeight: 640, background: '#000' }} src={`/api/explainers2/${slug}/mp4?v=${job.renderId}`} poster={`/api/explainers2/${slug}/poster?v=${job.renderId}`} />
              ) : (
                <Typography.Text type="secondary">Not rendered yet.</Typography.Text>
              )}
            </Card>
            <Card size="small" title="Captions and sound">
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Caption timing </Typography.Text>
                  <Tag color={method.color}>{method.label}</Tag>
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Music bed</Typography.Text>
                  {sound.beds.length || sound.bed ? (
                    <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                      <Select<string>
                        style={{ flex: 1 }}
                        disabled={busy}
                        value={bed ?? ''}
                        onChange={(v) => setPickedBed(v === '' ? null : v)}
                        options={[{ value: '', label: 'No music' }, ...sound.beds.map((b) => ({ value: b.file, label: b.mood ? `${b.file} · ${b.mood}` : b.file }))]}
                      />
                      <Button
                        disabled={busy || pickedBed === undefined || pickedBed === sound.bed}
                        onClick={async () => { if (await act('bed', { bed: pickedBed }, 'changing the bed; rendering again')) setPickedBed(undefined); }}
                      >
                        Change bed
                      </Button>
                    </Space.Compact>
                  ) : (
                    <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>No audio library yet; the video is voice only.</Typography.Text></div>
                  )}
                </div>
              </Space>
            </Card>
            <Card size="small" title="Critic" extra={critic ? <Tag color={critic.pass ? 'green' : 'orange'}>{critic.pass ? 'passed' : 'under 8'} · {critic.rounds.length} round{critic.rounds.length === 1 ? '' : 's'}</Tag> : null}>
              {critic ? (
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                  <Space wrap size={[6, 6]}>
                    {CRITERIA.map((c) => (
                      <Tooltip key={c.key} title={c.rule}>
                        <Tag color={critic.scores[c.key] >= 8 ? 'green' : 'orange'} style={{ marginInlineEnd: 0 }}>{c.key} {critic.scores[c.key]}</Tag>
                      </Tooltip>
                    ))}
                  </Space>
                  {critic.fixes.length ? (
                    <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12 }}>
                      {critic.fixes.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  ) : null}
                </Space>
              ) : (
                <Typography.Text type="secondary">Not scored yet.</Typography.Text>
              )}
            </Card>
            <Card size="small" title="Revise">
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Segmented value={kind} onChange={(v) => setKind(v as 'visual' | 'wording')} options={[{ value: 'visual', label: 'Look' }, { value: 'wording', label: 'Wording' }]} />
                <Input.TextArea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={kind === 'visual' ? 'What should look different?' : 'What should it say differently? (the voice and design run again)'}
                  autoSize={{ minRows: 3, maxRows: 6 }}
                />
                <Button disabled={busy || !notes.trim() || !script} onClick={async () => { if (await act('revise', { notes, kind }, 'revising')) setNotes(''); }}>Revise</Button>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>

      {strips.length ? (
        <Card size="small" title="Motion strips: six frames per beat, left to right and top to bottom">
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
            {strips.map((f) => (
              <div key={f} style={{ flex: '0 0 auto', width: 300 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/explainers2/${slug}/strips/${f}?v=${stamp}`} alt={f} style={{ width: '100%', borderRadius: 8, display: 'block', border: '1px solid rgba(128,128,128,.3)' }} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{f.replace('.png', '')}</Typography.Text>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {voice.length ? (
        <Card size="small" title="Voice">
          <Row gutter={[12, 8]}>
            {voice.map((f) => {
              const id = f.replace('.mp3', '');
              const t = timing?.beats.find((b) => b.id === id);
              return (
                <Col key={f} xs={24} md={12}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{id}{t ? ` · ${((t.end - t.start) / (timing?.fps ?? 30)).toFixed(1)}s` : ''}</Typography.Text>
                                    <audio controls preload="none" src={`/api/explainers2/${slug}/voice/${f}?v=${stamp}`} style={{ width: '100%' }} />
                </Col>
              );
            })}
          </Row>
        </Card>
      ) : null}

      {stills.length ? (
        <Card size="small" title="Stills, middle of each beat">
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
            {stills.map((f) => (
              <div key={f} style={{ flex: '0 0 auto', width: 180 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/explainers2/${slug}/stills/${f}?v=${stamp}`} alt={f} style={{ width: '100%', borderRadius: 8, display: 'block', border: '1px solid rgba(128,128,128,.3)' }} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{f.replace('.png', '')}</Typography.Text>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </Space>
  );
}

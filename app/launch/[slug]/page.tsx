'use client';
import React from 'react';
import { Alert, Button, Card, Col, Empty, Input, Popover, Row, Select, Space, Steps, Tag, Typography } from 'antd';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ago } from '@/lib/explainer/browse';
import { LAUNCH_CRITERIA, LAUNCH_PASS } from '@/lib/launch/rubric';
import { STAGES, spent, type Asset, type Stage } from '@/lib/launch/schema';
import { useLaunch } from './useLaunch';

const WORK = STAGES.filter((s): s is Exclude<Stage, 'brief'> => s !== 'brief');
const LABEL: Record<Stage, string> = {
  brief: 'Brief', research: 'Research', script: 'Script', factcheck: 'Fact check', approve: 'Approval', voice: 'Voice', edit: 'Edit', assets: 'Assets', gates: 'Checks', render: 'Render', critic: 'Polish',
};

export default function LaunchReel() {
  const { slug } = useParams<{ slug: string }>();
  const { data, missing, busy, act } = useLaunch(slug);
  const [rewrite, setRewrite] = React.useState('');
  const [visual, setVisual] = React.useState('');
  const [from, setFrom] = React.useState<Stage>('edit');

  if (missing) return <Empty description="There is no launch reel with that name." />;
  if (!data) return <Typography.Text type="secondary">Loading…</Typography.Text>;

  const { job, brief, claims, script, factcheck, receipts, spend, assets, critic, props } = data;
  const stamp = encodeURIComponent(job.updatedAt);
  const firstOpen = WORK.find((s) => job.stages[s].status !== 'done');
  const current = firstOpen ? WORK.indexOf(firstOpen) : WORK.length;
  const failed = WORK.map((s) => [s, job.stages[s]] as const).find(([, st]) => st.status === 'failed');
  const awaiting = job.stages.approve.status === 'blocked';
  const factBlocked = job.stages.factcheck.status === 'blocked';
  const claimById = new Map((claims?.claims ?? []).map((c) => [c.id, c]));
  const pending = WORK.some((s) => job.stages[s].status !== 'done');

  const stepStatus = (s: Exclude<Stage, 'brief'>) => {
    const st = job.stages[s].status;
    if (st === 'failed') return 'error' as const;
    if (st === 'blocked') return 'wait' as const;
    if (st === 'running') return 'process' as const;
    return st === 'done' ? ('finish' as const) : ('wait' as const);
  };
  const stepNote = (s: Exclude<Stage, 'brief'>) => {
    const st = job.stages[s];
    if (s === 'approve' && st.status === 'blocked') return 'needs your approval';
    return st.error ? <span style={{ fontSize: 12 }}>{st.error.split('\n')[0]}</span> : undefined;
  };

  const balance = spend?.entries.findLast((e) => e.balanceAfter !== null)?.balanceAfter ?? null;
  const creditsLine = `Credits: ${Math.round(spent(spend ?? { budget: brief.creditBudget, entries: [] }) * 100) / 100} of ${spend?.budget ?? brief.creditBudget} spent${balance !== null ? ` · balance ${Math.round(balance * 100) / 100}` : ''}`;
  const assetRows = Object.entries(assets?.assets ?? {});

  const fixNotes = factcheck && factcheck.issues.length
    ? ['A fact check found these problems. Fix every one, keeping the rest of the script as it is:', ...factcheck.issues.map((i) => `- ${i.beat}: "${i.claim}" is wrong or unsupported. ${i.correction}`)].join('\n')
    : '';

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Link className="st-link" href="/launch" style={{ fontSize: 12 }}>← Launch reels</Link>
        <Typography.Title level={3} style={{ margin: 0 }}>{script?.headline ?? brief.title}</Typography.Title>
        <Typography.Text type="secondary">{brief.title} · {brief.seconds}s target · {brief.links.length ? `${brief.links.length} link${brief.links.length === 1 ? '' : 's'}` : brief.reference ? `paced like @${brief.reference.creator}` : '0 links'} · updated {ago(job.updatedAt)}</Typography.Text>
        {brief.mode === 'avatar' || spend ? <div><Typography.Text type="secondary">{creditsLine}</Typography.Text></div> : null}
      </div>

      <Card size="small">
        <Steps
          size="small"
          current={Math.min(current, WORK.length - 1)}
          items={WORK.map((s) => ({ title: LABEL[s], status: stepStatus(s), content: stepNote(s) }))}
          responsive
        />
        <div style={{ marginTop: 12 }}>
          <Button type="primary" disabled={busy || !pending || awaiting} loading={busy} onClick={() => void act('run', {}, 'running the pending stages')}>
            {busy ? 'Running' : failed ? 'Retry' : 'Run pending stages'}
          </Button>
        </div>
      </Card>

      {failed ? (
        <Alert type="error" showIcon title={`${LABEL[failed[0]]} failed`} description={<pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{failed[1].error}</pre>} />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" title="Script" extra={script ? <Tag color="red">{script.kicker}</Tag> : null}>
              {script ? (
                <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                  <Typography.Text strong>{script.headline}</Typography.Text>
                  {script.beats.map((b) => (
                    <div key={b.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                      <Tag style={{ marginInlineEnd: 0, minWidth: 64, textAlign: 'center' }}>{b.id}</Tag>
                      <div style={{ flex: 1 }}>
                        <div>{b.narration}</div>
                        <Space size={4} wrap style={{ marginTop: 4 }}>
                          {b.claims.map((id) => {
                            const c = claimById.get(id);
                            return (
                              <Popover
                                key={id}
                                title={c?.text ?? id}
                                content={c ? (
                                  <div style={{ maxWidth: 320 }}>
                                    <div style={{ fontStyle: 'italic', marginBottom: 6 }}>“{c.quote}”</div>
                                    <a href={c.url} target="_blank" rel="noreferrer">{c.url}</a>
                                  </div>
                                ) : 'not a claim'}
                              >
                                <Tag color="blue" style={{ marginInlineEnd: 0, cursor: 'help', fontSize: 11 }}>{id}</Tag>
                              </Popover>
                            );
                          })}
                        </Space>
                      </div>
                    </div>
                  ))}
                </Space>
              ) : (
                <Typography.Text type="secondary">Not written yet.</Typography.Text>
              )}
            </Card>

            {factcheck && !factcheck.ok ? (
              <Alert
                type={factBlocked ? 'warning' : 'info'}
                showIcon
                title={factBlocked ? 'The fact check found problems that remain after a rewrite.' : 'The fact check found problems'}
                description={
                  <Space orientation="vertical" size={6}>
                    {factcheck.issues.map((i, n) => (
                      <div key={n}><Tag>{i.beat}</Tag><b>{i.claim}</b> {i.correction}</div>
                    ))}
                    <Space>
                      <Button size="small" disabled={busy || !fixNotes} onClick={() => void act('revise', { notes: fixNotes, kind: 'wording' }, 'rewriting with these fixes')}>Rewrite with these fixes</Button>
                      <Button size="small" disabled={busy || !factBlocked} onClick={() => void act('override', undefined, 'accepted; continuing')}>Accept and continue</Button>
                    </Space>
                  </Space>
                }
              />
            ) : factcheck ? (
              <Alert type="success" showIcon title="The fact check found nothing to correct" />
            ) : null}

            {awaiting ? (
              <Card size="small" title="Approve the script">
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                  <Typography.Text type="secondary">Nothing is voiced until you approve. Read the script against its sources first.</Typography.Text>
                  <Button type="primary" disabled={busy} onClick={() => void act('approve', undefined, 'approved; voicing it')}>Approve script</Button>
                  <Input.TextArea value={rewrite} onChange={(e) => setRewrite(e.target.value)} placeholder="Or say what the script should do differently" autoSize={{ minRows: 2, maxRows: 5 }} />
                  <Button disabled={busy || !rewrite.trim()} onClick={async () => { if (await act('revise', { notes: rewrite, kind: 'wording' }, 'rewriting')) setRewrite(''); }}>Rewrite</Button>
                </Space>
              </Card>
            ) : null}

            {assetRows.length || assets?.notes.length ? (
              <Card size="small" title="Assets">
                <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                  {assets?.notes.map((n) => <Alert key={n} type="warning" showIcon title={`${n}. Every anchor scene used its free fallback.`} />)}
                  {assetRows.map(([id, a]) => (
                    <AssetRow key={id} slug={slug} id={id} asset={a} stamp={stamp} busy={busy} onRedo={() => void act(`assets/${id}/redo`, undefined, `making ${id} again`)} />
                  ))}
                </Space>
              </Card>
            ) : null}

            <Card size="small" title="Receipts">
              {receipts && Object.keys(receipts).length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                  {Object.values(receipts).map((r) => (
                    <div key={r.claim}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/launch/${slug}/receipts/${r.file}?v=${stamp}`} alt={r.claim} style={{ width: '100%', borderRadius: 6, display: 'block', border: '1px solid rgba(128,128,128,.3)' }} />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.claim} · {r.host}</Typography.Text>
                      {!r.focus ? <div><Tag color="red" style={{ marginInlineEnd: 0 }}>quote not found</Tag></div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <Typography.Text type="secondary">No screenshots yet.</Typography.Text>
              )}
            </Card>
          </Space>
        </Col>

        <Col xs={24} lg={10}>
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" title="Reel">
              {job.renderId ? (
                <video
                  key={job.renderId}
                  controls
                  style={{ width: '100%', maxHeight: '80vh', aspectRatio: '9 / 16', background: '#000' }}
                  src={`/api/launch/${slug}/mp4?v=${job.renderId}`}
                  poster={`/api/launch/${slug}/cover?v=${job.renderId}`}
                />
              ) : (
                <Typography.Text type="secondary">Not rendered yet.</Typography.Text>
              )}
            </Card>
            {critic ? (
              <Card size="small" title="Critic" extra={<Tag color={critic.pass ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>{critic.pass ? 'passed' : 'did not pass'} · {critic.rounds.length} round{critic.rounds.length === 1 ? '' : 's'}</Tag>}>
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                  {LAUNCH_CRITERIA.map((c) => {
                    const v = critic.scores[c.key] ?? 0;
                    const low = v < LAUNCH_PASS;
                    return (
                      <div key={c.key} title={c.rule} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ width: 70, fontSize: 12 }}>{c.key}</span>
                        <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(128,128,128,.2)' }}>
                          <div style={{ width: `${v * 10}%`, height: '100%', borderRadius: 4, background: low ? '#d4380d' : '#389e0d' }} />
                        </div>
                        <span style={{ width: 24, textAlign: 'right', fontSize: 12, color: low ? '#d4380d' : undefined }}>{v}</span>
                      </div>
                    );
                  })}
                  {critic.fixes.length ? (
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{critic.pass ? 'Last fixes asked for' : 'Still to fix'}</Typography.Text>
                      <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>{critic.fixes.map((f, n) => <li key={n} style={{ fontSize: 13 }}>{f}</li>)}</ul>
                    </div>
                  ) : null}
                  {props ? (
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                      {props.scenes.map((s, n) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={n} src={`/api/launch/${slug}/strips/${String(n).padStart(2, '0')}-${s.type}.png?v=${stamp}`} alt={`scene ${n} ${s.type}`} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ height: 96, borderRadius: 4, border: '1px solid rgba(128,128,128,.3)' }} />
                      ))}
                    </div>
                  ) : null}
                </Space>
              </Card>
            ) : null}
            {brief.speed === 'fast' && job.stages.render.status === 'done' ? (
              <Card size="small" title="Polish">
                <Space orientation="vertical" size={8}>
                  <Typography.Text type="secondary">A critic watches the render and fixes the edit, up to two rounds. The script stays as it is.</Typography.Text>
                  <Button disabled={busy} onClick={async () => { if (await act('speed', { speed: 'polish' })) await act('run', { from: 'critic' }, 'polishing the reel'); }}>Polish this reel</Button>
                </Space>
              </Card>
            ) : null}
            <Card size="small" title="Change the visuals">
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Input.TextArea value={visual} onChange={(e) => setVisual(e.target.value)} placeholder="What should look different? The edit is cut again; the voice stays." autoSize={{ minRows: 3, maxRows: 6 }} />
                <Button disabled={busy || !visual.trim() || !script} onClick={async () => { if (await act('revise', { notes: visual, kind: 'visual' }, 'cutting it again')) setVisual(''); }}>Change</Button>
              </Space>
            </Card>
            <Card size="small" title="Run again from">
              <Space>
                <Select<Stage>
                  value={from}
                  onChange={setFrom}
                  disabled={busy}
                  style={{ width: 160 }}
                  options={WORK.map((s) => ({ value: s, label: LABEL[s] }))}
                />
                <Button disabled={busy} onClick={() => void act('run', { from }, `running from ${LABEL[from]}`)}>Run</Button>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}

const SOURCE_TEXT: Record<Asset['source'], string> = {
  higgsfield: 'Higgsfield', lipsync: 'lip-sync (free)', still: 'still portrait (no clip made)', download: 'downloaded', oembed: 'X', swapped: 'swapped for a headline', refused: 'refused',
};
const SOURCE_COLOR: Record<Asset['source'], string> = { higgsfield: 'green', lipsync: 'blue', still: 'gold', download: 'green', oembed: 'green', swapped: 'gold', refused: 'red' };

/** One avatar clip, photo, demo clip or post: what it is, where it came from, and a button to make it again. */
function AssetRow({ slug, id, asset, stamp, busy, onRedo }: { slug: string; id: string; asset: Asset; stamp: string; busy: boolean; onRedo: () => void }) {
  const thumb: React.CSSProperties = { width: 54, aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(128,128,128,.3)', background: 'rgba(128,128,128,.12)', display: 'block' };
  const url = asset.file ? `/api/launch/${slug}/assets/${asset.file}?v=${stamp}` : null;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      {url && asset.file.endsWith('.png') ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={id} style={thumb} />
      ) : url ? (
        <video src={url} muted preload="metadata" style={thumb} />
      ) : (
        <div style={thumb} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div><Typography.Text strong>{id}</Typography.Text> <Tag color={SOURCE_COLOR[asset.source]} style={{ marginInlineEnd: 0 }}>{SOURCE_TEXT[asset.source]}</Tag></div>
        {asset.post ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{asset.post.handle}: {asset.post.text.slice(0, 80)}</Typography.Text> : null}
        {asset.reason ? <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{asset.reason}</Typography.Text></div> : null}
      </div>
      <Button size="small" disabled={busy} onClick={onRedo}>Make again</Button>
    </div>
  );
}

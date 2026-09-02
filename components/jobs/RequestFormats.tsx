'use client';
import React, { useEffect, useState } from 'react';
import { Alert, Card, Collapse, Space, Table, Tag, Typography } from 'antd';
import type { StyleSpec } from '@/lib/jobs/board';

/**
 * What the studio sends the jobs-reel plugin, per style, straight from the plugin's own
 * catalogue: a style belongs to a world, a world is a beat grammar, and the request for a
 * style is the list, then the lines with their recordings for exactly those beats.
 */

const STEPS: { step: string; who: string; call: string; what: string }[] = [
  { step: '1', who: 'studio', call: 'POST /api/jobs/pool/pull', what: 'Pull the research pool into the ledger (jobs_pool).' },
  { step: '2', who: 'studio', call: 'POST /api/jobs/cuts {kind}', what: 'Map the period\'s rows into the reel schema (rules, then one qwen call), compute the tiles, fetch the brief. A cut under the thin threshold waits for force.' },
  { step: '3', who: 'studio → plugin', call: 'POST /api/weeks/{week}/jobs', what: 'The list: jobs, rejected, warnings, source {kind: "studio", cutId, pulledAt}, brief. The plugin writes jobs.json and stops.' },
  { step: '4', who: 'plugin', call: 'POST /api/weeks/{week}/run {stage: "summarise"}', what: 'Counts, shares, top cities and employers, freshness, deadlines: summary.json.' },
  { step: '5', who: 'plugin', call: 'POST /api/weeks/{week}/run {stage: "plan", style}', what: 'The world for the style picks the scored highlights and lays the beats: reel.json. The beat ids here are what every later call names.' },
  { step: '6', who: 'plugin', call: 'POST /api/weeks/{week}/run {stage: "script"}', what: 'The plugin\'s writer gets the facts and, per beat, what its slide shows; one line per speaking beat inside its word budget.' },
  { step: '7', who: 'studio', call: 'GET /api/weeks/{week}/script', what: 'The lines, ready to record. The studio reads each with its own voice (kokoro, then piper, mastered).' },
  { step: '8', who: 'studio → plugin', call: 'POST /api/weeks/{week}/script {style, lines[{beatId, text, audio}]}', what: 'One recording per speaking beat. The plugin measures each and cuts the slide to it: 0.25 s lead, the line, 0.6 s pad, floored per role, on the frame grid. The reel is the sum.' },
  { step: '9', who: 'plugin', call: 'POST /api/weeks/{week}/run {stage: "build"}', what: 'Detached: render every scene on progress 0..1, captions spelled from the script and timed by whisper, composite. GET /api/weeks/{week}/build for the log; the week row shows running, done or failed.' },
];

export default function RequestFormats() {
  const [styles, setStyles] = useState<StyleSpec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch('/api/jobs/styles', { cache: 'no-store' });
        const d = (await r.json()) as { board: string; styles: StyleSpec[]; error?: string };
        if (!live) return;
        setBoard(d.board ?? '');
        setStyles(d.styles ?? []);
        if (d.error) setError(d.error);
      } catch (err) {
        if (live) setError(String(err instanceof Error ? err.message : err));
      }
    })();
    return () => { live = false; };
  }, []);

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }} data-testid="request-formats">
      <Card size="small" title="How a cut becomes a reel">
        <Table
          size="small"
          rowKey="step"
          pagination={false}
          dataSource={STEPS}
          columns={[
            { title: '#', dataIndex: 'step', width: 40 },
            { title: 'Who', dataIndex: 'who', width: 130, render: (w: string) => <Tag color={w.includes('plugin') && !w.includes('studio') ? 'purple' : w.includes('→') ? 'geekblue' : 'green'}>{w}</Tag> },
            { title: 'Call', dataIndex: 'call', width: 360, render: (c: string) => <code style={{ fontSize: 12 }}>{c}</code> },
            { title: 'What happens', dataIndex: 'what' },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0', fontSize: 12 }}>
          The studio's job is the data and the voice: the list in, the recordings in. The plugin owns the plan, the script, the picture and the export.
          Submit on a cut runs steps 3 to 9 in order and records every reply. Board: <code>{board || 'http://127.0.0.1:26100'}</code>; full schemas at <code>{(board || 'http://127.0.0.1:26100') + '/docs'}</code>.
        </Typography.Paragraph>
      </Card>

      {error && <Alert type="warning" showIcon title="The board is not answering" description={error} />}
      {styles === null && !error && <Typography.Text type="secondary">Loading the style catalogue from the board…</Typography.Text>}

      {styles && styles.length > 0 && (
        <Collapse
          items={styles.map((s) => ({
            key: s.style,
            label: (
              <span>
                <strong>{s.displayName}</strong> <Tag>{s.style}</Tag> <Tag color="purple">{s.world}</Tag>
                <Typography.Text type="secondary">{s.fixed.length} fixed beats · {s.elastic.slots.split(',')[0]} · captions {s.captionMode}</Typography.Text>
              </span>
            ),
            children: (
              <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <Typography.Text strong>Beats the plugin plans for this style</Typography.Text>
                  <Table
                    size="small"
                    rowKey={(b) => `${b.role}-${b.scene}`}
                    pagination={false}
                    dataSource={s.fixed}
                    style={{ marginTop: 6 }}
                    columns={[
                      { title: 'Role', dataIndex: 'role', width: 110 },
                      { title: 'Scene', dataIndex: 'scene', width: 200, render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code> },
                      { title: 'Planned s', dataIndex: 'seconds', width: 100 },
                    ]}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Plus the elastic block: {s.elastic.slots}; {s.elastic.secondsEach}{s.elastic.rehook ? `; re-hook ${s.elastic.rehook}` : ''}. Every spoken beat is later cut to its line.
                  </Typography.Text>
                </div>
                <div>
                  <Typography.Text strong>1 · the list</Typography.Text>
                  <pre style={{ fontSize: 12, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{`${s.request.jobs.method} ${s.request.jobs.path}\n${s.request.jobs.body}`}</pre>
                </div>
                <div>
                  <Typography.Text strong>2 · the lines with their recordings</Typography.Text>
                  <pre style={{ fontSize: 12, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{`${s.request.script.method} ${s.request.script.path}\n${JSON.stringify(s.request.script.body, null, 2)}`}</pre>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    The beat ids and word budgets for a real week come from <code>GET /api/weeks/{'{week}'}/request?style={s.style}</code>.
                  </Typography.Text>
                </div>
                <div>
                  <Typography.Text strong>3 · the build</Typography.Text>
                  <pre style={{ fontSize: 12, margin: '6px 0 0' }}>{`${s.request.build.method} ${s.request.build.path}\n${JSON.stringify(s.request.build.body)}`}</pre>
                </div>
              </Space>
            ),
          }))}
        />
      )}
    </Space>
  );
}

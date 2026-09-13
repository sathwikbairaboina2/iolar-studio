'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Drawer, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { message } from '@/lib/ui/message';
import { ExportOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { WeekRow, WeekStage } from '@/lib/jobs/board';
import type { Cut } from '@/lib/jobs/ledger';
import PoolPane, { type PoolStatus } from '@/components/jobs/PoolPane';
import CutsPane from '@/components/jobs/CutsPane';
import CutView, { type CutDetail } from '@/components/jobs/CutView';
import RequestFormats from '@/components/jobs/RequestFormats';
import JobCardPane from '@/components/jobs/JobCardPane';

/**
 * The bridge between the research pool and the jobs-reel board, run from one page:
 * pull the pool, prepare a cut, look at it, submit it, and watch the board's week
 * appear below. The plugin renders; the studio manages the data and the brief.
 */

type Row = WeekRow & { links: { board: string; reel: string; preview: string } };

const STAGE_COLOUR: Record<WeekStage, string> = {
  empty: 'default',
  imported: 'blue',
  planned: 'geekblue',
  scripted: 'purple',
  voiced: 'cyan',
  exported: 'green',
};

export default function JobsPage() {
  const router = useRouter();
  const [pool, setPool] = useState<PoolStatus | null>(null);
  const [pulling, setPulling] = useState(false);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [preparing, setPreparing] = useState<'weekly' | 'daily' | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<CutDetail | null>(null);
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [board, setBoard] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [styles, setStyles] = useState<{ style: string; world: string; displayName: string }[]>([]);
  const [style, setStyle] = useState<string>('paper-doodle');
  const [log, setLog] = useState<{ week: string; text: string; status: string | null } | null>(null);

  const refreshPool = useCallback(async () => {
    const r = await fetch('/api/jobs/pool', { cache: 'no-store' }).catch(() => null);
    if (r?.ok) setPool((await r.json()) as PoolStatus);
  }, []);
  const refreshCuts = useCallback(async () => {
    const r = await fetch('/api/jobs/cuts', { cache: 'no-store' }).catch(() => null);
    if (r?.ok) setCuts(((await r.json()) as { cuts: Cut[] }).cuts ?? []);
  }, []);
  const refreshDetail = useCallback(async (id: number | null) => {
    if (id === null) {
      setDetail(null);
      return;
    }
    const r = await fetch(`/api/jobs/cuts/${id}`, { cache: 'no-store' }).catch(() => null);
    if (r?.ok) setDetail((await r.json()) as CutDetail);
  }, []);
  const refreshBoard = useCallback(async () => {
    try {
      const r = await fetch('/api/jobs/weeks', { cache: 'no-store' });
      const d = await r.json();
      setBoard(d.board ?? '');
      if (!r.ok) {
        setError(d.error ?? `the board answered ${r.status}`);
        setRows([]);
        return;
      }
      setError(null);
      setRows(d.weeks as Row[]);
    } catch (err) {
      setError(String(err));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshPool();
    void refreshCuts();
    void refreshBoard();
    void fetch('/api/jobs/styles', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { styles?: { style: string; world: string; displayName: string }[] }) => setStyles(d.styles ?? []))
      .catch(() => {});
  }, [refreshPool, refreshCuts, refreshBoard]);

  const openLog = async (week: string) => {
    const r = await fetch(`/api/jobs/weeks/${week}/build`, { cache: 'no-store' }).catch(() => null);
    const d = r ? ((await r.json()) as { build?: { status: string } | null; log?: string; error?: string }) : null;
    setLog({ week, text: d?.log ?? d?.error ?? 'no log yet', status: d?.build?.status ?? null });
  };

  // Force is a decision about one cut; choosing another cut clears it (see `choose`).
  const choose = (id: number | null) => {
    setSelected(id);
    setForce(false);
    void refreshDetail(id);
  };

  const pull = async () => {
    setPulling(true);
    try {
      const r = await fetch('/api/jobs/pool/pull', { method: 'POST' });
      const d = await r.json();
      if (d.error) message.error(d.error);
      else message.success(`pulled ${d.fetched}: ${d.added} new, ${d.refreshed} refreshed, ${d.closed} closed`);
    } finally {
      setPulling(false);
      await refreshPool();
    }
  };

  const prepare = async (kind: 'weekly' | 'daily') => {
    setPreparing(kind);
    try {
      const r = await fetch('/api/jobs/cuts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, force }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `answered ${r.status}`);
      const cut = d.cut as Cut;
      message[cut.status === 'thin' ? 'warning' : 'success'](`${cut.periodKey}: ${cut.counted} rows${cut.status === 'thin' ? ', thin' : ''}`);
      await refreshCuts();
      choose(cut.id);
    } catch (err) {
      message.error(String(err instanceof Error ? err.message : err));
    } finally {
      setPreparing(null);
    }
  };

  const submit = async () => {
    if (selected === null) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/jobs/cuts/${selected}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force, style }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const cut = d.cut as Cut;
      message[cut.status === 'failed' ? 'error' : 'success'](`${cut.periodKey} is ${cut.status}`);
    } catch (err) {
      message.error(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
      await Promise.all([refreshCuts(), refreshDetail(selected), refreshBoard()]);
    }
  };

  const dropVoice = async (file: File) => {
    if (selected === null) return;
    try {
      const r = await fetch(`/api/jobs/cuts/${selected}/voice?name=${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      message.success(`${file.name} will be the voice of this cut`);
    } catch (err) {
      message.error(String(err instanceof Error ? err.message : err));
    } finally {
      await refreshDetail(selected);
    }
  };

  const clearVoice = async () => {
    if (selected === null) return;
    await fetch(`/api/jobs/cuts/${selected}/voice`, { method: 'DELETE' }).catch(() => null);
    await refreshDetail(selected);
  };

  const run = async (week: string, stage: 'summarise' | 'plan' | 'script' | 'build') => {
    const key = `${week}:${stage}`;
    setRunning(key);
    try {
      const r = await fetch(`/api/jobs/weeks/${week}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(stage === 'plan' ? { stage, style } : { stage }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? d.message ?? `the board answered ${r.status}`);
      message.success(d.message ?? `${stage} ran for ${week}`);
      await refreshBoard();
    } catch (err) {
      message.error(String(err instanceof Error ? err.message : err));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Typography.Title level={3} style={{ margin: 0, flex: 1 }}>
          Jobs
        </Typography.Title>
        {board && (
          <Button icon={<ExportOutlined />} href={board} target="_blank">
            Open board
          </Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={() => void Promise.all([refreshPool(), refreshCuts(), refreshBoard(), refreshDetail(selected)])}>
          Refresh
        </Button>
      </div>

      {error && (
        <Alert
          type="warning"
          showIcon
          title="The jobs-reel board is not answering"
          description={
            <span>
              {error}. Start it from <a onClick={() => router.push('/plugins')}>Plugins</a>, or run <code>npm run dev</code> in{' '}
              <code>projects/plugins/jobs-reel-plugin</code>.
            </span>
          }
        />
      )}

      <Tabs
        defaultActiveKey="pipeline"
        items={[
          { key: 'pipeline', label: 'Pipeline', children: (
            <div style={{ display: 'grid', gap: 16 }}>
      <PoolPane pool={pool} pulling={pulling} onPull={() => void pull()} />
      <CutsPane cuts={cuts} preparing={preparing} selectedId={selected} boardBase={board} onPrepare={(k) => void prepare(k)} onSelect={choose} />
      {detail && (
        <div style={{ display: 'grid', gap: 8 }}>
          <Space size={8} data-testid="style-pick">
            <Typography.Text type="secondary">Style</Typography.Text>
            <Select
              size="small"
              style={{ minWidth: 220 }}
              value={style}
              onChange={setStyle}
              options={(styles.length ? styles : [{ style: 'paper-doodle', world: 'classic', displayName: 'Paper & Doodle' }]).map((s) => ({ value: s.style, label: `${s.displayName} · ${s.world}` }))}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Submit sends the list, plans in this style, lets the plugin write the lines, records them here, sends the recordings, and starts the build.</Typography.Text>
          </Space>
          <CutView
            detail={detail}
            submitting={submitting}
            force={force}
            onForce={setForce}
            onSubmit={() => void submit()}
            onVoice={(f) => void dropVoice(f)}
            onClearVoice={() => void clearVoice()}
          />
        </div>
      )}

      <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
        On the board
      </Typography.Title>
      <Table<Row>
        rowKey="week"
        size="small"
        dataSource={rows ?? []}
        loading={rows === null}
        pagination={{ pageSize: 12, size: 'small', hideOnSinglePage: true, showSizeChanger: false }}
        locale={{ emptyText: error ? 'Nothing to show while the board is down.' : 'No weeks yet.' }}
        columns={[
          { title: 'Week', dataIndex: 'week', width: 120, render: (w: string) => <strong>{w}</strong> },
          { title: 'Stage', dataIndex: 'stage', width: 120, render: (s: WeekStage) => <Tag color={STAGE_COLOUR[s] ?? 'default'}>{s}</Tag> },
          { title: 'Roles', dataIndex: 'counted', width: 90 },
          { title: 'Rejected', dataIndex: 'rejected', width: 100, render: (n: number) => (n ? <Tag color="red">{n}</Tag> : '0') },
          { title: 'Style', dataIndex: 'style', width: 140, render: (s: string | null) => s ?? '—' },
          {
            title: 'Build',
            dataIndex: 'build',
            width: 120,
            render: (b: string | null, row) =>
              b ? (
                <Button size="small" type="link" onClick={() => void openLog(row.week)} style={{ padding: 0 }}>
                  <Tag color={b === 'done' ? 'green' : b === 'failed' ? 'red' : 'processing'}>{b}</Tag>
                </Button>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: 'Audio',
            dataIndex: 'music',
            width: 200,
            render: (m: string | null, row) =>
              row.stage === 'empty' || row.stage === 'imported' || row.stage === 'planned' ? (
                <Typography.Text type="secondary">not voiced</Typography.Text>
              ) : (
                <Space size={4}>
                  <Tag color={row.fitted ? 'cyan' : 'default'}>{row.fitted ? 'cut to voice' : 'spine'}</Tag>
                  {m ? <Tag color="purple">{m}</Tag> : <Typography.Text type="secondary">no music</Typography.Text>}
                </Space>
              ),
          },
          {
            title: 'Reel',
            dataIndex: 'hasExport',
            width: 110,
            render: (has: boolean, row) =>
              has ? (
                <Button size="small" icon={<PlayCircleOutlined />} href={row.links.reel} target="_blank">
                  reel.mp4
                </Button>
              ) : (
                <Typography.Text type="secondary">not yet</Typography.Text>
              ),
          },
          {
            title: '',
            key: 'actions',
            render: (_: unknown, row) => (
              <Space size={4}>
                <Button size="small" loading={running === `${row.week}:summarise`} disabled={row.stage === 'empty'} onClick={() => void run(row.week, 'summarise')}>
                  summarise
                </Button>
                <Button size="small" loading={running === `${row.week}:plan`} disabled={row.stage === 'empty' || row.stage === 'imported'} onClick={() => void run(row.week, 'plan')}>
                  plan
                </Button>
                <Button size="small" loading={running === `${row.week}:build`} disabled={row.stage === 'empty' || row.stage === 'imported' || row.build === 'running'} onClick={() => void run(row.week, 'build')}>
                  build
                </Button>
                <Button size="small" type="link" href={row.links.board} target="_blank">
                  open on board
                </Button>
              </Space>
            ),
          },
        ]}
      />
            </div>
          ) },
          { key: 'card', label: 'Job card', children: <JobCardPane /> },
          { key: 'formats', label: 'Request formats', children: <RequestFormats /> },
        ]}
      />
      <Drawer title={log ? `Build log · ${log.week}${log.status ? ` · ${log.status}` : ''}` : 'Build log'} open={log !== null} onClose={() => setLog(null)} size="large">
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{log?.text}</pre>
      </Drawer>
    </div>
  );
}

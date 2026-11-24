'use client';
import React from 'react';
import { Alert, Button, Card, Collapse, Empty, Form, Input, InputNumber, Segmented, Space, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { message } from '@/lib/ui/message';
import { ago } from '@/lib/explainer/browse';
import type { LaunchSummary } from '@/lib/launch/store';
import type { Reference, WatchState } from '@/lib/launch/inbox';

/**
 * Launch reels: paste the links of a launch and get back a fact-checked 30 to 60 second reel. The script waits for approval
 * before anything is voiced.
 */

const THUMB: React.CSSProperties = { width: 54, aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(128,128,128,.25)', display: 'block' };

function Cover({ slug, renderId }: { slug: string; renderId: string | null }) {
  const [hidden, setHidden] = React.useState(false);
  if (hidden || !renderId) return <div style={{ ...THUMB, background: 'rgba(128,128,128,.10)' }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/launch/${slug}/cover?v=${encodeURIComponent(renderId)}`} alt="" style={THUMB} onError={() => setHidden(true)} />;
}

const stageTag = (r: LaunchSummary) => {
  if (r.failed?.startsWith('approve')) return <Tag color="gold">needs approval</Tag>;
  if (r.failed) return <Tag color="red">{r.failed}</Tag>;
  if (r.stage === 'done') return <Tag color="green">done</Tag>;
  return <Tag color="blue">{r.stage}</Tag>;
};

/** One link per line, blank lines dropped. */
const parseLinks = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Validates an optional list of http(s) links, at most `max`. */
const linkRule = (v: string | undefined, max: number): Promise<void> => {
  const links = parseLinks(v ?? '');
  if (links.length > max) return Promise.reject(new Error(`at most ${max} links`));
  const bad = links.find((l) => !/^https?:\/\/\S+$/i.test(l));
  return bad ? Promise.reject(new Error(`not an http(s) link: ${bad}`)) : Promise.resolve();
};

/** The shot count and the hook length of a reference, as the pacing the new reel will follow. */
const pacingText = (r: Reference) => {
  const lens = r.shots.map((s) => s.end - s.start);
  return lens.length ? `hook ${Math.round(lens[0] * 10) / 10} s · ${lens.length} shots` : 'no shots found';
};

/** New launch reels from the channels tracked in instascraper, found by the daily watch. One click starts our own reel on the same launch. */
function Inbox({ onMade }: { onMade: (slug: string) => void }) {
  const [data, setData] = React.useState<{ references: Reference[]; watch: WatchState } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const body = await fetch('/api/launch/inbox', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (body?.references) setData(body);
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  // While a check is running, look again every few seconds.
  React.useEffect(() => {
    if (!data?.watch.running) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [data?.watch.running, load]);

  const checkNow = async () => {
    setBusy('watch');
    try {
      const r = await fetch('/api/launch/inbox/watch', { method: 'POST' });
      if (!r.ok) message.error((await r.json().catch(() => ({}))).error ?? 'could not start the check');
      await load();
    } finally {
      setBusy(null);
    }
  };
  const make = async (r: Reference) => {
    setBusy(r.id);
    try {
      const res = await fetch('/api/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ referenceId: r.id, start: true }) });
      const body = await res.json();
      if (!res.ok) { message.error(body.error ?? 'could not create it'); return; }
      onMade(body.slug);
    } finally {
      setBusy(null);
    }
  };
  const dismiss = async (r: Reference) => {
    setBusy(r.id);
    try {
      await fetch(`/api/launch/inbox/${r.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'dismissed' }) });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const watch = data?.watch;
  const fresh = (data?.references ?? []).filter((r) => r.status === 'new');
  const done = (data?.references ?? []).filter((r) => r.status === 'made');
  return (
    <Card size="small" title="From tracked channels" extra={<Button size="small" onClick={() => void checkNow()} loading={busy === 'watch' || !!watch?.running} disabled={!data}>Check now</Button>}>
      <Space orientation="vertical" size={10} style={{ width: '100%' }}>
        {watch?.running ? (
          <Typography.Text type="secondary">Checking now…</Typography.Text>
        ) : watch?.skipped ? (
          <Alert type="warning" showIcon title={`${watch.skipped.reason} (${ago(watch.skipped.at)})`} />
        ) : watch?.lastRunAt ? (
          <Typography.Text type="secondary">Checked {ago(watch.lastRunAt)}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">Not checked yet.</Typography.Text>
        )}
        {fresh.length === 0 && !watch?.running ? (
          <Typography.Text type="secondary">No new launches from the channels you track.</Typography.Text>
        ) : (
          fresh.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <div><Typography.Text type="secondary">@{r.creator}</Typography.Text> <Typography.Text strong>{r.topic}</Typography.Text></div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  posted {ago(r.postedAt)} · {pacingText(r)} · <a href={r.url} target="_blank" rel="noreferrer">Watch the reference</a>
                </Typography.Text>
                {r.note ? <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.note}</Typography.Text></div> : null}
              </div>
              <Space>
                <Button type="primary" size="small" loading={busy === r.id} onClick={() => void make(r)}>Make our reel</Button>
                <Button size="small" disabled={busy === r.id} onClick={() => void dismiss(r)}>Dismiss</Button>
              </Space>
            </div>
          ))
        )}
        {done.length ? (
          <Collapse ghost size="small" items={[{
            key: 'done', label: `Done (${done.length})`,
            children: done.map((r) => (
              <div key={r.id}><Typography.Text type="secondary">@{r.creator} · {r.topic} · Made → </Typography.Text>{r.slug ? <Link href={`/launch/${r.slug}`}>{r.slug}</Link> : null}</div>
            )),
          }]} />
        ) : null}
      </Space>
    </Card>
  );
}

export default function LaunchPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<LaunchSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [form] = Form.useForm();

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const body = await fetch('/api/launch', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
        if (alive) setRows((body.launches ?? []) as LaunchSummary[]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const create = async (values: { title: string; links: string; seconds: number; mode: 'faceless' | 'avatar'; look: 'newsroom' | 'creator'; speed: 'fast' | 'polish'; creditBudget: number | null; demos?: string; posts?: string }) => {
    setCreating(true);
    try {
      const r = await fetch('/api/launch', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: values.title, links: parseLinks(values.links), seconds: values.seconds, start: true, mode: values.mode, look: values.look, speed: values.speed,
          ...(values.creditBudget === null || values.creditBudget === undefined ? {} : { creditBudget: values.creditBudget }),
          demos: parseLinks(values.demos ?? ''), posts: parseLinks(values.posts ?? ''),
        }),
      });
      const body = await r.json();
      if (!r.ok) { message.error(body.error ?? 'could not create it'); return; }
      router.push(`/launch/${body.slug}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Space orientation="vertical" size={18} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>Launch reels</Typography.Title>
        <Typography.Text type="secondary">Paste the launch links. You approve the script before anything is voiced.</Typography.Text>
      </div>

      <Inbox onMade={(slug) => router.push(`/launch/${slug}`)} />

      <Card size="small" title="New launch reel">
        <Form form={form} layout="vertical" initialValues={{ seconds: 45, mode: 'faceless', look: 'creator', speed: 'fast', creditBudget: 0 }} onFinish={(v) => void create(v)}>
          <Form.Item name="title" label="Launch" rules={[{ required: true, message: 'what launched?' }]}>
            <Input placeholder="e.g. Gemini 4" maxLength={80} />
          </Form.Item>
          <Form.Item
            name="links"
            label="Links (one per line, up to 5)"
            rules={[
              { required: true, message: 'paste at least one link' },
              {
                validator: (_r, v: string | undefined) => {
                  const links = parseLinks(v ?? '');
                  if (links.length > 5) return Promise.reject(new Error('at most 5 links'));
                  const bad = links.find((l) => !/^https?:\/\/\S+$/i.test(l));
                  return bad ? Promise.reject(new Error(`not an http(s) link: ${bad}`)) : Promise.resolve();
                },
              },
            ]}
          >
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder={'https://blog.google/...\nhttps://ai.google.dev/pricing'} />
          </Form.Item>
          <Form.Item name="seconds" label="Length">
            <Segmented options={[{ value: 30, label: '30 s' }, { value: 45, label: '45 s' }, { value: 60, label: '60 s' }]} />
          </Form.Item>
          <Form.Item name="look" label="Look" extra="Creator: a dark, fast cut with a face cam, big capitals and moving b-roll. Newsroom: paper and serif headlines.">
            <Segmented options={[{ value: 'creator', label: 'Creator' }, { value: 'newsroom', label: 'Newsroom' }]} />
          </Form.Item>
          <Form.Item name="speed" label="Finish" extra="Polish has a critic watch the render and fix the edit, up to two rounds. It takes longer.">
            <Segmented options={[{ value: 'fast', label: 'Fast' }, { value: 'polish', label: 'Polish' }]} />
          </Form.Item>
          <Form.Item label="Presenter">
            <Space wrap>
              <Form.Item name="mode" noStyle>
                <Segmented
                  options={[{ value: 'faceless', label: 'Faceless' }, { value: 'avatar', label: 'Anchor' }]}
                  onChange={(v) => form.setFieldValue('creditBudget', v === 'avatar' ? 120 : 0)}
                />
              </Form.Item>
              <Link className="st-link" href="/launch/anchor" style={{ fontSize: 12 }}>Anchor face</Link>
            </Space>
          </Form.Item>
          <Form.Item shouldUpdate={(a, b) => a.mode !== b.mode} noStyle>
            {({ getFieldValue }) => (
              <Form.Item name="creditBudget" label="Credit budget" extra={getFieldValue('mode') === 'avatar' ? 'Higgsfield credits this reel may spend; an anchor clip costs about 1.5 credits a second at 720p. The reel falls back to free options when it runs out.' : 'A faceless reel spends nothing unless you give it a budget.'}>
                <InputNumber min={0} max={1000} step={10} style={{ width: 140 }} />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item
            name="demos"
            label="Official demo video links (optional, up to 3)"
            rules={[{ validator: (_r, v: string | undefined) => linkRule(v, 3) }]}
          >
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="https://.../demo.mp4" />
          </Form.Item>
          <Form.Item
            name="posts"
            label="X post links (optional, up to 3)"
            rules={[{ validator: (_r, v: string | undefined) => linkRule(v, 3) }]}
          >
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="https://x.com/Google/status/..." />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={creating}>Make the reel</Button>
        </Form>
      </Card>

      {rows.length === 0 && !loading ? (
        <Empty description="No launch reels yet. Paste a launch above." />
      ) : (
        <Table<LaunchSummary>
          size="small"
          rowKey="slug"
          loading={loading}
          pagination={false}
          dataSource={rows}
          onRow={(r) => ({ onClick: () => router.push(`/launch/${r.slug}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: '', key: 'cover', width: 70, render: (_v, r) => <Cover slug={r.slug} renderId={r.renderId} /> },
            { title: 'Launch', dataIndex: 'title', key: 'title', className: 'st-title-col' },
            { title: 'Stage', key: 'stage', render: (_v, r) => stageTag(r) },
            { title: 'Updated', key: 'updated', render: (_v, r) => <Typography.Text type="secondary">{ago(r.updatedAt)}</Typography.Text> },
          ]}
        />
      )}
    </Space>
  );
}

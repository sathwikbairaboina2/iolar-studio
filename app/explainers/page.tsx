'use client';
import React from 'react';
import {
  Alert, Button, Card, Empty, Input, InputNumber, Segmented, Select, Space, Switch, Typography, message,
} from 'antd';
import { AppstoreOutlined, BarsOutlined, SearchOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import type { ExplainerSummary } from '@/lib/explainer/store';
import { search } from '@/lib/explainer/browse';
import ExplainerShelf from './ExplainerShelf';
import ExplainerTable from './ExplainerTable';

type Contract = { themes: string[]; themeModes: Record<string, 'light' | 'dark'> } | null;
type View = 'shelf' | 'table';

/** Which way you like to look at these outlives the tab; it is a preference, not state. */
const VIEW_KEY = 'explainers.view';

export default function ExplainersPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<ExplainerSummary[]>([]);
  const [contract, setContract] = React.useState<Contract>(null);
  const [loading, setLoading] = React.useState(true);
  const [title, setTitle] = React.useState('');
  const [theme, setTheme] = React.useState<string | undefined>();
  const [creating, setCreating] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [view, setView] = React.useState<View>('shelf');
  // Writing it here is the difference between opening a board about your topic and opening two
  // rows called Before and After.
  const [write, setWrite] = React.useState(false);
  const [audience, setAudience] = React.useState('');
  const [claim, setClaim] = React.useState('');
  const [seconds, setSeconds] = React.useState(18);

  React.useEffect(() => {
    // Read after mount, never during render: the server has no localStorage and the markup it
    // sends has to match the first client paint.
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'shelf' || saved === 'table') setView(saved);
    } catch { /* a browser that refuses storage still gets the default */ }
  }, []);

  const pickView = (next: View) => {
    setView(next);
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* preference only */ }
  };

  // The `alive` guard is not ceremony: the page can be left while the fetch is in flight, and
  // setting state after that is a leak the console will complain about.
  const load = React.useCallback(async () => {
    const r = await fetch('/api/explainers', { cache: 'no-store' });
    const body = await r.json();
    return body as { explainers?: ExplainerSummary[]; contract?: Contract };
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const body = await load();
        if (!alive) return;
        setRows(body.explainers ?? []);
        setContract(body.contract ?? null);
        if (body.contract?.themes?.length) setTheme((t) => t ?? body.contract!.themes[0]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const r = await fetch('/api/explainers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          theme,
          brief: write && claim.trim()
            ? { topic: title.trim(), audience: audience.trim() || 'engineers', claim: claim.trim(), seconds }
            : undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) { message.error(body.error ?? 'could not create it'); return; }
      // A model that would not answer still leaves an explainer to work in; say so rather than
      // opening a blank board with no explanation.
      if (write && body.drafted === false) message.warning(body.error ?? 'it was created, but not written');
      router.push(`/explainers/${body.slug}`);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (slug: string) => {
    const r = await fetch(`/api/explainers/${slug}`, { method: 'DELETE' });
    if (!r.ok) { message.error('could not delete it'); return; }
    // Drop it here rather than refetching: the list is already right, and a round trip would make
    // the row sit there for a beat after you confirmed it was gone.
    setRows((all) => all.filter((row) => row.slug !== slug));
    message.success('deleted');
  };

  const open = (slug: string) => router.push(`/explainers/${slug}`);
  const shown = React.useMemo(() => search(rows, query), [rows, query]);

  return (
    <Space orientation="vertical" size={18} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>Explainers</Typography.Title>
        <Typography.Text type="secondary">
          One scene that changes. The board holds still while its numbers move — which is what makes
          a before and after read as a comparison rather than two screens.
        </Typography.Text>
      </div>

      {!contract && !loading ? (
        <Alert
          type="warning"
          showIcon
          title="The templates service is not answering on 26200"
          description="You can still write and edit here. Rendering, and the list of themes, need it running — start it from Plugins."
        />
      ) : null}

      <Card size="small">
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="What does this one explain?  e.g. What a CDN actually buys you"
            value={title}
            maxLength={48}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={() => void create()}
          />
          <Select
            value={theme}
            onChange={setTheme}
            style={{ width: 190 }}
            placeholder="theme"
            options={(contract?.themes ?? []).map((t) => ({
              value: t,
              label: `${t}  ·  ${contract?.themeModes?.[t] ?? ''}`,
            }))}
            disabled={!contract}
          />
          <Button type="primary" loading={creating} onClick={() => void create()} disabled={!title.trim()}>
            {write ? 'Write it' : 'New explainer'}
          </Button>
        </Space.Compact>

        <Space style={{ marginTop: 10 }} size={8}>
          <Switch size="small" checked={write} onChange={setWrite} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Write the first draft with the model
          </Typography.Text>
        </Space>

        {write ? (
          <Space orientation="vertical" size={8} style={{ width: '100%', marginTop: 10 }}>
            <Input
              placeholder="Audience — who it is for"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            />
            <Input.TextArea
              placeholder="The one thing that must land"
              autoSize={{ minRows: 2, maxRows: 3 }}
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
            />
            <Space>
              <InputNumber min={6} max={60} value={seconds} onChange={(v) => setSeconds(Number(v ?? 16))} suffix="s" />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                The reference channel sits between 14 and 21 seconds.
              </Typography.Text>
            </Space>
          </Space>
        ) : null}
      </Card>

      {rows.length === 0 && !loading ? (
        <Empty description="Nothing here yet. Name one above and it opens with a working two-row board." />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search title, theme or slug"
              allowClear
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ maxWidth: 320 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {query.trim() && shown.length !== rows.length
                ? `${shown.length} of ${rows.length}`
                : `${rows.length} explainer${rows.length === 1 ? '' : 's'}`}
            </Typography.Text>
            <div style={{ flex: 1 }} />
            <Segmented
              value={view}
              onChange={(v) => pickView(v as View)}
              options={[
                { value: 'shelf', icon: <AppstoreOutlined /> },
                { value: 'table', icon: <BarsOutlined /> },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <Empty description={`Nothing matches “${query.trim()}”.`} />
          ) : view === 'shelf' ? (
            <ExplainerShelf rows={shown} onOpen={open} onDelete={(s) => void remove(s)} />
          ) : (
            <ExplainerTable rows={shown} loading={loading} onOpen={open} onDelete={(s) => void remove(s)} />
          )}
        </>
      )}
    </Space>
  );
}

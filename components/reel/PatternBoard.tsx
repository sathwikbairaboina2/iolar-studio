'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Progress, Radio, Select, Space, Steps, Tag, Typography, Upload } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';

/**
 * Approved script to rendered reel through the templates service. The stage is derived on
 * the server from what is on disk; this panel asks where it got to, draws it, and offers
 * the one next step. Sections are edited here, with the service's own limits counted live,
 * and the preview is the service's player, never a second implementation.
 */

export type Unit = { path: string; label: string; kind: string; lineIds: string[]; start: number; end: number; sec: number };
export type Section = Record<string, unknown> & { kind: string };
export type State = {
  stage: 'unsectioned' | 'sectioned' | 'voiced' | 'aligned' | 'presented' | 'rendering' | 'failed' | 'done';
  blocked: string | null;
  sectionsStale: boolean;
  renderStale: boolean;
  units: Unit[];
  measured: boolean;
  timingError: string | null;
  presenter: { source: 'upload' | 'lipsync'; status: string; error?: string; blocked?: string };
  job: { id: string; state: string; error: string | null } | null;
  progress: number | null;
  previewUrl: string | null;
  exportPath: string | null;
  lastError: string | null;
  pattern: { name: string; theme: string; presenter: 'upload' | 'lipsync'; sections: Section[] };
  lines: Record<string, string>;
  limits: Record<string, number>;
  themes: string[];
};
type Issue = { loc: (string | number)[]; msg: string };

const STAGES = ['unsectioned', 'sectioned', 'voiced', 'aligned', 'presented', 'rendering', 'failed', 'done'] as const;
const LABELS = ['Section', 'Voice', 'Align', 'Presenter', 'Render', 'Done'];
const NEXT: Record<string, string> = {
  unsectioned: 'Section the script',
  sectioned: 'Add the voice',
  voiced: 'Align the voice',
  aligned: 'Make the hook clip',
  presented: 'Render',
};

/** A unit path like sections.1.slides.0 → [1, 'slides', 0]; sections.3 → [3]. */
const parsePath = (p: string) => p.split('.').slice(1).map((s) => (/^\d+$/.test(s) ? Number(s) : s)) as (number | string)[];

/** The unit an editable path points at, or undefined while the draft and the server's units disagree (mid-save). */
function unitOf(sections: Section[], path: string): Record<string, unknown> | undefined {
  const [i, key, j] = parsePath(path);
  const s = sections[i as number];
  if (!s) return undefined;
  return key ? (s[key as string] as Record<string, unknown>[] | undefined)?.[j as number] : s;
}

/** Move one line to the neighbouring unit, keeping script order; an emptied slide or page is dropped. */
export function moveLine(sections: Section[], units: Unit[], path: string, lineId: string, dir: -1 | 1): Section[] | null {
  const k = units.findIndex((u) => u.path === path);
  const from = units[k];
  const to = units[k + dir];
  if (!from || !to) return null;
  const isEdge = dir === -1 ? from.lineIds[0] === lineId : from.lineIds.at(-1) === lineId;
  if (!isEdge) return null;
  if (from.lineIds.length === 1 && (from.kind === 'hook' || from.kind === 'cta')) return null;
  const next = structuredClone(sections);
  const src = unitOf(next, from.path) as { lineIds: string[] } | undefined;
  const dst = unitOf(next, to.path) as { lineIds: string[] } | undefined;
  if (!src || !dst) return null;
  src.lineIds = src.lineIds.filter((id) => id !== lineId);
  dst.lineIds = dir === -1 ? [...dst.lineIds, lineId] : [lineId, ...dst.lineIds];
  if (src.lineIds.length === 0) {
    const [i, key, j] = parsePath(from.path);
    const list = next[i as number][key as string] as unknown[];
    list.splice(j as number, 1);
    if (list.length === 0) next.splice(i as number, 1);
  }
  return next;
}

const Count = ({ path, value, limit }: { path: string; value: string; limit: number }) => (
  <Typography.Text
    type={value.trim().length > limit || value.trim().length === 0 ? 'danger' : 'secondary'}
    data-testid={`count-${path}`}
    style={{ fontSize: 12 }}
  >
    {value.trim().length}/{limit}
  </Typography.Text>
);

const COLOURS: Record<string, string> = { hook: '#722ed1', cta: '#13c2c2', page: '#1677ff', slide: '#52c41a' };

export default function PatternBoard({ slug, onChanged }: { slug: string; pattern?: { name: string; theme: string }; onChanged?: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<Section[] | null>(null);
  const [voice, setVoice] = useState<'tts' | 'supplied'>('tts');
  const [captions, setCaptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/reel/${slug}/pattern`, { cache: 'no-store' });
    if (r.ok) {
      const s = (await r.json()) as State;
      setState(s);
      setDraft(s.pattern.sections);
    }
  }, [slug]);
  useEffect(() => {
    // The first read is a fetch; nothing is set until it answers.
    void Promise.resolve().then(load);
    return () => {
      if (polling.current) clearInterval(polling.current);
    };
  }, [load]);
  useEffect(() => {
    if (state?.stage !== 'rendering') return;
    polling.current = setInterval(load, 5000);
    return () => {
      if (polling.current) clearInterval(polling.current);
    };
  }, [state?.stage, load]);

  const call = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const r = await fetch(`/api/reel/${slug}/pattern${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? 'the step did not go through');
        if (Array.isArray(d.issues)) setIssues(d.issues);
        if (typeof d.path === 'string') setIssues([{ loc: d.path.split('.'), msg: d.error }]);
      } else {
        setState(d);
        setDraft(d.pattern?.sections ?? null);
      }
    } catch {
      setError('the studio did not answer — reloading where it got to');
    } finally {
      setBusy(false);
      await load();
      onChanged?.();
    }
  };

  const save = (sections: Section[]) => call('', { sections });
  const edit = (path: string, field: string, value: unknown) => {
    if (!draft) return;
    const next = structuredClone(draft);
    const target = unitOf(next, path);
    if (!target) return;
    target[field] = value;
    setDraft(next);
  };
  const uploadPresenter = async (file: File) => {
    setBusy(true);
    try {
      await fetch(`/api/reel/${slug}/presenter`, { method: 'PUT', body: await file.arrayBuffer() });
    } finally {
      setBusy(false);
      await load();
    }
  };
  const uploadVoice = async (file: File) => {
    setBusy(true);
    try {
      await fetch(`/api/reel/${slug}/vo`, { method: 'PUT', body: await file.arrayBuffer() });
      setVoice('supplied');
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (!state || !draft) return null;
  const step = Math.min(STAGES.indexOf(state.stage), LABELS.length - 1);
  const errorAt = (path: string) => issues.some((i) => i.loc.join('.') === path || i.loc.join('.').startsWith(`${path}.`));
  const total = state.units.at(-1)?.end ?? 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.pattern.sections);
  const L = state.limits;

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Steps size="small" current={state.stage === 'failed' ? 4 : step} status={state.stage === 'failed' ? 'error' : undefined} items={LABELS.map((title) => ({ title }))} />
      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} />}
      {state.blocked && <Alert type="warning" showIcon message={state.blocked} />}
      {state.sectionsStale && (
        <Alert type="warning" showIcon message="The script changed since these sections were cut" action={<Button size="small" onClick={() => call('/section', {})}>Re-section</Button>} />
      )}
      {state.renderStale && state.job && <Alert type="info" showIcon message="The document changed since the last render" />}
      {state.timingError && <Alert type="error" showIcon message={state.timingError} />}

      <Card
        size="small"
        title="Theme and voice"
        extra={
          NEXT[state.stage] ? (
            <Button type="primary" loading={busy} onClick={() => call('/advance', { voice })} data-testid="advance">
              {NEXT[state.stage]}
            </Button>
          ) : (
            <Tag color={state.stage === 'done' ? 'green' : state.stage === 'failed' ? 'red' : 'blue'}>{state.stage}</Tag>
          )
        }
      >
        <Space wrap>
          <Select value={state.pattern.theme} style={{ minWidth: 180 }} options={state.themes.map((t) => ({ value: t, label: t }))} onChange={(theme) => call('', { theme })} data-testid="theme" />
          <Radio.Group value={voice} onChange={(e) => setVoice(e.target.value)}>
            <Radio.Button value="tts">Speak it here</Radio.Button>
            <Radio.Button value="supplied">I recorded it</Radio.Button>
          </Radio.Group>
          {voice === 'supplied' && state.stage === 'sectioned' && (
            <Upload accept="audio/*" showUploadList={false} beforeUpload={(f) => { uploadVoice(f as unknown as File); return false; }}>
              <Button icon={<InboxOutlined />}>Drop the voiceover</Button>
            </Upload>
          )}
          <Checkbox checked={captions} onChange={(e) => setCaptions(e.target.checked)}>Captions</Checkbox>
          <Button icon={<ReloadOutlined />} loading={busy} onClick={() => call('/section', {})} data-testid="resection">
            Re-section with Claude
          </Button>
        </Space>
      </Card>

      <Card size="small" title={`Timing — ${total.toFixed(1)} s${state.measured ? '' : ' (defaults until the voice is aligned)'}`}>
        <div style={{ display: 'flex', width: '100%', height: 22, gap: 2 }} data-testid="timing">
          {state.units.map((u) => (
            <div
              key={u.path}
              title={`${u.label} ${u.sec.toFixed(1)}s`}
              style={{ flex: u.sec, background: errorAt(u.path) ? '#ff4d4f' : COLOURS[u.kind] ?? '#999', color: '#fff', fontSize: 11, padding: '2px 4px', overflow: 'hidden', whiteSpace: 'nowrap' }}
            >
              {u.label} {u.sec.toFixed(1)}s
            </div>
          ))}
        </div>
      </Card>

      {state.units.map((u) => {
        const s = unitOf(draft, u.path);
        if (!s) return null;
        const text = (f: string, limit: number) => (
          <div>
            <Input.TextArea autoSize value={String(s[f] ?? '')} onChange={(e) => edit(u.path, f, e.target.value)} placeholder={f} />
            <Count path={`${u.path}.${f}`} value={String(s[f] ?? '')} limit={limit} />
          </div>
        );
        const list = (f: string, max: number, each: number) => {
          const items = (s[f] as string[] | undefined) ?? [];
          return (
            <div>
              {items.map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <Input value={v} onChange={(e) => edit(u.path, f, items.map((x, k) => (k === i ? e.target.value : x)))} />
                  <Count path={`${u.path}.${f}.${i}`} value={v} limit={each} />
                  <Button size="small" onClick={() => edit(u.path, f, items.filter((_, k) => k !== i))}>×</Button>
                </div>
              ))}
              {items.length < max && <Button size="small" onClick={() => edit(u.path, f, [...items, ''])}>+ {f.replace(/s$/, '')}</Button>}
            </div>
          );
        };
        return (
          <Card
            key={u.path}
            size="small"
            className={errorAt(u.path) ? 'unit-error' : ''}
            data-testid={`unit-card-${u.path}`}
            title={<span data-testid="unit-card">{u.label} · {u.sec.toFixed(1)} s</span>}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {u.lineIds.map((id) => (
                <Tag key={id} style={{ whiteSpace: 'normal', padding: 2 }}>
                  <Button size="small" type="text" icon={<ArrowLeftOutlined />} data-testid={`move-prev-${u.path}-${id}`} onClick={() => { const n = moveLine(draft, state.units, u.path, id, -1); if (n) save(n); }} />
                  {state.lines[id] ?? id}
                  <Button size="small" type="text" icon={<ArrowRightOutlined />} data-testid={`move-next-${u.path}-${id}`} onClick={() => { const n = moveLine(draft, state.units, u.path, id, 1); if (n) save(n); }} />
                </Tag>
              ))}
            </div>
            {u.kind === 'hook' && <Space orientation="vertical" style={{ width: '100%' }}>{text('title', L.title ?? 60)}{list('chips', L.chips ?? 3, L.chip ?? 16)}{text('tease', L.title ?? 60)}</Space>}
            {u.kind === 'slide' && (
              <Space orientation="vertical" style={{ width: '100%' }}>
                {text('topic', L.topic ?? 40)}
                {list('points', L.points ?? 4, L.point ?? 40)}
                <Input value={String(s.image ?? '')} placeholder="image url, or empty" onChange={(e) => edit(u.path, 'image', e.target.value || null)} />
              </Space>
            )}
            {u.kind === 'page' && (
              <Space orientation="vertical" style={{ width: '100%' }}>
                <Input value={String(s.url ?? '')} onChange={(e) => edit(u.path, 'url', e.target.value)} />
                {text('label', 20)}
              </Space>
            )}
            {u.kind === 'cta' && <Space orientation="vertical" style={{ width: '100%' }}>{text('keyword', L.keyword ?? 12)}{text('line', L.title ?? 60)}{text('follow', L.title ?? 60)}</Space>}
          </Card>
        );
      })}
      {dirty && (
        <Button type="primary" loading={busy} onClick={() => save(draft)} data-testid="save-sections">
          Save sections
        </Button>
      )}

      <Card size="small" title="Presenter">
        <Space wrap>
          <Tag color={state.presenter.status === 'ready' ? 'green' : state.presenter.status === 'failed' ? 'red' : 'blue'}>
            {state.presenter.source} · {state.presenter.status}
          </Tag>
          {state.presenter.error && <Typography.Text type="danger">{state.presenter.error}</Typography.Text>}
          <Upload accept="video/*,.mp4,.mov,.webm" showUploadList={false} beforeUpload={(f) => { uploadPresenter(f as unknown as File); return false; }}>
            <Button icon={<InboxOutlined />}>Upload a hook clip</Button>
          </Upload>
          {state.presenter.source === 'upload' && (
            <Button onClick={async () => { await fetch(`/api/reel/${slug}/presenter`, { method: 'DELETE' }); await load(); }}>Use lipsync instead</Button>
          )}
        </Space>
      </Card>

      <Card
        size="small"
        title="Render"
        extra={
          <Button
            type="primary"
            loading={busy}
            disabled={!['presented', 'failed', 'done'].includes(state.stage) || Boolean(state.timingError)}
            onClick={() => call('/render', { captions })}
            data-testid="render"
          >
            {state.job ? 'Render again' : 'Render'}
          </Button>
        }
      >
        {state.job && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Tag>{state.job.id} · {state.job.state}</Tag>
            {state.stage === 'rendering' && <Progress percent={Math.round((state.progress ?? 0) * 100)} status="active" />}
            {state.job.error && <Alert type="error" showIcon message={state.job.error} />}
            {state.previewUrl && (
              <>
                <iframe title="preview" src={state.previewUrl} data-testid="preview-frame" style={{ width: '100%', aspectRatio: '9 / 16', maxHeight: 640, border: 0 }} />
                <a href={state.previewUrl} target="_blank" rel="noreferrer">open the preview in a tab</a>
              </>
            )}
            {state.exportPath && (
              <Typography.Text>
                Exported to <code>{state.exportPath.replace(/\\/g, '/').replace(/.*\/reel\//, '')}</code>
              </Typography.Text>
            )}
          </Space>
        )}
      </Card>
    </Space>
  );
}

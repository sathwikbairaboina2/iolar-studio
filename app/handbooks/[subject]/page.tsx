'use client';
import { use, useEffect, useState } from 'react';
import { Button, Card, Checkbox, Empty, Input, Modal, Segmented, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { message } from '@/lib/ui/message';
import { PlusOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isSlug, slugify } from '@/lib/paths';
import { SWEEP } from '@/components/ThemeProvider';
import { CATEGORIES, categoryOf, filterChapters, type CategoryId } from '@/lib/handbookCategories';
import { CategorySelect } from '@/components/handbooks/CategorySelect';
import { PublishStrip } from '@/components/handbooks/PublishStrip';
import { PublishBar } from '@/components/handbooks/PublishBar';
import { PublishDrawer } from '@/components/handbooks/PublishDrawer';
import { usePublish, type PublishData } from '@/components/handbooks/usePublish';

type ChapterMeta = {
  subject: string; slug: string; title: string; category?: string; parts: number;
  points: number; pages: number; avgFill: number; status: string;
  partStatuses?: string[]; updatedAt: string;
};

const STATUSES = ['draft', 'rendered', 'polished', 'packaged', 'published'];
type Subject = { slug: string; name: string; emoji: string; description: string };

const STATUS_COLOR: Record<string, string> = {
  draft: 'default', rendered: 'blue', polished: 'purple', packaged: 'gold', published: 'success',
};

const AIIOLAR_TAG: Record<string, { color: string; label: string }> = {
  live: { color: 'success', label: 'Live on aiiolar' },
  none: { color: 'default', label: 'Not published' },
  run: { color: 'processing', label: 'Reviewing' },
  you: { color: 'warning', label: 'Needs you' },
  fail: { color: 'error', label: 'Failed review' },
};

/** Where a chapter stands on aiiolar, from the publish snapshot. */
function aiiolarState(slug: string, p: PublishData | null): string {
  if (!p) return 'none';
  const job = p.job;
  if (job?.live && job.steps.some((s) => s.chapter === slug && (s.state === 'running' || s.state === 'queued'))) return 'run';
  if (p.live.includes(slug)) return 'live';
  const c = p.state.chapters[slug];
  if (c?.selected && !c.rejected && c.verdict === 'fail') return 'fail';
  if (p.queue.chapters.includes(slug)) return 'you';
  return 'none';
}

export default function SubjectPage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject } = use(params);
  const [meta, setMeta] = useState<Subject | null>(null);
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<CategoryId>('handbook');
  const [fCategory, setFCategory] = useState<string>('');
  const [fStatus, setFStatus] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<'run' | 'queue' | null>(null);
  const { data: pub, act } = usePublish(subject);
  const router = useRouter();
  const shown = filterChapters(chapters, { category: fCategory, status: fStatus, query });
  const count = (id: string) => chapters.filter((c) => categoryOf(c.category).id === id).length;

  const slug = slugify(title);
  const load = () =>
    fetch(`/api/handbooks/${subject}`).then((r) => r.json()).then((d) => {
      setMeta(d.subject ?? null);
      setChapters(d.chapters ?? []);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [subject]);

  const titles = Object.fromEntries(chapters.map((c) => [c.slug, c.title]));
  const toggle = (slug: string) => setSel((cur) => { const n = new Set(cur); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; });
  const allSelected = chapters.length > 0 && sel.size === chapters.length;
  const live = new Set(pub?.live ?? []);
  const selected = [...sel];
  // Live, stale (edited since its review) or still waiting: any chapter the publish state holds as selected can come off.
  const onSite = (s: string) => !!pub?.state.chapters[s]?.selected;
  const publishError = (e: unknown) => message.error(e instanceof Error ? e.message : 'failed');
  const startRun = async () => {
    try {
      await act({ action: 'run', chapters: selected });
      setDrawer('run');
      setSel(new Set());
    } catch (e) { publishError(e); }
  };
  const takeOff = async () => {
    try {
      await act({ action: 'unselect', chapters: selected.filter(onSite) });
      setSel(new Set());
    } catch (e) { publishError(e); }
  };

  const create = async () => {
    const r = await fetch(`/api/handbooks/${subject}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, title, category }),
    });
    if (r.ok) {
      setOpen(false);
      setTitle('');
      setCategory('handbook');
      router.push(`/handbooks/${subject}/${slug}`);
    } else {
      message.error((await r.json()).error ?? 'failed');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {meta ? `${meta.emoji} ${meta.name}` : subject} · {chapters.length} chapters
        </Typography.Title>
        <Space style={{ marginLeft: 'auto' }}>
          <Link href="/handbooks/categories">category rules</Link>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>new chapter</Button>
        </Space>
      </div>

      {chapters.length > 0 && pub && (
        <PublishStrip
          liveCount={pub.live.length}
          name={meta?.name ?? subject}
          updatedAt={pub.state.exportedAt}
          alwaysAsk={pub.state.alwaysAsk}
          queueCount={pub.queue.chapters.length + (pub.queue.order ? 1 : 0)}
          onAlwaysAsk={(v) => act({ action: 'alwaysAsk', value: v }).catch(publishError)}
          onQueue={() => setDrawer('queue')}
        />
      )}

      {chapters.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <Segmented
            value={fCategory}
            onChange={(v) => setFCategory(String(v))}
            options={[
              { value: '', label: `All ${chapters.length}` },
              ...CATEGORIES.filter((c) => count(c.id) > 0).map((c) => ({ value: c.id, label: `${c.emoji} ${c.name} ${count(c.id)}` })),
            ]}
          />
          <Select
            allowClear
            placeholder="any status"
            value={fStatus}
            onChange={setFStatus}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
            style={{ width: 140 }}
          />
          <Input.Search
            allowClear
            placeholder="filter by title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 220 }}
          />
          {shown.length !== chapters.length && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{shown.length} of {chapters.length}</Typography.Text>
          )}
        </div>
      )}

      {chapters.length === 0 ? (
        <Empty description="No chapters yet">
          <Button type="primary" onClick={() => setOpen(true)}>+ new chapter</Button>
        </Empty>
      ) : shown.length === 0 ? (
        <Empty description="No chapters match these filters" />
      ) : (
        <>
        <div style={{ marginBottom: 6, paddingInlineStart: 14 }}>
          <Checkbox
            aria-label="select all chapters"
            checked={allSelected}
            indeterminate={sel.size > 0 && !allSelected}
            onChange={() => setSel(allSelected ? new Set() : new Set(chapters.map((c) => c.slug)))}
          >
            <span style={{ opacity: 0.65, fontSize: 13 }}>Chapter</span>
          </Checkbox>
        </div>
        {shown.map((c) => (
          <Card
            key={c.slug}
            size="small"
            hoverable
            style={{ marginBottom: 9 }}
            onClick={() => router.push(`/handbooks/${subject}/${c.slug}`)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox aria-label={`select ${c.title}`} checked={sel.has(c.slug)} onChange={() => toggle(c.slug)} />
              </span>
              <span
                style={{
                  width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#fff', backgroundImage: SWEEP,
                }}
              >
                {String(chapters.indexOf(c) + 1).padStart(2, '0')}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{c.title}</b>
                <Tag style={{ marginInlineStart: 8, fontSize: 11 }}>{categoryOf(c.category).emoji} {categoryOf(c.category).name}</Tag>
                <div style={{ fontSize: 11.5, opacity: 0.65 }}>
                  {c.points} points · {c.avgFill ? `${c.avgFill}% avg fill` : 'not rendered'}
                </div>
              </div>
              <Space size={4}>
                {Array.from({ length: c.parts }, (_, p) => {
                  const st = c.partStatuses?.[p];
                  return (
                    <Tooltip key={p} title={st ? `part ${p + 1}: ${st}` : `part ${p + 1}`}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {p > 0 && <span style={{ opacity: 0.5, fontSize: 11 }}>⛓</span>}
                        <Tag
                          color={st === 'published' ? 'success' : p === 0 ? 'magenta' : 'purple'}
                          style={{ marginInlineEnd: 0 }}
                        >
                          part {p + 1}{st === 'published' ? ' ✓' : ''}
                        </Tag>
                      </span>
                    </Tooltip>
                  );
                })}
              </Space>
              <Tag color={STATUS_COLOR[c.status] ?? 'default'}>{c.status}</Tag>
              {pub && (() => {
                const st = aiiolarState(c.slug, pub);
                return <Tag data-testid={`aiiolar-${c.slug}`} color={AIIOLAR_TAG[st].color}>{AIIOLAR_TAG[st].label}</Tag>;
              })()}
              <Button size="small">open</Button>
            </div>
          </Card>
        ))}
        </>
      )}

      <PublishBar
        count={sel.size}
        toReview={selected.filter((s) => !live.has(s)).length}
        anyLive={selected.some(onSite)}
        busy={!!pub?.job?.live}
        onClear={() => setSel(new Set())}
        onUnpublish={takeOff}
        onGo={startRun}
      />
      <PublishDrawer
        open={drawer !== null}
        mode={drawer ?? 'run'}
        subject={subject}
        data={pub}
        titles={titles}
        selected={selected}
        act={act}
        onClose={() => setDrawer(null)}
      />

      <Modal
        title="New chapter"
        open={open}
        onOk={create}
        onCancel={() => setOpen(false)}
        okText="Create"
        okButtonProps={{ disabled: !isSlug(slug) }}
      >
        <Input
          placeholder="Chapter title, e.g. Data Structures — Deep Dive"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <div style={{ marginBottom: 10 }}>
          <CategorySelect value={category} onChange={setCategory} style={{ width: '100%' }} />
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
            {categoryOf(category).blurb}
          </Typography.Text>
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          chapter-slug: <b>{slug || '—'}</b>
        </Typography.Text>
      </Modal>
    </div>
  );
}

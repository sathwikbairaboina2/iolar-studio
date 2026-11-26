'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Empty,
  Input,
  InputNumber,
  Pagination,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { message } from '@/lib/ui/message';
import { FileImageOutlined, PictureOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import type { Family, JobCardDraft } from '@/lib/jobcard/schema';
import { FALLBACK } from '@/lib/jobcard/pick';
import type { CardRow } from '@/lib/jobcard/store';
import type { ScrapedItem } from '@/lib/jobcard/scraped';

/**
 * One job, one card. Paste a listing or name a row already in the pool, correct what the
 * model read, pick a family, render. The card is not rendered while a mandatory field is
 * missing — the gaps are named here instead, which is the whole point of the gate.
 */

type Score = { family: Family; score: number; why: string };
type ScrapedRow = ScrapedItem & { cardId: string | null };
type Handoff = { postId: string; accountId: string; at: string; status: 'queued' };
type Detail = { row: CardRow; draft: JobCardDraft; missing: string[]; families: Score[]; handoff?: Handoff | null };

const MODES = ['onsite', 'hybrid', 'remote'] as const;
const CHANNELS = ['site', 'whatsapp', 'bio', 'dm'] as const;

/** A salary with one end typed stands for a single figure; the other end takes its value. */
function whole(d: JobCardDraft): JobCardDraft {
  const pay = d.salary;
  if (!pay) return d;
  const min = pay.min ?? pay.max;
  const max = pay.max ?? pay.min;
  return { ...d, salary: { ...pay, min, max } };
}

const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

export default function JobCardPane() {
  const [cards, setCards] = useState<CardRow[]>([]);
  // Cards are never deleted, so the history only grows; the pane holds one page of it.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 8;
  const [id, setId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<JobCardDraft | null>(null);
  const [way, setWay] = useState<'url' | 'pool' | 'scraped'>('url');
  const [url, setUrl] = useState('');
  const [poolId, setPoolId] = useState<number | null>(null);
  // null until the scraper has answered once, which is what 'loading' means here.
  const [scraped, setScraped] = useState<ScrapedRow[] | null>(null);
  const [scrapedError, setScrapedError] = useState<string | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [family, setFamily] = useState<Family | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [sending, setSending] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/jobcards?limit=${pageSize}&offset=${(page - 1) * pageSize}`, {
      cache: 'no-store',
    }).catch(() => null);
    if (!r?.ok) return;
    const body = (await r.json()) as { cards?: CardRow[]; total?: number };
    setCards(body.cards ?? []);
    setTotal(body.total ?? 0);
  }, [page]);

  const open = useCallback(async (cardId: string) => {
    setId(cardId);
    setShot(null);
    setHandoff(null);
    setHandoffError(null);
    const r = await fetch(`/api/jobcards/${cardId}`, { cache: 'no-store' }).catch(() => null);
    if (!r?.ok) return;
    const d = (await r.json()) as Detail;
    setDetail(d);
    setDraft(d.draft);
    setFamily(d.row.family ?? d.families[0]?.family ?? null);
    setHandoff(d.handoff ?? null);
    if (d.row.renderedAt) setShot(`/api/jobcards/${cardId}/image?v=${Date.parse(d.row.renderedAt)}`);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // setState only inside the promise callbacks, so the effect below never sets state itself.
  const loadScraped = useCallback(
    () =>
      fetch('/api/jobcards/scraped', { cache: 'no-store' })
        .catch(() => null)
        .then(async (r) => {
          if (!r?.ok) {
            const body = (await r?.json().catch(() => null)) as { error?: string } | null;
            setScraped([]);
            setScrapedError(body?.error ?? 'the scraper could not be reached');
            return;
          }
          setScrapedError(null);
          setScraped(((await r.json()) as { items?: ScrapedRow[] }).items ?? []);
        }),
    []
  );

  useEffect(() => {
    if (way === 'scraped') void loadScraped();
  }, [way, loadScraped]);

  const read = async () => {
    setReading(true);
    setError(null);
    const body = way === 'url' ? { url } : { poolId };
    const r = await fetch('/api/jobcards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setReading(false);
    if (!r?.ok) {
      setError(((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'the listing could not be read');
      return;
    }
    const made = (await r.json()) as { id: string };
    setPage(1);
    await refresh();
    await open(made.id);
  };

  const makeFromScraped = async (shortcode: string) => {
    setMaking(shortcode);
    setError(null);
    const r = await fetch('/api/jobcards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scraped: shortcode }),
    }).catch(() => null);
    setMaking(null);
    if (!r?.ok) {
      setError(((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'the post could not be read');
      return;
    }
    const made = (await r.json()) as { id: string };
    setPage(1);
    await refresh();
    await open(made.id);
    void loadScraped();
  };

  const save = async () => {
    if (!id || !draft) return;
    setSaving(true);
    const r = await fetch(`/api/jobcards/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(whole(draft)),
    }).catch(() => null);
    setSaving(false);
    if (!r?.ok) return void message.error('the document was not saved');
    await refresh();
    await open(id);
    message.success('document saved');
  };

  const renderIt = async () => {
    if (!id) return;
    setRendering(true);
    const r = await fetch(`/api/jobcards/${id}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ family }),
    }).catch(() => null);
    setRendering(false);
    const out = (await r?.json().catch(() => null)) as
      | { family?: Family; fellBack?: boolean; error?: string; missing?: string[] }
      | null;
    if (!r?.ok) {
      setError(out?.missing?.length ? `still missing: ${out.missing.join(', ')}` : (out?.error ?? 'the card did not render'));
      return;
    }
    if (out?.fellBack) message.warning(`${family} could not hold this job — rendered as ${FALLBACK}`);
    setShot(`/api/jobcards/${id}/image?v=${Date.now()}`);
    await refresh();
    if (out?.family) setFamily(out.family);
  };

  const sendToIntabot = async () => {
    if (!id || sending) return;
    setSending(true);
    setHandoffError(null);
    const r = await fetch(`/api/jobcards/${id}/handoff`, { method: 'POST' }).catch(() => null);
    const out = (await r?.json().catch(() => null)) as { handoff?: Handoff; error?: string; missing?: string[] } | null;
    setSending(false);
    if (!r?.ok || !out?.handoff) {
      setHandoffError(out?.missing?.length ? `still missing: ${out.missing.join(', ')}` : (out?.error ?? 'IntaBot could not be reached'));
      return;
    }
    setHandoff(out.handoff);
  };

  const set = (patch: Partial<JobCardDraft>) => setDraft((d) => ({ ...(d ?? {}), ...patch }));
  /**
   * Pay is all or nothing: emptying both numbers removes it. One number may sit empty
   * while the other is typed; `whole` fills it from the other at save, so no 0 to 0
   * placeholder is ever written.
   */
  const setPay = (patch: { min?: number | null; max?: number | null; unit?: string }) => {
    const cur = draft?.salary;
    const min = 'min' in patch ? patch.min : cur?.min;
    const max = 'max' in patch ? patch.max : cur?.max;
    if (min == null && max == null) return set({ salary: undefined });
    set({
      salary: {
        min: min ?? undefined,
        max: max ?? undefined,
        currency: cur?.currency ?? 'INR',
        unit: patch.unit ?? cur?.unit ?? 'LPA',
        note: cur?.note ?? null,
      },
    });
  };
  const missing = useMemo(() => detail?.missing ?? [], [detail]);

  return (
    <div className="st-stack" style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)', gap: 16 }} data-testid="job-card">
      <Card
        size="small"
        title="Job cards"
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={refresh} data-testid="jobcards-refresh" />}
      >
        <Segmented
          block
          value={way}
          onChange={(v) => setWay(v as 'url' | 'pool' | 'scraped')}
          options={[
            { label: 'A job URL', value: 'url' },
            { label: 'A pool row', value: 'pool' },
            { label: 'A scraped post', value: 'scraped' },
          ]}
        />
        {way === 'scraped' ? (
          <div style={{ marginTop: 8 }} data-testid="scraped-list">
            {scrapedError ? (
              <Alert type="error" showIcon title={scrapedError} data-testid="scraped-error" />
            ) : (scraped ?? []).length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={scraped === null ? 'asking the scraper' : 'nothing queued in the scraper'}
              />
            ) : (
              (scraped ?? []).map((p) => (
                <div
                  key={p.shortcode}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}
                  data-testid={`scraped-row-${p.shortcode}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt="" width={44} height={44} style={{ borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: '#7b8798' }}>
                      @{p.username} <Tag style={{ marginLeft: 4 }}>{p.status}</Tag>
                    </div>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.caption.split('\n').find((l) => l.trim()) ?? 'no caption'}
                    </div>
                  </div>
                  {p.cardId ? (
                    <Button size="small" onClick={() => open(p.cardId as string)} data-testid={`scraped-open-${p.shortcode}`}>
                      Open card
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      loading={making === p.shortcode}
                      onClick={() => makeFromScraped(p.shortcode)}
                      data-testid={`scraped-make-${p.shortcode}`}
                    >
                      Make card
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
        <Space.Compact style={{ width: '100%', marginTop: 8 }}>
          {way === 'url' ? (
            <Input
              placeholder="https://careers.example.com/jobs/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="jobcard-url"
            />
          ) : (
            <InputNumber
              style={{ width: '100%' }}
              placeholder="research id"
              value={poolId ?? undefined}
              onChange={(v) => setPoolId(typeof v === 'number' ? v : null)}
              data-testid="jobcard-pool-id"
            />
          )}
          <Button
            type="primary"
            loading={reading}
            disabled={way === 'url' ? !url.trim() : poolId === null}
            onClick={read}
            data-testid="jobcard-read"
          >
            Read it
          </Button>
        </Space.Compact>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '8px 0' }}>
          A reference post decides the look, never the facts — and needs a vision model, which is not installed.
        </Typography.Text>
        <Input disabled placeholder="a reference post (needs qwen2.5vl)" prefix={<PictureOutlined />} />

        <Divider style={{ margin: '12px 0' }} />
        {cards.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="no cards yet" />
        ) : (
          <div>
            {cards.map((c) => (
              <div
                key={c.id}
                onClick={() => open(c.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: c.id === id ? 'rgba(22,80,224,.06)' : undefined,
                }}
                data-testid={`jobcard-row-${c.id}`}
              >
                <div style={{ fontWeight: 600 }}>{c.role || 'untitled role'}</div>
                <div style={{ fontSize: 12, color: '#7b8798' }}>
                  {c.company || 'unknown company'}
                  {c.missing.length ? <Tag color="gold" style={{ marginLeft: 6 }}>{c.missing.length} missing</Tag> : null}
                  {c.family ? <Tag style={{ marginLeft: 6 }}>{c.family}</Tag> : null}
                </div>
              </div>
            ))}
            {total > pageSize && (
              <Pagination
                simple
                size="small"
                align="center"
                style={{ marginTop: 10 }}
                current={page}
                pageSize={pageSize}
                total={total}
                onChange={setPage}
                data-testid="jobcards-pager"
              />
            )}
          </div>
        )}
      </Card>

      <Card
        size="small"
        title={detail ? `${detail.row.role || 'untitled role'} · ${detail.row.company || ''}` : 'The document'}
        extra={
          detail ? (
            <Space>
              <Select
                size="small"
                style={{ width: 190 }}
                value={family ?? undefined}
                placeholder="family"
                onChange={(v) => setFamily(v as Family)}
                options={detail.families.map((f) => ({ value: f.family, label: `${f.family} · ${f.why}` }))}
                data-testid="jobcard-family"
              />
              <Button size="small" loading={saving} onClick={save} data-testid="jobcard-save">
                Save
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<FileImageOutlined />}
                loading={rendering}
                disabled={missing.length > 0}
                onClick={renderIt}
                data-testid="jobcard-render"
              >
                Render
              </Button>
            </Space>
          ) : null
        }
      >
        {error && <Alert type="error" showIcon closable onClose={() => setError(null)} title={error} style={{ marginBottom: 12 }} />}
        {!detail || !draft ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="read a listing, or pick a card" />
        ) : (
          <>
            {missing.length > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                title="This card is not ready"
                description={`the listing did not say: ${missing.join(', ')}`}
                data-testid="jobcard-missing"
              />
            )}

            <div className="st-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label>
                <Typography.Text type="secondary">Company</Typography.Text>
                <Input
                  value={draft.company?.name ?? ''}
                  onChange={(e) => set({ company: { ...(draft.company ?? { logo: null, accent: null }), name: e.target.value } })}
                  data-testid="jobcard-company"
                />
              </label>
              <label>
                <Typography.Text type="secondary">Role</Typography.Text>
                <Input
                  value={draft.role?.title ?? ''}
                  onChange={(e) => set({ role: { ...(draft.role ?? { skills: [], team: null }), title: e.target.value } })}
                  data-testid="jobcard-role"
                />
              </label>
              <label>
                <Typography.Text type="secondary">Skills, comma separated</Typography.Text>
                <Input
                  value={(draft.role?.skills ?? []).join(', ')}
                  onChange={(e) =>
                    set({
                      role: {
                        ...(draft.role ?? { title: '', team: null }),
                        skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      },
                    })
                  }
                  data-testid="jobcard-skills"
                />
              </label>
              <label>
                <Typography.Text type="secondary">Experience, as the listing words it</Typography.Text>
                <Input
                  value={draft.experience?.label ?? ''}
                  onChange={(e) => set({ experience: { ...(draft.experience ?? { min: null, max: null }), label: e.target.value } })}
                  data-testid="jobcard-experience"
                />
              </label>
              <label>
                <Typography.Text type="secondary">City</Typography.Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={draft.location?.city ?? ''}
                    onChange={(e) => set({ location: { ...(draft.location ?? { region: null, workMode: 'onsite' }), city: e.target.value } })}
                    data-testid="jobcard-city"
                  />
                  <Select
                    style={{ width: 120 }}
                    value={draft.location?.workMode ?? 'onsite'}
                    onChange={(v) => set({ location: { ...(draft.location ?? { city: '', region: null }), workMode: v } })}
                    options={MODES.map((m) => ({ value: m, label: m }))}
                  />
                </Space.Compact>
              </label>
              <label>
                <Typography.Text type="secondary">Salary range</Typography.Text>
                <Space.Compact style={{ width: '100%' }}>
                  <InputNumber
                    style={{ width: '28%' }}
                    value={draft.salary?.min}
                    onChange={(v) => setPay({ min: v })}
                    data-testid="jobcard-salary-min"
                  />
                  <InputNumber
                    style={{ width: '28%' }}
                    value={draft.salary?.max}
                    onChange={(v) => setPay({ max: v })}
                    data-testid="jobcard-salary-max"
                  />
                  <Input
                    style={{ width: '20%' }}
                    value={draft.salary?.unit ?? 'LPA'}
                    disabled={!draft.salary}
                    onChange={(e) => setPay({ unit: e.target.value })}
                  />
                  <Button
                    style={{ width: '24%' }}
                    disabled={!draft.salary}
                    onClick={() => set({ salary: undefined })}
                    data-testid="jobcard-salary-clear"
                  >
                    Not disclosed
                  </Button>
                </Space.Compact>
                {!draft.salary && (
                  <Typography.Text type="secondary" data-testid="jobcard-salary-hint">
                    No pay on this card: it prints Not disclosed.
                  </Typography.Text>
                )}
              </label>
            </div>

            <label style={{ display: 'block', marginTop: 12 }}>
              <Typography.Text type="secondary">Eligibility, one rule per line</Typography.Text>
              <Input.TextArea
                rows={3}
                value={(draft.eligibility ?? []).join('\n')}
                onChange={(e) => set({ eligibility: lines(e.target.value) })}
                data-testid="jobcard-eligibility"
              />
            </label>

            <div className="st-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <Typography.Text type="secondary">Selection process, as announced</Typography.Text>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {(draft.selectionProcess ?? []).length === 0 ? (
                    <Typography.Text type="secondary">none announced — the families that show it fall back</Typography.Text>
                  ) : (
                    (draft.selectionProcess ?? []).map((s) => (
                      <Tag key={s.step} style={{ marginBottom: 4 }}>
                        {s.step} · {s.label}
                      </Tag>
                    ))
                  )}
                </div>
              </div>
              <label>
                <Typography.Text type="secondary">Comment keyword and channel</Typography.Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={draft.cta?.keyword ?? ''}
                    placeholder={(draft.company?.name ?? '').split(' ')[0]?.toUpperCase()}
                    onChange={(e) => set({ cta: { ...(draft.cta ?? { channel: 'site' }), keyword: e.target.value } })}
                    data-testid="jobcard-keyword"
                  />
                  <Select
                    style={{ width: 130 }}
                    value={draft.cta?.channel ?? 'site'}
                    onChange={(v) => set({ cta: { ...(draft.cta ?? {}), channel: v } })}
                    options={CHANNELS.map((c) => ({ value: c, label: c }))}
                    data-testid="jobcard-channel"
                  />
                </Space.Compact>
                {(draft.cta?.channel ?? 'site') === 'site' && (
                  <Input
                    style={{ marginTop: 4 }}
                    value={draft.cta?.url ?? ''}
                    placeholder="the aiiolar.com page apply points at; filled in when saved if left empty"
                    onChange={(e) => set({ cta: { ...(draft.cta ?? { channel: 'site' }), url: e.target.value } })}
                    data-testid="jobcard-cta-url"
                  />
                )}
              </label>
            </div>

            {detail.row.fellBack && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12 }}
                title={`the picked family could not hold this job — it rendered as ${detail.row.family}`}
              />
            )}

            {shot && (
              <>
                <Divider style={{ margin: '16px 0 12px' }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot} alt="the rendered card" style={{ maxWidth: 'min(380px, 100%)', borderRadius: 8, border: '1px solid #eee' }} data-testid="jobcard-image" />
                <div style={{ marginTop: 12 }}>
                  <Space wrap>
                    <Button
                      icon={<SendOutlined />}
                      loading={sending}
                      disabled={sending}
                      onClick={sendToIntabot}
                      data-testid="jobcard-handoff"
                    >
                      Send to IntaBot
                    </Button>
                    {handoff && (
                      <Typography.Text type="success" data-testid="jobcard-handoff-status">
                        Queued in IntaBot · post {handoff.postId}
                      </Typography.Text>
                    )}
                  </Space>
                  {handoffError && (
                    <Alert type="error" showIcon style={{ marginTop: 8 }} title={handoffError} data-testid="jobcard-handoff-error" />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { Button, Drawer, Input, Progress, Steps, Tag } from 'antd';
import Link from 'next/link';
import { message } from '@/lib/ui/message';
import type { Finding } from '@/lib/verify/gates';
import type { PublishData } from './usePublish';

/** The steps shown per chapter, in the order the job runs them. */
const STEPS = ['generate', 'rules', 'facts', 'pedagogy', 'readability', 'fix'];
const REVIEW_PASSES = new Set(['rules', 'facts', 'pedagogy', 'readability']);

type PassState = 'ok' | 'minor' | 'bad' | 'run' | '';
const PASS_STYLE: Record<PassState, { bg: string; fg: string; mark: string }> = {
  '': { bg: 'rgba(128,128,128,.1)', fg: 'rgba(128,128,128,.9)', mark: '○' },
  run: { bg: '#e6f4ff', fg: '#1677ff', mark: '…' },
  ok: { bg: '#f6ffed', fg: '#389e0d', mark: '✓' },
  minor: { bg: '#fffbe6', fg: '#d48806', mark: '!' },
  bad: { bg: '#fff1f0', fg: '#cf1322', mark: '✕' },
};

/** A review pass takes its colour from its findings; generate and fix only say whether they ran. */
function stepState(name: string, jobState: string | undefined, findings: Finding[], hasVerdict: boolean): PassState {
  if (jobState === 'running') return 'run';
  if (jobState === 'failed') return 'bad';
  if (!REVIEW_PASSES.has(name)) return jobState === 'done' ? 'ok' : '';
  if (!hasVerdict) return '';
  const mine = findings.filter((f) => f.pass === name);
  if (mine.some((f) => f.severity === 'blocker' || f.severity === 'major')) return 'bad';
  return mine.length ? 'minor' : 'ok';
}

function Pill({ name, state }: { name: string; state: PassState }) {
  const st = PASS_STYLE[state];
  return (
    <span data-testid={`pass-${name}`} data-state={state || 'idle'} style={{ fontSize: 12, borderRadius: 999, padding: '1px 9px', background: st.bg, color: st.fg, display: 'inline-flex', gap: 5 }}>
      {st.mark} {name}
    </span>
  );
}

const SEV = { blocker: 0, major: 1, minor: 2 } as const;

function ChapterCard({ subject, slug, title, data, act, onDone }: {
  subject: string; slug: string; title: string; data: PublishData;
  act: (b: Record<string, unknown>) => Promise<unknown>; onDone: () => void;
}) {
  const c = data.state.chapters[slug];
  const job = data.job;
  const step = (pass: string) => job?.steps.find((s) => s.chapter === slug && s.pass === pass)?.state;
  const reviewing = !!job?.live && STEPS.some((p) => step(p) === 'running');
  const reused = !job?.live && STEPS.every((p) => step(p) === 'skipped');
  const sections = data.editions?.[slug] ?? [];
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const findings = [...(c?.findings ?? [])].sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const shown = findings.filter((f) => f.severity !== 'minor' || findings.length <= 2).slice(0, 3);
  const waiting = c?.verdict === 'unsure' && !c.approvedBy && !c.rejected;
  const run = async (body: Record<string, unknown>) => {
    try { await act(body); onDone(); } catch (e) { message.error(e instanceof Error ? e.message : 'failed'); }
  };

  let tag = <Tag>queued</Tag>;
  if (reviewing) tag = <Tag color="processing">reviewing</Tag>;
  else if (c?.rejected) tag = <Tag color="default">rejected</Tag>;
  else if (c?.verdict === 'fail') tag = <Tag color="error">failed</Tag>;
  else if (waiting) tag = <Tag color="warning">needs you</Tag>;
  else if (c?.approvedBy) tag = <Tag color="success">{reused ? 'unchanged, review reused' : c.approvedBy === 'human' ? 'approved by you' : 'passed'}</Tag>;
  else if (c?.verdict === 'pass') tag = <Tag color="warning">passed, waiting for you</Tag>;

  return (
    <div style={{ border: '1px solid rgba(128,128,128,.2)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
        {title}<span style={{ flex: 1 }} />{tag}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {STEPS.map((p) => <Pill key={p} name={p} state={stepState(p, step(p), c?.findings ?? [], !!c?.verdict)} />)}
      </div>
      {shown.map((f, i) => (
        <div key={i} style={{ marginTop: 8, fontSize: 13, borderRadius: 8, padding: '8px 10px', background: f.severity === 'minor' ? '#fffbe6' : f.severity === 'major' ? '#fff7e6' : '#fff1f0' }}>
          <b style={{ textTransform: 'capitalize' }}>{f.severity} · {f.pass}{f.page > 0 ? ` · page ${f.page}${sections[f.page - 1] ? ` (${sections[f.page - 1]})` : ''}` : ''}:</b> {f.summary}
        </div>
      ))}
      {!reviewing && c?.verdict && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {(waiting || (c.verdict === 'pass' && !c.approvedBy && !c.rejected)) && <Button size="small" type="primary" onClick={() => run({ action: 'approve', chapter: slug })}>Approve</Button>}
          {(waiting || c.verdict === 'fail') && (
            <Link href={`/handbooks/${subject}/${slug}?review=1`}>
              <Button size="small" type={c.verdict === 'fail' ? 'primary' : 'default'}>{c.verdict === 'fail' ? 'Fix with revise chat' : 'Send to revise chat'}</Button>
            </Link>
          )}
          {waiting && <Button size="small" onClick={() => run({ action: 'reject', chapter: slug })}>Reject</Button>}
          {sections.length > 0 && <Link href={`/handbooks/${subject}/${slug}/edition`}><Button size="small">Open the edition</Button></Link>}
          {!job?.live && sections.length > 0 && <Button size="small" onClick={() => run({ action: 'rereview', chapter: slug })}>Review again</Button>}
          {!job?.live && <Button size="small" onClick={() => setNotesOpen((v) => !v)}>Regenerate with notes</Button>}
        </div>
      )}
      {notesOpen && !reviewing && (
        <div style={{ marginTop: 8 }}>
          <Input.TextArea
            aria-label={`notes for ${title}`}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What should change? Name a section to rewrite only that one; otherwise every section is rewritten."
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <Button size="small" onClick={() => setNotesOpen(false)}>Cancel</Button>
            <Button size="small" type="primary" disabled={!notes.trim()} onClick={async () => { await run({ action: 'regenerate', chapter: slug, notes: notes.trim() }); setNotes(''); setNotesOpen(false); }}>Regenerate</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Remounts when the proposed order changes, so the draggable copy starts from the new one. */
function OrderStep(props: { data: PublishData; titles: Record<string, string>; act: (b: Record<string, unknown>) => Promise<unknown>; onDone: () => void }) {
  const order = props.data.state.order;
  if (!order) return <p>No order yet.</p>;
  return <OrderList key={`${order.order.join(',')}|${order.approvedBy ?? ''}`} {...props} />;
}

function OrderList({ data, titles, act, onDone }: {
  data: PublishData; titles: Record<string, string>; act: (b: Record<string, unknown>) => Promise<unknown>; onDone: () => void;
}) {
  const order = data.state.order!;
  const [list, setList] = useState<string[]>(order.order);
  const [drag, setDrag] = useState<string | null>(null);
  const move = (over: string) => {
    if (!drag || drag === over) return;
    setList((l) => {
      const next = l.filter((s) => s !== drag);
      next.splice(l.indexOf(over), 0, drag);
      return next;
    });
  };
  const pct = Math.round(order.confidence * 100);
  const needsYou = !order.approvedBy;
  const approve = async () => {
    try { await act({ action: 'order', order: list }); onDone(); } catch (e) { message.error(e instanceof Error ? e.message : 'failed'); }
  };

  return (
    <div>
      <p style={{ margin: '0 0 6px' }}>Proposed reading order for the handbook{needsYou ? ' (drag to change)' : ''}:</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 12px', fontSize: 13, opacity: 0.8 }}>
        confidence <Progress percent={pct} size="small" style={{ flex: 1, margin: 0 }} strokeColor={{ from: '#fcb045', to: '#833ab4' }} />
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((s, i) => {
          const pres = (order.prerequisites[s] ?? []).filter((p) => list.includes(p));
          return (
            <li
              key={s}
              draggable={needsYou}
              onDragStart={() => setDrag(s)}
              onDragOver={(e) => { e.preventDefault(); move(s); }}
              onDragEnd={() => setDrag(null)}
              style={{ display: 'grid', gridTemplateColumns: '24px 26px 1fr auto', gap: 8, alignItems: 'center', border: '1px solid rgba(128,128,128,.2)', borderRadius: 10, padding: '8px 10px', marginBottom: 6, cursor: needsYou ? 'grab' : 'default' }}
            >
              <span style={{ opacity: 0.4 }}>⋮⋮</span>
              <span style={{ width: 22, height: 22, borderRadius: '50%', backgroundImage: 'linear-gradient(135deg,#fcb045,#fd1d1d,#833ab4)', color: '#fff', fontSize: 12, display: 'grid', placeItems: 'center', fontWeight: 700 }}>{i + 1}</span>
              <span>
                <b>{titles[s] ?? s}</b>
                <br /><span style={{ fontSize: 12, opacity: 0.6 }}>{pres.length ? `after ${pres.map((p) => titles[p] ?? p).join(', ')}` : 'start here'}</span>
              </span>
              {data.live.includes(s) ? <Tag color="success">live</Tag> : <Tag color="processing">new</Tag>}
            </li>
          );
        })}
      </ol>
      {order.gaps.map((g, i) => <div key={`g${i}`} style={{ borderLeft: '3px solid #faad14', background: '#fffbe6', padding: '8px 10px', borderRadius: '0 8px 8px 0', fontSize: 13, margin: '10px 0' }}><b>Gap:</b> {g}</div>)}
      {order.overlaps.map((o, i) => <div key={`o${i}`} style={{ borderLeft: '3px solid #91caff', background: '#e6f4ff', padding: '8px 10px', borderRadius: '0 8px 8px 0', fontSize: 13, margin: '10px 0' }}><b>Overlap:</b> {o}</div>)}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <span style={{ marginRight: 'auto', fontSize: 13, opacity: 0.65 }}>
          {needsYou ? 'Waiting for you.' : `Approved by ${order.approvedBy === 'human' ? 'you' : 'the AI'}.`}
        </span>
        {needsYou && <Button type="primary" onClick={approve}>Approve order &amp; publish</Button>}
      </div>
    </div>
  );
}

/** One drawer for the whole run (reviews, order, result) and for the standing review queue. */
export function PublishDrawer({ open, mode, subject, data, titles, selected, act, onClose }: {
  open: boolean; mode: 'run' | 'queue'; subject: string; data: PublishData | null; titles: Record<string, string>;
  selected: string[]; act: (b: Record<string, unknown>) => Promise<unknown>; onClose: () => void;
}) {
  if (!data) return <Drawer open={open} onClose={onClose} size={620} title="Review & publish" />;
  const job = data.job;
  const runSlugs = job ? [...new Set(job.steps.filter((s) => s.chapter).map((s) => s.chapter))] : selected;
  const slugs = mode === 'queue' ? data.queue.chapters : runSlugs;
  const live = !!job?.live;
  const stage = live ? (job!.stage === 'reviews' ? 0 : job!.stage === 'order' ? 1 : 2) : data.queue.order ? 1 : 2;
  const current = mode === 'queue' ? -1 : stage;
  const failed = Object.entries(data.state.chapters).filter(([s, c]) => runSlugs.includes(s) && c.selected && c.verdict === 'fail').length;
  const waiting = data.queue.chapters.length;

  return (
    <Drawer open={open} onClose={onClose} size={620} title={`${mode === 'queue' ? 'Review queue' : 'Review & publish'} · ${subject}`}>
      {mode === 'run' && (
        <Steps size="small" current={current} style={{ marginBottom: 16 }} items={[{ title: 'Chapter reviews' }, { title: 'Learnable order' }, { title: 'Publish' }]} />
      )}
      {mode === 'queue' && !slugs.length && !data.queue.order && <p>Nothing is waiting for you.</p>}
      {(mode === 'queue' || stage === 0 || (stage === 2 && !live)) && slugs.map((s) => <ChapterCard key={s} subject={subject} slug={s} title={titles[s] ?? s} data={data} act={act} onDone={() => {}} />)}
      {mode === 'run' && stage === 0 && <p style={{ opacity: 0.6, fontSize: 13 }}>Runs in the background; you can close this.</p>}
      {mode === 'run' && stage === 1 && live && <p>Working out a learnable order...</p>}
      {((mode === 'run' && stage === 1 && !live) || (mode === 'queue' && data.queue.order)) && (
        <OrderStep data={data} titles={titles} act={act} onDone={() => {}} />
      )}
      {mode === 'run' && stage === 2 && (
        <div>
          {live ? <p>Publishing...</p> : (
            <>
              <p><b>{data.live.length ? 'Published to aiiolar.' : 'Nothing is live yet.'}</b></p>
              <p>
                {data.live.length} {data.live.length === 1 ? 'chapter goes' : 'chapters go'} live with the next sync. {waiting} wait in the Review queue. {failed} failed and stay off until fixed.
              </p>
              {job?.message && <p style={{ color: '#d48806' }}>{job.message}</p>}
              {data.live.length > 0 && <p style={{ opacity: 0.6 }}>Written: data/published/{subject}.handbook.json</p>}
              <Button type="primary" onClick={onClose}>Done</Button>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

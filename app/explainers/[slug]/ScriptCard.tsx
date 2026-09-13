'use client';
import React from 'react';
import { Alert, Button, Card, Input, InputNumber, Space, Tag, Typography } from 'antd';
import { message } from '@/lib/ui/message';
import { LoadingOutlined } from '@ant-design/icons';
import type { Brief, ExplainerDoc } from '@/lib/explainer/schema';
import type { FitReport } from '@/lib/explainer/fit';
import { missingForDraft } from '@/lib/explainer/brief';

/**
 * The writing stage on screen: the brief this explainer was written from, and two ways to change it.
 *
 * A model write is approved by a person. What comes back is shown as the list of changes it would
 * make; Approve puts it through the command layer as `agent`, which is one purple row in the
 * history panel and one press of Undo to take back.
 *
 * The local 27B takes minutes, not seconds, so the wait is given a running clock rather than one
 * line of reassurance. Cancel drops the answer; it cannot stop the model, and says so.
 */

type Proposal = { doc: ExplainerDoc; diff: string[]; fit: FitReport };

const BLANK: Brief = { topic: '', audience: '', claim: '', seconds: 18 };
const LEVEL_COLOUR: Record<string, string> = { good: 'default', warn: 'orange', bad: 'red' };

/** A label wide enough for the longest of them, so the four fields line up down the left. */
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
    <Typography.Text type="secondary" style={{ fontSize: 12, width: 62, paddingTop: 6, flexShrink: 0 }}>
      {label}
    </Typography.Text>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
);

/** mm:ss from a start time, ticking once a second while the model is out. */
function Elapsed({ since }: { since: number }) {
  // Seconds rather than a timestamp: reading the clock while rendering is impure, and counting
  // from zero is what the label says anyway.
  const [secs, setSecs] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setSecs(Math.max(0, Math.floor((Date.now() - since) / 1000))), 1000);
    return () => clearInterval(id);
  }, [since]);
  return <>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</>;
}

export default function ScriptCard({
  slug, doc, fit, onApplied,
}: {
  slug: string;
  doc: ExplainerDoc | null;
  fit: FitReport | null;
  onApplied: () => Promise<void> | void;
}) {
  // Derived, not synchronised. `edit` holds what was typed along with the brief it was typed
  // against; the page hands back a fresh document on every reload, so an approve, undo or redo
  // drops a stale draft by identity. Held in state alone, this form locked to BLANK on the first
  // render — when the document had not arrived yet — and stayed empty under a card that said it
  // was written from a brief.
  const [edit, setEdit] = React.useState<{ against: Brief | null; brief: Brief } | null>(null);
  const saved = doc?.brief ?? null;
  const brief = edit && edit.against === saved ? edit.brief : (saved ?? BLANK);
  const [instruction, setInstruction] = React.useState('');
  const [thinking, setThinking] = React.useState<'draft' | 'revise' | null>(null);
  const [startedAt, setStartedAt] = React.useState(0);
  const [proposal, setProposal] = React.useState<Proposal | null>(null);
  const [applying, setApplying] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);

  const set = (patch: Partial<Brief>) => setEdit({ against: saved, brief: { ...brief, ...patch } });

  const ask = async (mode: 'draft' | 'revise') => {
    const controller = new AbortController();
    abort.current = controller;
    setThinking(mode);
    setStartedAt(Date.now());
    setProposal(null);
    try {
      const r = await fetch(`/api/explainers/${slug}/author`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'draft' ? { mode, brief } : { mode, instruction }),
        signal: controller.signal,
      });
      const body = await r.json();
      if (!r.ok) {
        message.error(body.error ?? 'the model would not answer');
        return;
      }
      if (body.diff.length === 0) {
        message.info('it came back with the same document');
        return;
      }
      setProposal(body);
    } catch (err) {
      // An aborted fetch is not a failure; it is the thing the button was for.
      if ((err as Error)?.name !== 'AbortError') {
        message.error('the model would not answer');
      }
    } finally {
      abort.current = null;
      setThinking(null);
    }
  };

  const stop = () => abort.current?.abort();

  /** Approve is a command like any other, which is what makes it undoable. */
  const approve = async () => {
    if (!proposal) return;
    setApplying(true);
    try {
      const r = await fetch(`/api/explainers/${slug}/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'doc.replace', args: { doc: proposal.doc }, actor: 'agent' }),
      });
      const body = await r.json();
      if (!r.ok) {
        message.error(body.error ?? 'it would not apply');
        return;
      }
      setProposal(null);
      setInstruction('');
      message.success('applied — Undo takes it back');
      await onApplied();
    } finally {
      setApplying(false);
    }
  };

  const busy = thinking !== null || applying;
  const missing = missingForDraft(brief);
  const beats = doc?.beats.length ?? 0;

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Card
        size="small"
        title="Script"
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {doc?.brief ? 'written from this brief' : 'no brief yet'}
          </Typography.Text>
        }
      >
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Field label="Topic">
            <Input
              placeholder="What it is about"
              value={brief.topic}
              onChange={(e) => set({ topic: e.target.value })}
            />
          </Field>
          <Field label="Audience">
            <Input
              placeholder="Who it is for — engineers, if you leave it"
              value={brief.audience}
              onChange={(e) => set({ audience: e.target.value })}
            />
          </Field>
          <Field label="Claim">
            <Input.TextArea
              placeholder="The one thing that must land"
              autoSize={{ minRows: 2, maxRows: 3 }}
              value={brief.claim}
              onChange={(e) => set({ claim: e.target.value })}
            />
          </Field>
          <Field label="Length">
            <Space size={8}>
              <InputNumber
                min={6}
                max={60}
                value={brief.seconds}
                onChange={(v) => set({ seconds: Number(v ?? 16) })}
                suffix="s"
                style={{ width: 96 }}
              />
              {fit ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  the board runs {fit.seconds}s
                </Typography.Text>
              ) : null}
            </Space>
          </Field>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 }}>
            <Button
              type="primary"
              loading={thinking === 'draft'}
              disabled={busy || !!missing}
              onClick={() => void ask('draft')}
            >
              {beats ? `Rewrite all ${beats} beats` : 'Write it'}
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {/* The disabled reason wins the slot: it is the only one that is actionable. */}
              {missing ?? 'Replaces the whole document. Undo takes it back.'}
            </Typography.Text>
          </div>
        </Space>
      </Card>

      <Card size="small" title="Change one thing">
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="“shorter, and keep the claim”"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onPressEnter={() => instruction.trim() && !busy && void ask('revise')}
          />
          <Button
            loading={thinking === 'revise'}
            disabled={busy || !instruction.trim()}
            onClick={() => void ask('revise')}
          >
            Revise
          </Button>
        </Space.Compact>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          Keeps the board and rewrites what you asked about.
        </Typography.Text>
      </Card>

      {thinking ? (
        <Alert
          type="info"
          icon={<LoadingOutlined />}
          showIcon
          title={<>Thinking — <Elapsed since={startedAt} /></>}
          description="The local model takes a few minutes. Cancel stops waiting for the answer; it does not stop the model."
          action={<Button size="small" onClick={stop}>Cancel</Button>}
        />
      ) : null}

      {proposal ? (
        <Card
          size="small"
          title={`It would make ${proposal.diff.length} change${proposal.diff.length === 1 ? '' : 's'}`}
          extra={
            <Space>
              <Button size="small" onClick={() => setProposal(null)} disabled={applying}>Discard</Button>
              <Button size="small" type="primary" loading={applying} onClick={() => void approve()}>Approve</Button>
            </Space>
          }
        >
          <div style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', lineHeight: 1.8 }}>
            {proposal.diff.map((line) => <div key={line}>{line}</div>)}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {proposal.fit.seconds}s
            {proposal.fit.target ? ` against ${proposal.fit.target}s` : ''}
            {' · '}{proposal.fit.busiestBoard} rows at its busiest
          </Typography.Text>
        </Card>
      ) : null}

      {fit ? (
        <Card size="small" title="Fit" styles={{ body: { padding: 0 } }}>
          {[...fit.notes]
            .sort((a, b) => Number(b.level === 'bad') - Number(a.level === 'bad'))
            .map((note) => (
              <div
                key={note.text}
                style={{ padding: '8px 14px', fontSize: 12, borderBottom: '1px solid rgba(128,128,128,.12)' }}
              >
                <Tag color={LEVEL_COLOUR[note.level]} style={{ marginInlineEnd: 6 }}>{note.level}</Tag>
                {note.text}
              </div>
            ))}
        </Card>
      ) : null}
    </Space>
  );
}

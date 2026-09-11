'use client';
import React from 'react';
import { Alert, Button, Card, Input, InputNumber, Space, Tag, Typography, message } from 'antd';
import type { Brief, ExplainerDoc } from '@/lib/explainer/schema';
import type { FitReport } from '@/lib/explainer/fit';

/**
 * The writing stage on screen: four inputs, two buttons, and a proposal nobody applied yet.
 *
 * A model write is approved by a person. What comes back is shown as the list of changes it would
 * make; Approve puts it through the command layer as `agent`, which is one purple row in the
 * history panel and one press of Undo to take back.
 */

type Proposal = { doc: ExplainerDoc; diff: string[]; fit: FitReport };

const BLANK: Brief = { topic: '', audience: '', claim: '', seconds: 18 };
const LEVEL_COLOUR: Record<string, string> = { good: 'default', warn: 'orange', bad: 'red' };

export default function ScriptCard({
  slug, doc, fit, onApplied,
}: {
  slug: string;
  doc: ExplainerDoc | null;
  fit: FitReport | null;
  onApplied: () => Promise<void> | void;
}) {
  const [brief, setBrief] = React.useState<Brief>(doc?.brief ?? BLANK);
  const [instruction, setInstruction] = React.useState('');
  const [thinking, setThinking] = React.useState<'draft' | 'revise' | null>(null);
  const [proposal, setProposal] = React.useState<Proposal | null>(null);
  const [applying, setApplying] = React.useState(false);

  const set = (patch: Partial<Brief>) => setBrief((b) => ({ ...b, ...patch }));

  const ask = async (mode: 'draft' | 'revise') => {
    setThinking(mode);
    setProposal(null);
    try {
      const r = await fetch(`/api/explainers/${slug}/author`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'draft' ? { mode, brief } : { mode, instruction }),
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
    } finally {
      setThinking(null);
    }
  };

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

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small" title="Script">
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Input
            placeholder="Topic — what it is about"
            value={brief.topic}
            onChange={(e) => set({ topic: e.target.value })}
          />
          <Input
            placeholder="Audience — who it is for"
            value={brief.audience}
            onChange={(e) => set({ audience: e.target.value })}
          />
          <Input.TextArea
            placeholder="The one thing that must land"
            autoSize={{ minRows: 2, maxRows: 3 }}
            value={brief.claim}
            onChange={(e) => set({ claim: e.target.value })}
          />
          <Space>
            <InputNumber
              min={6}
              max={60}
              value={brief.seconds}
              onChange={(v) => set({ seconds: Number(v ?? 16) })}
              suffix="s"
            />
            <Button
              type="primary"
              loading={thinking === 'draft'}
              disabled={busy || !brief.topic.trim() || !brief.claim.trim()}
              onClick={() => void ask('draft')}
            >
              Draft
            </Button>
          </Space>

          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="Or change one thing — “shorter, and keep the claim”"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onPressEnter={() => instruction.trim() && void ask('revise')}
            />
            <Button
              loading={thinking === 'revise'}
              disabled={busy || !instruction.trim()}
              onClick={() => void ask('revise')}
            >
              Revise
            </Button>
          </Space.Compact>

          {thinking ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Thinking. This takes a while on the local model.
            </Typography.Text>
          ) : null}
        </Space>
      </Card>

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

      {doc && !doc.brief ? (
        <Alert
          type="info"
          showIcon
          title="No brief on this one"
          description="Fill the four fields in and press Draft to rewrite it, or use Revise to change one thing at a time."
        />
      ) : null}
    </Space>
  );
}

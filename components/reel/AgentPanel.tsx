'use client';
import React, { useState } from 'react';
import { Alert, Button, Input, Space, Spin, Tag, Typography } from 'antd';
import { RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';

/**
 * Where you tell the agent what is wrong with the reel.
 *
 * The agent proposes; this is where the proposal is read and accepted. Apply is
 * offered only when every command previewed cleanly — a plan that would half-land
 * is shown with its reasons instead, because the measured failure mode of a small
 * model is a well-formed command carrying the wrong value, not a malformed one.
 */

type Command = { op: string; args: Record<string, unknown>; actor?: string };
type Applied = { index: number; op: string; summary: string };
type Rejected = { index: number; op: string; error: string; detail?: unknown };

type Proposal = {
  provider?: string;
  commands: Command[];
  applied: Applied[];
  rejected: Rejected[];
  note?: string;
  raw?: string;
};

export type AgentPanelProps = {
  slug: string;
  /** Fires with the reel the apply produced, so the studio can adopt it. */
  onApplied?: (reel: unknown) => void;
};

function AgentPanel({ slug, onApplied }: AgentPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<'ask' | 'apply' | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy('ask');
    setError(null);
    setProposal(null);
    try {
      const res = await fetch(`/api/reel/${slug}/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? 'the agent failed');
      setProposal({ commands: [], applied: [], rejected: [], ...data });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!proposal) return;
    setBusy('apply');
    setError(null);
    try {
      const res = await fetch(`/api/reel/${slug}/agent/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commands: proposal.commands }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Some of the plan may have landed. Say how far it got rather than
        // implying the whole thing failed.
        const landed = data.applied?.length
          ? ` ${data.applied.length} command(s) landed first and can be undone.`
          : '';
        setError(`${data.error ?? 'apply failed'}.${landed}`);
        if (data.reel) onApplied?.(data.reel);
        return;
      }
      onApplied?.(data.reel);
      // Clear it: a proposal describes a reel that no longer exists.
      setProposal(null);
      setPrompt('');
    } finally {
      setBusy(null);
    }
  };

  const clean = !!proposal && proposal.rejected.length === 0 && proposal.commands.length > 0;

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="small" data-testid="agent-panel">
      <Space style={{ width: '100%' }} size="small">
        <RobotOutlined />
        <Typography.Text strong>Ask the agent</Typography.Text>
        {proposal?.provider && (
          <Tag data-testid="agent-provider" color={proposal.provider === 'local' ? 'green' : 'blue'}>
            {proposal.provider}
          </Tag>
        )}
      </Space>

      <Input.TextArea
        data-testid="agent-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="the captions drift after 20s, fix them"
        autoSize={{ minRows: 2, maxRows: 4 }}
        disabled={busy !== null}
      />

      <Button
        data-testid="agent-run"
        type="primary"
        icon={<ThunderboltOutlined />}
        disabled={!prompt.trim() || busy !== null}
        onClick={ask}
      >
        {busy === 'ask' ? 'thinking…' : 'Propose edits'}
      </Button>

      {busy === 'ask' && <Spin size="small" />}

      {error && <Alert type="error" showIcon message={error} />}

      {proposal && (
        <>
          {proposal.note && <Alert type="info" showIcon message={proposal.note} />}

          {proposal.applied.length > 0 && (
            <div data-testid="agent-plan">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Proposed
              </Typography.Text>
              {proposal.applied.map((a) => (
                <div key={a.index} style={{ fontSize: 13, padding: '2px 0' }}>
                  {a.summary}
                </div>
              ))}
            </div>
          )}

          {proposal.rejected.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="This plan would not fully apply, so it is not offered."
              description={proposal.rejected.map((r) => (
                <div key={r.index} style={{ fontSize: 12 }}>
                  {r.op}: {r.error}
                </div>
              ))}
            />
          )}

          {/* The model returned something unparseable; show it rather than pretend. */}
          {proposal.raw && proposal.commands.length === 0 && (
            <Alert type="warning" message="The agent's reply could not be read as edits" description={
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{proposal.raw.slice(0, 600)}</pre>
            } />
          )}

          <Space>
            {clean && (
              <Button data-testid="agent-apply" type="primary" loading={busy === 'apply'} onClick={apply}>
                Apply {proposal.commands.length} edit{proposal.commands.length === 1 ? '' : 's'}
              </Button>
            )}
            <Button data-testid="agent-discard" onClick={() => setProposal(null)} disabled={busy !== null}>
              Discard
            </Button>
          </Space>
        </>
      )}
    </Space>
  );
}

// Nothing here depends on the playhead; memoising keeps a playing reel from
// re-rendering the panel on every frame.
export default React.memo(AgentPanel);

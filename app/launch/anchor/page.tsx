'use client';
import React from 'react';
import { Alert, Button, Card, Space, Typography } from 'antd';
import Link from 'next/link';
import { message } from '@/lib/ui/message';
import type { Anchor, Candidate } from '@/lib/launch/anchor';

/** The channel's anchor: the one face every avatar reel uses. Proposing faces costs about 0.5 credits. */

const PHOTO: React.CSSProperties = { width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 8, display: 'block', border: '1px solid rgba(128,128,128,.3)' };

export default function AnchorPage() {
  const [anchor, setAnchor] = React.useState<Anchor | null>(null);
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [busy, setBusy] = React.useState<'propose' | string | null>(null);
  const [stamp, setStamp] = React.useState(() => Date.now());

  const load = React.useCallback(async () => {
    const body = await fetch('/api/launch/anchor', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    setAnchor(body.anchor ?? null);
    setCandidates(body.candidates ?? []);
    setStamp(Date.now());
  }, []);
  // The first read after mount; the state it sets arrives after the fetch, not during the render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  const post = async (payload: object, working: string) => {
    setBusy(working);
    try {
      const r = await fetch('/api/launch/anchor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { message.error(body.error ?? 'that did not work'); return false; }
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Link href="/launch" style={{ fontSize: 12 }}>← Launch reels</Link>
        <Typography.Title level={3} style={{ margin: 0 }}>Anchor</Typography.Title>
        <Typography.Text type="secondary">The face of the channel in every avatar reel.</Typography.Text>
      </div>

      <Alert type="warning" showIcon title="Changing the anchor changes the channel's face. Every reel made after it uses the new one." />

      <Card size="small" title="Locked anchor">
        {anchor ? (
          <div style={{ maxWidth: 320 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/launch/anchor/portrait.png?v=${stamp}`} alt="The locked anchor" style={PHOTO} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>locked {new Date(anchor.lockedAt).toLocaleDateString()}</Typography.Text>
          </div>
        ) : (
          <Typography.Text type="secondary">No anchor yet. Propose faces below and use one.</Typography.Text>
        )}
      </Card>

      <Card size="small" title="New faces" extra={<Typography.Text type="secondary">about 0.5 credits</Typography.Text>}>
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Button type="primary" loading={busy === 'propose'} disabled={busy !== null} onClick={() => void post({ action: 'propose' }, 'propose')}>
            Propose 4 new faces
          </Button>
          {candidates.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {candidates.map((c) => (
                <div key={c.jobId}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${c.url}?v=${stamp}`} alt="A proposed face" style={PHOTO} />
                  <Button size="small" style={{ marginTop: 6 }} loading={busy === c.jobId} disabled={busy !== null || anchor?.imageJobId === c.jobId} onClick={() => void post({ action: 'lock', jobId: c.jobId }, c.jobId)}>
                    {anchor?.imageJobId === c.jobId ? 'Current anchor' : 'Use this one'}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Typography.Text type="secondary">No proposed faces yet.</Typography.Text>
          )}
        </Space>
      </Card>
    </Space>
  );
}

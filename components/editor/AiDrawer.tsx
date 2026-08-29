'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Input, Segmented, Space, Spin, Typography, message } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import type { Post } from '@/lib/schema';
import type { SlideDiff } from '@/lib/ai/diff';
import DiffCard from './DiffCard';
import { fetchWithRetry } from '@/lib/http';

type Msg = { role: string; text: string; ts: string };
type Scope = 'slide' | 'post' | 'caption';

export default function AiDrawer({
  subject, chapter, part, post, slideIndex, open, prefill, onOpen, onClose, onApplied,
}: {
  subject: string;
  chapter: string;
  part: number;
  post: Post;
  slideIndex: number;
  open: boolean;
  prefill: string;
  onOpen: () => void;
  onClose: () => void;
  onApplied: (p: Post) => void | Promise<void>;
}) {
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [scope, setScope] = useState<Scope>('post');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Post | null>(null);
  const [diff, setDiff] = useState<SlideDiff[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      fetch(`/api/handbooks/${subject}/${chapter}/parts/${part}/revise`).then((r) => r.json()).then((d) => setHistory(d.history ?? []));
      if (prefill) { setInput(prefill); setScope('post'); }
    }
  }, [open, subject, chapter, part, prefill]);

  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: bodyRef.current.scrollHeight });
  }, [history, diff, busy]);

  const send = async () => {
    const request = input.trim();
    if (!request || busy) return;
    setBusy(true);
    setInput('');
    setProposal(null);
    setDiff([]);
    setHistory((h) => [...h, { role: 'user', text: request, ts: new Date().toISOString() }]);
    try {
      const r = await fetchWithRetry(`/api/handbooks/${subject}/${chapter}/parts/${part}/revise`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request, scope, slideIndex: scope === 'slide' ? slideIndex : undefined }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? 'revise failed');
      setProposal(body.proposal);
      setDiff(body.diff);
      setHistory((h) => [...h, {
        role: 'assistant',
        text: body.diff.length ? `Proposed changes to ${body.diff.length} slide(s) — review below.` : 'No changes needed.',
        ts: new Date().toISOString(),
      }]);
    } catch (err) {
      message.error(String(err));
      setHistory((h) => [...h, { role: 'assistant', text: `Error: ${String(err)}`, ts: new Date().toISOString() }]);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!proposal) return;
    await onApplied(proposal);
    setProposal(null);
    setDiff([]);
    message.success('Applied & re-rendering');
  };

  return (
    <>
      <Button
        type="primary"
        onClick={onOpen}
        style={{
          position: 'fixed', right: 24, bottom: 24, zIndex: 100, borderRadius: 24,
          background: 'linear-gradient(135deg,#7c5cff,#3ec5ff)', border: 'none',
          boxShadow: '0 6px 20px rgba(124,92,255,.5)',
        }}
      >
        ✦ Revise with AI
      </Button>

      <Drawer
        title="✦ Revise with AI"
        open={open}
        onClose={onClose}
        width={400}
        styles={{ body: { display: 'flex', flexDirection: 'column', padding: 0 } }}
      >
        <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(128,128,128,.15)' }}>
          <Segmented
            value={scope}
            onChange={(v) => setScope(v as Scope)}
            options={[
              { label: 'This slide', value: 'slide' },
              { label: 'Whole post', value: 'post' },
              { label: 'Caption', value: 'caption' },
            ]}
          />
        </div>

        <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {history.map((m, i) => (
            <div
              key={i}
              style={{
                maxWidth: '88%', padding: '8px 12px', borderRadius: 12, fontSize: 13,
                marginBottom: 8, lineHeight: 1.5,
                marginLeft: m.role === 'user' ? 'auto' : 0,
                background: m.role === 'user' ? '#7c5cff' : 'rgba(128,128,128,.12)',
                color: m.role === 'user' ? '#fff' : undefined,
              }}
            >
              {m.text}
            </div>
          ))}
          {busy && <Spin size="small" style={{ display: 'block', margin: '8px 0' }} />}
          {diff.map((d) => <DiffCard key={d.slide} diff={d} />)}
          {proposal && (
            <Space style={{ marginTop: 4 }}>
              <Button type="primary" size="small" onClick={apply}>✓ Apply & re-render</Button>
              <Button size="small" onClick={() => { setProposal(null); setDiff([]); }}>Discard</Button>
            </Space>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid rgba(128,128,128,.15)' }}>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder='e.g. "fit this into 7 slides", "split slide 3", "add an Interview Tip about tuples"'
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={busy}
          />
          <Button icon={<SendOutlined />} onClick={send} loading={busy} aria-label="send-request" />
        </div>
      </Drawer>
    </>
  );
}

'use client';
import React, { useState } from 'react';
import { Button, Input, Space, Typography } from 'antd';
import { message } from '@/lib/ui/message';
import { CheckOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';

/**
 * One beat's line, editable in place.
 *
 * It goes through the command registry like every other edit, so the history, the undo
 * stack and the agent all see the same operation. What it cannot fix is the audio: the take
 * on disk still speaks the old words, and the Voice panel is where that gets said.
 */

type Props = { slug: string; beatId: string; text: string; onEdited?: () => void };

export default function BeatText({ slug, beatId, text, onEdited }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/reel/${slug}/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'beat.text', args: { beatId, text: draft.trim() }, actor: 'ui' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'that line was refused');
      message.success(`${beatId} rewritten`);
      setEditing(false);
      onEdited?.();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <Space align="start">
        <Typography.Paragraph data-testid="beat-text" style={{ marginBottom: 0 }}>
          {text}
        </Typography.Paragraph>
        <Button
          data-testid="beat-edit"
          size="small"
          type="text"
          icon={<EditOutlined />}
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        />
      </Space>
    );
  }

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="small">
      <Input.TextArea
        data-testid="beat-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoSize={{ minRows: 2, maxRows: 6 }}
      />
      <Space>
        <Button
          data-testid="beat-save"
          size="small"
          type="primary"
          icon={<CheckOutlined />}
          loading={busy}
          disabled={!draft.trim()}
          onClick={save}
        >
          Save
        </Button>
        <Button data-testid="beat-cancel" size="small" icon={<CloseOutlined />} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </Space>
    </Space>
  );
}

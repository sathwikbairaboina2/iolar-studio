'use client';
import { Button } from 'antd';

/** Appears under the list while anything is ticked. */
export function PublishBar({ count, toReview, anyLive, busy, onClear, onUnpublish, onGo }: {
  count: number; toReview: number; anyLive: boolean; busy: boolean;
  onClear: () => void; onUnpublish: () => void; onGo: () => void;
}) {
  if (!count) return null;
  return (
    <div
      style={{
        position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 14, marginTop: 14,
        padding: '12px 18px', background: 'var(--ant-color-bg-container, #fff)', borderTop: '1px solid rgba(128,128,128,.2)',
        boxShadow: '0 -6px 24px rgba(0,0,0,.06)', borderRadius: 12,
      }}
    >
      <b>{count} selected</b>
      <span style={{ opacity: 0.6, fontSize: 13 }}>
        {toReview ? `${toReview} will be reviewed first; unchanged reviewed chapters are skipped` : 'all selected are live'}
      </span>
      <span style={{ flex: 1 }} />
      <Button onClick={onClear}>Clear</Button>
      {anyLive && <Button onClick={onUnpublish}>Take off aiiolar</Button>}
      <Button type="primary" disabled={busy} onClick={onGo}>Review &amp; publish</Button>
    </div>
  );
}

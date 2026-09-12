'use client';
import React from 'react';
import { Button, Popconfirm, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlayCircleOutlined, PictureOutlined } from '@ant-design/icons';
import type { ExplainerSummary } from '@/lib/explainer/store';
import { ago } from '@/lib/explainer/browse';

/**
 * The shelf: one card per explainer, with the board it renders to on the front of it.
 *
 * A table of six text columns is the wrong shape for a thing whose whole output is a picture. The
 * poster is the frame three quarters of the way through the reel, which is the fullest the board
 * ever gets — an explainer is one scene that fills up as its beats mutate it.
 */

const CARD: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  border: '1px solid rgba(128,128,128,.22)', borderRadius: 12,
  background: 'rgba(128,128,128,.04)', cursor: 'pointer',
};

/**
 * A square window onto a 9:16 still: the title, the subtitle and the top two tiers.
 *
 * Any crop of a vertical board cuts a card in half somewhere, so the bottom edge is faded rather
 * than sliced — a soft edge reads as "there is more of this", a hard one reads as a bug.
 */
const WINDOW: React.CSSProperties = {
  position: 'relative', width: '100%', aspectRatio: '1 / 1',
  overflow: 'hidden', background: 'rgba(128,128,128,.10)',
};

const FADE: React.CSSProperties = {
  position: 'absolute', left: 0, right: 0, bottom: 0, height: '22%',
  background: 'linear-gradient(to bottom, transparent, rgba(128,128,128,.10))',
  pointerEvents: 'none',
};

function Poster({ row }: { row: ExplainerSummary }) {
  const [broken, setBroken] = React.useState(false);
  if (!row.poster || broken) {
    return (
      <div style={{ ...WINDOW, display: 'grid', placeItems: 'center' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <PictureOutlined style={{ marginInlineEnd: 6 }} />
          no still yet
        </Typography.Text>
      </div>
    );
  }
  return (
    <div style={WINDOW}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        // The render's timestamp is the cache key: a new render is a new URL, so the shelf never
        // shows the board from before the change you just made.
        src={`/api/explainers/${row.slug}/poster?v=${encodeURIComponent(row.renderedAt ?? '')}`}
        alt=""
        onError={() => setBroken(true)}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%',
          // Anchored to the top, so the crop takes the title and the board and drops the log
          // panel, rather than centring on the quiet middle of the frame.
          display: 'block',
        }}
      />
      <div style={FADE} />
    </div>
  );
}

export default function ExplainerShelf({
  rows, onOpen, onDelete,
}: {
  rows: ExplainerSummary[];
  onOpen: (slug: string) => void;
  onDelete: (slug: string) => void;
}) {
  return (
    <div
      style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fill, minmax(264px, 1fr))',
      }}
    >
      {rows.map((row) => (
        <div
          key={row.slug}
          style={CARD}
          onClick={() => onOpen(row.slug)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onOpen(row.slug); }}
        >
          <Poster row={row} />

          <div style={{ padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Typography.Text strong ellipsis={{ tooltip: row.title }} style={{ lineHeight: 1.3 }}>
              {row.title}
            </Typography.Text>

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.seconds}s · {row.beats} beat{row.beats === 1 ? '' : 's'}
            </Typography.Text>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <Tag style={{ marginInlineEnd: 0 }}>{row.theme}</Tag>
              <Tooltip title={`edited ${ago(row.updatedAt)}`}>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {row.renderedAt ? `rendered ${ago(row.renderedAt)}` : 'never rendered'}
                </Typography.Text>
              </Tooltip>
            </div>

            {/* Stop propagation on the row of actions, or every one of them also opens the card. */}
            <div
              style={{ display: 'flex', gap: 4, marginTop: 2 }}
              onClick={(e) => e.stopPropagation()}
            >
              <Tooltip title={row.renderedAt ? 'Play the reel' : 'Nothing rendered yet'}>
                <Button
                  size="small"
                  type="text"
                  icon={<PlayCircleOutlined />}
                  disabled={!row.renderedAt}
                  href={row.renderedAt ? `/api/explainers/${row.slug}/mp4` : undefined}
                  target="_blank"
                />
              </Tooltip>
              <div style={{ flex: 1 }} />
              <Popconfirm
                title="Delete this explainer?"
                description="The document, its history and every render go with it."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={() => onDelete(row.slug)}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

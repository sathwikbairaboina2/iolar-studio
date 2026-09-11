'use client';
import React from 'react';
import type { Row, Scene } from '@/lib/explainer/schema';

/**
 * A cheap, faithful-enough drawing of the board for the editor.
 *
 * Remotion owns the real render. This exists so selecting a beat shows what changed instantly,
 * without a job. It is deliberately an approximation: same layout rules, same state colours, same
 * ordering — not the same pixels. Anything that must be exact is checked by rendering.
 */

const PALETTE = {
  dark: { bg: '#0B0B0F', surface: '#FFFFFF08', line: '#8A8A9455', fg: '#F5F5F7', muted: '#8A8A94', accent: '#FF4D2E', good: '#3DDC84', warn: '#FFB020', bad: '#FF3B30' },
  light: { bg: '#F3E9D6', surface: '#00000008', line: '#6B5A4433', fg: '#2B2118', muted: '#7A6A55', accent: '#A3341F', good: '#3F6B45', warn: '#A9781C', bad: '#9C2B21' },
};

const colourFor = (state: Row['state'], p: typeof PALETTE.dark) =>
  state === 'good' ? p.good : state === 'warn' ? p.warn : state === 'bad' ? p.bad : p.fg;

type Placed = Row & { x: number; y: number };

const place = (rows: Row[]): Placed[] => {
  const tiers = Array.from(new Set(rows.map((r) => r.tier))).sort((a, b) => a - b);
  const [top, bottom] = tiers.length <= 2 ? [27, 73] : tiers.length === 3 ? [16, 84] : [11, 89];
  return rows.map((r) => {
    const ti = tiers.indexOf(r.tier);
    const peers = rows.filter((o) => o.tier === r.tier).sort((a, b) => a.col - b.col);
    const ci = peers.findIndex((o) => o.id === r.id);
    return {
      ...r,
      x: peers.length === 1 ? 50 : 17 + (ci / (peers.length - 1)) * 66,
      y: tiers.length === 1 ? 50 : top + (ti / (tiers.length - 1)) * (bottom - top),
    };
  });
};

export default function ScenePreview({ scene, mode = 'dark' }: { scene: Scene; mode?: 'light' | 'dark' }) {
  const p = PALETTE[mode];
  const asDiagram = scene.links.length > 0 || scene.rows.some((r) => r.tier > 0);
  const nodes = place(scene.rows);
  const at = (id: string) => nodes.find((n) => n.id === id);

  return (
    <div
      style={{
        aspectRatio: '9 / 16', width: '100%', background: p.bg, borderRadius: 14,
        border: `1px solid ${p.line}`, overflow: 'hidden', position: 'relative',
        display: 'flex', flexDirection: 'column', padding: '5% 4.5% 6%',
        fontFamily: mode === 'light' ? 'Georgia, serif' : 'Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: p.fg, fontSize: '3.1cqw', fontWeight: 800, lineHeight: 1.1, textTransform: mode === 'light' ? 'none' : 'uppercase' }}>
          {scene.title}
        </div>
        <div style={{ color: p.muted, fontSize: '1.6cqw', marginTop: 5, fontFamily: 'ui-monospace, monospace', minHeight: '1.6cqw' }}>
          {scene.subtitle ?? ''}
        </div>
      </div>

      <div style={{ position: 'relative', flex: 1, margin: '4% 0' }}>
        {asDiagram ? (
          <>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              {scene.links.map((l) => {
                const a = at(l.from);
                const b = at(l.to);
                if (!a || !b) return null;
                const live = l.state !== 'idle';
                const c = live ? colourFor(l.state, p) : p.muted;
                return (
                  <line
                    key={`${l.from}-${l.to}`}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={live ? `${c}99` : `${p.muted}33`} strokeWidth={1}
                    strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
            {nodes.map((n) => (
              <div key={n.id} style={{ position: 'absolute', left: `${n.x}%`, top: `${n.y}%`, transform: 'translate(-50%,-50%)' }}>
                <NodeChip row={n} p={p} />
              </div>
            ))}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4%', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            {scene.rows.map((r) => <NodeChip key={r.id} row={r} p={p} />)}
          </div>
        )}
      </div>

      {scene.note ? (
        <div style={{ padding: '2.2% 2.6%', borderRadius: 8, background: p.surface, borderLeft: `4px solid ${p.accent}`, color: p.fg, fontSize: '2cqw', fontWeight: 700, marginBottom: 8 }}>
          {scene.note}
        </div>
      ) : null}

      {scene.panel.length ? (
        <div style={{ border: `1px solid ${p.line}`, borderRadius: 8, overflow: 'hidden' }}>
          {scene.panel.map((line, i) => {
            const lit = line.state !== 'idle';
            const c = colourFor(line.state, p);
            return (
              <div
                key={`${i}-${line.text}`}
                style={{
                  padding: '1.6% 2.2%', fontFamily: 'ui-monospace, monospace', fontSize: '1.6cqw',
                  color: lit ? c : p.muted, background: lit ? `${c}14` : 'transparent',
                  borderLeft: `3px solid ${lit ? c : 'transparent'}`,
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function NodeChip({ row, p }: { row: Row; p: typeof PALETTE.dark }) {
  const live = row.state !== 'idle';
  const c = colourFor(row.state, p);
  return (
    <div
      style={{
        border: `1.5px solid ${live ? c : p.line}`, borderRadius: 10, padding: '5px 10px',
        background: live ? `${c}14` : p.surface, textAlign: 'center', minWidth: 72,
      }}
    >
      <div style={{ color: p.fg, fontSize: '1.5cqw', fontWeight: 700, letterSpacing: 0.6, whiteSpace: 'nowrap' }}>
        {row.label}
      </div>
      {row.value !== null ? (
        <div style={{ color: c, fontSize: '2cqw', fontWeight: 800, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
          {row.value}{row.unit}
        </div>
      ) : null}
      {row.sub ? <div style={{ color: p.muted, fontSize: '1.2cqw', whiteSpace: 'nowrap' }}>{row.sub}</div> : null}
    </div>
  );
}

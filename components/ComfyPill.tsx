'use client';
import { useEffect, useState } from 'react';
import { Progress, Tooltip } from 'antd';

type Status = { up: boolean; gpu?: string; vramFreeGb?: number; vramTotalGb?: number };

export default function ComfyPill() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/comfy/status');
        const s = await r.json();
        if (alive) setStatus(s);
      } catch {
        if (alive) setStatus({ up: false });
      }
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const up = status?.up ?? false;
  const usedPct =
    status?.vramTotalGb && status.vramFreeGb !== undefined
      ? Math.round(((status.vramTotalGb - status.vramFreeGb) / status.vramTotalGb) * 100)
      : 0;

  return (
    <Tooltip title={up ? 'Jobs appear in ComfyUI Desktop queue' : 'Start the ComfyUI Desktop app'}>
      <div style={{ padding: '12px 16px', fontSize: 12, borderTop: '1px solid rgba(128,128,128,.2)' }} data-testid="comfy-pill">
        <span style={{ color: up ? '#3ddc97' : '#ff5f57', marginRight: 6 }}>●</span>
        {up ? `ComfyUI live${status?.gpu ? ' · ' + status.gpu : ''}` : 'ComfyUI offline'}
        {up && status?.vramTotalGb ? (
          <>
            <Progress percent={usedPct} size="small" showInfo={false} style={{ margin: '4px 0 0' }} />
            <span style={{ opacity: 0.6 }}>
              {(status.vramTotalGb - (status.vramFreeGb ?? 0)).toFixed(1)} / {status.vramTotalGb.toFixed(0)} GB VRAM
            </span>
          </>
        ) : null}
      </div>
    </Tooltip>
  );
}

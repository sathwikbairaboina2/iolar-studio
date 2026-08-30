'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Button, Card, Empty, Input, Progress, Segmented, Slider, Space, Spin, Tabs, Tag, Tooltip, Typography, Upload, message,
} from 'antd';
import {
  AudioOutlined, DeleteOutlined, ExportOutlined, PlayCircleOutlined, PauseCircleOutlined,
  ReloadOutlined, ScissorOutlined, ThunderboltOutlined, UploadOutlined,
} from '@ant-design/icons';
import Player from '@/components/reel/Player';
import AgentPanel from '@/components/reel/AgentPanel';
import ResearchPanel from '@/components/reel/ResearchPanel';
import { useReelEditor } from './useReelEditor';
import Timeline from '@/components/reel/Timeline';
import type { Pattern } from '@/lib/reel/pattern-schema';
import type { Reel } from '@/lib/reel/schema';
import { timelineDuration } from '@/lib/reel/timeline';

const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'hold'] as const;

export default function ReelStudio() {
  const slug = String(useParams().slug ?? '');
  const { reel, setReel, error, setError, run, undo, redo } = useReelEditor(slug);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [clipId, setClipId] = useState<string | null>(null);
  const [cueId, setCueId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportPct, setExportPct] = useState<number | null>(null);

  // A rejected command names both what was wrong and what would have been valid;
  // surface it rather than letting the edit look like it silently did nothing.
  useEffect(() => {
    if (!error) return;
    message.error(error);
    setError(null);
  }, [error, setError]);

  // The pattern drives both the player's styling and the export's, so load the whole preset.
  const patternName = reel?.pattern;
  useEffect(() => {
    if (!patternName) return;
    let alive = true;
    fetch(`/api/reel/patterns?name=${patternName}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.pattern) setPattern(d.pattern);
      });
    return () => {
      alive = false;
    };
  }, [patternName]);

  // Its stylesheet is linked live, so preview captions are styled by the same file
  // the export's Playwright pass loads.
  useEffect(() => {
    if (!patternName) return;
    const id = 'reel-pattern-css';
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = `/api/reel/patterns/css?name=${patternName}`;
  }, [patternName]);

  // Shots land asynchronously: poll while anything is still generating.
  const pending = reel?.assets.some((a) => a.status === 'queued' || a.status === 'running') ?? false;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/reel/${slug}/shots`).then((x) => x.json());
      if (r.reel) setReel(r.reel);
    }, 4000);
    return () => clearInterval(t);
  }, [pending, slug, setReel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === ' ' && (e.target as HTMLElement)?.tagName !== 'INPUT') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const stage = async (name: string, path: string, body?: unknown) => {
    setBusy(name);
    try {
      const r = await fetch(`/api/reel/${slug}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `${name} failed`);
      if (data.reel) setReel(data.reel);
      message.success(`${name} done`);
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(null);
    }
  };

  const runExport = async () => {
    setExportPct(0);
    try {
      const res = await fetch(`/api/reel/${slug}/export`, { method: 'POST' });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const line of buffer.split('\n\n')) {
          const payload = line.replace(/^data: /, '').trim();
          if (!payload.startsWith('{')) continue;
          const evt = JSON.parse(payload);
          if (typeof evt.pct === 'number') setExportPct(evt.pct);
          if (evt.error) message.error(evt.error);
          if (evt.done) message.success('exported');
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
      }
    } catch (err) {
      message.error(String(err));
    } finally {
      setExportPct(null);
    }
  };

  const clip = useMemo(() => reel?.timeline.clips.find((c) => c.id === clipId) ?? null, [reel, clipId]);
  const cue = useMemo(() => reel?.timeline.captions.find((c) => c.id === cueId) ?? null, [reel, cueId]);

  if (!reel || !pattern) return <Spin style={{ marginTop: 64 }} />;
  const duration = timelineDuration(reel.timeline) || reel.vo.durationSec;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Typography.Title level={4} style={{ margin: 0, flex: 1 }}>
          {reel.title}
        </Typography.Title>
        <Tag>{reel.pattern}</Tag>
        <Tag>{reel.ratio}</Tag>
        <Tag>{duration ? `${duration.toFixed(1)}s` : 'no timeline yet'}</Tag>
        <Space.Compact>
          <Button icon={<AudioOutlined />} loading={busy === 'voice'} onClick={() => stage('voice', 'voice')}>
            Voice
          </Button>
          <Button icon={<ThunderboltOutlined />} loading={busy === 'shots'} onClick={() => stage('shots', 'shots')}>
            Shots
          </Button>
          <Button icon={<ReloadOutlined />} loading={busy === 'assemble'} onClick={() => stage('assemble', 'assemble')}>
            Assemble
          </Button>
          <Button
            type="primary"
            icon={<ExportOutlined />}
            disabled={exportPct !== null}
            onClick={runExport}
          >
            Export
          </Button>
        </Space.Compact>
      </div>

      {exportPct !== null && <Progress percent={Math.round(exportPct * 100)} status="active" />}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 420px) 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <Player
            reel={reel}
            pattern={pattern}
            slug={slug}
            currentTime={time}
            playing={playing}
            onTimeChange={setTime}
            onEnded={() => setPlaying(false)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Button
              icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => setPlaying((p) => !p)}
              disabled={!duration}
            />
            <Slider
              min={0}
              max={Math.max(0.1, duration)}
              step={0.01}
              value={time}
              onChange={setTime}
              style={{ flex: 1 }}
              tooltip={{ formatter: (v) => `${Number(v).toFixed(2)}s` }}
            />
            <Typography.Text type="secondary">{time.toFixed(2)}s</Typography.Text>
          </div>
        </div>

        <Tabs
          items={[
            {
              key: 'research',
              label: 'Research',
              children: (
                <Card size="small">
                  <ResearchPanel slug={slug} />
                </Card>
              ),
            },
            {
              key: 'agent',
              label: 'Agent',
              children: (
                <Card size="small">
                  <AgentPanel slug={slug} onApplied={(next) => setReel(next as Reel)} />
                </Card>
              ),
            },
            {
              key: 'clip',
              label: 'Clip',
              children: clip ? (
                <Card size="small" title={`${clip.id}${clip.locked ? ' · locked' : ''}`}>
                  <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                    <Segmented
                      value={clip.motion.type}
                      options={MOTIONS as unknown as string[]}
                      onChange={(v) => run('clip.motion', { clipId: clip.id, motion: { type: v as (typeof MOTIONS)[number] } })}
                    />
                    <div>
                      <Typography.Text type="secondary">Motion strength</Typography.Text>
                      <Slider
                        min={0}
                        max={0.4}
                        step={0.01}
                        value={clip.motion.strength}
                        onChangeComplete={(v) => run('clip.motion', { clipId: clip.id, motion: { strength: v as number } })}
                      />
                    </div>
                    <Segmented
                      value={clip.fit}
                      options={['cover', 'contain']}
                      onChange={(v) => run('clip.fit', { clipId: clip.id, fit: v as 'cover' | 'contain' })}
                    />
                    <Segmented
                      value={clip.transition}
                      options={['cut', 'crossfade']}
                      onChange={(v) => run('clip.transition', { clipId: clip.id, transition: v as 'cut' | 'crossfade' })}
                    />
                    <Space wrap>
                      <Button onClick={() => run('clip.trim', { clipId: clip.id, edge: 'in', deltaSec: 0.1 })}>Trim in +0.1</Button>
                      <Button onClick={() => run('clip.trim', { clipId: clip.id, edge: 'out', deltaSec: -0.1 })}>Trim out −0.1</Button>
                      <Button icon={<ScissorOutlined />} onClick={() => run('clip.split', { clipId: clip.id, atSec: time })}>
                        Split here
                      </Button>
                      <Button danger icon={<DeleteOutlined />} onClick={() => run('clip.delete', { clipId: clip.id })}>
                        Delete
                      </Button>
                    </Space>
                    <Space wrap>
                      <Button
                        onClick={() => run('clip.move', { clipId: clip.id, toIndex: Math.max(0, reel.timeline.clips.findIndex((c) => c.id === clip.id) - 1) })}
                      >
                        Move earlier
                      </Button>
                      <Button
                        onClick={() => run('clip.move', { clipId: clip.id, toIndex: Math.min(reel.timeline.clips.length - 1, reel.timeline.clips.findIndex((c) => c.id === clip.id) + 1) })}
                      >
                        Move later
                      </Button>
                    </Space>
                  </Space>
                </Card>
              ) : (
                <Empty description="Pick a clip in the timeline" />
              ),
            },
            {
              key: 'caption',
              label: 'Caption',
              children: cue ? (
                <Card size="small" title={`${cue.id}${cue.locked ? ' · locked' : ''}`}>
                  <Space orientation="vertical" style={{ width: '100%' }}>
                    <Input
                      value={cue.text}
                      onChange={(e) => run('caption.edit', { cueId: cue.id, text: e.target.value })}
                    />
                    <Space wrap>
                      <Button onClick={() => run('caption.nudge', { cueId: cue.id, deltaSec: -0.05 })}>−0.05s</Button>
                      <Button onClick={() => run('caption.nudge', { cueId: cue.id, deltaSec: 0.05 })}>+0.05s</Button>
                      <Button onClick={() => run('caption.merge', { cueId: cue.id })}>Merge next</Button>
                      <Button onClick={() => run('caption.split', { cueId: cue.id })}>Split</Button>
                      <Button onClick={() => run('caption.toggle', { cueId: cue.id })}>
                        {cue.hidden ? 'Show' : 'Hide'}
                      </Button>
                    </Space>
                  </Space>
                </Card>
              ) : (
                <Empty description="Pick a caption in the timeline" />
              ),
            },
            {
              key: 'shots',
              label: `Shots (${reel.beats.length})`,
              children: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  {reel.beats.map((beat) => {
                    const asset = reel.assets.find((a) => a.id === beat.shot.assetId);
                    return (
                      <Card key={beat.id} size="small" title={`${beat.id} · ${beat.shot.kind}`}>
                        <Typography.Paragraph style={{ marginBottom: 8 }}>{beat.text}</Typography.Paragraph>
                        <Typography.Text type="secondary">{beat.shot.brief}</Typography.Text>
                        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Tag color={asset?.status === 'ready' ? 'green' : asset?.status === 'failed' ? 'red' : 'orange'}>
                            {asset?.status ?? 'no asset'}
                          </Tag>
                          {asset?.error && (
                            <Tooltip title={asset.error}>
                              <Typography.Text type="danger" ellipsis style={{ maxWidth: 220 }}>
                                {asset.error}
                              </Typography.Text>
                            </Tooltip>
                          )}
                          <Upload
                            showUploadList={false}
                            customRequest={async (opt) => {
                              const form = new FormData();
                              form.append('file', opt.file as File);
                              form.append('beatId', beat.id);
                              const r = await fetch(`/api/reel/${slug}/assets`, { method: 'POST', body: form });
                              const data = await r.json();
                              if (data.reel) setReel(data.reel);
                              else message.error(data.error ?? 'upload failed');
                            }}
                          >
                            <Button size="small" icon={<UploadOutlined />}>
                              Drop file
                            </Button>
                          </Upload>
                          <Button size="small" onClick={() => stage('shots', 'shots', { beatId: beat.id })}>
                            Regenerate
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Card size="small">
        <Timeline
          reel={reel}
          currentTime={time}
          selectedClipId={clipId}
          selectedCueId={cueId}
          onSeek={setTime}
          onSelectClip={setClipId}
          onSelectCue={setCueId}
          onCommand={run}
        />
      </Card>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, Card, Slider, Space, Spin, Tabs, Tag, Tooltip, Typography, Upload } from 'antd';
import { message } from '@/lib/ui/message';
import {
  AudioOutlined, PlayCircleOutlined, PauseCircleOutlined,
  ReloadOutlined, ThunderboltOutlined, UploadOutlined, WarningOutlined,
} from '@ant-design/icons';
import Player from '@/components/reel/Player';
import AgentPanel from '@/components/reel/AgentPanel';
import ResearchPanel from '@/components/reel/ResearchPanel';
import BuildBoard from '@/components/reel/BuildBoard';
import PatternBoard from '@/components/reel/PatternBoard';
import VoicePanel from '@/components/reel/VoicePanel';
import ShotGate from '@/components/reel/ShotGate';
import ShotActions from '@/components/reel/ShotActions';
import InboxPanel from '@/components/reel/InboxPanel';
import BeatText from '@/components/reel/BeatText';
import Handoff from '@/components/reel/Handoff';
import JobsBoard from '@/components/reel/JobsBoard';
import { useReelEditor } from './useReelEditor';
import Timeline from '@/components/reel/Timeline';
import type { Style } from '@/lib/reel/style-schema';
import type { Reel } from '@/lib/reel/schema';
import { timelineDuration } from '@/lib/reel/timeline';

export default function ReelStudio() {
  const slug = String(useParams().slug ?? '');
  const { reel, setReel, error, setError, undo, redo } = useReelEditor(slug);
  const [style, setPattern] = useState<Style | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState('research');

  // A rejected command names both what was wrong and what would have been valid;
  // surface it rather than letting the edit look like it silently did nothing.
  useEffect(() => {
    if (!error) return;
    message.error(error);
    setError(null);
  }, [error, setError]);

  // The style drives both the player's styling and the export's, so load the whole preset.
  const styleName = reel?.style;
  useEffect(() => {
    if (!styleName) return;
    let alive = true;
    fetch(`/api/reel/styles?name=${styleName}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.style) setPattern(d.style);
      });
    return () => {
      alive = false;
    };
  }, [styleName]);

  // Its stylesheet is linked live, so preview captions are styled by the same file
  // the export's Playwright pass loads.
  useEffect(() => {
    if (!styleName) return;
    const id = 'reel-style-css';
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = `/api/reel/styles/css?name=${styleName}`;
  }, [styleName]);

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


  if (!reel || !style) return <Spin style={{ marginTop: 64 }} />;
  const duration = timelineDuration(reel.timeline) || reel.vo.durationSec;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Typography.Title level={4} style={{ margin: 0, flex: 1 }}>
          {reel.title}
        </Typography.Title>
        <Tag>{reel.style}</Tag>
        {reel.pattern && <Tag color="purple">{reel.pattern.name} · {reel.pattern.theme}</Tag>}
        <Tag>{reel.ratio}</Tag>
        <Tag>{duration ? `${duration.toFixed(1)}s` : 'no timeline yet'}</Tag>
        <Space.Compact>
          <Button icon={<AudioOutlined />} onClick={() => setTab('voice')}>
            Voice
          </Button>
          <Button icon={<ThunderboltOutlined />} onClick={() => setTab('shots')}>
            Shots
          </Button>
          <Button icon={<ReloadOutlined />} loading={busy === 'assemble'} onClick={() => stage('assemble', 'assemble')}>
            Assemble
          </Button>
        </Space.Compact>
      </div>


      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 420px) 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <Player
            reel={reel}
            style={style}
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
          activeKey={tab}
          onChange={setTab}
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
              key: 'voice',
              label: 'Voice',
              children: (
                <Card size="small">
                  <VoicePanel
                    slug={slug}
                    onVoice={async () => {
                      // Alignment rewrites the word timings the whole build reads from.
                      const r = await fetch(`/api/reel/${slug}`).then((x) => x.json()).catch(() => null);
                      if (r?.reel) setReel(r.reel as Reel);
                    }}
                  />
                </Card>
              ),
            },
            ...(reel.pattern
              ? [{
                  key: 'pattern',
                  label: `Pattern: ${reel.pattern.name}`,
                  children: (
                    <Card size="small">
                      <PatternBoard
                        slug={slug}
                        pattern={reel.pattern}
                        onChanged={async () => {
                          const r = await fetch(`/api/reel/${slug}`).then((x) => x.json()).catch(() => null);
                          if (r?.reel) setReel(r.reel as Reel);
                        }}
                      />
                    </Card>
                  ),
                }]
              : []),
            {
              key: 'build',
              label: 'Build',
              children: (
                <Card size="small">
                  <BuildBoard slug={slug} beats={(reel?.beats ?? []) as never} onBuilt={async () => {
                      // Bridging rewrites the beats; pull the reel back so the table is not stale.
                      const r = await fetch(`/api/reel/${slug}`).then((x) => x.json()).catch(() => null);
                      if (r?.reel) setReel(r.reel as Reel);
                    }} />
                </Card>
              ),
            },
            {
              key: 'files',
              label: 'Files',
              children: (
                <Card size="small">
                  <InboxPanel
                    slug={slug}
                    onAdopted={async () => {
                      const r = await fetch(`/api/reel/${slug}`).then((x) => x.json()).catch(() => null);
                      if (r?.reel) setReel(r.reel as Reel);
                    }}
                  />
                </Card>
              ),
            },
            {
              key: 'pages',
              label: 'Pages',
              children: (
                <Card size="small">
                  <JobsBoard
                    slug={slug}
                    provider="webpage"
                    title="Source pages"
                    empty="No page shots queued yet — build the reel first."
                    extraColumns={[
                      {
                        title: 'Visits',
                        width: 260,
                        render: (j) =>
                          j.url ? (
                            <a href={j.url} target="_blank" rel="noreferrer">
                              {j.url.replace(/^https?:\/\//, '').slice(0, 46)}
                            </a>
                          ) : null,
                      },
                      {
                        title: 'Sweeps',
                        width: 220,
                        render: (j) =>
                          j.highlight ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {j.highlight.slice(0, 60)}
                            </Typography.Text>
                          ) : null,
                      },
                      {
                        title: 'Review',
                        width: 90,
                        render: (j) =>
                          j.review ? (
                            <Tooltip title={j.review.notes}>
                              <Tag color={j.review.ok ? 'green' : 'red'}>{j.review.ok ? 'passed' : 'failed'}</Tag>
                            </Tooltip>
                          ) : null,
                      },
                    ]}
                  />
                </Card>
              ),
            },
            {
              key: 'presenter',
              label: 'Presenter',
              children: (
                <Card size="small">
                  <JobsBoard
                    slug={slug}
                    provider="lipsync"
                    title="Talking head"
                    empty="No presenter shots queued yet — build the reel first."
                    extraColumns={[
                      {
                        title: 'Speaks',
                        render: (j) => (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {j.brief.slice(0, 70)}
                          </Typography.Text>
                        ),
                      },
                    ]}
                  />
                </Card>
              ),
            },
            {
              key: 'agent',
              // Off until the agent is trusted to edit unattended. The panel itself
              // works; what is not ready is handing it the timeline.
              disabled: true,
              label: (
                <Tooltip
                  color="var(--ant-color-warning, #faad14)"
                  title="Lets an agent take over editing — propose changes to clips and captions, and apply them for you. Not ready yet."
                >
                  <span>
                    <WarningOutlined style={{ marginInlineEnd: 6, color: 'var(--ant-color-warning, #faad14)' }} />
                    Agent
                  </span>
                </Tooltip>
              ),
              children: (
                <Card size="small">
                  <AgentPanel slug={slug} onApplied={(next) => setReel(next as Reel)} />
                </Card>
              ),
            },
            {
              key: 'editor',
              label: 'Editor',
              children: (
                <Card size="small">
                  <Handoff
                    slug={slug}
                    onReturned={async () => {
                      const r = await fetch(`/api/reel/${slug}`).then((x) => x.json()).catch(() => null);
                      if (r?.reel) setReel(r.reel as Reel);
                    }}
                  />
                </Card>
              ),
            },
            {
              key: 'shots',
              label: `Shots (${reel.beats.length})`,
              children: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Card size="small" title="Before anything is rendered">
                    <ShotGate
                      slug={slug}
                      onQueued={async () => {
                        const r = await fetch(`/api/reel/${slug}`).then((x) => x.json()).catch(() => null);
                        if (r?.reel) setReel(r.reel as Reel);
                      }}
                    />
                  </Card>
                  {reel.beats.map((beat) => {
                    const asset = reel.assets.find((a) => a.id === beat.shot.assetId);
                    return (
                      <Card key={beat.id} size="small" title={`${beat.id} · ${beat.shot.kind}`}>
                        <BeatText
                          slug={slug}
                          beatId={beat.id}
                          text={beat.text}
                          onEdited={async () => {
                            const r = await fetch(`/api/reel/${slug}`).then((x) => x.json()).catch(() => null);
                            if (r?.reel) setReel(r.reel as Reel);
                          }}
                        />
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
                        </div>
                        {beat.shot.kind !== 'title' && (
                          <div style={{ marginTop: 8 }}>
                            <ShotActions
                              slug={slug}
                              beatId={beat.id}
                              kind={beat.shot.kind}
                              brief={beat.shot.brief}
                              status={asset?.status}
                              onChanged={async () => {
                                const r = await fetch(`/api/reel/${slug}`).then((x) => x.json()).catch(() => null);
                                if (r?.reel) setReel(r.reel as Reel);
                              }}
                            />
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </Space>
              ),
            },
          ].filter((t) => !reel.pattern || ['research', 'voice', 'pattern', 'files'].includes(t.key))}
        />
      </div>

      <Card size="small">
        <Timeline reel={reel} currentTime={time} onSeek={setTime} />
      </Card>
    </div>
  );
}

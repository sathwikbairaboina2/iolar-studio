'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Col, Row, Select, Space, Tag, Typography, message } from 'antd';
import {
  PictureOutlined, ThunderboltOutlined, StarOutlined, ExportOutlined,
} from '@ant-design/icons';
import { MAX_SLIDES, type Post, type Slide } from '@/lib/schema';
import SlideChips from '@/components/editor/SlideChips';
import BlockEditor from '@/components/editor/BlockEditor';
import PreviewPane from '@/components/editor/PreviewPane';
import AiDrawer from '@/components/editor/AiDrawer';
import ReferencePanel from '@/components/editor/ReferencePanel';
import BookPanel from '@/components/editor/BookPanel';

const RATIO_OPTS = ['3:4', '4:5', '1:1'].map((v) => ({ value: v, label: `Ratio ${v}` }));

export default function EditorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [post, setPost] = useState<Post | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  const [slide, setSlide] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(Date.now());
  const [rendering, setRendering] = useState(false);
  const [overflow, setOverflow] = useState<Record<number, number>>({});
  const [fill, setFill] = useState<Record<number, number>>({});
  const [comfyUp, setComfyUp] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState('');
  const [refUrls, setRefUrls] = useState<string[]>([]);
  const [compareRefs, setCompareRefs] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/paperbook/${slug}`).then((r) => r.json()).then(setPost);
    fetch('/api/paperbook').then((r) => r.json()).then((d) => setTemplates(d.templates ?? []));
    fetch('/api/comfy/status').then((r) => r.json()).then((s) => setComfyUp(!!s.up));
  }, [slug]);

  const save = useCallback(async (p: Post) => {
    const r = await fetch(`/api/paperbook/${slug}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
    if (r.ok) setDirty(false);
    else message.error('Save failed: ' + ((await r.json()).error ?? ''));
  }, [slug]);

  const update = useCallback((p: Post) => {
    setPost(p);
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(p), 800);
  }, [save]);

  const render = async (which?: number) => {
    if (!post) return;
    setRendering(true);
    if (dirty) await save(post);
    try {
      const r = await fetch(`/api/paperbook/${slug}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(which !== undefined ? { slide: which } : {}),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      const ovf: Record<number, number> = { ...overflow };
      const fl: Record<number, number> = { ...fill };
      for (const res of body.results) {
        ovf[res.slide] = res.overflowPx;
        fl[res.slide] = res.fillPct;
      }
      setOverflow(ovf);
      setFill(fl);
      setVersion(Date.now());
      if (body.split) {
        const fresh = await fetch(`/api/paperbook/${slug}`).then((r) => r.json());
        setPost(fresh);
        message.info(`Content reflowed onto ${body.slides} pages`);

        const h = await fetch(`/api/paperbook/${slug}/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'headings' }),
        });
        if (h.ok) {
          const { proposal } = await h.json();
          setPost(proposal);
          await save(proposal);
          message.success('Page titles updated for the new pages');
        }
      } else {
        message.success('Rendered');
      }
    } catch (err) {
      message.error(String(err));
    } finally {
      setRendering(false);
    }
  };

  const reloadAndRender = async () => {
    const p = await fetch(`/api/paperbook/${slug}`).then((r) => r.json());
    setPost(p);
    setSlide(0);
    await render();
  };

  const densify = async () => {
    const underfilled = Object.entries(fill)
      .filter(([, pct]) => pct < 80)
      .map(([slide, pct]) => ({ slide: Number(slide), fillPct: pct }));
    if (!underfilled.length) return message.info('Every slide is already well filled');
    setRendering(true);
    message.info(`Asking AI to fill ${underfilled.length} slide(s) from the book…`);
    try {
      const r = await fetch(`/api/paperbook/${slug}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'densify', underfilled }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'densify failed');
      await save(d.proposal);
      setPost(d.proposal);
      await render();
    } catch (err) {
      message.error(String(err));
    } finally {
      setRendering(false);
    }
  };

  const doPackage = async () => {
    const r = await fetch(`/api/paperbook/${slug}/package`, { method: 'POST' });
    const body = await r.json();
    if (r.ok) message.success(`Packaged to ${body.dir}`);
    else message.error(body.error ?? 'package failed');
  };

  const doPolish = async () => {
    message.info('Polishing via ComfyUI — check the Desktop app queue');
    const r = await fetch(`/api/paperbook/${slug}/polish`, { method: 'POST' });
    const body = await r.json();
    if (r.ok) message.success(`Polished ${body.slides} slides`);
    else message.error(body.error ?? 'polish failed');
  };

  if (!post) return <Typography.Text>Loading…</Typography.Text>;
  const currentOverflow = overflow[slide + 1] ?? null;

  return (
    <div>
      <Space style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <Select
          value={post.template}
          options={templates.map((t) => ({ value: t, label: t }))}
          onChange={(template) => update({ ...post, template } as Post)}
          style={{ width: 180 }}
        />
        <Select
          value={post.ratio}
          options={RATIO_OPTS}
          onChange={(ratio) => update({ ...post, ratio } as Post)}
          style={{ width: 130 }}
        />
        <Tag color={dirty ? 'orange' : 'green'}>{dirty ? 'unsaved' : 'saved'}</Tag>
        {post.slides.length > MAX_SLIDES && (
          <Tag color="warning">{post.slides.length} slides — over Instagram&apos;s {MAX_SLIDES}</Tag>
        )}
        <Button icon={<PictureOutlined />} onClick={() => render(slide + 1)} loading={rendering}>Render slide</Button>
        <Button icon={<ThunderboltOutlined />} onClick={() => render()} loading={rendering}>Render all</Button>
        <Button icon={<StarOutlined />} disabled={!comfyUp} onClick={doPolish} title={comfyUp ? '' : 'ComfyUI offline'}>Polish</Button>
        <BookPanel slug={slug} onSlidesPlanned={reloadAndRender} />
        <ReferencePanel
          slug={slug}
          compare={compareRefs}
          onCompareChange={setCompareRefs}
          onUrlsChange={setRefUrls}
          onPlanned={reloadAndRender}
        />
        <Button type="primary" icon={<ExportOutlined />} onClick={doPackage}>Package</Button>
      </Space>

      <SlideChips
        count={post.slides.length}
        selected={slide}
        onSelect={setSlide}
        onAdd={() => {
          const slides = [...post.slides, { page_title: `Page ${post.slides.length + 1}`, blocks: [{ type: 'heading' as const, text: 'New slide' }] }];
          update({ ...post, slides } as Post);
          setSlide(slides.length - 1);
        }}
        onDelete={(i) => {
          const slides = post.slides.filter((_, j) => j !== i);
          update({ ...post, slides } as Post);
          setSlide(Math.max(0, slide - (i <= slide ? 1 : 0)));
        }}
      />

      <Row gutter={20}>
        <Col span={12}>
          <BlockEditor
            slide={post.slides[slide]}
            onChange={(s: Slide) => update({ ...post, slides: post.slides.map((x, j) => (j === slide ? s : x)) } as Post)}
          />
        </Col>
        <Col span={12}>
          <PreviewPane
            slug={slug}
            slide={slide + 1}
            slideCount={post.slides.length}
            version={version}
            overflowPx={currentOverflow}
            fillPct={fill[slide + 1] ?? null}
            onDensify={densify}
            rendering={rendering}
            referenceUrl={compareRefs ? refUrls[slide] : undefined}
            onRerender={() => render(slide + 1)}
            onAiFix={() => {
              setAiPrefill(`Slide ${slide + 1} overflows by ${currentOverflow}px. Move or condense content to fit; use another slide if needed (max 10 slides).`);
              setAiOpen(true);
            }}
          />
        </Col>
      </Row>

      <AiDrawer
        slug={slug}
        post={post}
        slideIndex={slide}
        open={aiOpen}
        prefill={aiPrefill}
        onOpen={() => { setAiPrefill(''); setAiOpen(true); }}
        onClose={() => setAiOpen(false)}
        onApplied={async (p) => {
          setPost(p);
          await save(p);
          await render();
        }}
      />
    </div>
  );
}

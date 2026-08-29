'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Collapse, Drawer, Empty, Space, Tag, Typography, message } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import type { Post } from '@/lib/schema';
import type { Finding } from '@/lib/verify/gates';
import type { Review } from '@/lib/verify/review';

const SEVERITY_COLOR: Record<string, string> = { blocker: 'error', major: 'warning', minor: 'default' };

export default function VerifyDrawer({
  subject, chapter, part, open, onOpen, onClose, onGoToPage, onApplied,
}: {
  subject: string;
  chapter: string;
  part: number;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onGoToPage: (page: number) => void;
  onApplied: (p: Post) => void | Promise<void>;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [current, setCurrent] = useState(false);
  const [busy, setBusy] = useState<'' | 'gates' | 'full' | 'fix'>('');

  const base = `/api/handbooks/${subject}/${chapter}/parts/${part}`;

  useEffect(() => {
    if (!open) return;
    fetch(`${base}/review`).then((r) => r.json()).then((d) => {
      setReview(d.review ?? null);
      setCurrent(!!d.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subject, chapter, part]);

  const run = async (mode: 'gates' | 'full') => {
    setBusy(mode);
    if (mode === 'full') message.info('Running the full review — facts, visuals, pedagogy and brand. This takes a few minutes.');
    try {
      const r = await fetch(`${base}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'gates' ? { mode: 'gates' } : {}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'review failed');
      setReview(d.review);
      setCurrent(!!d.current);
      const blockers = d.review.findings.filter((f: Finding) => f.severity === 'blocker').length;
      if (blockers) message.warning(`${blockers} blocker(s) — publishing is held until they clear`);
      else message.success('No blockers');
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy('');
    }
  };

  /** Routes one finding through the normal revise path, so a fix may only add or correct. */
  const fix = async (f: Finding) => {
    setBusy('fix');
    try {
      const where = f.page ? `On page ${f.page}` : 'In this part';
      const request = [
        `${where}: ${f.summary}`,
        f.evidence ? `Evidence: ${f.evidence}` : '',
        f.fix ? `Suggested fix: ${f.fix}` : '',
        'Apply exactly this fix. Do not remove any other content.',
      ].filter(Boolean).join('\n');

      const r = await fetch(`${base}/revise`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request, scope: f.page ? 'slide' : 'post', slideIndex: f.page ? f.page - 1 : undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'fix failed');

      const saved = await fetch(base, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(d.proposal),
      });
      if (!saved.ok) throw new Error((await saved.json()).error ?? 'save failed');

      message.success('Fix applied — re-run the review to confirm it cleared');
      await onApplied(await saved.json());
      setCurrent(false);
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy('');
    }
  };

  const findings = review?.findings ?? [];
  const blockers = findings.filter((f) => f.severity === 'blocker');
  const grouped = ['blocker', 'major', 'minor'].map((sev) => ({
    sev,
    items: findings.filter((f) => f.severity === sev),
  })).filter((g) => g.items.length);

  return (
    <>
      <Badge count={blockers.length} size="small">
        <Button icon={<SafetyCertificateOutlined />} onClick={onOpen}>
          Verify
        </Button>
      </Badge>

      <Drawer title="Verify before publishing" open={open} onClose={onClose} width={520}>
        <Space style={{ marginBottom: 14 }} wrap>
          <Button loading={busy === 'gates'} onClick={() => run('gates')}>Run checks</Button>
          <Button type="primary" loading={busy === 'full'} onClick={() => run('full')}>Full review</Button>
          {review && !current && <Tag color="orange">content changed since this review</Tag>}
        </Space>

        {!review ? (
          <Empty description="Not reviewed yet — run the checks to see what would block publishing" />
        ) : (
          <>
            <Alert
              type={review.passed ? 'success' : 'error'}
              showIcon
              style={{ marginBottom: 14 }}
              message={review.passed ? 'No blockers — this part can be published' : `${blockers.length} blocker(s) hold publishing`}
              description={`${findings.length} finding(s) · reviewed ${new Date(review.generatedAt).toLocaleString()}`}
            />

            {findings.length === 0 ? (
              <Empty description="Nothing to fix" />
            ) : (
              <Collapse
                size="small"
                defaultActiveKey={['blocker']}
                items={grouped.map((g) => ({
                  key: g.sev,
                  label: (
                    <span>
                      <Tag color={SEVERITY_COLOR[g.sev]}>{g.sev}</Tag> {g.items.length}
                    </span>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {g.items.map((f, i) => (
                        <div key={`${f.rule}-${i}`} style={{ borderBottom: '1px solid rgba(128,128,128,.15)', paddingBottom: 9 }}>
                          <div style={{ fontSize: 13 }}>
                            <Tag>{f.rule}</Tag>
                            {f.page > 0 && (
                              <Button size="small" type="link" onClick={() => { onGoToPage(f.page); onClose(); }}>
                                page {f.page}
                              </Button>
                            )}
                          </div>
                          <div style={{ fontSize: 13, marginTop: 3 }}>{f.summary}</div>
                          {f.evidence && (
                            <div style={{ fontSize: 11.5, opacity: 0.65, fontFamily: 'monospace', marginTop: 3 }}>
                              {f.evidence}
                            </div>
                          )}
                          {f.fix && (
                            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                              <Typography.Text type="secondary">fix: </Typography.Text>{f.fix}
                            </div>
                          )}
                          <Button
                            size="small"
                            style={{ marginTop: 6 }}
                            loading={busy === 'fix'}
                            onClick={() => fix(f)}
                          >
                            ✦ Fix with AI
                          </Button>
                        </div>
                      ))}
                    </div>
                  ),
                }))}
              />
            )}
          </>
        )}
      </Drawer>
    </>
  );
}

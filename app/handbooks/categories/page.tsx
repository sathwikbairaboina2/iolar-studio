'use client';
import { Card, Col, Descriptions, Row, Tabs, Tag, Typography } from 'antd';
import { CATEGORIES } from '@/lib/handbookCategories';

const NUMBERING: Record<string, string> = {
  chapters: 'sections restart on every page',
  continuous: 'items run on across pages (Q1, Q2 …)',
  counter: 'one item per page, "02 / 12"',
};

const COUNT: Record<string, string> = {
  pages: 'a count in the title must equal the number of pages',
  items: 'a count in the title must equal the number of items',
  none: 'no count rule',
};

/**
 * Every handbook category's rule set, read straight from lib/handbookCategories.ts: what the
 * generator is told (content), how pages are laid out (presentation) and how the caption and a
 * reel cut are written (script), plus the gates the review runs.
 */
export default function CategoriesPage() {
  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>Handbook categories</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ maxWidth: 760 }}>
        A chapter&apos;s category drives three layers: content (what the book and pages teach), presentation (how each page is laid out
        and numbered) and script (the caption, the call to action, and the beats of a reel cut). Every category also shares the gates:
        no repeated page titles or items, and a title count that matches what is delivered.
      </Typography.Paragraph>
      <Row gutter={[14, 14]}>
        {CATEGORIES.map((c) => (
          <Col span={24} key={c.id}>
            <Card id={c.id} title={<span>{c.emoji} {c.name} <Tag style={{ marginInlineStart: 6 }}>{c.id}</Tag></span>} extra={<span style={{ fontSize: 12, opacity: 0.7 }}>{c.blurb}</span>}>
              <Tabs
                size="small"
                items={[
                  {
                    key: 'content',
                    label: 'Content',
                    children: (
                      <Descriptions size="small" column={1} bordered>
                        <Descriptions.Item label="One page is">{c.content.unit}</Descriptions.Item>
                        <Descriptions.Item label="Book">{c.content.bookGuidance}</Descriptions.Item>
                        <Descriptions.Item label="Page shape">{c.content.pageShape.join(' → ')}</Descriptions.Item>
                        <Descriptions.Item label="Rules"><ul style={{ margin: 0, paddingLeft: 18 }}>{c.content.rules.map((r) => <li key={r}>{r}</li>)}</ul></Descriptions.Item>
                        <Descriptions.Item label="Count gate">{COUNT[c.content.countBy]}</Descriptions.Item>
                      </Descriptions>
                    ),
                  },
                  {
                    key: 'presentation',
                    label: 'Presentation',
                    children: (
                      <Descriptions size="small" column={1} bordered>
                        <Descriptions.Item label="Per page">{c.presentation.itemsPerPage}</Descriptions.Item>
                        <Descriptions.Item label="Numbering">{NUMBERING[c.presentation.numbering]}</Descriptions.Item>
                        <Descriptions.Item label="Page layout">{c.presentation.pageRules}</Descriptions.Item>
                        <Descriptions.Item label="Cover">{c.presentation.cover}</Descriptions.Item>
                        <Descriptions.Item label="Closing">{c.presentation.closing}</Descriptions.Item>
                      </Descriptions>
                    ),
                  },
                  {
                    key: 'script',
                    label: 'Script',
                    children: (
                      <Descriptions size="small" column={1} bordered>
                        <Descriptions.Item label="Caption">{c.script.caption}</Descriptions.Item>
                        <Descriptions.Item label="Call to action">{c.script.cta}</Descriptions.Item>
                        <Descriptions.Item label="Reel beats"><ol style={{ margin: 0, paddingLeft: 18 }}>{c.script.narration.map((r) => <li key={r}>{r}</li>)}</ol></Descriptions.Item>
                      </Descriptions>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}

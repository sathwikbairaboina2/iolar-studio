'use client';
import { Button, Dropdown, Input } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { Block, Slide } from '@/lib/schema';
import BlockForm from './BlockForm';

const NEW_BLOCK: Record<string, Block> = {
  heading: { type: 'heading', text: 'New heading' },
  paragraph: { type: 'paragraph', text: 'New paragraph.' },
  bullets: { type: 'bullets', items: ['First point'] },
  sidebox: { type: 'sidebox', title: 'Box title', items: ['Item one'], ink: 'green' },
  table: { type: 'table', headers: ['Col A', 'Col B'], rows: [['', '']] },
  code: { type: 'code', lang: 'python', lines: ['# code here'] },
  diagram: { type: 'diagram', kind: 'flow', spec: { nodes: ['start', 'end'] } },
  callout: { type: 'callout', style: 'tip', title: 'Tip', text: 'Callout text.' },
  qa: { type: 'qa', q: 'Question?', a_bullets: ['Answer'] },
};

export default function BlockEditor({
  slide, onChange,
}: {
  slide: Slide;
  onChange: (s: Slide) => void;
}) {
  const setBlocks = (blocks: Block[]) => onChange({ ...slide, blocks });

  return (
    <div>
      <Input
        addonBefore="Page title"
        value={slide.page_title}
        onChange={(e) => onChange({ ...slide, page_title: e.target.value })}
        style={{ marginBottom: 12 }}
      />
      {slide.blocks.map((b, i) => (
        <BlockForm
          key={i}
          block={b}
          index={i}
          total={slide.blocks.length}
          onChange={(nb) => setBlocks(slide.blocks.map((x, j) => (j === i ? nb : x)))}
          onMove={(dir) => {
            const blocks = [...slide.blocks];
            const [x] = blocks.splice(i, 1);
            blocks.splice(i + dir, 0, x);
            setBlocks(blocks);
          }}
          onDuplicate={() => {
            const blocks = [...slide.blocks];
            blocks.splice(i + 1, 0, structuredClone(b));
            setBlocks(blocks);
          }}
          onDelete={() => slide.blocks.length > 1 && setBlocks(slide.blocks.filter((_, j) => j !== i))}
        />
      ))}
      <Dropdown
        menu={{
          items: Object.keys(NEW_BLOCK).map((k) => ({ key: k, label: k })),
          onClick: ({ key }) => setBlocks([...slide.blocks, structuredClone(NEW_BLOCK[key])]),
        }}
      >
        <Button block icon={<PlusOutlined />} style={{ borderStyle: 'dashed' }}>
          Add block
        </Button>
      </Dropdown>
    </div>
  );
}

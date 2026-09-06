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
  'diagram: flow': { type: 'diagram', kind: 'flow', spec: { nodes: ['start', { text: 'step', sub: 'why', ink: 'green' }, 'end'] } },
  'diagram: array': { type: 'diagram', kind: 'array', spec: { cells: ['2', '5', '8', '12'], indices: true, pointers: [{ index: 0, label: 'low' }, { index: 3, label: 'high' }], highlight: [1], dim: [], caption: '' } },
  'diagram: flowchart': { type: 'diagram', kind: 'flowchart', spec: { title: 'Flow', rows: [['a'], ['b', 'c']], nodes: { a: { text: 'Start', shape: 'pill' }, b: { text: 'Yes path', shape: 'box' }, c: { text: 'No path', shape: 'box' } }, edges: [{ from: 'a', to: 'b', label: 'yes' }, { from: 'a', to: 'c', label: 'no' }] } },
  'diagram: matrix': { type: 'diagram', kind: 'matrix', spec: { rows: [['1', '2'], ['3', '4']], highlight: [[0, 0]] } },
  'diagram: cards': { type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'One', icon: 'user', text: 'First idea', lines: [] }, { title: 'Two', icon: 'lock', text: 'Second idea', lines: [] }, { title: 'Three', icon: 'key', text: 'Third idea', lines: [] }] } },
  'diagram: chain': { type: 'diagram', kind: 'chain', spec: { title: 'Hierarchy', steps: [{ text: 'Top', note: 'explains the top' }, { text: 'Middle', note: 'explains the middle' }] } },
  'diagram: tables': { type: 'diagram', kind: 'tables', spec: { arrow: true, tables: [{ title: 'Before', headers: ['a', 'b'], rows: [['1', '2']] }, { title: 'After', headers: ['a', 'b'], rows: [['1', '2']] }] } },
  'diagram: schema': { type: 'diagram', kind: 'schema', spec: { tables: [{ name: 'PARENT', columns: ['id (PK)', 'name'] }, { name: 'CHILD', columns: ['id (PK)', 'parent_id (FK)'] }], links: [{ from: 'PARENT', to: 'CHILD', fromLabel: '1', toLabel: 'N', arrow: true }] } },
  'diagram: er': { type: 'diagram', kind: 'er', spec: { entities: [{ name: 'STUDENT', attrs: ['Roll_No', 'Name'], key: 'Roll_No' }, { name: 'COURSE', attrs: ['Course_ID'], key: 'Course_ID' }], relations: [{ from: 'STUDENT', to: 'COURSE', name: 'ENROLLS', labels: ['M', 'N'] }] } },
  sticky: { type: 'callout', style: 'sticky', title: 'Note', text: 'Pinned aside.' },
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

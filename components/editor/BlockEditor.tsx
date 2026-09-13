'use client';
import { Button, Dropdown, Input, Space, Switch } from 'antd';
import LabeledInput from '@/components/ui/LabeledInput';
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
      <LabeledInput
        label="Page title"
        value={slide.page_title}
        onChange={(e) => onChange({ ...slide, page_title: e.target.value })}
        style={{ marginBottom: 8 }}
      />
      <Space style={{ marginBottom: 8, width: '100%' }} styles={{ item: { flex: 1 } }}>
        <LabeledInput
          label="Subtitle"
          placeholder="(Identity and Access Management)"
          value={slide.subtitle ?? ''}
          onChange={(e) => onChange({ ...slide, subtitle: e.target.value || undefined })}
        />
        <LabeledInput
          label="Hero icon"
          placeholder="aws, iam, docker, database…"
          value={slide.hero ?? ''}
          onChange={(e) => onChange({ ...slide, hero: e.target.value || undefined })}
        />
      </Space>
      <Space style={{ marginBottom: 12 }}>
        <Switch
          checked={slide.kind === 'cover'}
          onChange={(on) =>
            onChange(
              on
                ? { ...slide, kind: 'cover', cover: slide.cover ?? { title: slide.page_title, icons: [], pills: [] } }
                : { ...slide, kind: undefined, cover: undefined, blocks: slide.blocks.length ? slide.blocks : [structuredClone(NEW_BLOCK.heading)] }
            )
          }
        />
        <span style={{ fontSize: 12 }}>Cover page</span>
      </Space>
      {slide.kind === 'cover' && slide.cover && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <LabeledInput label="Cover title" value={slide.cover.title} onChange={(e) => onChange({ ...slide, cover: { ...slide.cover!, title: e.target.value } })} />
          <LabeledInput label="Cover subtitle" value={slide.cover.subtitle ?? ''} onChange={(e) => onChange({ ...slide, cover: { ...slide.cover!, subtitle: e.target.value || undefined } })} />
          <LabeledInput label="Tagline" value={slide.cover.tagline ?? ''} onChange={(e) => onChange({ ...slide, cover: { ...slide.cover!, tagline: e.target.value || undefined } })} />
          <LabeledInput
            label="Pills"
            placeholder="EC2, S3, RDS"
            value={slide.cover.pills.join(', ')}
            onChange={(e) => onChange({ ...slide, cover: { ...slide.cover!, pills: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })}
          />
          <Input.TextArea
            rows={2}
            defaultValue={JSON.stringify(slide.cover.icons)}
            placeholder='[{"icon":"ec2","label":"Compute","sub":"EC2, Lambda"}]'
            style={{ fontFamily: 'monospace' }}
            onBlur={(e) => {
              try { onChange({ ...slide, cover: { ...slide.cover!, icons: JSON.parse(e.target.value) } }); } catch { /* keep old icons on bad JSON */ }
            }}
          />
        </div>
      )}
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

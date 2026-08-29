'use client';
import { Button, Dropdown, Tooltip } from 'antd';
import { MAX_SLIDES } from '@/lib/schema';

export default function SlideChips({
  count, selected, onSelect, onAdd, onDelete,
}: {
  count: number;
  selected: number;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onDelete: (i: number) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
      {Array.from({ length: count }, (_, i) => (
        <Dropdown
          key={i}
          trigger={['contextMenu']}
          menu={{
            items: [{ key: 'del', label: 'Delete slide', danger: true, disabled: count <= 1 }],
            onClick: () => onDelete(i),
          }}
        >
          <Button
            type={i === selected ? 'primary' : 'default'}
            onClick={() => onSelect(i)}
            style={{ width: 38 }}
            aria-label={`slide ${i + 1}`}
          >
            {i + 1}
          </Button>
        </Dropdown>
      ))}
      <Tooltip
        title={
          count >= MAX_SLIDES
            ? `${count} slides — over Instagram's ${MAX_SLIDES}-image limit`
            : 'add slide'
        }
      >
        <Button onClick={onAdd} aria-label="add slide" style={{ borderStyle: 'dashed' }}>
          +
        </Button>
      </Tooltip>
    </div>
  );
}

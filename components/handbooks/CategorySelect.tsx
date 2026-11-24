'use client';
import { useEffect, useState } from 'react';
import { Select, Tooltip } from 'antd';
import Link from 'next/link';
import { message } from '@/lib/ui/message';
import { CATEGORIES, categoryOf, type CategoryId } from '@/lib/handbookCategories';

export const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({
  value: c.id,
  label: `${c.emoji} ${c.name}`,
  title: c.blurb,
}));

/** A controlled picker; each option carries the category's one-line blurb. */
export function CategorySelect({ value, onChange, style }: {
  value: CategoryId; onChange: (id: CategoryId) => void; style?: React.CSSProperties;
}) {
  return (
    <Select
      aria-label="category"
      value={value}
      onChange={onChange}
      style={{ width: 230, ...style }}
      options={CATEGORY_OPTIONS}
      optionRender={(o) => (
        <div>
          <div>{o.label}</div>
          <div style={{ fontSize: 11, opacity: 0.6, whiteSpace: 'normal' }}>{categoryOf(o.value).blurb}</div>
        </div>
      )}
    />
  );
}

/**
 * The chapter's category in the chapter toolbar. Changing it applies to what is generated next
 * (book, pages, caption, gates); pages already written keep their content.
 */
export function ChapterCategory({ subject, chapter }: { subject: string; chapter: string }) {
  const [value, setValue] = useState<CategoryId | null>(null);
  useEffect(() => {
    fetch(`/api/handbooks/${subject}/${chapter}`).then((r) => r.json())
      .then((d) => setValue(categoryOf(d.chapter?.category).id))
      .catch(() => setValue('handbook'));
  }, [subject, chapter]);

  const change = async (category: CategoryId) => {
    const r = await fetch(`/api/handbooks/${subject}/${chapter}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category }),
    });
    if (!r.ok) return message.error((await r.json()).error ?? 'could not change category');
    setValue(category);
    message.success(`Category: ${categoryOf(category).name}. It applies to the next book, pages and review.`);
  };

  if (!value) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <CategorySelect value={value} onChange={change} />
      <Tooltip title="This category's content, presentation and script rules">
        <Link className="st-link" href={`/handbooks/categories#${value}`} style={{ fontSize: 12 }}>rules</Link>
      </Tooltip>
    </span>
  );
}

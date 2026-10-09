'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AutoComplete, Input, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import type { SearchHit } from '@/lib/search';

/** Long enough that a fast typist does not fire a request per keystroke, short enough to feel live. */
const DEBOUNCE_MS = 180;

const KIND_COLOR: Record<SearchHit['kind'], string> = {
  subject: 'magenta',
  chapter: 'blue',
  topic: 'cyan',
  explainer: 'purple',
  reel: 'volcano',
};

/**
 * The box in the top bar. It searches every shelf at once and navigates to what you pick.
 *
 * Nothing is submitted: there is no results page to submit to, and inventing one would be a second
 * place to keep the same list. Picking a row is the whole interaction.
 */
export default function StudioSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  // Answers can land out of order; only the newest query's answer is allowed to win.
  const latest = useRef(0);

  useEffect(() => {
    const query = q.trim();
    const id = ++latest.current;
    // Every state change happens on the timer, never in the effect body: typing a letter must not
    // cascade a render before the request it debounces has even been made.
    const timer = setTimeout(async () => {
      if (query.length < 2) {
        setHits([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const body = (await r.json()) as { hits?: SearchHit[] };
        if (id === latest.current) setHits(body.hits ?? []);
      } catch {
        if (id === latest.current) setHits([]);
      } finally {
        if (id === latest.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const options = useMemo(
    () =>
      hits.map((hit) => ({
        value: hit.href,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color={KIND_COLOR[hit.kind]} style={{ marginInlineEnd: 0 }}>
              {hit.kind}
            </Tag>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hit.label}
            </span>
            <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              {hit.sub}
            </Typography.Text>
          </div>
        ),
      })),
    [hits]
  );

  const notFound =
    q.trim().length < 2 ? 'keep typing…' : loading ? 'searching…' : 'nothing by that name';

  return (
    <AutoComplete
      value={q}
      options={options}
      onChange={setQ}
      onSelect={(href: string) => {
        setQ('');
        setHits([]);
        router.push(href);
      }}
      style={{ maxWidth: 320, width: '100%', marginLeft: 'auto' }}
      popupMatchSelectWidth={420}
      notFoundContent={<Typography.Text type="secondary">{notFound}</Typography.Text>}
    >
      <Input.Search placeholder="search chapters, topics…" loading={loading} />
    </AutoComplete>
  );
}

import type { ReactNode } from 'react';
import { renderInline } from '@/lib/renderer/inline';
import type { Edition } from '@/lib/digital/edition';

type Block = Record<string, unknown>;

const html = (s: unknown) => ({ __html: renderInline(String(s ?? '')) });
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

const BOX: React.CSSProperties = { border: '1px solid rgba(128,128,128,.3)', borderRadius: 8, padding: '8px 12px', margin: '10px 0' };

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case 'heading':
      return <h4 style={{ margin: '14px 0 4px' }} dangerouslySetInnerHTML={html(block.text)} />;
    case 'paragraph':
      return <p style={{ margin: '8px 0', lineHeight: 1.6 }} dangerouslySetInnerHTML={html(block.text)} />;
    case 'bullets':
      return <ul style={{ margin: '8px 0', paddingLeft: 22 }}>{list(block.items).map((t, i) => <li key={i} dangerouslySetInnerHTML={html(t)} />)}</ul>;
    case 'code': {
      const isOutput = block.lang === 'output';
      return (
        <figure style={{ margin: '10px 0' }}>
          <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 8, overflowX: 'auto', fontSize: 13, background: isOutput ? 'rgba(128,128,128,.08)' : 'rgba(22,119,255,.07)', borderLeft: isOutput ? '3px solid #52c41a' : '3px solid #1677ff' }}>
            <span style={{ display: 'block', fontSize: 11, opacity: 0.55, marginBottom: 4 }}>{isOutput ? 'output' : String(block.lang ?? 'python')}</span>
            {list(block.lines).join('\n')}
          </pre>
          {typeof block.note === 'string' && <figcaption style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }} dangerouslySetInnerHTML={html(block.note)} />}
        </figure>
      );
    }
    case 'table': {
      const headers = list(block.headers);
      const rows = Array.isArray(block.rows) ? (block.rows as unknown[][]) : [];
      return (
        <div style={{ overflowX: 'auto', margin: '10px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr>{headers.map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '4px 10px', borderBottom: '2px solid rgba(128,128,128,.4)' }} dangerouslySetInnerHTML={html(h)} />)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} style={block.highlightRow === ri ? { background: 'rgba(250,173,20,.15)' } : undefined}>
                  {list(r).map((c, ci) => <td key={ci} style={{ padding: '4px 10px', borderBottom: '1px solid rgba(128,128,128,.2)' }} dangerouslySetInnerHTML={html(c)} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'callout':
      return (
        <div style={{ ...BOX, borderLeft: `4px solid ${block.style === 'sticky' ? '#faad14' : block.style === 'takeaway' ? '#52c41a' : '#1677ff'}` }}>
          <b style={{ fontSize: 12, textTransform: 'uppercase', opacity: 0.7 }}>{String(block.style)}{block.title ? ` · ${String(block.title)}` : ''}</b>
          <div dangerouslySetInnerHTML={html(block.text)} />
        </div>
      );
    case 'sidebox':
      return (
        <div style={BOX}>
          <b>{String(block.title ?? '')}</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 22 }}>{list(block.items).map((t, i) => <li key={i} dangerouslySetInnerHTML={html(t)} />)}</ul>
        </div>
      );
    case 'qa':
      return (
        <div style={BOX}>
          <b dangerouslySetInnerHTML={html(block.q)} />
          <ul style={{ margin: '4px 0 0', paddingLeft: 22 }}>{list(block.a_bullets).map((t, i) => <li key={i} dangerouslySetInnerHTML={html(t)} />)}</ul>
          {list(block.example_code).length > 0 && <pre style={{ fontSize: 13, margin: '6px 0 0' }}>{list(block.example_code).join('\n')}</pre>}
        </div>
      );
    case 'diagram':
      return (
        <div style={BOX}>
          <b style={{ fontSize: 12, textTransform: 'uppercase', opacity: 0.7 }}>diagram · {String(block.kind)}</b>
          <pre style={{ margin: '4px 0 0', fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(block.spec, null, 2)}</pre>
        </div>
      );
    default:
      return <pre style={{ ...BOX, fontSize: 12 }}>{JSON.stringify(block, null, 2)}</pre>;
  }
}

/** A plain, read-only view of an edition: sections, pages and blocks in order. The site draws the real thing. */
export function EditionView({ edition, title }: { edition: Edition; title: string }) {
  // First page number of each section, so a page can say which number a finding would use.
  const firstPage = edition.sections.map((_, i) => edition.sections.slice(0, i).reduce((n, x) => n + x.pages.length, 0) + 1);
  return (
    <article style={{ maxWidth: 820, margin: '0 auto', padding: '24px 16px 80px' }}>
      <style>{'.em{font-weight:700}.ul{text-decoration:underline}.hl{background:#fff1b8;padding:0 2px}.mono{font-family:ui-monospace,monospace;background:rgba(128,128,128,.15);padding:0 4px;border-radius:4px}.ink-blue{color:#1677ff}.ink-red{color:#cf1322}.ink-green{color:#389e0d}.ink-purple{color:#722ed1}.ink-orange{color:#d46b08}.ink-pink{color:#c41d7f}'}</style>
      <h1 style={{ marginBottom: 4 }}>{title}</h1>
      <p style={{ opacity: 0.6, fontSize: 13, marginTop: 0 }}>Edition written {edition.generatedAt.slice(0, 16).replace('T', ' ')} · {edition.sections.length} sections</p>
      {edition.sections.map((s, si) => (
        <section key={si} style={{ marginTop: 28 }}>
          <h2 style={{ borderBottom: '1px solid rgba(128,128,128,.3)', paddingBottom: 4 }}>{s.title}</h2>
          {s.pages.map((p, pi) => {
            return (
              <div key={pi} style={{ marginTop: 16 }}>
                <h3 style={{ marginBottom: 2 }}>{p.title} <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.5 }}>page {firstPage[si] + pi}</span></h3>
                {(p.blocks as Block[]).map((b, bi) => <BlockView key={bi} block={b} />)}
              </div>
            );
          })}
        </section>
      ))}
    </article>
  );
}

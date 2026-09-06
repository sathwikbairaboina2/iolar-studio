import { describe, it, expect } from 'vitest';
import { renderInline, stripInline } from '@/lib/renderer/inline';

describe('renderInline', () => {
  it('escapes HTML before applying markers', () => {
    expect(renderInline('<b>==x==</b>')).toBe('&lt;b&gt;<mark class="hl">x</mark>&lt;/b&gt;');
  });
  it('renders every marker', () => {
    expect(renderInline('==hl==')).toBe('<mark class="hl">hl</mark>');
    expect(renderInline('**em**')).toBe('<span class="em">em</span>');
    expect(renderInline('__ul__')).toBe('<span class="ul">ul</span>');
    expect(renderInline('`x`')).toBe('<code class="mono">x</code>');
    expect(renderInline('{green:ok}')).toBe('<span class="ink-green">ok</span>');
    expect(renderInline('{purple:p} {orange:o}')).toBe('<span class="ink-purple">p</span> <span class="ink-orange">o</span>');
  });
  it('leaves unmatched markers and unknown inks literal', () => {
    expect(renderInline('a == b')).toBe('a == b');
    expect(renderInline('2 ** 3')).toBe('2 ** 3');
    expect(renderInline('{accent:x}')).toBe('{accent:x}');
    expect(renderInline('{pink:x}')).toBe('{pink:x}');
  });
  it('protects code spans from other markers', () => {
    expect(renderInline('`__init__`')).toBe('<code class="mono">__init__</code>');
    expect(renderInline('call `a**b` now')).toBe('call <code class="mono">a**b</code> now');
  });
  it('does not cross lines', () => {
    expect(renderInline('==a\nb==')).toBe('==a\nb==');
  });
  it('allows a highlight inside emphasis', () => {
    expect(renderInline('**==x==**')).toBe('<span class="em"><mark class="hl">x</mark></span>');
  });
});

describe('stripInline', () => {
  it('removes every marker and keeps the text', () => {
    expect(stripInline('==a== **b** __c__ `d` {red:e} f')).toBe('a b c d e f');
  });
  it('leaves unmatched markers alone', () => {
    expect(stripInline('a == b')).toBe('a == b');
  });
});

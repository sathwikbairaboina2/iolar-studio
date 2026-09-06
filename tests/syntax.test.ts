import { describe, it, expect } from 'vitest';
import { tokenize, highlightLine } from '@/lib/renderer/syntax';

const classes = (lang: string, line: string) => tokenize(lang, line).filter((t) => t.cls).map((t) => `${t.cls}:${t.text}`);

describe('tokenize', () => {
  it('python: keywords, comment, string, number, function call', () => {
    expect(classes('python', 'if x == 1: print("hi")  # note')).toEqual([
      'kw:if', 'num:1', 'fn:print', 'str:"hi"', 'cm:# note',
    ]);
  });
  it('c-like: java keywords and // comment', () => {
    expect(classes('java', 'int mid = low + (high - low) / 2; // safe')).toEqual(['kw:int', 'num:2', 'cm:// safe']);
    expect(classes('js', "return fetch('/x')")).toEqual(['kw:return', 'fn:fetch', "str:'/x'"]);
  });
  it('sql: keywords are case-insensitive and -- comments', () => {
    expect(classes('sql', "select * from users where id = 5 -- all")).toEqual(['kw:select', 'kw:from', 'kw:where', 'num:5', 'cm:-- all']);
  });
  it('shell: # comment, no keyword for plain words', () => {
    expect(classes('bash', 'ls -la | grep foo # list')).toEqual(['cm:# list']);
  });
  it('unknown language gets only comments and strings', () => {
    expect(classes('brainfuck', 'if "x" // y')).toEqual(['str:"x"', 'cm:// y']);
  });
  it('a hash inside a string is not a comment', () => {
    expect(classes('python', 'a = "#tag"')).toEqual(['str:"#tag"']);
  });
  it('keeps every character of the line in order', () => {
    const line = 'while (low <= high) {  // loop';
    expect(tokenize('c', line).map((t) => t.text).join('')).toBe(line);
  });
});

describe('highlightLine', () => {
  it('escapes and wraps', () => {
    expect(highlightLine('python', 'if a < b: # c')).toBe('<span class="tk-kw">if</span> a &lt; b: <span class="tk-cm"># c</span>');
  });
});

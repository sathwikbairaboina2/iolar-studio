import { escapeHtml } from './inline';

export type TokenClass = 'kw' | 'cm' | 'str' | 'num' | 'fn' | null;
export type Token = { cls: TokenClass; text: string };

type Family = 'c' | 'python' | 'sql' | 'shell' | 'none';

const FAMILY: Record<string, Family> = {
  c: 'c', cpp: 'c', 'c++': 'c', java: 'c', js: 'c', javascript: 'c', ts: 'c', typescript: 'c', go: 'c', rust: 'c',
  kotlin: 'c', swift: 'c', csharp: 'c', 'c#': 'c', php: 'c', dart: 'c', scala: 'c',
  python: 'python', py: 'python', ruby: 'python',
  sql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql', sqlite: 'sql',
  shell: 'shell', bash: 'shell', sh: 'shell', zsh: 'shell', powershell: 'shell', ps1: 'shell',
};

const KW: Record<Family, string[]> = {
  c: 'int long double float char boolean bool void var let const function return if else for while do break continue switch case default new class interface extends implements import export from static public private protected final this null true false try catch finally throw async await fn pub struct enum impl mut match use go defer func package type map range nil'.split(' '),
  python: 'def return if elif else for while in not and or is None True False class import from as with try except finally raise lambda yield pass break continue global nonlocal assert del'.split(' '),
  sql: 'select from where insert into values update set delete join inner left right on group by order having limit offset as and or not null is in like between create table drop alter index primary key union distinct count sum avg min max case when then else end'.split(' '),
  shell: [],
  none: [],
};

const LINE_COMMENT: Record<Family, string[]> = {
  c: ['//', '/*'], python: ['#'], sql: ['--', '/*'], shell: ['#'], none: ['//', '#', '--'],
};

export function familyOf(lang: string): Family {
  return FAMILY[lang.toLowerCase()] ?? 'none';
}

export function tokenize(lang: string, line: string): Token[] {
  const fam = familyOf(lang);
  const kws = new Set(KW[fam]);
  const ci = fam === 'sql';
  const out: Token[] = [];
  let plain = '';
  const flush = () => { if (plain) { out.push({ cls: null, text: plain }); plain = ''; } };

  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const starter = LINE_COMMENT[fam].find((c) => line.startsWith(c, i));
    if (starter) { flush(); out.push({ cls: 'cm', text: line.slice(i) }); break; }
    if (ch === '"' || ch === "'" || (fam === 'c' && ch === '`')) {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
      flush(); out.push({ cls: 'str', text: line.slice(i, Math.min(j + 1, line.length)) }); i = j + 1; continue;
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z0-9_]/.test(line[i - 1] ?? ' ')) {
      const m = /^\d+(\.\d+)?/.exec(line.slice(i))!;
      flush(); out.push({ cls: 'num', text: m[0] }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i))!;
      const word = m[0];
      const key = ci ? word.toLowerCase() : word;
      const next = line.slice(i + word.length).match(/^\s*\(/);
      flush();
      if (kws.has(key)) out.push({ cls: 'kw', text: word });
      else if (next && fam !== 'none' && fam !== 'shell') out.push({ cls: 'fn', text: word });
      else out.push({ cls: null, text: word });
      i += word.length; continue;
    }
    plain += ch; i++;
  }
  flush();
  return out;
}

export function highlightLine(lang: string, line: string): string {
  return tokenize(lang, line)
    .map((tk) => (tk.cls ? `<span class="tk-${tk.cls}">${escapeHtml(tk.text)}</span>` : escapeHtml(tk.text)))
    .join('');
}

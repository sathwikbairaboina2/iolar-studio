import { describe, expect, it } from 'vitest';
import { modeFromMessage, modeFromSearch, panelOrigins } from '@/lib/ui/themeSync';

const allowed = panelOrigins(undefined);

describe('modeFromSearch', () => {
  it('reads light or dark from the url, and nothing else', () => {
    expect(modeFromSearch('?theme=dark')).toBe('dark');
    expect(modeFromSearch('?a=1&theme=light')).toBe('light');
    expect(modeFromSearch('?theme=sepia')).toBeNull();
    expect(modeFromSearch('?theme=')).toBeNull();
    expect(modeFromSearch('')).toBeNull();
  });
});

describe('modeFromMessage', () => {
  it('accepts the panel origins and rejects others', () => {
    for (const origin of [
      'http://localhost:28100',
      'http://127.0.0.1:28100',
      'http://localhost:28101',
      'http://127.0.0.1:28101',
      'https://beast.tail88cf35.ts.net:8444',
    ]) {
      expect(modeFromMessage({ origin, data: { type: 'insta-theme', mode: 'dark' } }, allowed)).toBe('dark');
    }
    expect(modeFromMessage({ origin: 'https://evil.example', data: { type: 'insta-theme', mode: 'dark' } }, allowed)).toBeNull();
    expect(modeFromMessage({ origin: 'http://localhost:3120', data: { type: 'insta-theme', mode: 'dark' } }, allowed)).toBeNull();
  });

  it('ignores payloads that are not a theme message', () => {
    const origin = 'http://localhost:28100';
    for (const data of [null, undefined, 'dark', 42, {}, { type: 'other', mode: 'dark' }, { type: 'insta-theme' }, { type: 'insta-theme', mode: 'blue' }]) {
      expect(modeFromMessage({ origin, data }, allowed)).toBeNull();
    }
  });
});

describe('panelOrigins', () => {
  it('adds extra origins from the env value and drops junk', () => {
    const extra = panelOrigins(' https://panel.example.com , http://10.0.0.5:28100/ ,not a url,');
    expect(extra).toContain('https://panel.example.com');
    expect(extra).toContain('http://10.0.0.5:28100');
    expect(extra).toContain('http://localhost:28100');
    expect(extra).toHaveLength(allowed.length + 2);
    expect(modeFromMessage({ origin: 'https://panel.example.com', data: { type: 'insta-theme', mode: 'light' } }, extra)).toBe('light');
    expect(modeFromMessage({ origin: 'https://panel.example.com', data: { type: 'insta-theme', mode: 'light' } }, allowed)).toBeNull();
  });
});

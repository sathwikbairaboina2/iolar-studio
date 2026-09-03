import { describe, it, expect } from 'vitest';
import { PLUGINS } from '@/lib/plugins/registry';

describe('plugin registry', () => {
  it('lists the templates service on 26200 with its health url', () => {
    const t = PLUGINS.find((p) => p.name === 'templates')!;
    expect(t.port).toBe(26200);
    expect(t.healthUrl).toBe('http://127.0.0.1:26200/health');
    expect(t.start?.cwd).toMatch(/main-reels-templates-plugin$/);
  });
});

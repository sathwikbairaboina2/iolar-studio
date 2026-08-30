import { describe, it, expect, beforeEach } from 'vitest';

/**
 * The bus is what makes an agent's edit show up in an open studio tab. It is
 * deliberately in-process: the studio runs as one local Next process.
 */

async function bus() {
  const mod = await import('@/lib/reel/bus');
  mod.resetBus();
  return mod;
}

describe('reel bus', () => {
  beforeEach(async () => {
    (await import('@/lib/reel/bus')).resetBus();
  });

  it('delivers a published reel to a subscriber of that slug', async () => {
    const { subscribe, publish } = await bus();
    const seen: string[] = [];
    subscribe('grok', (reel) => seen.push(reel.title));

    publish('grok', { title: 'after the edit' } as never);

    expect(seen).toEqual(['after the edit']);
  });

  it('keeps slugs apart so one reel never leaks into another studio tab', async () => {
    const { subscribe, publish } = await bus();
    const seen: string[] = [];
    subscribe('grok', (reel) => seen.push(reel.title));

    publish('other-reel', { title: 'not yours' } as never);

    expect(seen).toEqual([]);
  });

  it('delivers to every subscriber on the slug', async () => {
    const { subscribe, publish } = await bus();
    const seen: string[] = [];
    subscribe('grok', () => seen.push('a'));
    subscribe('grok', () => seen.push('b'));

    publish('grok', { title: 'x' } as never);

    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('stops delivering once unsubscribed', async () => {
    const { subscribe, publish } = await bus();
    const seen: string[] = [];
    const off = subscribe('grok', () => seen.push('x'));

    off();
    publish('grok', { title: 'x' } as never);

    expect(seen).toEqual([]);
  });

  it('drops the slug entirely when its last subscriber leaves, so closed tabs do not leak', async () => {
    const { subscribe, publish, subscriberCount } = await bus();
    const off1 = subscribe('grok', () => {});
    const off2 = subscribe('grok', () => {});

    off1();
    off2();

    expect(subscriberCount('grok')).toBe(0);
    expect(() => publish('grok', { title: 'x' } as never)).not.toThrow();
  });

  it('lets the other subscribers through when one listener throws', async () => {
    const { subscribe, publish } = await bus();
    const seen: string[] = [];
    subscribe('grok', () => {
      throw new Error('a dead EventSource controller');
    });
    subscribe('grok', () => seen.push('still delivered'));

    expect(() => publish('grok', { title: 'x' } as never)).not.toThrow();
    expect(seen).toEqual(['still delivered']);
  });
});

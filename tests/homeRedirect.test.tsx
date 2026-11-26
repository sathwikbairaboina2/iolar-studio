import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

beforeEach(() => redirect.mockClear());

describe('home redirect', () => {
  it('keeps the query string, so ?theme= survives a fresh frame load', async () => {
    const { homeTarget } = await import('@/lib/ui/homeTarget');
    expect(homeTarget({ theme: 'dark' })).toBe('/handbooks?theme=dark');
    expect(homeTarget({ theme: 'light', x: '1' })).toBe('/handbooks?theme=light&x=1');
    expect(homeTarget({ tag: ['a', 'b'] })).toBe('/handbooks?tag=a&tag=b');
    expect(homeTarget({})).toBe('/handbooks');
    expect(homeTarget({ empty: undefined })).toBe('/handbooks');
  });

  it('the page redirects to the target built from its search params', async () => {
    const Home = (await import('@/app/page')).default;
    await Home({ searchParams: Promise.resolve({ theme: 'dark' }) });
    expect(redirect).toHaveBeenCalledWith('/handbooks?theme=dark');
    await Home({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenLastCalledWith('/handbooks');
  });
});

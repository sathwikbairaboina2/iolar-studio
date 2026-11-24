import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const push = vi.fn();
let path = '/handbooks';
vi.mock('next/navigation', () => ({
  usePathname: () => path,
  useRouter: () => ({ push }),
}));

const setPhone = (phone: boolean) => {
  window.matchMedia = ((q: string) => ({
    matches: phone && q.includes('max-width: 767px'),
    media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
};

async function shell() {
  const ThemeProvider = (await import('@/components/ThemeProvider')).default;
  const AppShell = (await import('@/components/AppShell')).default;
  const utils = render(
    <ThemeProvider>
      <AppShell>
        <p>page body</p>
      </AppShell>
    </ThemeProvider>
  );
  return utils;
}

beforeEach(() => {
  cleanup();
  push.mockClear();
  path = '/handbooks';
  global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ hits: [] }) }) as unknown as typeof fetch;
});

describe('AppShell on a phone', () => {
  it('opens the menu from the top bar and marks the current screen', async () => {
    setPhone(true);
    await shell();
    expect(screen.queryByRole('dialog')).toBeNull();

    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);

    const dialog = await screen.findByRole('dialog');
    const nav = within(dialog).getByRole('navigation', { name: 'Primary' });
    const here = within(nav).getByRole('link', { name: 'Handbooks' });
    expect(here.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBeNull();
    // The stories shelf is not built yet: shown, never a link.
    expect(within(nav).queryByRole('link', { name: /Stories/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open menu' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('closes the menu when a destination is chosen', async () => {
    setPhone(true);
    await shell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('link', { name: 'Jobs' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes the menu when the route changes under it', async () => {
    setPhone(true);
    const { rerender } = await shell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('dialog');
    path = '/jobs';
    const ThemeProvider = (await import('@/components/ThemeProvider')).default;
    const AppShell = (await import('@/components/AppShell')).default;
    rerender(
      <ThemeProvider>
        <AppShell>
          <p>page body</p>
        </AppShell>
      </ThemeProvider>
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('puts the search box in the menu, not in the bar', async () => {
    setPhone(true);
    await shell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByPlaceholderText(/search chapters/)).toBeTruthy();
  });

  it('keeps the menu closed at desktop width', async () => {
    setPhone(false);
    await shell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('menu links', () => {
  it('navigates exactly once on a plain click', async () => {
    setPhone(false);
    await shell();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Jobs' }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/jobs');
  });

  it.each([['ctrl', { ctrlKey: true }], ['meta', { metaKey: true }], ['shift', { shiftKey: true }]])(
    'leaves a %s click to the browser: no navigation here, default not prevented',
    async (_n, mods) => {
      setPhone(false);
      await shell();
      const nav = screen.getByRole('navigation', { name: 'Primary' });
      const notPrevented = fireEvent.click(within(nav).getByRole('link', { name: 'Jobs' }), mods);
      expect(push).not.toHaveBeenCalled();
      expect(notPrevented).toBe(true);
    }
  );
});

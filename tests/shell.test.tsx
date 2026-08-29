import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}));

// jsdom: fetch for ComfyPill
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ up: false }) }) as unknown as typeof fetch;
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe('AppShell', () => {
  it('renders menu with paperbook active and reels disabled; theme toggles', async () => {
    const ThemeProvider = (await import('@/components/ThemeProvider')).default;
    const AppShell = (await import('@/components/AppShell')).default;
    render(
      <ThemeProvider>
        <AppShell>
          <p>hi</p>
        </AppShell>
      </ThemeProvider>
    );
    expect(screen.getByText('Paperbook')).toBeTruthy();
    const reels = screen.getByText('Reels').closest('li');
    expect(reels?.className).toContain('ant-menu-item-disabled');

    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByLabelText('toggle theme'));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

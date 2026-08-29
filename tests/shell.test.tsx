import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/handbooks',
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
  global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ up: false }) }) as unknown as typeof fetch;
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe('AppShell', () => {
  it('renders both sidebar groups, disables the soon categories, defaults to light', async () => {
    const ThemeProvider = (await import('@/components/ThemeProvider')).default;
    const AppShell = (await import('@/components/AppShell')).default;
    render(
      <ThemeProvider>
        <AppShell>
          <p>hi</p>
        </AppShell>
      </ThemeProvider>
    );

    expect(screen.getByText('Create')).toBeTruthy();
    expect(screen.getByText('Library')).toBeTruthy();
    expect(screen.getByText('Handbooks')).toBeTruthy();
    expect(screen.getByText('Knowledge graph')).toBeTruthy();
    expect(screen.getByText('Reels').closest('li')?.className).toContain('ant-menu-item-disabled');

    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByLabelText('toggle theme'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

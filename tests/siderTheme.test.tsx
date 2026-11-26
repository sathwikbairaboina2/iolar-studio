import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
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
afterEach(() => cleanup());

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('sidebar follows the theme tokens', () => {
  it('takes its ground, trigger and menu from the shared tokens in both modes, not antd navy', async () => {
    const { buildTheme, themeTokens } = await import('@/components/ThemeProvider');
    for (const mode of ['light', 'dark'] as const) {
      const cfg = buildTheme(mode);
      const t = themeTokens(mode);
      const layout = cfg.components?.Layout as Record<string, string>;
      expect(layout.siderBg).toBe(t.colorBgContainer);
      expect(layout.lightSiderBg).toBe(t.colorBgContainer);
      expect(layout.triggerBg).toBe(t.colorBgContainer);
      expect(layout.lightTriggerBg).toBe(t.colorBgContainer);
      const menu = cfg.components?.Menu as Record<string, string>;
      expect(menu.darkItemBg).toBe('transparent');
      expect(menu.darkSubMenuItemBg).toBe('transparent');
    }
    expect(themeTokens('dark')).toMatchObject({ colorBgLayout: '#000000', colorBgContainer: '#121212', colorBorder: '#262626' });
    expect(themeTokens('light')).toMatchObject({ colorBgContainer: '#fafafa' });
    for (const mode of ['light', 'dark'] as const) {
      expect(JSON.stringify(buildTheme(mode))).not.toMatch(/#001529|#002140|#000c17/i);
    }
  });

  it('keeps the wordmark readable on the sidebar ground in both modes', async () => {
    const { themeTokens } = await import('@/components/ThemeProvider');
    for (const mode of ['light', 'dark'] as const) {
      const t = themeTokens(mode);
      expect(contrast(t.colorText, t.colorBgContainer)).toBeGreaterThanOrEqual(7);
    }
  });

  it('renders the wordmark with the text token and a sider painted from the theme, not the navy default', async () => {
    const ThemeProvider = (await import('@/components/ThemeProvider')).default;
    const { themeTokens } = await import('@/components/ThemeProvider');
    const AppShell = (await import('@/components/AppShell')).default;
    window.history.replaceState({}, '', '/?theme=dark');
    render(
      <ThemeProvider>
        <AppShell><p>hi</p></AppShell>
      </ThemeProvider>,
    );
    await screen.findByLabelText('toggle theme');
    expect(document.documentElement.dataset.theme).toBe('dark');
    const sider = document.querySelector('.st-sider') as HTMLElement;
    expect(sider).toBeTruthy();
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    expect(css).not.toMatch(/#001529|rgb\(0,\s*21,\s*41\)/i);
    expect(css.toLowerCase()).toContain(themeTokens('dark').colorBgContainer);
    const insta = screen.getByText('insta');
    expect(insta.style.color || insta.parentElement?.style.color).toBeTruthy();
    fireEvent.click(screen.getByLabelText('toggle theme'));
    expect(document.documentElement.dataset.theme).toBe('light');
    window.history.replaceState({}, '', '/');
  });
});

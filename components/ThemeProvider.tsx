'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { App, ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';
import { bindMessageApi } from '@/lib/ui/message';
import { modeFromMessage, modeFromSearch, panelOrigins, type Mode } from '@/lib/ui/themeSync';

const ThemeCtx = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'light', toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

/** Instagram sweep. antd drives controls from a single colorPrimary, so the gradient is
 *  painted on the surfaces broad enough to hold it and magenta carries borders and chips. */
export const SWEEP = 'linear-gradient(135deg,#fcb045,#fd1d1d,#833ab4)';

const FONT = 'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_MONO = 'var(--font-geist-mono), ui-monospace, Consolas, monospace';

const lightTokens = {
  colorPrimary: '#e1306c',
  colorBgBase: '#ffffff',
  colorBgContainer: '#fafafa',
  colorBgLayout: '#ffffff',
  colorText: '#000000',
  colorTextSecondary: '#5e5e5e',
  colorTextTertiary: '#737373',
  colorBorder: '#dbdbdb',
  colorBorderSecondary: '#ebebeb',
  colorSuccess: '#1a7f3f',
  colorWarning: '#9a5b00',
  colorError: '#c9303e',
  colorInfo: '#1f63c4',
  borderRadius: 10,
  fontFamily: FONT,
  fontFamilyCode: FONT_MONO,
};

const darkTokens = {
  colorPrimary: '#e1306c',
  colorBgBase: '#000000',
  colorBgContainer: '#121212',
  colorBgLayout: '#000000',
  colorText: '#f5f5f5',
  colorTextSecondary: '#a8a8a8',
  colorTextTertiary: '#8a8a8a',
  colorBorder: '#262626',
  colorBorderSecondary: '#1a1a1a',
  colorSuccess: '#2ecc71',
  colorWarning: '#fcb045',
  colorError: '#ed4956',
  colorInfo: '#4c9aff',
  borderRadius: 10,
  fontFamily: FONT,
  fontFamilyCode: FONT_MONO,
};

export const themeTokens = (mode: Mode) => (mode === 'dark' ? darkTokens : lightTokens);

/** antd's dark sider, trigger and menu are a fixed navy (#001529); they are repainted from the shared tokens so the
 *  sidebar sits on the same ground as the other surfaces in both modes. */
export function buildTheme(mode: Mode): ThemeConfig {
  const t = themeTokens(mode);
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: t,
    components: {
      Layout: {
        siderBg: t.colorBgContainer,
        lightSiderBg: t.colorBgContainer,
        headerBg: t.colorBgLayout,
        colorBgHeader: t.colorBgLayout,
        colorBgTrigger: t.colorBgContainer,
        triggerBg: t.colorBgContainer,
        lightTriggerBg: t.colorBgContainer,
        triggerColor: t.colorText,
        lightTriggerColor: t.colorText,
      },
      Menu: {
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'transparent',
        darkPopupBg: t.colorBgContainer,
      },
    },
  };
}

const GLOBAL_CSS = `
body{font-family:${FONT};-webkit-font-smoothing:antialiased}
code,kbd,pre,samp{font-family:${FONT_MONO}}
.ig-sweep{background-image:${SWEEP}!important;border-color:transparent!important;color:#fff!important}
.ant-btn-primary:not(:disabled){background-image:${SWEEP};border-color:transparent}
.ant-btn-primary:not(:disabled):hover{opacity:.88;border-color:transparent}
.ant-menu-item-selected{background-image:${SWEEP}!important;color:#fff!important}
.ant-menu-item-selected .ant-menu-title-content{color:#fff!important}
.ant-segmented .ant-segmented-item-selected{background-image:${SWEEP};color:#fff}
.ant-progress-bg{background-image:${SWEEP}}
`;

/** Hands the studio's toast API the instance that lives inside the theme. */
function MessageBridge() {
  const { message } = App.useApp();
  useEffect(() => {
    bindMessageApi(message);
    return () => bindMessageApi(null);
  }, [message]);
  return null;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('light');

  // A ?theme= in the url (the control-room panel adds it) wins over the stored choice.
  useEffect(() => {
    const fromUrl = modeFromSearch(window.location.search);
    if (fromUrl) { setMode(fromUrl); return; }
    try {
      const saved = localStorage.getItem('instastudio-theme');
      if (saved === 'light' || saved === 'dark') setMode(saved);
    } catch { /* ignore */ }
  }, []);

  // The panel posts the new mode when its toggle changes.
  useEffect(() => {
    const allowed = panelOrigins(process.env.NEXT_PUBLIC_PANEL_ORIGINS);
    const onMessage = (event: MessageEvent) => {
      const next = modeFromMessage(event, allowed);
      if (next) setMode(next);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem('instastudio-theme', mode); } catch { /* ignore */ }
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'light' ? 'dark' : 'light'));

  return (
    <ThemeCtx.Provider value={{ mode, toggle }}>
      <ConfigProvider theme={buildTheme(mode)}>
        <style>{GLOBAL_CSS}</style>
        {/* component={false}: no wrapper element, so the shell keeps its own layout box. */}
        <App component={false}>
          <MessageBridge />
          {children}
        </App>
      </ConfigProvider>
    </ThemeCtx.Provider>
  );
}

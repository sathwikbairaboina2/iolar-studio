'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { App, ConfigProvider, theme as antdTheme } from 'antd';
import { bindMessageApi } from '@/lib/ui/message';

type Mode = 'light' | 'dark';
const ThemeCtx = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'light', toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

/** Instagram sweep. antd drives controls from a single colorPrimary, so the gradient is
 *  painted on the surfaces broad enough to hold it and magenta carries borders and chips. */
export const SWEEP = 'linear-gradient(135deg,#fcb045,#fd1d1d,#833ab4)';

const lightTokens = {
  colorPrimary: '#e1306c',
  colorBgBase: '#ffffff',
  colorBgContainer: '#fafafa',
  colorBgLayout: '#ffffff',
  colorText: '#000000',
  colorSuccess: '#1a9e4b',
  borderRadius: 10,
};

const darkTokens = {
  colorPrimary: '#e1306c',
  colorBgBase: '#000000',
  colorBgContainer: '#121212',
  colorBgLayout: '#000000',
  colorText: '#f5f5f5',
  colorSuccess: '#25d366',
  borderRadius: 10,
};

const GLOBAL_CSS = `
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem('instastudio-theme');
      if (saved === 'light' || saved === 'dark') setMode(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem('instastudio-theme', mode); } catch { /* ignore */ }
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'light' ? 'dark' : 'light'));

  return (
    <ThemeCtx.Provider value={{ mode, toggle }}>
      <ConfigProvider
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: mode === 'dark' ? darkTokens : lightTokens,
        }}
      >
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

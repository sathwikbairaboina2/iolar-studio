'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';

type Mode = 'dark' | 'light';
const ThemeCtx = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'dark', toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

const darkTokens = {
  colorPrimary: '#7c5cff',
  colorBgBase: '#0f1016',
  colorBgContainer: '#14151f',
  colorBgLayout: '#0f1016',
  colorBorder: '#23253c',
  colorBorderSecondary: '#1e2030',
  borderRadius: 10,
};

const lightTokens = {
  colorPrimary: '#5b45e0',
  colorBgLayout: '#f5f5f7',
  borderRadius: 10,
};

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('dark');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('iolar-theme');
      if (saved === 'light' || saved === 'dark') setMode(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem('iolar-theme', mode); } catch { /* ignore */ }
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeCtx.Provider value={{ mode, toggle }}>
      <ConfigProvider
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: mode === 'dark' ? darkTokens : lightTokens,
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeCtx.Provider>
  );
}

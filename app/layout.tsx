import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import ThemeProvider from '@/components/ThemeProvider';
import AppShell from '@/components/AppShell';
import PluginActivity from '@/components/PluginActivity';
import './mobile.css';

export const metadata: Metadata = {
  title: 'instastudio',
  description: 'Instagram content studio',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body style={{ margin: 0 }}>
        <AntdRegistry>
          <ThemeProvider>
            <PluginActivity />
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}

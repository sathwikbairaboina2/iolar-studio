import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import ThemeProvider from '@/components/ThemeProvider';
import AppShell from '@/components/AppShell';
import PluginActivity from '@/components/PluginActivity';

export const metadata: Metadata = {
  title: 'instastudio',
  description: 'Instagram content studio',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
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

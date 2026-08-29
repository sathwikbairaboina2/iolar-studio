'use client';
import React from 'react';
import { Layout, Menu, Button, Badge } from 'antd';
import {
  HomeOutlined, FileTextOutlined, VideoCameraOutlined, ClockCircleOutlined,
  MessageOutlined, SmileOutlined, PictureOutlined, SettingOutlined,
  MoonOutlined, SunOutlined,
} from '@ant-design/icons';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from './ThemeProvider';
import ComfyPill from './ComfyPill';

const soon = (label: string) => (
  <span>
    {label} <Badge count="soon" style={{ backgroundColor: 'rgba(128,128,128,.25)', color: '#999', fontSize: 9 }} />
  </span>
);

const items = [
  { key: '/dashboard', icon: <HomeOutlined />, label: 'Dashboard' },
  { key: '/paperbook', icon: <FileTextOutlined />, label: 'Paperbook' },
  { key: '/reels', icon: <VideoCameraOutlined />, label: soon('Reels'), disabled: true },
  { key: '/stories', icon: <ClockCircleOutlined />, label: soon('Stories'), disabled: true },
  { key: '/quotes', icon: <MessageOutlined />, label: soon('Quote cards'), disabled: true },
  { key: '/memes', icon: <SmileOutlined />, label: soon('Memes'), disabled: true },
  { key: '/assets', icon: <PictureOutlined />, label: 'Assets' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggle } = useTheme();
  const selected = items.find((i) => pathname?.startsWith(i.key))?.key;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider width={220} theme="dark" style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px',
            color: '#fff', fontWeight: 800, fontSize: 16, letterSpacing: 0.3,
          }}
        >
          <span
            style={{
              width: 30, height: 30, borderRadius: 9, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg,#7c5cff,#3ec5ff)',
              boxShadow: '0 0 18px rgba(124,92,255,.5)',
            }}
          >
            ✍️
          </span>
          iolar studio
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selected ? [selected] : []}
          items={items}
          onClick={({ key }) => router.push(key)}
          style={{ flex: 1, background: 'transparent' }}
        />
        <ComfyPill />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            padding: '0 20px', height: 52, lineHeight: '52px',
            borderBottom: '1px solid rgba(128,128,128,.15)',
            background: 'transparent',
          }}
        >
          <Button
            type="text"
            aria-label="toggle theme"
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggle}
          />
        </Layout.Header>
        <Layout.Content style={{ padding: 20 }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}

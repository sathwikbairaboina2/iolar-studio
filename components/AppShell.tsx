'use client';
import React from 'react';
import { Button, Input, Layout, Menu, Tag } from 'antd';
import {
  BookOutlined, VideoCameraOutlined, ClockCircleOutlined, MessageOutlined, SmileOutlined,
  ShareAltOutlined, PictureOutlined, SettingOutlined, MoonOutlined, SunOutlined,
} from '@ant-design/icons';
import { usePathname, useRouter } from 'next/navigation';
import { SWEEP, useTheme } from './ThemeProvider';
import ComfyPill from './ComfyPill';

const soon = (label: string) => (
  <span>
    {label} <Tag style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}>soon</Tag>
  </span>
);

const items = [
  {
    key: 'create',
    type: 'group' as const,
    label: 'Create',
    children: [
      { key: '/handbooks', icon: <BookOutlined />, label: 'Handbooks' },
      { key: '/reels', icon: <VideoCameraOutlined />, label: soon('Reels'), disabled: true },
      { key: '/stories', icon: <ClockCircleOutlined />, label: soon('Stories'), disabled: true },
      { key: '/quotes', icon: <MessageOutlined />, label: soon('Quote cards'), disabled: true },
      { key: '/memes', icon: <SmileOutlined />, label: soon('Memes'), disabled: true },
    ],
  },
  {
    key: 'library',
    type: 'group' as const,
    label: 'Library',
    children: [
      { key: '/graph', icon: <ShareAltOutlined />, label: 'Knowledge graph' },
      { key: '/assets', icon: <PictureOutlined />, label: 'Assets' },
      { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
    ],
  },
];

const FLAT = items.flatMap((g) => g.children);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggle } = useTheme();
  const selected = FLAT.filter((i) => pathname?.startsWith(i.key)).sort((a, b) => b.key.length - a.key.length)[0]?.key;

  const crumbs = (pathname ?? '/').split('/').filter(Boolean);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        width={232}
        theme={mode}
        style={{ borderRight: '1px solid rgba(128,128,128,.18)', display: 'flex', flexDirection: 'column' }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '18px 18px 14px',
            fontWeight: 800, fontSize: 17, letterSpacing: '-0.4px',
          }}
        >
          <span style={{ width: 28, height: 28, borderRadius: 9, backgroundImage: SWEEP, display: 'inline-block' }} />
          <span>
            insta
            <span style={{ backgroundImage: SWEEP, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
              studio
            </span>
          </span>
        </div>
        <Menu
          theme={mode}
          mode="inline"
          selectedKeys={selected ? [selected] : []}
          items={items}
          onClick={({ key }) => router.push(key)}
          style={{ flex: 1, background: 'transparent', borderInlineEnd: 'none' }}
        />
        <ComfyPill />
      </Layout.Sider>

      <Layout>
        <Layout.Header
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', height: 52, lineHeight: '52px',
            borderBottom: '1px solid rgba(128,128,128,.18)', background: 'transparent',
          }}
        >
          <span style={{ fontSize: 12.5, opacity: 0.7 }} data-testid="crumbs">
            {crumbs.length ? crumbs.join(' / ') : 'instastudio'}
          </span>
          <Input.Search placeholder="search chapters, topics…" style={{ maxWidth: 260, marginLeft: 'auto' }} />
          <Button
            type="text"
            aria-label="toggle theme"
            icon={mode === 'light' ? <MoonOutlined /> : <SunOutlined />}
            onClick={toggle}
          />
        </Layout.Header>
        <Layout.Content style={{ padding: 22 }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}

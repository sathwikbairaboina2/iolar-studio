'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Layout, Menu, Tag } from 'antd';
import Link from 'next/link';
import {
  BookOutlined, VideoCameraOutlined, ClockCircleOutlined, MessageOutlined, SmileOutlined,
  ShareAltOutlined, PictureOutlined, SettingOutlined, MoonOutlined, SunOutlined, ApiOutlined, ScheduleOutlined, ReadOutlined,
  NodeIndexOutlined, MenuOutlined,
} from '@ant-design/icons';
import { usePathname, useRouter } from 'next/navigation';
import StudioSearch from './StudioSearch';
import { SWEEP, useTheme } from './ThemeProvider';
import { usePhone } from '@/lib/ui/useMedia';

const soon = (label: string) => (
  <span>
    {label} <Tag style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}>soon</Tag>
  </span>
);

const rows = [
  {
    key: 'create',
    type: 'group' as const,
    label: 'Create',
    children: [
      { key: '/handbooks', icon: <BookOutlined />, label: 'Handbooks' },
      { key: '/launch', icon: <VideoCameraOutlined />, label: 'Launch reels' },
      { key: '/explainers', icon: <NodeIndexOutlined />, label: 'Explainers' },
      { key: '/jobs', icon: <ScheduleOutlined />, label: 'Jobs' },
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
      { key: '/plugins', icon: <ApiOutlined />, label: 'Plugins' },
      { key: '/about', icon: <ReadOutlined />, label: 'How it works' },
      { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
    ],
  },
];

const FLAT = rows.flatMap((g) => g.children);

/** The menu entries. A live row is a real link, so the current screen can say so with aria-current and a
 *  middle click opens it in a tab; the rows that are not built yet stay plain text. */
const navItems = (selected?: string) =>
  rows.map((g) => ({
    ...g,
    children: g.children.map((i) =>
      i.disabled
        ? i
        : {
            ...i,
            label: (
              <Link
                href={i.key}
                aria-current={i.key === selected ? 'page' : undefined}
                style={{ color: 'inherit' }}
                // The menu row does the navigation, so a plain click on the link must not do it twice. A click
                // with a modifier is the browser's (new tab or window): it must not reach the row either.
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) e.stopPropagation();
                  else e.preventDefault();
                }}
              >
                {i.label}
              </Link>
            ),
          }
    ),
  }));

function Brand() {
  return (
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
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggle } = useTheme();
  const phone = usePhone();
  const selected = FLAT.filter((i) => pathname?.startsWith(i.key)).sort((a, b) => b.key.length - a.key.length)[0]?.key;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  const crumbs = (pathname ?? '/').split('/').filter(Boolean);

  // The menu is for one screen on a phone: a route change, or a window grown past phone width, ends it.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!phone) setMenuOpen(false);
  }, [phone]);

  // Focus returns to the button that opened the menu, however the menu closed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !menuOpen) menuButton.current?.focus();
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  const menu = (onDone?: () => void) => (
    <Menu
      theme={mode}
      mode="inline"
      selectedKeys={selected ? [selected] : []}
      items={navItems(selected)}
      onClick={({ key }) => {
        router.push(key);
        onDone?.();
      }}
      style={{ flex: 1, background: 'transparent', borderInlineEnd: 'none' }}
    />
  );

  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Layout.Sider
        className="st-sider"
        width={232}
        theme={mode}
        style={{ borderRight: '1px solid rgba(128,128,128,.18)', display: 'flex', flexDirection: 'column' }}
      >
        <Brand />
        <nav aria-label="Primary" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {menu()}
        </nav>
      </Layout.Sider>

      <Layout className="st-main">
        <Layout.Header
          className="st-header"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', height: 52, lineHeight: '52px',
            borderBottom: '1px solid rgba(128,128,128,.18)', background: 'transparent',
          }}
        >
          <Button
            ref={menuButton}
            className="st-menu-btn"
            type="text"
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            icon={<MenuOutlined />}
            onClick={() => setMenuOpen(true)}
          />
          <span className="st-crumbs" style={{ fontSize: 12.5, opacity: 0.7 }} data-testid="crumbs">
            {crumbs.length ? crumbs.join(' / ') : 'instastudio'}
          </span>
          <span className="st-search">
            <StudioSearch />
          </span>
          <Button
            type="text"
            aria-label="toggle theme"
            icon={mode === 'light' ? <MoonOutlined /> : <SunOutlined />}
            onClick={toggle}
          />
        </Layout.Header>
        {/* overflowX hidden so a wide timeline scrolls in its own box, never the page. */}
        <Layout.Content className="st-content" style={{ padding: '28px 32px 40px', overflowX: 'hidden' }}>
          {children}
        </Layout.Content>
      </Layout>

      <Drawer
        rootClassName="st-nav-drawer"
        placement="left"
        size={300}
        title="instastudio"
        open={menuOpen && phone}
        onClose={() => setMenuOpen(false)}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ padding: '12px 12px 4px' }}>
          <StudioSearch />
        </div>
        <nav aria-label="Primary">{menu(() => setMenuOpen(false))}</nav>
      </Drawer>
    </Layout>
  );
}

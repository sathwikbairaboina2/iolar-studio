import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import type { Finding } from '@/lib/verify/gates';

afterEach(cleanup);

const findings: Finding[] = [
  {
    pass: 'code', rule: 'code.severed', severity: 'blocker', page: 3, block: 1,
    summary: 'Code block starts indented — its class or function header is missing.',
    evidence: 'def __next__(s):',
    fix: 'Include the enclosing class line.',
  },
  {
    pass: 'code', rule: 'heading.unique', severity: 'major', page: 5,
    summary: 'Heading "Time Complexity" already appears on page 2.',
    evidence: 'Time Complexity',
    fix: 'Rename this section.',
  },
];

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
});

function mockFetch(calls: { url: string; method?: string; body?: unknown }[]) {
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (init?.method === 'POST' && url.endsWith('/review')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          review: { generatedAt: new Date().toISOString(), part: 1, findings, passed: false },
          current: true,
        }),
      });
    }
    if (init?.method === 'POST' && url.endsWith('/revise')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposal: { fixed: true }, diff: [] }) });
    }
    if (init?.method === 'PUT') {
      return Promise.resolve({ ok: true, json: async () => ({ fixed: true }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ review: null, current: false }) });
  }) as unknown as typeof fetch;
}

describe('VerifyDrawer', () => {
  it('runs the checks and lists findings by severity', async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    mockFetch(calls);

    const VerifyDrawer = (await import('@/components/editor/VerifyDrawer')).default;
    render(
      <VerifyDrawer
        subject="python" chapter="lists" part={1} open
        onOpen={() => {}} onClose={() => {}} onGoToPage={() => {}} onApplied={() => {}}
      />
    );

    fireEvent.click(await screen.findByText('Run checks', {}, { timeout: 5000 }));
    expect(await screen.findByText(/blocker\(s\) hold publishing/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('code.severed')).toBeTruthy();

    const gates = calls.find((c) => c.method === 'POST' && c.url.endsWith('/review'));
    expect((gates?.body as { mode?: string })?.mode).toBe('gates');
  });

  it('sends a finding through the revise path and saves the proposal', async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    mockFetch(calls);
    const onApplied = vi.fn();

    const VerifyDrawer = (await import('@/components/editor/VerifyDrawer')).default;
    render(
      <VerifyDrawer
        subject="python" chapter="lists" part={1} open
        onOpen={() => {}} onClose={() => {}} onGoToPage={() => {}} onApplied={onApplied}
      />
    );

    fireEvent.click(await screen.findByText('Run checks', {}, { timeout: 5000 }));
    await screen.findByText('code.severed', {}, { timeout: 5000 });

    fireEvent.click(screen.getAllByText('✦ Fix with AI')[0]);
    await waitFor(() => expect(onApplied).toHaveBeenCalled());

    const revise = calls.find((c) => c.url.endsWith('/revise'));
    const body = revise?.body as { request: string; scope: string; slideIndex: number };
    expect(body.scope).toBe('slide');
    expect(body.slideIndex).toBe(2); // page 3 -> index 2
    expect(body.request).toContain('header is missing');
    expect(body.request).toContain('Do not remove any other content.');
    expect(calls.some((c) => c.method === 'PUT')).toBe(true);
  });

  it('jumps to the page a finding points at', async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    mockFetch(calls);
    const onGoToPage = vi.fn();

    const VerifyDrawer = (await import('@/components/editor/VerifyDrawer')).default;
    render(
      <VerifyDrawer
        subject="python" chapter="lists" part={1} open
        onOpen={() => {}} onClose={() => {}} onGoToPage={onGoToPage} onApplied={() => {}}
      />
    );

    fireEvent.click(await screen.findByText('Run checks', {}, { timeout: 5000 }));
    await screen.findByText('code.severed', {}, { timeout: 5000 });

    fireEvent.click(screen.getByText('page 3'));
    expect(onGoToPage).toHaveBeenCalledWith(3);
  });
});

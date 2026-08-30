import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * The panel is the review surface. Its job is to make a proposal legible and to
 * refuse to apply one that would not fully land — an 8B model gets things wrong,
 * and the measured failure was a well-formed command with the wrong sign.
 */

afterEach(cleanup);

// jsdom has none, and antd's auto-sizing TextArea observes itself.
global.ResizeObserver =
  global.ResizeObserver ?? (class { observe() {} unobserve() {} disconnect() {} } as never);

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply>;
const calls: { url: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  replies = {};
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    // Longest first: "/agent" is a substring of "/agent/apply", and the wrong
    // one winning makes apply silently receive the proposal reply.
    const key = Object.keys(replies)
      .sort((a, b) => b.length - a.length)
      .find((k) => u.endsWith(k)) ?? '';
    const { status = 200, body } = replies[key] ?? { body: {} };
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
  });
});

const trim = { op: 'clip.trim', args: { clipId: 'c1', edge: 'out', deltaSec: -0.5 }, actor: 'agent' };

async function panel(onApplied = vi.fn()) {
  const AgentPanel = (await import('@/components/reel/AgentPanel')).default;
  render(<AgentPanel slug="grok" onApplied={onApplied} />);
  return { onApplied };
}

function ask(text = 'the first clip drags') {
  fireEvent.change(screen.getByTestId('agent-prompt'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('agent-run'));
}

describe('agent panel', () => {
  it('will not run on an empty prompt', async () => {
    await panel();

    expect((screen.getByTestId('agent-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the typed request to the agent', async () => {
    await panel();
    replies['/agent'] = { body: { provider: 'local', commands: [], applied: [], rejected: [] } };

    ask('tighten the hook');

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/agent'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/agent'))?.body).toEqual({ prompt: 'tighten the hook' });
  });

  it('lists what the agent proposes in words, not JSON', async () => {
    await panel();
    replies['/agent'] = {
      body: {
        provider: 'local',
        commands: [trim],
        applied: [{ index: 0, op: 'clip.trim', summary: 'trim c1 out -0.5s' }],
        rejected: [],
      },
    };

    ask();

    expect(await screen.findByText('trim c1 out -0.5s')).toBeTruthy();
  });

  it('applies the proposed commands on Apply', async () => {
    const { onApplied } = await panel();
    replies['/agent'] = {
      body: { provider: 'local', commands: [trim], applied: [{ index: 0, op: 'clip.trim', summary: 'trim c1 out -0.5s' }], rejected: [] },
    };
    replies['/agent/apply'] = { body: { reel: { title: 'Grok' }, applied: [{ op: 'clip.trim' }] } };

    ask();
    fireEvent.click(await screen.findByTestId('agent-apply'));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/agent/apply'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/agent/apply'))?.body).toEqual({ commands: [trim] });
    expect(onApplied).toHaveBeenCalled();
  });

  it('clears the proposal once applied, so it cannot be applied twice', async () => {
    await panel();
    replies['/agent'] = {
      body: { provider: 'local', commands: [trim], applied: [{ index: 0, op: 'clip.trim', summary: 'trim c1 out -0.5s' }], rejected: [] },
    };
    replies['/agent/apply'] = { body: { reel: {}, applied: [{ op: 'clip.trim' }] } };

    ask();
    fireEvent.click(await screen.findByTestId('agent-apply'));

    await waitFor(() => expect(screen.queryByTestId('agent-apply')).toBeNull());
  });

  it('drops the proposal on Discard without touching the reel', async () => {
    await panel();
    replies['/agent'] = {
      body: { provider: 'local', commands: [trim], applied: [{ index: 0, op: 'clip.trim', summary: 'trim c1 out -0.5s' }], rejected: [] },
    };

    ask();
    fireEvent.click(await screen.findByTestId('agent-discard'));

    expect(screen.queryByTestId('agent-apply')).toBeNull();
    expect(calls.some((c) => c.url.includes('/apply'))).toBe(false);
  });

  // A partly valid plan is never half-applied; that is what keeps preview honest.
  it('refuses to offer Apply when any command was rejected', async () => {
    await panel();
    replies['/agent'] = {
      body: {
        provider: 'local',
        commands: [trim, { op: 'clip.delete', args: { clipId: 'c99' }, actor: 'agent' }],
        applied: [{ index: 0, op: 'clip.trim', summary: 'trim c1 out -0.5s' }],
        rejected: [{ index: 1, op: 'clip.delete', error: 'no clip "c99" on this reel', detail: {} }],
      },
    };

    ask();

    expect(await screen.findByText(/no clip "c99"/)).toBeTruthy();
    expect(screen.queryByTestId('agent-apply')).toBeNull();
  });

  it('says so when the agent proposes nothing', async () => {
    await panel();
    replies['/agent'] = {
      body: { provider: 'local', commands: [], applied: [], rejected: [], note: 'The agent proposed no changes.' },
    };

    ask();

    expect(await screen.findByText(/proposed no changes/)).toBeTruthy();
    expect(screen.queryByTestId('agent-apply')).toBeNull();
  });

  it('shows the service error verbatim, since it names what to restart', async () => {
    await panel();
    replies['/agent'] = {
      status: 503,
      body: { error: 'The local agent at http://127.0.0.1:3121 is not reachable. Start it with `docker compose -f agent/compose.yml up -d`.' },
    };

    ask();

    expect(await screen.findByText(/agent\/compose\.yml/)).toBeTruthy();
  });

  it('reports which commands landed when apply stops partway', async () => {
    await panel();
    replies['/agent'] = {
      body: { provider: 'local', commands: [trim], applied: [{ index: 0, op: 'clip.trim', summary: 'trim c1 out -0.5s' }], rejected: [] },
    };
    replies['/agent/apply'] = {
      status: 409,
      body: {
        error: 'no clip "c2" on this reel',
        applied: [{ index: 0, op: 'clip.trim', summary: 'trim c1 out -0.5s' }],
        rejected: { index: 1, op: 'clip.delete', error: 'no clip "c2" on this reel' },
        notAttempted: 0,
      },
    };

    ask();
    fireEvent.click(await screen.findByTestId('agent-apply'));

    expect(await screen.findByText(/no clip "c2"/)).toBeTruthy();
  });

  it('names which brain answered', async () => {
    await panel();
    replies['/agent'] = { body: { provider: 'local', commands: [], applied: [], rejected: [], note: 'nothing to do' } };

    ask();

    expect(await screen.findByTestId('agent-provider')).toBeTruthy();
  });
});

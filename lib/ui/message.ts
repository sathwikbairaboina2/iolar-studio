'use client';
import { message as staticMessage } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

/**
 * One toast API for the whole studio.
 *
 * antd's static `message.*` renders outside React, so it never sees the ConfigProvider and a
 * toast comes out light while the studio is dark — which is what the console warning is about.
 * `App.useApp()` hands back an instance that does see it, but it is a hook, and the calls are
 * spread over a hundred call sites in components, hooks and plain modules.
 *
 * So the instance is registered once, from the bridge inside the theme, and every call site
 * imports this object instead of antd's. Calls made before the bridge mounts (or from a module
 * with no React around it) fall back to the static API rather than being dropped.
 */
let bound: MessageInstance | null = null;

export const bindMessageApi = (api: MessageInstance | null) => {
  bound = api;
};

export const message: MessageInstance = new Proxy({} as MessageInstance, {
  get(_target, prop: keyof MessageInstance) {
    const api = bound ?? staticMessage;
    const value = api[prop];
    return typeof value === 'function' ? value.bind(api) : value;
  },
});

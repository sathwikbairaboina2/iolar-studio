import { existsSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { PLUGINS } from '@/lib/plugins/registry';

describe('plugin registry', () => {
  const templates = () => PLUGINS.find((p) => p.name === 'templates')!;

  it('lists the templates service on 26200 with its health url', () => {
    const t = templates();
    expect(t.port).toBe(26200);
    expect(t.healthUrl).toBe('http://127.0.0.1:26200/health');
    expect(t.start?.cwd).toMatch(/main-reels-templates-plugin[/\\]api$/);
  });

  // The Start button reported success while nothing came up, because the script it names sits
  // one directory below where it was run. A path that merely looks right is what allowed that,
  // so this asks the disk: the file has to be there, under the cwd, by the name we pass.
  it('starts the templates service from the directory its script actually lives in', () => {
    const t = templates();
    const cwd = t.start!.cwd;
    const script = t.start!.args[t.start!.args.length - 1];
    if (!existsSync(cwd)) return; // the plugin is not checked out on this machine
    expect(existsSync(path.join(cwd, script))).toBe(true);
  });
});

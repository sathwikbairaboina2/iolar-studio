import { spawn } from 'child_process';
import { pluginByName } from './registry';
import { logPlugin } from './log';

/**
 * Starts one service, by name only.
 *
 * The name is looked up in the registry and the recipe comes from there — nothing a caller
 * sends is ever run. The child is detached and its output goes nowhere: this is the same
 * command a person would type in a terminal they then close, and the studio should not die
 * with it or fill memory with its log.
 */

export class PluginStartError extends Error {}

export async function startPlugin(name: string): Promise<{ started: true; hint: string }> {
  const plugin = pluginByName(name);
  if (!plugin) throw new PluginStartError(`no plugin called "${name}"`);
  if (!plugin.start) {
    throw new PluginStartError(`${plugin.label} is not something the studio can start — launch it yourself`);
  }

  const child = spawn(plugin.start.command, plugin.start.args, {
    cwd: plugin.start.cwd,
    detached: true,
    stdio: 'ignore',
    shell: true,
    windowsHide: true,
  });
  child.unref();
  logPlugin(plugin.name, `starting ${plugin.label}: ${plugin.start.hint} in ${plugin.start.cwd}`, 'info');
  child.on('error', (err) => logPlugin(plugin.name, `${plugin.label} would not start: ${err.message}`, 'error'));

  return { started: true, hint: plugin.start.hint };
}

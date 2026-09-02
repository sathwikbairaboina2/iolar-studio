import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import path from 'path';
import type { ResearchJob } from '@/lib/jobs/researchApi';

/**
 * The studio keeps a zod 4 copy of the plugin's zod 3 schema. The copy is only right if
 * both accept and reject the same rows. vitest will not import a file outside its root,
 * so the plugin judges the rows with its own tsx and its own zod, and we compare verdicts
 * on every mapped sample row and on six broken ones.
 */

const PLUGIN = process.env.JOBS_REEL_DIR ?? 'C:/Users/sathwik/projects/plugins/jobs-reel-plugin';
const schemaFile = path.join(PLUGIN, 'lib', 'schema', 'jobs.ts');
const tsxCli = path.join(PLUGIN, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const sample = (JSON.parse(readFileSync('tests/fixtures/jobs-pool.sample.json', 'utf8')) as { items: ResearchJob[] }).items;

const VERDICT_SCRIPT = [
  // Node's ESM loader wants a file:// URL for an absolute path on Windows.
  `import { JobSchema } from ${JSON.stringify(pathToFileURL(schemaFile).href)};`,
  `let s = '';`,
  `process.stdin.on('data', (c) => (s += c));`,
  `process.stdin.on('end', () => {`,
  `  const rows = JSON.parse(s);`,
  `  process.stdout.write(JSON.stringify(rows.map((r) => JobSchema.safeParse(r).success)));`,
  `});`,
  ``,
].join('\n');

describe.skipIf(!existsSync(schemaFile) || !existsSync(tsxCli))('reel schema parity', () => {
  it('accepts and rejects exactly what the plugin does', async () => {
    const studio = await import('@/lib/jobs/reelSchema');
    const { mapRows } = await import('@/lib/jobs/map');
    const rows = await mapRows(sample, '2026-W36', async (t) => t.map(() => 'other'));
    const good = rows.filter((r) => r.row).map((r) => r.row);
    expect(good.length).toBeGreaterThan(8);
    const base = good[0] as Record<string, unknown>;
    const broken = [
      { ...base, function: 'astronaut' },
      { ...base, experienceMin: 6, experienceMax: 2 },
      { ...base, salaryMin: 20, salaryMax: 10 },
      { ...base, postedOn: '2026/09/02' },
      { ...base, link: 'nope' },
      { ...base, currency: 'INRR' },
    ];
    const all = [...good, ...broken];
    const scriptPath = path.join(tmpdir(), `reel-schema-verdicts-${process.pid}.mts`);
    writeFileSync(scriptPath, VERDICT_SCRIPT);
    const out = execFileSync(process.execPath, [tsxCli, scriptPath], {
      cwd: PLUGIN,
      input: JSON.stringify(all),
      encoding: 'utf8',
      timeout: 60_000,
    });
    const verdicts = JSON.parse(out) as boolean[];
    expect(verdicts).toHaveLength(all.length);
    all.forEach((x, i) => {
      expect(studio.JobSchema.safeParse(x).success, JSON.stringify(x).slice(0, 120)).toBe(verdicts[i]);
    });
    for (const x of broken) expect(studio.JobSchema.safeParse(x).success).toBe(false);
  });
});

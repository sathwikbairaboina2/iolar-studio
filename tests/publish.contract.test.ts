import { existsSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const AIIOLAR = 'C:/Users/sathwik/projects/aiiolar/src/lib/handbooks/contract.ts';
describe('contract copy', () => {
  it.skipIf(!existsSync(AIIOLAR))('matches aiiolar byte for byte', () => {
    expect(readFileSync('lib/publish/contract.ts', 'utf8')).toBe(readFileSync(AIIOLAR, 'utf8'));
  });
});

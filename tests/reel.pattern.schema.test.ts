import { describe, it, expect } from 'vitest';
import { validateReel, emptyReel } from '@/lib/reel/schema';

describe('reel style and pattern fields', () => {
  it('migrates a legacy string pattern into style and leaves pattern null', () => {
    const legacy = { ...emptyReel('x'), pattern: 'armand' } as unknown as Record<string, unknown>;
    delete legacy.style;
    const reel = validateReel(legacy);
    expect(reel.style).toBe('armand');
    expect(reel.pattern).toBeNull();
  });

  it('defaults style to armand and pattern to null on a fresh reel', () => {
    const reel = emptyReel('fresh');
    expect(reel.style).toBe('armand');
    expect(reel.pattern).toBeNull();
  });
});

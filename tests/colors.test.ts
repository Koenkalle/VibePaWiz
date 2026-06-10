import { describe, expect, it } from 'vitest';
import { palette, rainbow } from '../src/viz/colors';

describe('rainbow / palette', () => {
  it('returns hex colors', () => {
    expect(rainbow(6, 0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(rainbow(6, 3)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('falls back to grey for non-positive counts', () => {
    expect(rainbow(0, 0)).toBe('#888888');
  });

  it('produces the requested number of distinct colors', () => {
    const colors = palette(5);
    expect(colors).toHaveLength(5);
    expect(new Set(colors).size).toBe(5);
  });
});

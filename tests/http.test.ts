import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test, fetchJson } from '../src/providers/http';

const { parseRetryAfter } = __test;

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('reads an HTTP date relative to the given now', () => {
    const now = 1_000_000_000_000; // a whole-second boundary
    expect(parseRetryAfter(new Date(now + 5000).toUTCString(), now)).toBe(5000);
  });

  it('returns undefined for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('fetchJson rate limiting', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('spaces consecutive requests to the same host', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    vi.stubGlobal('fetch', fetchMock);

    // An unknown host uses the default 200ms minimum spacing.
    const url = 'https://rate.test/resource';
    void fetchJson(url);
    void fetchJson(url);

    // The first request starts immediately; the second is held by the rate gate.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Once the interval elapses, the second request is released.
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

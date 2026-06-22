import { ProviderError } from './types';

const DEFAULT_RETRIES = 3;

/**
 * Minimum spacing between request *starts* per host (ms). The keyless Semantic
 * Scholar pool is aggressively rate-limited (HTTP 429, surfaced in-browser as a
 * CORS/NetworkError because its error responses carry no CORS headers), so its
 * requests are spaced ~1s apart; OpenAlex's polite pool tolerates ~10 req/s.
 * Spacing here — not just capping concurrency — is what keeps a big-graph
 * expansion from triggering a 429 storm.
 */
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  'api.semanticscholar.org': 1100,
  'api.openalex.org': 120,
};
const DEFAULT_MIN_INTERVAL_MS = 200;

/** Per-host earliest-next-start timestamp (ms), advanced as requests are queued. */
const nextStartAt = new Map<string, number>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** True for transient conditions worth retrying with backoff. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Parse a `Retry-After` header value (delta-seconds or an HTTP date) into a
 * millisecond delay. Returns undefined when absent or unparseable.
 */
function parseRetryAfter(value: string | null, nowMs: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Block until this host's rate window allows another request, reserving the slot
 * synchronously (no await between read and write of `nextStartAt`) so concurrent
 * callers queue in order rather than all firing at once.
 */
async function rateGate(url: string, signal?: AbortSignal): Promise<void> {
  const host = hostOf(url);
  const interval = HOST_MIN_INTERVAL_MS[host] ?? DEFAULT_MIN_INTERVAL_MS;
  const now = Date.now();
  const start = Math.max(now, nextStartAt.get(host) ?? 0);
  nextStartAt.set(host, start + interval);
  if (start > now) await sleep(start - now, signal);
}

/**
 * Fetch JSON with per-host rate limiting and exponential backoff on transient
 * failures. Replaces the ad-hoc XMLHttpRequest + setTimeout retry loop from the
 * original loadData.js. Honors the AbortSignal during the request, the rate-limit
 * wait, and between retries.
 */
export async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
  retries = DEFAULT_RETRIES,
  headers?: Record<string, string>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await rateGate(url, signal);
    let retryAfter: number | undefined;
    try {
      const res = await fetch(url, { signal, headers: { Accept: 'application/json', ...headers } });
      if (res.ok) return (await res.json()) as T;
      if (!isRetryableStatus(res.status) || attempt === retries) {
        throw new ProviderError(`Request failed (${res.status}) for ${url}`, res.status);
      }
      retryAfter = parseRetryAfter(res.headers?.get('Retry-After') ?? null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof ProviderError) throw err;
      lastError = err;
      if (attempt === retries) break;
    }
    // Honor a server-sent Retry-After; otherwise exponential backoff with jitter
    // (~0.5s, 1s, 2s ...). The per-host rate gate already spaces the next start.
    await sleep(retryAfter ?? 500 * 2 ** attempt + Math.random() * 250, signal);
  }
  throw new ProviderError(
    `Request failed after ${retries + 1} attempts for ${url}: ${String(lastError)}`,
  );
}

// Exposed for unit tests.
export const __test = { parseRetryAfter };

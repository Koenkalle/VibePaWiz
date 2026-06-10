import { ProviderError } from './types';

const DEFAULT_RETRIES = 3;

/** True for transient conditions worth retrying with backoff. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
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
 * Fetch JSON with exponential backoff on transient failures. Replaces the
 * ad-hoc XMLHttpRequest + setTimeout retry loop from the original loadData.js.
 * Honors the AbortSignal both during the request and between retries.
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
    try {
      const res = await fetch(url, { signal, headers: { Accept: 'application/json', ...headers } });
      if (res.ok) return (await res.json()) as T;
      if (!isRetryableStatus(res.status) || attempt === retries) {
        throw new ProviderError(`Request failed (${res.status}) for ${url}`, res.status);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof ProviderError) throw err;
      lastError = err;
      if (attempt === retries) break;
    }
    // Exponential backoff with jitter: ~0.5s, 1s, 2s ...
    await sleep(500 * 2 ** attempt + Math.random() * 250, signal);
  }
  throw new ProviderError(
    `Request failed after ${retries + 1} attempts for ${url}: ${String(lastError)}`,
  );
}

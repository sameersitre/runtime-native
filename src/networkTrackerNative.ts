/**
 * Network Request Tracker for @flotrace/runtime-native.
 *
 * Mirrors the web tracker in `@flotrace/runtime` but drops the patches that
 * crash the React Native bridge:
 *   - NO Response.prototype.json patch (RN's fetch polyfill rejects it —
 *     see research doc §11.3.2).
 *   - NO global JSON.parse patch (same bridge crash; axios on RN also reads
 *     responses through different paths than on the web).
 *
 * API → Store causal correlation for XHR still works via the `responseType='json'`
 * direct-tag branch (the RN platform pre-parses JSON when responseType is set),
 * which is the dominant pattern for RN networking libraries (axios, TanStack
 * Query with a custom fetcher). Fetch responses on RN are NOT auto-tagged —
 * users who need causal correlation for fetch can wrap their fetcher manually.
 *
 * Ambient types for fetch / URL / XMLHttpRequest / timer globals live in
 * `./rnGlobals.d.ts` because `runtime-native`'s tsconfig excludes `lib: ["DOM"]`.
 */

import type {
  NetworkRequestEntry,
  FloTraceWebSocketClient,
} from '@flotrace/runtime-core';
import {
  getCurrentRenderingFiber,
  getComponentNameFromFiber,
  buildAncestorChain,
  tagFetchData,
  clearFetchOriginTags,
} from '@flotrace/runtime-core';

// ============================================================================
// Types
// ============================================================================

/** XHR instance with per-request metadata stashed on it by our open()/send(). */
interface XhrWithMeta extends RNXHR {
  __ftMethod?: string;
  __ftUrl?: string;
  __ftRequestId?: string;
}

/**
 * Typed handle to `globalThis.fetch`. Avoids repeated
 * `(globalThis as unknown as { fetch: RNFetch })` casts at call sites.
 */
const rnGlobal = globalThis as unknown as { fetch?: RNFetch };

// ============================================================================
// Constants
// ============================================================================

const MAX_BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFER_SIZE = 300;
const DEDUPE_WINDOW_MS = 5000;
const MAX_ANCESTOR_CHAIN = 3;

/**
 * URL path patterns that identify noise (Metro dev-server traffic, analytics
 * beacons, FloTrace's own WebSocket). Hostnames are intentionally avoided —
 * Metro's host varies per topology (localhost / 10.0.2.2 / LAN IP) and path
 * matching is topology-independent.
 *
 * Patterns are anchored to path-leaves (`(\?|$)`) where a collision with user
 * APIs would otherwise be likely — a user endpoint at `/api/hotels` or
 * `/reload-data` must not be swallowed by the Metro filter. Patterns like
 * `/symbolicate` and `/inspector/` stay loose because user paths rarely
 * contain those tokens.
 */
const NOISE_URL_PATTERNS: RegExp[] = [
  // Metro / RN dev server
  /\/symbolicate(\?|$)/i,
  /\/open-stack-frame(\?|$)/i,
  /\/launch-js-devtools(\?|$)/i,
  /\/hot(\?|$)/i,
  /\/reload(\?|$)/i,
  /\/inspector\//i,
  /\.bundle(\?|$)/i,
  /\/logs(\?|$)/i,
  /\/onchange(\?|$)/i,
  /\/status(\?|$)/i,
  // Expo dev tooling
  /\/_expo\//i,
  /expo-updates/i,
  // Analytics & telemetry (cross-platform noise)
  /google-analytics\.com/i, /googletagmanager\.com/i,
  /facebook\.com\/tr/i, /segment\.io/i, /mixpanel\.com/i,
  /amplitude\.com/i, /sentry\.io/i, /bugsnag\.com/i, /datadog/i,
  // FloTrace's own WebSocket
  /:3457(\/|$)/,
];

/** Pre-combined regex for O(1) noise URL matching (mirrors web tracker). */
const COMBINED_NOISE_PATTERN = new RegExp(
  NOISE_URL_PATTERNS.map((r) => r.source).join('|'),
  'i',
);

// ============================================================================
// Module state
// ============================================================================

let client: FloTraceWebSocketClient | null = null;
let isInstalled = false;
let buffer: NetworkRequestEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let requestCounter = 0;

/** O(1) lookup: requestId → buffer index for in-place updates. */
const requestIndexMap = new Map<string, number>();

/** Original fetch before our patch (may already be wrapped by another tracker). */
let previousFetch: RNFetch | null = null;

/** Original XHR methods, captured so `uninstall()` can restore them. */
let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;

/** Sliding window for duplicate detection: dedupeKey → last-seen timestamp. */
const dedupeWindow = new Map<string, number>();

// API → Store causal correlation uses the shared `tagFetchData` registry in
// runtime-core (read by `findFetchOrigin` / `hasActiveTags`, both re-exported
// by this package's index.ts). On RN only the XHR `responseType='json'` branch
// can auto-tag — fetch responses are NOT tagged because the
// Response.prototype.json wrapper that web relies on crashes the RN bridge
// (research doc §11.3.2).

// ============================================================================
// Install / Uninstall
// ============================================================================

export function installNetworkTrackerNative(wsClient: FloTraceWebSocketClient): void {
  if (isInstalled) return;
  client = wsClient;
  isInstalled = true;
  requestCounter = 0;

  patchFetch();
  patchXhr();

  flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
}

export function uninstallNetworkTrackerNative(): void {
  if (!isInstalled) return;

  // --- Restore patched globals ---
  if (previousFetch) {
    rnGlobal.fetch = previousFetch;
    previousFetch = null;
  }
  if (originalXhrOpen) {
    XMLHttpRequest.prototype.open = originalXhrOpen;
    originalXhrOpen = null;
  }
  if (originalXhrSend) {
    XMLHttpRequest.prototype.send = originalXhrSend;
    originalXhrSend = null;
  }

  // --- Stop the flush loop ---
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  // --- Drain remaining entries, then reset state ---
  flushBuffer();
  buffer = [];
  requestIndexMap.clear();
  dedupeWindow.clear();
  clearFetchOriginTags();
  client = null;
  isInstalled = false;
}

// ============================================================================
// Fetch patching
// ============================================================================

function patchFetch(): void {
  if (typeof rnGlobal.fetch !== 'function') return;

  previousFetch = rnGlobal.fetch;

  rnGlobal.fetch = async function trackedFetch(
    input: RNFetchInput,
    init?: RNRequestInit,
  ): Promise<RNResponse> {
    const url = extractUrl(input);

    if (isNoiseUrl(url)) {
      return previousFetch!(input, init);
    }

    const method = (init?.method ?? 'GET').toUpperCase();
    const parsedUrl = parseUrl(url);
    const entry = createEntry(method, parsedUrl);
    const startTime = nowMs();

    // { once: true } prevents listener leaks when callers reuse an
    // AbortController across multiple fetches.
    if (init?.signal) {
      init.signal.addEventListener(
        'abort',
        () => {
          entry.state = 'aborted';
          entry.durationMs = nowMs() - startTime;
          pushEntry(entry);
        },
        { once: true },
      );
    }

    // Emit the pending snapshot first so the UI sees the request in-flight.
    // We clone so later mutations to `entry` don't retroactively change the
    // already-buffered snapshot.
    pushEntry({ ...entry });

    try {
      const response = await previousFetch!(input, init);

      if (entry.state !== 'aborted') {
        entry.state = response.ok ? 'success' : 'error';
        entry.status = response.status;
        entry.durationMs = nowMs() - startTime;
        entry.responseSizeBytes = parseContentLength(response.headers);
        if (!response.ok) {
          entry.errorMessage = `${response.status} ${response.statusText}`;
        }
        pushEntry(entry);
      }

      return response;
    } catch (err) {
      if (entry.state !== 'aborted') {
        entry.state = 'error';
        entry.durationMs = nowMs() - startTime;
        entry.errorMessage = err instanceof Error ? err.message : String(err);
        pushEntry(entry);
      }
      throw err;
    }
  };
}

// ============================================================================
// XHR patching
// ============================================================================

function patchXhr(): void {
  if (typeof XMLHttpRequest === 'undefined') return;

  originalXhrOpen = XMLHttpRequest.prototype.open;
  originalXhrSend = XMLHttpRequest.prototype.send;

  // --- open(): stash method + url; register an early 'load' listener so we
  // run before any caller-added listeners. When responseType is 'json', RN's
  // XHR polyfill hands back the already-parsed object — we can tag it for
  // API→Store causal correlation without touching JSON.parse. ---
  XMLHttpRequest.prototype.open = function (
    this: RNXHR,
    method: string,
    url: string | RNURL,
    ...rest: unknown[]
  ) {
    const xhr = this as XhrWithMeta;
    xhr.__ftMethod = method.toUpperCase();
    xhr.__ftUrl = typeof url === 'string' ? url : url.href;

    xhr.addEventListener('load', function () {
      const requestId = xhr.__ftRequestId;
      if (!requestId) return;

      if (
        xhr.responseType === 'json' &&
        xhr.response !== null &&
        typeof xhr.response === 'object'
      ) {
        try { tagFetchData(xhr.response, requestId, 0); } catch { /* best-effort */ }
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalXhrOpen as any).apply(this, [method, url, ...rest]);
  } as typeof XMLHttpRequest.prototype.open;

  // --- send(): materialize the entry, attach success/error/abort listeners,
  // then delegate to the original. ---
  XMLHttpRequest.prototype.send = function (this: RNXHR, body?: unknown) {
    const xhr = this as XhrWithMeta;
    const url = xhr.__ftUrl ?? '';

    if (isNoiseUrl(url)) {
      return originalXhrSend!.call(this, body);
    }

    const method = xhr.__ftMethod ?? 'GET';
    const parsedUrl = parseUrl(url);
    const entry = createEntry(method, parsedUrl);
    const startTime = nowMs();

    xhr.__ftRequestId = entry.requestId;

    pushEntry({ ...entry });

    this.addEventListener('load', () => {
      entry.state = this.status >= 400 ? 'error' : 'success';
      entry.status = this.status;
      entry.durationMs = nowMs() - startTime;
      entry.responseSizeBytes = parseXhrContentLength(this);
      if (this.status >= 400) {
        entry.errorMessage = `${this.status} ${this.statusText}`;
      }
      pushEntry(entry);
    });

    this.addEventListener('error', () => {
      entry.state = 'error';
      entry.durationMs = nowMs() - startTime;
      entry.errorMessage = 'Network error';
      pushEntry(entry);
    });

    this.addEventListener('abort', () => {
      entry.state = 'aborted';
      entry.durationMs = nowMs() - startTime;
      pushEntry(entry);
    });

    return originalXhrSend!.call(this, body);
  };
}

// ============================================================================
// Entry creation & attribution
// ============================================================================

function createEntry(
  method: string,
  parsedUrl: { path: string; host: string },
): NetworkRequestEntry {
  const requestId = String(++requestCounter);
  const dedupeKey = `${method}:${parsedUrl.path}`;

  const attribution = getAttribution();
  const now = Date.now();
  const isDuplicate = checkDuplicate(dedupeKey, now);

  return {
    requestId,
    method,
    urlPath: parsedUrl.path,
    urlHost: parsedUrl.host,
    status: 0,
    durationMs: null,
    responseSizeBytes: null,
    componentName: attribution.componentName,
    ancestorChain: attribution.ancestorChain,
    initiatedDuringRender: attribution.duringRender,
    initiatedInEffect: attribution.inEffect,
    state: 'pending',
    dedupeKey,
    // Storing `undefined` (vs `false`) keeps the wire payload compact:
    // JSON.stringify drops undefined keys entirely.
    isDuplicate: isDuplicate || undefined,
    timestamp: now,
  };
}

function getAttribution(): {
  componentName?: string;
  ancestorChain?: string[];
  duringRender: boolean;
  inEffect: boolean;
} {
  const fiber = getCurrentRenderingFiber();
  if (!fiber) return { duringRender: false, inEffect: false };

  const name = getComponentNameFromFiber(fiber);
  const ancestors = buildAncestorChain(fiber).slice(-MAX_ANCESTOR_CHAIN);
  return {
    componentName: name || undefined,
    ancestorChain: ancestors.length > 0 ? ancestors : undefined,
    duringRender: true,
    inEffect: false,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function extractUrl(input: RNFetchInput): string {
  if (typeof input === 'string') return input;
  if (isRNURL(input)) return input.href;
  return (input as RNRequestLike).url;
}

function isRNURL(value: unknown): value is RNURL {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RNURL).href === 'string' &&
    typeof (value as RNURL).pathname === 'string'
  );
}

function parseUrl(url: string): { path: string; host: string } {
  try {
    // RN has no `globalThis.location`; supply a bare base so `new URL` can
    // still resolve relative-looking strings.
    const u = new URL(url, 'http://localhost');
    return { path: u.pathname, host: u.host };
  } catch {
    return { path: url.split('?')[0] ?? url, host: '' };
  }
}

function isNoiseUrl(url: string): boolean {
  return COMBINED_NOISE_PATTERN.test(url);
}

function parseIntOrNull(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

function parseContentLength(headers: RNHeaders): number | null {
  return parseIntOrNull(headers.get('content-length'));
}

function parseXhrContentLength(xhr: RNXHR): number | null {
  return parseIntOrNull(xhr.getResponseHeader('content-length'));
}

function checkDuplicate(dedupeKey: string, now: number): boolean {
  // Sweep expired entries opportunistically. O(n) but n is bounded by the
  // window size — in practice a few dozen entries at most.
  for (const [key, ts] of dedupeWindow) {
    if (now - ts > DEDUPE_WINDOW_MS) dedupeWindow.delete(key);
  }
  const isDup = dedupeWindow.has(dedupeKey);
  dedupeWindow.set(dedupeKey, now);
  return isDup;
}

/** `performance.now()` is available on RN Hermes; fall back to Date.now(). */
function nowMs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

// ============================================================================
// Buffer & flush
// ============================================================================

function upsertAndPrune(
  entry: NetworkRequestEntry,
  buf: NetworkRequestEntry[],
  idxMap: Map<string, number>,
  maxSize: number,
): NetworkRequestEntry[] {
  const existingIdx = idxMap.get(entry.requestId);
  if (
    existingIdx !== undefined &&
    existingIdx < buf.length &&
    buf[existingIdx]?.requestId === entry.requestId
  ) {
    buf[existingIdx] = entry;
    return buf;
  }
  idxMap.set(entry.requestId, buf.length);
  buf.push(entry);
  if (buf.length > maxSize) {
    const pruned = buf.slice(-maxSize);
    idxMap.clear();
    for (let i = 0; i < pruned.length; i++) idxMap.set(pruned[i].requestId, i);
    return pruned;
  }
  return buf;
}

function pushEntry(entry: NetworkRequestEntry): void {
  buffer = upsertAndPrune(entry, buffer, requestIndexMap, MAX_BUFFER_SIZE);
  if (buffer.length >= MAX_BATCH_SIZE) flushBuffer();
}

function flushBuffer(): void {
  if (buffer.length === 0 || !client?.connected) return;

  client.send({
    type: 'runtime:networkRequest',
    requests: [...buffer],
    timestamp: Date.now(),
  });

  buffer = [];
  requestIndexMap.clear();
}

/**
 * Ambient types for web APIs that React Native exposes at runtime.
 *
 * The `runtime-native` tsconfig deliberately excludes `lib: ["DOM"]` so that
 * platform-only APIs (document, window, localStorage, …) can't leak into
 * native code. These declarations cover just the web APIs that RN's Hermes /
 * JSC runtime actually implements — fetch / Response / Headers / URL /
 * XMLHttpRequest plus the timer pair used by the network tracker.
 *
 * Anything NOT declared here stays a hard compile error, which is the point:
 * if a file reaches for `document.querySelector`, the compiler catches it
 * before it ships.
 *
 * This file contains NO top-level imports or exports so that it remains an
 * ambient declaration module and the declarations inside become globals.
 */

// --- Fetch / Response ---

interface RNHeaders {
  get(name: string): string | null;
}

interface RNResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: RNHeaders;
}

interface RNAbortSignal {
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean },
  ): void;
}

interface RNRequestInit {
  method?: string;
  signal?: RNAbortSignal;
}

interface RNRequestLike {
  url: string;
}

type RNFetchInput = string | RNURL | RNRequestLike;
type RNFetch = (input: RNFetchInput, init?: RNRequestInit) => Promise<RNResponse>;

// --- URL ---

interface RNURL {
  href: string;
  pathname: string;
  host: string;
}
interface RNURLCtor {
  new (url: string, base?: string): RNURL;
}

// --- XMLHttpRequest ---

interface RNXHREventTarget {
  addEventListener(type: string, listener: (this: RNXHR) => void): void;
}

interface RNXHR extends RNXHREventTarget {
  status: number;
  statusText: string;
  response: unknown;
  responseText: string;
  responseType: string;
  getResponseHeader(name: string): string | null;
  open(
    method: string,
    url: string | RNURL,
    async?: boolean,
    user?: string | null,
    password?: string | null,
  ): void;
  send(body?: unknown): void;
}

interface RNXHRCtor {
  new (): RNXHR;
  prototype: RNXHR;
}

// --- Global values exposed by the RN runtime (Hermes / JSC) ---

declare const fetch: RNFetch;
declare const URL: RNURLCtor;
declare const XMLHttpRequest: RNXHRCtor;
declare function setInterval(handler: () => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;
declare function setTimeout(handler: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;

// --- `react-native` module surface (minimal subset we actually use) ---
// Full RN typings would require @types/react-native; we only touch two symbols
// and declare them here to keep the provider's static import type-clean.
declare module 'react-native' {
  export const Platform: {
    OS: 'ios' | 'android' | 'web' | 'windows' | 'macos';
  };
  export const NativeModules: {
    SourceCode?: { scriptURL?: string };
    [key: string]: unknown;
  };
}

/**
 * FloTraceProviderNative
 *
 * React Native provider. Mirrors the web provider's shape but skips every browser-only
 * code path: no fetch/XHR patching (crashes RN's JSON bridge), no History API router tracker
 * (no routing API there), no RSC payload interceptor (no DOM). Network tracking is deferred
 * to a Phase 5 RN-safe tracker.
 *
 * Prod builds are a no-op — we early-return when `__DEV__ === false` so production bundles
 * don't ship tracking code or attempt a connection.
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  createContext,
  useContext,
  type ReactNode,
  Profiler,
} from 'react';
import type {
  FloTraceConfig,
  ResolvedFloTraceConfig,
  TrackingOptions,
  ZustandStoreApi,
  ReduxStoreApi,
  TanStackQueryClientApi,
} from '@flotrace/runtime-core';
import {
  DEFAULT_CONFIG,
  FloTraceWebSocketClient,
  serializeProps,
  getChangedKeys,
  installFiberTreeWalker,
  uninstallFiberTreeWalker,
  requestTreeSnapshot,
  requestFullSnapshot,
  getNodeProps,
  getNodeHooks,
  getNodeEffects,
  getDetailedRenderReason,
  installZustandTracker,
  uninstallZustandTracker,
  installReduxTracker,
  uninstallReduxTracker,
  installTanStackQueryTracker,
  uninstallTanStackQueryTracker,
  installTimelineTracker,
  uninstallTimelineTracker,
  getTimeline,
} from '@flotrace/runtime-core';
import { resolveMetroHost } from './metroHostResolver';
import {
  RN_FRAMEWORK_COMPONENT_NAMES,
  RN_FRAMEWORK_PATH_PATTERNS,
  RN_HOST_COMPONENT_SKIP_PREFIXES,
} from './frameworkNamesNative';

// React Native globals — typed minimally so we don't require RN types at build time.
declare const __DEV__: boolean | undefined;

// Dynamically load React Native to avoid a hard dependency. We require() it so bundlers
// that don't see the import (e.g., web builds accidentally consuming this file) don't fail.
// The package.json `react-native` export condition steers Metro to the right entry.
interface RNHandle {
  Platform: { OS: 'ios' | 'android' | 'web' | 'windows' | 'macos' };
  NativeModules: { SourceCode?: { scriptURL?: string } };
}

function loadReactNative(): RNHandle | null {
  try {
    // require at runtime so the web tree-shaker doesn't try to resolve it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native') as RNHandle;
    return rn;
  } catch {
    return null;
  }
}

// Singleton WS client for RN. We don't reuse runtime-core's `getWebSocketClient` singleton
// because RN vs. web singletons could collide in a shared-codebase app bundle.
let nativeClientInstance: FloTraceWebSocketClient | null = null;
function getNativeClient(config?: ResolvedFloTraceConfig): FloTraceWebSocketClient {
  if (!nativeClientInstance) {
    nativeClientInstance = new FloTraceWebSocketClient(config);
  }
  return nativeClientInstance;
}
function disposeNativeClient(): void {
  if (nativeClientInstance) {
    nativeClientInstance.disconnect();
    nativeClientInstance = null;
  }
}

// Module-level Strict Mode cleanup guard — matches the web provider's pattern.
let pendingCleanupTimer: ReturnType<typeof setTimeout> | null = null;

function safeTrackerOp(name: string, op: () => void): void {
  try {
    op();
  } catch (error) {
    console.error(`[FloTrace] ${name}:`, error);
  }
}

interface FloTraceContextValue {
  connected: boolean;
  enabled: boolean;
  config: ResolvedFloTraceConfig;
}

const FloTraceContext = createContext<FloTraceContextValue | null>(null);

export function useFloTrace(): FloTraceContextValue | null {
  return useContext(FloTraceContext);
}

export interface FloTraceProviderNativeProps {
  children: ReactNode;
  config?: FloTraceConfig;
  /**
   * Optional Zustand stores to track. Keys become the store names shown in FloTrace.
   */
  stores?: Record<
    string,
    { subscribe: (...args: unknown[]) => () => void; getState: () => Record<string, unknown> }
  >;
  /** Optional Redux store to track. */
  reduxStore?: ReduxStoreApi;
  /** Optional TanStack Query client to track. */
  queryClient?: TanStackQueryClientApi;
  /**
   * React Navigation ref. Reserved for Phase 3 (active-screen filter); unused in Phase 1.
   * Accepted in the signature so Phase 3 doesn't require a breaking API change.
   */
  navigationRef?: unknown;
}

/**
 * FloTraceProviderNative wraps a React Native app root to enable render tracking.
 *
 * @example
 * ```tsx
 * import { FloTraceProviderNative } from '@flotrace/runtime-native';
 *
 * export default function App() {
 *   return (
 *     <FloTraceProviderNative config={{ appName: 'MyApp' }}>
 *       <Root />
 *     </FloTraceProviderNative>
 *   );
 * }
 * ```
 */
export function FloTraceProviderNative({
  children,
  config = {},
  stores,
  reduxStore,
  queryClient,
}: FloTraceProviderNativeProps): JSX.Element {
  // Prod-build no-op. Metro strips `__DEV__` guards in release mode, so the entire
  // subtree below this check is tree-shaken out of production bundles.
  if (typeof __DEV__ !== 'undefined' && !__DEV__) {
    return <>{children}</>;
  }

  // RN-Web detection: some monorepos use react-native-web to ship the same tree to browsers.
  // In that case the web adapter is the right one — refuse to attach here and warn.
  // Read `document` off `globalThis` so the runtime-native tsconfig can omit the DOM lib.
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
    console.warn(
      '[FloTrace] FloTraceProviderNative (from @flotrace/runtime-native) detected a browser environment. ' +
      'Install @flotrace/runtime and use FloTraceProvider instead. Skipping attach.',
    );
    return <>{children}</>;
  }

  const rn = loadReactNative();
  if (!rn) {
    console.warn(
      '[FloTrace] react-native not found. FloTraceProviderNative only runs inside a React Native app. Skipping attach.',
    );
    return <>{children}</>;
  }

  const { host, platform } = resolveMetroHost(config.host, rn.Platform, rn.NativeModules);

  const mergedConfig: ResolvedFloTraceConfig = {
    ...DEFAULT_CONFIG,
    // Native has no browser URL — leave getAppUrl undefined (runtime:ready will omit appUrl).
    ...config,
    // Platform is derived from Platform.OS; user config cannot override it (would misreport).
    platform,
    // If user passed an explicit host, use it; otherwise use the resolver's choice.
    host: config.host ?? host,
  };

  const [connected, setConnected] = React.useState(false);
  const trackingOptionsRef = useRef<TrackingOptions>({});
  const storesRef = useRef(stores);
  storesRef.current = stores;
  const reduxStoreRef = useRef(reduxStore);
  reduxStoreRef.current = reduxStore;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const enabledRef = useRef(mergedConfig.enabled);
  enabledRef.current = mergedConfig.enabled;

  // Early patching. RN has no URL DOM API and no History — the only thing to
  // install during render is the fiber walker (needed before first commit).
  if (mergedConfig.enabled) {
    getNativeClient(mergedConfig);
    installFiberTreeWalker({
      frameworkComponentNames: [...RN_FRAMEWORK_COMPONENT_NAMES],
      frameworkPathPatterns: [...RN_FRAMEWORK_PATH_PATTERNS],
      hostComponentSkipPrefixes: [...RN_HOST_COMPONENT_SKIP_PREFIXES],
    });
  }

  useEffect(() => {
    if (!mergedConfig.enabled) return;

    if (pendingCleanupTimer) {
      clearTimeout(pendingCleanupTimer);
      pendingCleanupTimer = null;
    }

    const client = getNativeClient();

    const unsubConnection = client.onConnectionChange((isConnected) => {
      setConnected(isConnected);
      if (isConnected) requestFullSnapshot();
    });

    const unsubMessage = client.onMessage((message) => {
      try {
        switch (message.type) {
          case 'ext:ping':
            client.sendImmediate({ type: 'runtime:ready', appName: mergedConfig.appName });
            break;

          case 'ext:startTracking':
            trackingOptionsRef.current = message.options || {};
            if (
              message.options?.trackZustand &&
              storesRef.current &&
              Object.keys(storesRef.current).length > 0
            ) {
              safeTrackerOp('Zustand install', () =>
                installZustandTracker(storesRef.current as Record<string, ZustandStoreApi>, client),
              );
            }
            if (message.options?.trackRedux && reduxStoreRef.current) {
              safeTrackerOp('Redux install', () =>
                installReduxTracker(reduxStoreRef.current!, client),
              );
            }
            if (message.options?.trackTanstackQuery && queryClientRef.current) {
              safeTrackerOp('TanStack Query install', () =>
                installTanStackQueryTracker(queryClientRef.current!, client),
              );
            }
            // Router / network trackers deferred to later phases; no-op on RN here.
            safeTrackerOp('Timeline install', () => installTimelineTracker(client));
            console.log('[FloTrace] (native) Tracking started with options:', message.options);
            break;

          case 'ext:stopTracking':
            trackingOptionsRef.current = {};
            safeTrackerOp('Zustand uninstall', uninstallZustandTracker);
            safeTrackerOp('Redux uninstall', uninstallReduxTracker);
            safeTrackerOp('TanStack Query uninstall', uninstallTanStackQueryTracker);
            safeTrackerOp('Timeline uninstall', uninstallTimelineTracker);
            console.log('[FloTrace] (native) Tracking stopped');
            break;

          case 'ext:startTreeTracking':
            installFiberTreeWalker({
              frameworkComponentNames: [...RN_FRAMEWORK_COMPONENT_NAMES],
              frameworkPathPatterns: [...RN_FRAMEWORK_PATH_PATTERNS],
              hostComponentSkipPrefixes: [...RN_HOST_COMPONENT_SKIP_PREFIXES],
            });
            break;

          case 'ext:stopTreeTracking':
            uninstallFiberTreeWalker();
            break;

          case 'ext:requestNodeProps': {
            const props = getNodeProps(message.nodeId);
            client.sendImmediate({
              type: 'runtime:nodeProps',
              nodeId: message.nodeId,
              props: props || {},
              timestamp: Date.now(),
            });
            break;
          }

          case 'ext:requestNodeHooks': {
            const hooks = getNodeHooks(message.nodeId);
            client.sendImmediate({
              type: 'runtime:nodeHooks',
              nodeId: message.nodeId,
              hooks: hooks || [],
              timestamp: Date.now(),
            });
            break;
          }

          case 'ext:requestNodeEffects': {
            const effects = getNodeEffects(message.nodeId);
            client.sendImmediate({
              type: 'runtime:nodeEffects',
              nodeId: message.nodeId,
              effects: effects || [],
              timestamp: Date.now(),
            });
            break;
          }

          case 'ext:requestDetailedRenderReason': {
            const reason = getDetailedRenderReason(message.nodeId);
            if (reason) {
              client.sendImmediate({
                type: 'runtime:detailedRenderReason',
                nodeId: message.nodeId,
                reason,
                timestamp: Date.now(),
              });
            }
            break;
          }

          case 'ext:requestFullSnapshot':
            requestFullSnapshot();
            break;

          case 'ext:requestTimeline': {
            const events = getTimeline(message.nodeId);
            const componentName =
              message.nodeId.split('/').pop()?.replace(/-\d+$/, '') ?? 'Unknown';
            for (const event of events) {
              client.sendImmediate({
                type: 'runtime:timelineEvent',
                nodeId: message.nodeId,
                componentName,
                event,
              });
            }
            break;
          }

          // Individual tracker start/stop — mirrors web provider for sidebar panel show/hide
          case 'ext:startReduxTracking':
            if (reduxStoreRef.current)
              safeTrackerOp('Redux install', () =>
                installReduxTracker(reduxStoreRef.current!, client),
              );
            break;
          case 'ext:stopReduxTracking':
            safeTrackerOp('Redux uninstall', uninstallReduxTracker);
            break;
          case 'ext:startZustandTracking':
            if (storesRef.current && Object.keys(storesRef.current).length > 0) {
              safeTrackerOp('Zustand install', () =>
                installZustandTracker(storesRef.current as Record<string, ZustandStoreApi>, client),
              );
            }
            break;
          case 'ext:stopZustandTracking':
            safeTrackerOp('Zustand uninstall', uninstallZustandTracker);
            break;
          case 'ext:startTanstackTracking':
            if (queryClientRef.current)
              safeTrackerOp('TanStack Query install', () =>
                installTanStackQueryTracker(queryClientRef.current!, client),
              );
            break;
          case 'ext:stopTanstackTracking':
            safeTrackerOp('TanStack Query uninstall', uninstallTanStackQueryTracker);
            break;

          // Router + Network tracker start/stop are web-only for now; ignore on RN.
          case 'ext:startRouterTracking':
          case 'ext:stopRouterTracking':
          case 'ext:startNetworkCapture':
          case 'ext:stopNetworkCapture':
            break;

          case 'ext:requestState':
            break;
        }
      } catch (error) {
        console.error(
          `[FloTrace] (native) Error handling message type "${message.type}":`,
          error,
        );
      }
    });

    client.connect();

    return () => {
      unsubConnection();
      unsubMessage();

      pendingCleanupTimer = setTimeout(() => {
        pendingCleanupTimer = null;
        safeTrackerOp('cleanup fiberTreeWalker', uninstallFiberTreeWalker);
        safeTrackerOp('cleanup zustandTracker', uninstallZustandTracker);
        safeTrackerOp('cleanup reduxTracker', uninstallReduxTracker);
        safeTrackerOp('cleanup tanstackQueryTracker', uninstallTanStackQueryTracker);
        safeTrackerOp('cleanup timelineTracker', uninstallTimelineTracker);
        safeTrackerOp('cleanup websocketClient', disposeNativeClient);
      }, 100);
    };
  }, [mergedConfig.enabled, mergedConfig.port, mergedConfig.host, mergedConfig.appName]);

  const onRenderCallback = useCallback(
    (
      id: string,
      phase: 'mount' | 'update' | 'nested-update',
      actualDuration: number,
      baseDuration: number,
      _startTime: number,
      commitTime: number,
    ) => {
      try {
        if (!enabledRef.current) return;
        const client = getNativeClient();
        if (!client.connected) return;

        const normalizedPhase = phase === 'nested-update' ? 'update' : phase;
        client.send({
          type: 'runtime:render',
          componentName: id,
          phase: normalizedPhase,
          actualDuration,
          baseDuration,
          timestamp: commitTime,
        });
        requestTreeSnapshot();
      } catch (error) {
        console.error('[FloTrace] (native) Error in Profiler callback:', error);
      }
    },
    [],
  );

  const contextValue: FloTraceContextValue = {
    connected,
    enabled: mergedConfig.enabled,
    config: mergedConfig,
  };

  return (
    <FloTraceContext.Provider value={contextValue}>
      <Profiler id="FloTrace-Root" onRender={onRenderCallback}>
        {children}
      </Profiler>
    </FloTraceContext.Provider>
  );
}

/**
 * Hook to track props changes for a component (RN equivalent of useTrackProps).
 */
export function useTrackProps(componentName: string, props: Record<string, unknown>): void {
  const floTrace = useFloTrace();
  const prevPropsRef = useRef<Record<string, unknown>>();

  useEffect(() => {
    try {
      if (!floTrace?.enabled || !floTrace.config.includeProps) return;
      const client = getNativeClient();
      if (!client.connected) return;

      const changedKeys = getChangedKeys(prevPropsRef.current, props);
      if (changedKeys.length > 0) {
        client.send({
          type: 'runtime:props',
          componentName,
          props: serializeProps(props),
          changedKeys,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error('[FloTrace] (native) Error in useTrackProps:', error);
    } finally {
      prevPropsRef.current = { ...props };
    }
  }, [componentName, props, floTrace?.enabled, floTrace?.config.includeProps]);
}

export default FloTraceProviderNative;

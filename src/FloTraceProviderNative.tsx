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
  getWebSocketClient,
  disposeWebSocketClient,
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
  getFiberRefMap,
} from '@flotrace/runtime-core';
import { resolveMetroHost } from './metroHostResolver';
import {
  RN_FRAMEWORK_COMPONENT_NAMES,
  RN_FRAMEWORK_NAME_PATTERNS,
  RN_FRAMEWORK_PATH_PATTERNS,
  RN_HOST_COMPONENT_SKIP_PREFIXES,
} from './frameworkNamesNative';
import {
  installNavigationTracker,
  disposeNavigationTracker,
  shouldPruneNode,
  type NavigationRefLike,
} from './navigationTracker';
import {
  installNetworkTrackerNative,
  uninstallNetworkTrackerNative,
} from './networkTrackerNative';
import { resolveNativeAppIdentity, getReactNativeVersion } from './nativeAppIdentity';
// Static import — ESM-compiled output (`.mjs`) would otherwise rely on tsup's `__require`
// shim, which fails under iOS bridgeless / Hermes New Architecture where `require` is not
// a module-scope global. `react-native` is a non-optional peer dep, so consumers always
// have it available; react-native-web consumers are caught by the `document` guard below.
import { Platform, NativeModules } from 'react-native';

// React Native globals — typed minimally so we don't require RN types at build time.
declare const __DEV__: boolean | undefined;

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
   * React Navigation container ref. When provided, FloTrace tracks focused routes
   * and hides inactive-screen subtrees from the desktop tree. Pass the same ref
   * you hand to `<NavigationContainer ref={...}>`.
   */
  navigationRef?: NavigationRefLike | null;
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
  navigationRef,
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

  const { host, platform } = resolveMetroHost(config.host, Platform, NativeModules);

  // Probe installed identity libs (expo-application, react-native-device-info)
  // + iOS SettingsManager for bundle id / display name / app version. All
  // probes are optional — the user never needs to install anything.
  const fallbackName = config.appName ?? DEFAULT_CONFIG.appName;
  const identity = resolveNativeAppIdentity(fallbackName);
  const rnVersion = getReactNativeVersion();

  const mergedConfig: ResolvedFloTraceConfig = {
    ...DEFAULT_CONFIG,
    // Native has no browser URL — leave getAppUrl undefined (runtime:ready will omit appUrl).
    ...config,
    // Platform is derived from Platform.OS; user config cannot override it (would misreport).
    platform,
    // If user passed an explicit host, use it; otherwise use the resolver's choice.
    host: config.host ?? host,
    // Derived identity — user's explicit config.appId / config.appName still win.
    appName: config.appName ?? identity.appName ?? DEFAULT_CONFIG.appName,
    appId: config.appId ?? identity.appId,
    appVersion: config.appVersion ?? identity.appVersion,
    frameworkName: config.frameworkName ?? identity.frameworkName,
    reactNativeVersion: config.reactNativeVersion ?? rnVersion,
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
    getWebSocketClient(mergedConfig);
    installFiberTreeWalker({
      frameworkComponentNames: [...RN_FRAMEWORK_COMPONENT_NAMES],
      frameworkComponentNamePatterns: [...RN_FRAMEWORK_NAME_PATTERNS],
      frameworkPathPatterns: [...RN_FRAMEWORK_PATH_PATTERNS],
      hostComponentSkipPrefixes: [...RN_HOST_COMPONENT_SKIP_PREFIXES],
      pruneSubtree: shouldPruneNode,
      // Native default: opt INTO strict mode so library wrappers without evidence
      // get hidden automatically. Consumers can pass `userOnlyStrict: false` to
      // A/B back to the name-list approach.
      userOnlyStrict: mergedConfig.userOnlyStrict !== false,
      userAllowPatterns: mergedConfig.userAllowPatterns ?? [],
    });
  }

  // Navigation tracker lifecycle — attach/detach when the ref identity changes.
  // Keeping this in an effect (vs. the render-phase early-patching above) avoids
  // churn: `installNavigationTracker` detaches the prior subscription each call.
  useEffect(() => {
    if (!mergedConfig.enabled) return;
    installNavigationTracker(navigationRef ?? null);
    return () => disposeNavigationTracker();
  }, [mergedConfig.enabled, navigationRef]);

  // Dev-only guardrail: if the consumer has a NavigationContainer in the tree
  // but did not wire a `navigationRef` prop, the active-screen prune silently
  // does nothing and the desktop tree fills with inactive-screen components.
  // Fire a one-shot warning 3s after mount (tree populated by then) so future
  // consumers hit a loud message instead of puzzling over stale nodes.
  useEffect(() => {
    if (!mergedConfig.enabled) return;
    if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
    if (navigationRef) return;

    const timer = setTimeout(() => {
      try {
        const map = getFiberRefMap();
        for (const fiber of map.values()) {
          const type = (fiber as { type?: unknown }).type;
          if (!type || typeof type !== 'object') continue;
          const named = type as { displayName?: string; name?: string };
          const name = named.displayName ?? named.name;
          if (name === 'NavigationContainer' || name === 'BaseNavigationContainer') {
            console.warn(
              '[FloTrace] NavigationContainer detected but no `navigationRef` prop was passed ' +
              'to FloTraceProviderNative — the tree will include components from inactive ' +
              'screens. See https://flotrace.dev/docs/react-native#navigation-ref',
            );
            return;
          }
        }
      } catch {
        /* non-fatal: walker may not have populated yet */
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [mergedConfig.enabled, navigationRef]);

  useEffect(() => {
    if (!mergedConfig.enabled) return;

    if (pendingCleanupTimer) {
      clearTimeout(pendingCleanupTimer);
      pendingCleanupTimer = null;
    }

    const client = getWebSocketClient();

    const unsubConnection = client.onConnectionChange((isConnected) => {
      setConnected(isConnected);
      if (isConnected) requestFullSnapshot();
    });

    const unsubMessage = client.onMessage((message) => {
      try {
        switch (message.type) {
          // Heartbeat is handled by the dedicated `runtime:pong` path inside
          // websocketClient (sent before fan-out and returned), so this case
          // is never reached. Retained as a documented no-op to make the
          // absence of a `runtime:ready` re-send intentional — a truncated
          // ready would overwrite good registry metadata on every 5s tick.
          case 'ext:ping':
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
            if (message.options?.trackNetwork) {
              safeTrackerOp('Network install', () =>
                installNetworkTrackerNative(client),
              );
            }
            // Router tracker is web-only (History API); skipped on RN.
            safeTrackerOp('Timeline install', () => installTimelineTracker(client));
            console.log('[FloTrace] (native) Tracking started with options:', message.options);
            break;

          case 'ext:stopTracking':
            trackingOptionsRef.current = {};
            safeTrackerOp('Zustand uninstall', uninstallZustandTracker);
            safeTrackerOp('Redux uninstall', uninstallReduxTracker);
            safeTrackerOp('TanStack Query uninstall', uninstallTanStackQueryTracker);
            safeTrackerOp('Network uninstall', uninstallNetworkTrackerNative);
            safeTrackerOp('Timeline uninstall', uninstallTimelineTracker);
            console.log('[FloTrace] (native) Tracking stopped');
            break;

          case 'ext:startTreeTracking':
            installFiberTreeWalker({
              frameworkComponentNames: [...RN_FRAMEWORK_COMPONENT_NAMES],
              frameworkPathPatterns: [...RN_FRAMEWORK_PATH_PATTERNS],
              hostComponentSkipPrefixes: [...RN_HOST_COMPONENT_SKIP_PREFIXES],
              pruneSubtree: shouldPruneNode,
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

          // Router tracking is web-only (History API); ignore on RN.
          case 'ext:startRouterTracking':
          case 'ext:stopRouterTracking':
            break;

          case 'ext:startNetworkCapture':
            safeTrackerOp('Network install', () =>
              installNetworkTrackerNative(client),
            );
            break;
          case 'ext:stopNetworkCapture':
            safeTrackerOp('Network uninstall', uninstallNetworkTrackerNative);
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
        safeTrackerOp('cleanup networkTracker', uninstallNetworkTrackerNative);
        safeTrackerOp('cleanup timelineTracker', uninstallTimelineTracker);
        safeTrackerOp('cleanup websocketClient', disposeWebSocketClient);
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
        const client = getWebSocketClient();
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
      const client = getWebSocketClient();
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

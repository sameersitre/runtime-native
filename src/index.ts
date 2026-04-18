/**
 * @flotrace/runtime-native
 *
 * React Native adapter for FloTrace. Install this package in iOS/Android apps;
 * web apps should use `@flotrace/runtime` instead.
 *
 * @example
 * ```tsx
 * import { FloTraceProviderNative } from '@flotrace/runtime-native';
 *
 * export default function App() {
 *   return (
 *     <FloTraceProviderNative config={{ appName: 'My App' }}>
 *       <Root />
 *     </FloTraceProviderNative>
 *   );
 * }
 * ```
 */

// Re-export everything platform-agnostic from the core package
export * from '@flotrace/runtime-core';

// Native-only provider + hook
export {
  FloTraceProviderNative,
  useFloTrace,
  useTrackProps,
} from './FloTraceProviderNative';
export type { FloTraceProviderNativeProps } from './FloTraceProviderNative';

// Metro host resolver (exported for tests / advanced configuration)
export { resolveMetroHost, extractHostFromUrl } from './metroHostResolver';
export type { MetroHostResolution } from './metroHostResolver';

// RN framework detection tables (exported for advanced users who want to extend
// or override the default lists via `installFiberTreeWalker()` directly).
export {
  RN_FRAMEWORK_COMPONENT_NAMES,
  RN_FRAMEWORK_PATH_PATTERNS,
  RN_HOST_COMPONENT_SKIP_PREFIXES,
} from './frameworkNamesNative';

// React Navigation tracker (Phase 3 — active-screen filter). Normally invoked
// implicitly by FloTraceProviderNative's `navigationRef` prop; exported for
// advanced setups that install the walker manually.
export {
  installNavigationTracker,
  disposeNavigationTracker,
  shouldPruneNode,
} from './navigationTracker';
export type { NavigationRefLike } from './navigationTracker';

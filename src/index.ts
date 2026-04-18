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

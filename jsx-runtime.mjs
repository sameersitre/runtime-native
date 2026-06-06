/**
 * @flotrace/runtime-native/jsx-runtime — production JSX runtime re-export shim (ESM).
 *
 * Lets RN consumers set `"jsxImportSource": "@flotrace/runtime-native"` (the
 * package they installed) instead of `@flotrace/runtime-core`. Forwards to
 * runtime-core's canonical entry so the instrumentation state stays a singleton
 * shared with `FloTraceProviderNative`. See the web adapter's jsx-runtime.mjs
 * for the pnpm rationale.
 *
 * Note: on React Native, `jsxImportSource` is honoured by Metro's Babel preset
 * only when `nativewind` hasn't claimed the import-source slot; otherwise use
 * `@flotrace/runtime-native/babel-plugin` for source attribution.
 */
export { Fragment, jsx, jsxs } from '@flotrace/runtime-core/jsx-runtime';

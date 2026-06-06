/**
 * @flotrace/runtime-native/jsx-dev-runtime — dev JSX runtime re-export shim (ESM).
 *
 * Forwards to runtime-core's instrumented dev runtime. Forwarding (not
 * bundling) keeps runtime-core's ring buffer / adoption sentinel a singleton
 * shared with `FloTraceProviderNative`.
 */
export { Fragment, jsxDEV, jsxsDEV } from '@flotrace/runtime-core/jsx-dev-runtime';

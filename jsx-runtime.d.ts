/**
 * Type declarations for `@flotrace/runtime-native/jsx-runtime`.
 *
 * Re-exports the canonical runtime + the `JSX` namespace from
 * `@flotrace/runtime-core/jsx-runtime`. The explicit `export type { JSX }` is
 * required — `export *` alone does not reliably re-propagate the namespace.
 */
export * from '@flotrace/runtime-core/jsx-runtime';
export type { JSX } from '@flotrace/runtime-core/jsx-runtime';

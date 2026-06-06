/**
 * @flotrace/runtime-native/jsx-runtime — production JSX runtime re-export shim (CJS).
 *
 * CommonJS counterpart of jsx-runtime.mjs for the `require` condition. Forwards
 * verbatim to runtime-core's canonical entry.
 */
'use strict';

module.exports = require('@flotrace/runtime-core/jsx-runtime');

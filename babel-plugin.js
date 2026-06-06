/**
 * @flotrace/runtime-native/babel-plugin
 *
 * Thin re-export shim. The FloTrace source-attribution Babel plugin is
 * implemented once in `@flotrace/runtime-core` (its reader side lives there
 * too). React Native consumers reference it through this adapter — the
 * package they actually install — so they never depend on runtime-core
 * directly.
 *
 *   // babel.config.js
 *   env: { development: { plugins: ['@flotrace/runtime-native/babel-plugin'] } }
 *
 * CommonJS so Babel can `require()` it without a build step. `module.exports`
 * is the core module object verbatim, so the plugin function AND its static
 * `FLOTRACE_ATTR_NAME` property both pass through unchanged.
 */
'use strict';

module.exports = require('@flotrace/runtime-core/babel-plugin');

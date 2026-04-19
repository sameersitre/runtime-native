# @flotrace/runtime-native

## 0.1.0

Initial release — React Native adapter for FloTrace. Ships with:

### Provider

- `FloTraceProviderNative` — RN-safe provider. Refuses to attach in browser environments (`typeof document !== 'undefined'`); no-ops in production (`__DEV__ === false`).
- Skips the web runtime's `prewarmNetworkTracker`, router tracker, and RSC interceptor — all patch APIs that either don't exist on RN or crash the JS bridge.
- Accepts a `navigationRef` prop for React Navigation integration.

### Connectivity

- Metro host auto-detection: iOS simulator → `127.0.0.1`, Android emulator → `10.0.2.2`, physical devices → parsed from Metro's `scriptURL`. Override via `config.host`.
- LAN auth token support (required when the desktop app is bound to `0.0.0.0` for physical-device WiFi connections; loopback is exempt).

### Active-screen filter

- `navigationTracker` subscribes to `NavigationContainer.onStateChange` and drives the walker's `pruneSubtree` hook.
- Keeps focused routes, `react-native-screens` screens with `activityState === 2`, and visible `<Modal>` overlays. Hides everything else.

### Framework filter

- `frameworkNamesNative` — built-in list covering RN core, React Navigation, `react-native-screens`, Reanimated, Gesture Handler, Safe Area, FlashList, Expo. Injected into the walker's `frameworkComponentNames` / `frameworkPathPatterns` options.
- `hostComponentSkipPrefixes` filters `RCT*` host nodes (analogous to how the web adapter filters DOM elements).

### Network tracker

- `networkTrackerNative` patches only `globalThis.fetch` and `XMLHttpRequest`. No `JSON.parse` / `Response.prototype.json` patches — those crash the RN JS bridge.
- Metro / Expo noise filters anchored to `(\?|$)` path-leaves: `/symbolicate`, `/hot`, `/reload`, `/inspector/`, `/index.bundle`, `/logs`, `/onchange`, `/open-stack-frame`, Expo internal APIs.
- Preserves API → Store causal correlation via XHR `responseType === 'json'` direct tagging (web adapter does this via `Response.json()` patching, which we can't use here).

### Internal

- Depends on `@flotrace/runtime-core@0.1.x`.
- React Native is loaded via `require()` so web consumers of the monorepo don't accidentally bundle it.
- Ambient web-API types live in `rnGlobals.d.ts`; package `tsconfig.json` excludes `lib: ["DOM"]` to catch platform leaks at compile time.

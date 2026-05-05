# @flotrace/runtime-native

**Flipper is dead. RN DevTools is incomplete. Reactotron needs setup. FloTrace fills the gap.**

A live debugger for React Native (iOS / Android) that shows you what your app is actually doing — every render, every prop change, every store mutation, every network call — without changing how you ship code.

This package is the runtime that connects an Expo / bare RN app to the FloTrace desktop. Drop it in once and you get:

- **A live component tree** for what's actually on screen — inactive `react-native-screens`, hidden modals, and library wrappers (Reanimated, Gesture Handler, Safe Area, FlashList, etc.) are filtered out by default so the tree stays scoped.
- **Render reasons that survive Hermes / New Architecture / bridgeless mode** — props/state/context diffs without source maps.
- **All your state in one panel** — Zustand, Redux, TanStack Query. No Reactotron + Redux DevTools + RN DevTools dance.
- **A safe network tracker** — patches `fetch` and `XMLHttpRequest` only (no `JSON.parse` patches that crash the bridge), with Metro/Expo noise filtered out and API → store causal correlation.
- **Auto-detected Metro host** — `127.0.0.1` for iOS sim, `10.0.2.2` for Android emulator, `scriptURL` host for physical devices. No config in the common case.
- **Multi-app support** — connect your iOS sim *and* Android emulator at the same time and switch between them in the desktop.

Source code never leaves your machine. The runtime is `__DEV__`-gated and tree-shakes out of production bundles.

> **Companion to the FloTrace desktop app** — [download it from flotrace.dev](https://flotrace.dev/download).

[**Docs**](https://flotrace.dev/docs/runtime-native) · [**Compare to Reactotron / Flipper**](https://flotrace.dev/compare/reactotron) · [**Report an issue**](https://github.com/sameersitre/runtime-native/issues)

---

## About FloTrace Desktop

[**FloTrace Desktop**](https://flotrace.dev) is a free Electron app (macOS / Windows / Linux) that visualizes a running React Native app's component hierarchy in real time. This runtime package is the bridge: drop `<FloTraceProviderNative>` into your app and the desktop renders the live tree, with full inspection of props, hooks, effects, state, network calls, and render cascades — across iOS sim, Android emulator, and physical devices.

When `@flotrace/runtime-native` (this package) is paired with the desktop, you get:

- **Live component tree (user-only by default)** — RN-specific filtering hides framework wrappers (NavigationContainer, GestureHandlerRootView, SafeAreaProvider), `react-native-screens` internals, Reanimated, Gesture Handler, Safe Area, and FlashList. Toggle via desktop **Settings → Graph** if you need them.
- **Inactive-screen pruning** — `react-native-screens` only renders the focused route + visible `<Modal>` overlays. Background screens are dropped from the tree to keep the graph scoped to what's on screen.
- **Auto-detected Metro host** — `127.0.0.1` for iOS sim, `10.0.2.2` for Android emulator, `scriptURL` host for physical devices. No config in the common case.
- **Multi-app selector** — connect iOS sim *and* Android emulator at the same time (e.g. from one monorepo); the desktop tracks each as a separate client and lets you switch between them.
- **Per-node inspection** — props (with diff history), hooks (14 classified types + dep diffs), effects (willRun + dep diffs), component timeline.
- **State tracking** — Zustand (per-store), Redux (with change highlighting), TanStack Query (with health warnings + wasted-refetch detection).
- **Render cascade tracing** — trigger log, cascade tree, flame chart, cascade compare modal.
- **Prop drilling detection** — chain detection (≥3 levels deep), severity badges, heatmap overlay, refactor recommendations.
- **Safe network tracker** — `fetch` + `XMLHttpRequest` only (no `JSON.parse` patches that crash the RN bridge), with Metro / Expo noise filtered out and API → store causal correlation.
- **Connection heartbeat** — desktop pings every 5s; the connection pill flips to a yellow "Stale" state if the runtime stops responding (likely native crash) and recovers automatically.
- **Watch expressions** — pin values from 8 sources, max 20.
- **AI Code Review Dashboard** — 6-tab review (Re-renders, Memo, Drilling, Effects, Compiler, Network) with Lighthouse-style scores.
- **Copy-as-Prompt** — turn any panel into an AI-ready prompt for Cursor / Claude / ChatGPT in one click.

How it fits together:

```
your RN app  ←→  @flotrace/runtime-native  ←→  ws://<metro-host>:3457  ←→  FloTrace Desktop
                    (this package — open source, MIT, __DEV__-gated)        (closed-source commercial)
```

The desktop binds to `127.0.0.1` by default; LAN connections (physical devices over WiFi) require an opt-in auth token. Source code never leaves your machine.

---

## 30-second setup

```bash
npm install -D @flotrace/runtime-native
```

### Expo Router

```tsx
// app/_layout.tsx
import { FloTraceProviderNative } from '@flotrace/runtime-native';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <FloTraceProviderNative config={{ appName: 'My Expo App' }}>
      <Stack />
    </FloTraceProviderNative>
  );
}
```

### Classic Expo

```tsx
// App.tsx
import { FloTraceProviderNative } from '@flotrace/runtime-native';

export default function App() {
  return (
    <FloTraceProviderNative config={{ appName: 'My App' }}>
      <AppRoot />
    </FloTraceProviderNative>
  );
}
```

### Bare React Native

```tsx
// index.js
import { AppRegistry } from 'react-native';
import { FloTraceProviderNative } from '@flotrace/runtime-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => () => (
  <FloTraceProviderNative config={{ appName }}>
    <App />
  </FloTraceProviderNative>
));
```

Launch the FloTrace desktop. Start Metro. Open your app. Tree appears.

**Peer dependencies:** `react >= 16.9.0`, `react-native >= 0.64.0`. Compatible with Hermes, New Architecture (Fabric + TurboModules), bridgeless mode.

---

## React Navigation: wire `navigationRef` (strongly recommended)

Without this, `react-native-screens` keeps every visited screen mounted in the background and the tree fills up with stale routes. Pass a shared ref to both `<NavigationContainer>` and `<FloTraceProviderNative>`:

```ts
// src/navigation/navigationRef.ts
import { createNavigationContainerRef } from '@react-navigation/native';
export const navigationRef = createNavigationContainerRef();
```

```tsx
// App.tsx
import { NavigationContainer } from '@react-navigation/native';
import { FloTraceProviderNative } from '@flotrace/runtime-native';
import { navigationRef } from './src/navigation/navigationRef';

export default function App() {
  return (
    <FloTraceProviderNative config={{ appName: 'My App' }} navigationRef={navigationRef}>
      <NavigationContainer ref={navigationRef}>
        {/* your navigators */}
      </NavigationContainer>
    </FloTraceProviderNative>
  );
}
```

Visible `<Modal>` overlays and active `react-native-screens` (`activityState === 2`) stay in the tree even when the route isn't focused. Forget the prop and FloTrace prints a one-shot dev warning a few seconds after mount.

---

## Connectivity (auto-detected)

| Topology | Host used | Extra setup |
|---|---|---|
| iOS simulator | `127.0.0.1` | none |
| Android emulator | `10.0.2.2` | none |
| Physical device over USB | Metro `scriptURL` host | Android: `adb reverse tcp:3457 tcp:3457` |
| Physical device over WiFi | Metro `scriptURL` host | Enable LAN mode in desktop **Settings → LAN Access**, copy `authToken` into config |

```tsx
// LAN / WiFi:
<FloTraceProviderNative config={{ appName: 'My App', authToken: 'FT-xxxxxxxx...' }}>

// Override host explicitly:
<FloTraceProviderNative config={{ appName: 'My App', host: '192.168.1.42' }}>
```

Loopback connections (sim / emulator / `adb reverse`) are exempt from auth.

---

## Wire up your state stores

```tsx
import { FloTraceProviderNative } from '@flotrace/runtime-native';
import { useUserStore } from './zustandStore';
import { store as reduxStore } from './reduxStore';
import { queryClient } from './queryClient';

<FloTraceProviderNative
  config={{ appName: 'My App' }}
  stores={{ userStore: useUserStore }}
  reduxStore={reduxStore}
  queryClient={queryClient}
>
  <App />
</FloTraceProviderNative>
```

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appName` | `string` | `'React Native App'` | Shown in the FloTrace connection pill |
| `port` | `number` | `3457` | WebSocket port |
| `host` | `string` | auto | Override Metro detection |
| `authToken` | `string` | `undefined` | Required for LAN; ignored on loopback |
| `appId` / `appVersion` | `string` | `undefined` | Identity + version metadata |
| `enabled` | `boolean` | `__DEV__` | `false` to hard-disable |
| `autoReconnect` / `reconnectInterval` | | `true` / `2000ms` | Backoff config |
| `trackAllRenders` / `includeProps` | `boolean` | `true` | Render tracking |
| `trackZustand` / `trackRedux` / `trackTanstackQuery` / `trackNetwork` | `boolean` | `true` | Per-tracker toggles |

---

## Production safety

`FloTraceProviderNative` is a **no-op when `__DEV__ === false`** — it renders `children` and touches nothing else. Bundlers that tree-shake on `__DEV__` drop most of the package from production builds.

---

## Web + native from one codebase

```tsx
import { Platform } from 'react-native';
import { FloTraceProvider } from '@flotrace/runtime';
import { FloTraceProviderNative } from '@flotrace/runtime-native';

const Provider = Platform.OS === 'web' ? FloTraceProvider : FloTraceProviderNative;
```

Both providers refuse to attach in the wrong environment (the web one bails on `navigator.product === 'ReactNative'`, the native one bails on `typeof document !== 'undefined'`) so double-wrapping is safe.

---

## Privacy & security

- Source code never leaves your device.
- Desktop binds to `127.0.0.1` by default; LAN access is opt-in with a per-session auth token.
- This package is **MIT-licensed** and open at [github.com/sameersitre/runtime-native](https://github.com/sameersitre/runtime-native). The desktop app is closed-source commercial.

---

## Troubleshooting

**Nothing in the tree** — Desktop running? Android emulator host = `10.0.2.2`? `adb reverse` done for USB? `authToken` set for WiFi? Check Metro console for `[FloTrace]` logs.

**Tree looks too sparse** — RN view defaults to user-only. Library wrappers are hidden. Toggle "Show framework & library nodes" in desktop **Settings → Graph** to see them (note: significant render cost).

**"Connection stale" banner** — Desktop pings every 5s; flags stale after 10s of silence. Usually means JS bridge froze or native thread crashed. Restart the app; check `adb logcat` / Xcode console.

**Network requests missing** — Some libraries patch `fetch` first and don't forward through. Pass `trackNetwork: false` and patch manually if needed; or report the library so we can add it to our compatibility list.

---

## License

MIT — see [LICENSE](./LICENSE). Issues and PRs welcome at [github.com/sameersitre/runtime-native](https://github.com/sameersitre/runtime-native).

---

> **Mirrored from the [flotrace-desktop](https://github.com/sameersitre/flotrace-desktop) monorepo.** This repo is read-only — every release is regenerated by the lockstep publisher in the desktop monorepo. Issues filed here are tracked, but PRs are best opened against the upstream monorepo where the canonical source lives.

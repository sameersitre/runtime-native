# @flotrace/runtime-native

React Native adapter for FloTrace — enables real-time component tree visualization, render tracking, state management monitoring, and network health analysis for iOS / Android apps via Metro.

> **Companion to the FloTrace desktop app.** Download it from [flotrace.dev](https://flotrace.dev).

## Installation

```bash
npm install -D @flotrace/runtime-native
# or
yarn add -D @flotrace/runtime-native
# or
pnpm add -D @flotrace/runtime-native
```

**Peer dependencies:**
- `react >= 16.9.0`
- `react-native >= 0.64.0`

## Quick Start

Wrap the root of your app with `<FloTraceProviderNative>`:

### Expo Router (recommended for new apps)

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
import { AppRoot } from './AppRoot';

export default function App() {
  return (
    <FloTraceProviderNative config={{ appName: 'My Expo App' }}>
      <AppRoot />
    </FloTraceProviderNative>
  );
}
```

### Bare React Native

```tsx
// index.js
import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import { FloTraceProviderNative } from '@flotrace/runtime-native';
import App from './App';
import { name as appName } from './app.json';

function Root() {
  return (
    <FloTraceProviderNative config={{ appName }}>
      <App />
    </FloTraceProviderNative>
  );
}

AppRegistry.registerComponent(appName, () => Root);
```

Launch the FloTrace desktop app, start Metro (`npx expo start` or `npx react-native start`), open your app — the component tree appears automatically.

## Connectivity

FloTrace runtime connects to the desktop over WebSocket on port `3457`. The native adapter auto-resolves the desktop host from Metro:

| Topology | Host used | Notes |
|---|---|---|
| iOS simulator | `127.0.0.1` | Simulator shares the host's loopback. |
| Android emulator | `10.0.2.2` | Emulator's alias for the host machine. |
| Physical device over USB | Metro's `scriptURL` host | Run `adb reverse tcp:3457 tcp:3457` first on Android. |
| Physical device over LAN (WiFi) | Metro's `scriptURL` host | Requires `authToken` — see below. |

You can override detection by passing `config.host`:

```tsx
<FloTraceProviderNative config={{ appName: 'My App', host: '192.168.1.42' }}>
```

### LAN connections (physical-device over WiFi)

To keep the WebSocket server safe on shared networks, FloTrace desktop binds to `127.0.0.1` by default. Enable LAN mode in **Settings → LAN Access**; it generates a 32-character auth token. Copy the token into your app config:

```tsx
<FloTraceProviderNative config={{ appName: 'My App', authToken: 'FT-xxxxxxxx...' }}>
```

Loopback connections (simulator / emulator / `adb reverse`) are exempt from auth — no token needed.

## React Navigation integration (active-screen filter)

**Strongly recommended.** Without this wiring, `react-native-screens` keeps previously-visited screens mounted in the background and they all show up in the FloTrace tree — making it hard to see what's actually on screen. Passing a `navigationRef` lets FloTrace prune subtrees for inactive routes so the tree stays scoped to the current screen.

The same ref needs to be on **both** `<NavigationContainer>` and `<FloTraceProviderNative>`. The cleanest way to avoid an import cycle is a tiny shared module:

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

Visible `<Modal>` overlays and `react-native-screens` active screens (`activityState === 2`) stay in the tree even when the underlying route isn't focused. If you forget the `navigationRef` prop, FloTrace prints a one-shot dev warning a few seconds after mount pointing you back to this section.

## Configuration

All options are optional.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appName` | `string` | `'React Native App'` | App name shown in the FloTrace pill. |
| `port` | `number` | `3457` | WebSocket server port. |
| `host` | `string` | auto-detected | Explicit desktop host (skips Metro resolution). |
| `authToken` | `string` | `undefined` | Required for LAN connections; ignored on loopback. |
| `appId` | `string` | `undefined` | Stable identifier when multiple apps are connected. |
| `appVersion` | `string` | `undefined` | Displayed in the connection tooltip. |
| `enabled` | `boolean` | `__DEV__` | Set to `false` to hard-disable. |
| `autoReconnect` | `boolean` | `true` | Reconnect on disconnect. |
| `reconnectInterval` | `number` | `2000` | Base delay (ms) between reconnects (exponential backoff). |
| `trackAllRenders` | `boolean` | `true` | Track every commit via `<Profiler>`. |
| `includeProps` | `boolean` | `true` | Include props in render events. |
| `trackZustand` / `trackRedux` / `trackTanstackQuery` | `boolean` | `true` | Enable each state tracker. |
| `trackNetwork` | `boolean` | `true` | Enable the RN-safe network tracker. |

## Production safety

`FloTraceProviderNative` is a **no-op when `__DEV__ === false`** — it renders `children` without touching the fiber tree, WebSocket, or any trackers. You don't need to guard it manually, and bundlers that tree-shake on `__DEV__` will drop most of the package from production builds.

## Web + Native from the same codebase

If your app targets both web (React Native Web / Expo for Web) and native, use both providers — each one refuses to attach in the other's environment:

```tsx
import { Platform } from 'react-native';
import { FloTraceProvider } from '@flotrace/runtime';
import { FloTraceProviderNative } from '@flotrace/runtime-native';

const Provider = Platform.OS === 'web' ? FloTraceProvider : FloTraceProviderNative;
```

`FloTraceProviderNative` refuses to attach when `typeof document !== 'undefined'`; `FloTraceProvider` refuses when `navigator.product === 'ReactNative'`. Prevents double-attach.

## Troubleshooting

### Nothing appears in the desktop tree

1. Is the desktop app running?
2. On Android emulator: is your metro host `10.0.2.2` (auto-detected; override only if custom)?
3. On physical device over USB: did you run `adb reverse tcp:3457 tcp:3457`?
4. On physical device over WiFi: did you enable LAN mode in desktop settings and paste the `authToken`?
5. Check the Metro console for `[FloTrace]` logs.

### Tree looks too empty

The RN desktop view defaults to **user-only** — framework/library wrappers (`NavigationContainer`, `GestureHandlerRootView`, `react-native-screens`, Reanimated, Safe Area, etc.) are hidden automatically. You can toggle them back on in the desktop's **Settings → Graph** tab (note: re-enables significant render cost).

### "Connection stale" banner

The desktop sends a ping every 5s and flags the connection stale after 10s of silence. It usually means the JS bridge froze or the native thread crashed. Restart the app; if it happens repeatedly, check native-side logs (`adb logcat` / Xcode console).

## License

MIT

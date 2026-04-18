/**
 * Metro host resolver.
 *
 * Figures out which IP/hostname the RN runtime should open a WebSocket to so that
 * it can reach the desktop FloTrace app running on the developer's laptop.
 *
 * The correct host depends on where the app is running:
 * - iOS simulator         → `127.0.0.1` (shares network stack with the host Mac)
 * - Android emulator      → `10.0.2.2`  (AVD's special alias for the host machine)
 * - Physical device + USB → `127.0.0.1` with `adb reverse tcp:3457 tcp:3457`
 * - Physical device + LAN → the dev-machine's LAN IP, typically discoverable via Metro's `scriptURL`
 *
 * Strategies, evaluated in order:
 *   1. Explicit `host` in config — user override always wins
 *   2. Parse Metro's `SourceCode.scriptURL` — Metro serves the JS bundle from the host, so the
 *      URL's hostname is also the host we want to hit on the LAN. Works for physical devices too.
 *   3. Platform default — loopback for iOS, AVD alias for Android
 *   4. Last resort — return loopback and log a diagnostic; the user likely needs to pass `host` explicitly
 */

// Minimal subset of React Native we use. Typed explicitly so runtime-native can build
// even when RN types aren't installed in the workspace at dev time (RN is a peer dep).
interface RNPlatform {
  OS: 'ios' | 'android' | 'web' | 'windows' | 'macos';
}
interface RNSourceCode {
  scriptURL?: string;
}
interface RNNativeModules {
  SourceCode?: RNSourceCode;
}

export interface MetroHostResolution {
  host: string;
  platform: 'ios' | 'android';
  /** Which strategy produced this host — included in debug logs */
  source: 'config' | 'scriptURL' | 'default' | 'fallback';
}

/**
 * Resolve the desktop host from the current RN environment.
 *
 * @param configHost Optional explicit override passed via FloTraceConfig.host
 * @param Platform   React Native's `Platform` module (passed in to avoid a static import)
 * @param NativeModules React Native's `NativeModules` (same reason)
 */
export function resolveMetroHost(
  configHost: string | undefined,
  Platform: RNPlatform,
  NativeModules: RNNativeModules,
): MetroHostResolution {
  const platform: 'ios' | 'android' =
    Platform.OS === 'android' ? 'android' : 'ios';

  // 1. Explicit override
  if (configHost && configHost.length > 0) {
    return { host: configHost, platform, source: 'config' };
  }

  // 2. Parse Metro's scriptURL — works on physical devices because Metro served the bundle
  //    from the dev machine, so its hostname is reachable on the same network.
  const scriptURL = NativeModules?.SourceCode?.scriptURL;
  if (scriptURL) {
    const host = extractHostFromUrl(scriptURL);
    if (host && !isLoopback(host)) {
      return { host, platform, source: 'scriptURL' };
    }
    // scriptURL was loopback (e.g., iOS sim) — fall through to platform default.
  }

  // 3. Platform default
  if (platform === 'android') {
    // Android AVD remaps 10.0.2.2 to the host machine's loopback
    return { host: '10.0.2.2', platform, source: 'default' };
  }
  return { host: '127.0.0.1', platform, source: 'default' };
}

/**
 * Extract the hostname portion of a URL like `http://192.168.1.42:8081/index.bundle?platform=ios`.
 * Returns undefined if the URL is unparseable. Uses a regex rather than `new URL(...)` to avoid
 * relying on URL polyfills that may not be loaded yet when FloTrace initializes.
 */
export function extractHostFromUrl(url: string): string | undefined {
  // Match scheme://HOST(:port)?(/|$)
  const match = url.match(/^[a-z]+:\/\/([^/:?#]+)/i);
  return match ? match[1] : undefined;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

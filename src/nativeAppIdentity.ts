/**
 * Native app identity resolver.
 *
 * Probes, in priority order, the ecosystem libraries typically present in a
 * React Native app to recover the real bundle identifier, display name, and
 * app version. Every probe is wrapped in try/catch — absence is non-fatal and
 * simply falls through to the next signal. Users add no code; if they happen
 * to have `expo-application` or `react-native-device-info` installed (and
 * virtually all production RN apps do), we use the authoritative value.
 *
 * Precedence:
 *   1. `expo-application`            — authoritative on iOS + Android, covers
 *                                      Expo managed and bare-with-Expo.
 *   2. `react-native-device-info`    — authoritative on iOS + Android, the
 *                                      de facto standard in bare RN CLI.
 *   3. `NativeModules.SettingsManager.settings` (iOS only) — core RN module,
 *                                      still exposed under the New Architecture
 *                                      / Bridgeless interop layer (RN 0.82+).
 *                                      Android has no equivalent core module.
 *   4. Deterministic fallback         — `${Platform.OS}:${fallbackName}`. Only
 *                                      hit by bare RN CLI on Android without
 *                                      an identity library.
 */

import { NativeModules, Platform } from 'react-native';

export interface NativeAppIdentity {
  appId?: string;
  appName?: string;
  appVersion?: string;
  frameworkName: 'expo' | 'rn-cli';
}

type ExpoApplicationModule = {
  applicationId?: string | null;
  applicationName?: string | null;
  nativeApplicationVersion?: string | null;
};

type DeviceInfoModule = {
  getBundleId?: () => string;
  getApplicationName?: () => string;
  getVersion?: () => string;
};

type IOSSettings = {
  CFBundleIdentifier?: string;
  CFBundleDisplayName?: string;
  CFBundleName?: string;
  CFBundleShortVersionString?: string;
};

/**
 * Resolve the app's identity. `fallbackName` is the merged config's `appName`
 * (`DEFAULT_CONFIG.appName` if the user didn't set one) — used only by the
 * deterministic last-resort branch for Android bare-without-libs.
 */
export function resolveNativeAppIdentity(fallbackName: string): NativeAppIdentity {
  // 1. Expo — covers Expo managed + bare-with-Expo projects.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const Expo = require('expo-application') as ExpoApplicationModule;
    if (Expo.applicationId || Expo.applicationName) {
      return {
        appId: Expo.applicationId ?? undefined,
        appName: Expo.applicationName ?? undefined,
        appVersion: Expo.nativeApplicationVersion ?? undefined,
        frameworkName: 'expo',
      };
    }
  } catch {
    /* not installed — fine */
  }

  // 2. react-native-device-info — de facto standard for bare RN CLI.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const DeviceInfo = require('react-native-device-info') as DeviceInfoModule;
    const appId = DeviceInfo.getBundleId?.();
    const appName = DeviceInfo.getApplicationName?.();
    if (appId || appName) {
      return {
        appId,
        appName,
        appVersion: DeviceInfo.getVersion?.(),
        frameworkName: 'rn-cli',
      };
    }
  } catch {
    /* not installed — fine */
  }

  // 3. iOS core NativeModule — zero-dep path for bare RN CLI on iOS.
  //    Android has no equivalent core module; that path falls through to #4.
  if (Platform.OS === 'ios') {
    try {
      const settings = (NativeModules.SettingsManager as { settings?: IOSSettings } | undefined)
        ?.settings;
      if (settings && (settings.CFBundleIdentifier || settings.CFBundleDisplayName || settings.CFBundleName)) {
        return {
          appId: settings.CFBundleIdentifier,
          appName: settings.CFBundleDisplayName ?? settings.CFBundleName,
          appVersion: settings.CFBundleShortVersionString,
          frameworkName: 'rn-cli',
        };
      }
    } catch {
      /* defensive — SettingsManager should always be present on iOS, but the
         Bridgeless interop layer can throw for modules not loaded yet. */
    }
  }

  // 4. Deterministic fallback — Android bare-without-libs (or an unusual iOS
  //    bundle with no identifiers). `platform:name` still uniquely keys the
  //    project in admin, just with a less precise identifier.
  return {
    appId: `${Platform.OS}:${fallbackName}`,
    frameworkName: 'rn-cli',
  };
}

/**
 * Format `Platform.constants.reactNativeVersion` as "major.minor.patch".
 * Returns undefined if `Platform.constants` is unavailable (extremely rare —
 * only happens in pre-mount / bridgeless bootstrap races).
 */
export function getReactNativeVersion(): string | undefined {
  try {
    const c = (Platform as unknown as {
      constants?: {
        reactNativeVersion?: {
          major?: number;
          minor?: number;
          patch?: number;
          prerelease?: string | null;
        };
      };
    }).constants;
    const v = c?.reactNativeVersion;
    if (!v || typeof v.major !== 'number') return undefined;
    const base = `${v.major}.${v.minor ?? 0}.${v.patch ?? 0}`;
    return v.prerelease ? `${base}-${v.prerelease}` : base;
  } catch {
    return undefined;
  }
}

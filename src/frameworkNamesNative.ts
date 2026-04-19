/**
 * React Native framework-component / library-path tables injected into the
 * shared fiber tree walker via `installFiberTreeWalker({ frameworkComponentNames,
 * frameworkPathPatterns, hostComponentSkipPrefixes })`. These mirror the web
 * adapter's built-in filter lists but cover RN / Expo / React Navigation /
 * Reanimated / Gesture Handler / Safe Area / FlashList / Screens internals.
 *
 * Keeping these in the adapter (not runtime-core) lets us extend the list
 * without forcing web users to load RN-specific names.
 */

// ---------------------------------------------------------------------------
// Framework-component name tables, grouped by source library.
//
// Grouping makes maintenance tractable: when a user reports a new wrapper from
// (say) `react-native-screens`, a maintainer edits RN_SCREENS directly instead
// of scanning a 150-entry flat array. The final exported array is the union.
// ---------------------------------------------------------------------------

/** React Native core: host wrappers, list virtualization, touchables, etc. */
const RN_CORE: readonly string[] = [
  'AppContainer',
  'RootTagContext',
  'RCTView',            // Leaks through as user-component-tag on some RN versions
  'RCTText',
  'RCTScrollView',
  'View',               // RN core <View>
  'Text',               // RN core <Text>
  'ScrollView',
  'FlatList',
  'SectionList',
  'VirtualizedList',
  'VirtualizedSectionList',
  'VirtualizedListCell', // RN's per-row wrapper inside FlatList/VirtualizedList
  'CellRenderer',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
  'Pressable',
  'Modal',              // RN core <Modal> wrapper — host view is RCTModalHostView
  'ModalRenderer',
  'RefreshControl',
  'ActivityIndicator',
  'KeyboardAvoidingView',
  'StatusBar',
  'Image',
  'ImageBackground',
  'TextInput',
  'SafeAreaView',       // Legacy RN core; also comes from react-native-safe-area-context
];

/** React Navigation v6 / v7 (@react-navigation/*). */
const REACT_NAVIGATION: readonly string[] = [
  'NavigationContainer',
  'NavigationContainerInner',
  'NavigationContent',
  'NavigationState',
  'NavigationStateListenerProvider',      // v7 state-listener wrapper
  'BaseNavigationContainer',
  'EnsureSingleNavigator',
  'PreventRemoveProvider',                // v7
  'ScreenWrapper',                        // @react-navigation/elements
  'StaticContainer',                      // React Navigation perf wrapper (replaces children only when they change)
  'Screen',
  'SceneView',
  'StackView',
  'Stack',
  'StackNavigator',
  'NativeStack',
  'NativeStackView',
  'NativeStackNavigator',
  'BottomTabView',
  'BottomTabNavigator',
  'DrawerView',
  'DrawerNavigator',
  'MaterialTopTabView',
  'MaterialTopTabNavigator',
  'MaterialBottomTabNavigator',
  'CardContainer',
  'CardStack',
  'Card',
  'Background',
  'SafeAreaProviderCompat',
  'Header',
  'HeaderBackground',
  'HeaderShownContext',
  'TabBar',
  'TabView',
  'ThemeProvider',                        // @react-navigation/native theme context
  'FrameSizeProvider',                    // @react-navigation/elements v7
];

/** react-native-screens — the native-stack primitive used by React Navigation. */
const REACT_NATIVE_SCREENS: readonly string[] = [
  'ScreenStack',
  'ScreenContainer',
  'ScreenStackItem',
  'ScreenContentWrapper',
  'InnerScreen',
  'MaybeScreen',
  'MaybeScreenContainer',
  'NativeScreen',
  'NativeScreenNavigationContainer',
  'NativeScreenContainer',
  'FullWindowOverlay',
  'DebugContainer',
  'DelayedFreeze',      // react-native-screens uses react-freeze under the hood
  'Freeze',             // react-freeze
  'Suspender',          // react-freeze
];

/** react-native-gesture-handler. */
const GESTURE_HANDLER: readonly string[] = [
  'GestureHandlerRootView',
  'GestureHandler',
  'PanGestureHandler',
  'TapGestureHandler',
  'LongPressGestureHandler',
  'RotationGestureHandler',
  'FlingGestureHandler',
  'PinchGestureHandler',
  'ForceTouchGestureHandler',
  'NativeViewGestureHandler',
  'GestureDetector',
];

/** react-native-reanimated. */
const REANIMATED: readonly string[] = [
  'AnimatedComponent',
  'createAnimatedComponent',
  'AnimatedView',
  'AnimatedText',
  'AnimatedScrollView',
  'AnimatedImage',
  'AnimatedFlatList',
  'Reanimated.View',
  'Reanimated.Text',
  'Reanimated.ScrollView',
  'Reanimated.Image',
  'PerformanceMonitor',
];

/** react-native-safe-area-context. */
const SAFE_AREA: readonly string[] = [
  'SafeAreaProvider',
  'SafeAreaProviderShim',   // v5 internal shim
  'SafeAreaEnv',            // v5 env wrapper
  'SafeAreaInsetsContext',
  'SafeAreaFrameContext',
  'SafeAreaConsumer',
];

/** @shopify/flash-list. */
const FLASH_LIST: readonly string[] = [
  'FlashList',
  'FlashListComponent',
  'AutoLayoutView',
  'CellContainer',
  'WrapperComponent',
];

/** Expo / Expo Router. */
const EXPO: readonly string[] = [
  'ExpoRoot',
  'RootSiblingParent',
  'ExpoRouter.Root',
  'RouterRoot',
  'ContextNavigator',
  'RouteNode',
  'Sitemap',
  'LoadingRoute',
  'Slot',
  'Stack.Screen',
  'Tabs',
  'Link',
];

/** Component names treated as framework internals on React Native. */
export const RN_FRAMEWORK_COMPONENT_NAMES: readonly string[] = [
  ...RN_CORE,
  ...REACT_NAVIGATION,
  ...REACT_NATIVE_SCREENS,
  ...GESTURE_HANDLER,
  ...REANIMATED,
  ...SAFE_AREA,
  ...FLASH_LIST,
  ...EXPO,
];

/**
 * Display-name regex patterns for framework wrappers whose names are generated
 * (can't be enumerated exhaustively). Covers:
 *   - `Animated(View)` / `Animated(Anonymous)` / `Animated(ScrollView)` — RN's
 *     `createAnimatedComponent` HOC output uses `displayName = "Animated(X)"`.
 *   - `X_withRef` — RN core's internal forwardRef re-wrap for View / ScrollView
 *     / Text / etc. exported via React.forwardRef with a `_withRef` suffix.
 *   - `forwardRef(X)` — generic React.forwardRef fallback display when the
 *     inner component lacks a name (library wrappers commonly surface this).
 */
export const RN_FRAMEWORK_NAME_PATTERNS: readonly RegExp[] = [
  /^Animated\(.+\)$/,
  /_withRef$/,
  /^forwardRef\(.+\)$/,
];

/** File-path regex patterns flagging RN framework / library source. */
export const RN_FRAMEWORK_PATH_PATTERNS: readonly RegExp[] = [
  /react-native[\\/]Libraries/,
  /[\\/]@react-navigation[\\/]/,
  /[\\/]react-native-screens[\\/]/,
  /[\\/]react-native-gesture-handler[\\/]/,
  /[\\/]react-native-reanimated[\\/]/,
  /[\\/]react-native-safe-area-context[\\/]/,
  /[\\/]@shopify[\\/]flash-list[\\/]/,
  /[\\/]expo[\\/]build/,
  /[\\/]expo-router[\\/]/,
  /[\\/]@expo[\\/]/,
];

/**
 * Host-component name prefixes that should not surface as tree nodes on RN.
 * Children are still walked via the transparent-wrapper branch.
 */
export const RN_HOST_COMPONENT_SKIP_PREFIXES: readonly string[] = ['RCT'];

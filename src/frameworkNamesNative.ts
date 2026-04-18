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

/** Component names treated as framework internals on React Native. */
export const RN_FRAMEWORK_COMPONENT_NAMES: readonly string[] = [
  // --- React Native core wrappers ---
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

  // --- React Navigation v6 / v7 (@react-navigation/*) ---
  'NavigationContainer',
  'NavigationContainerInner',
  'NavigationContent',
  'NavigationState',
  'BaseNavigationContainer',
  'EnsureSingleNavigator',
  'Screen',
  'SceneView',
  'StackView',
  'Stack',
  'NativeStack',
  'NativeStackView',
  'BottomTabView',
  'DrawerView',
  'MaterialTopTabView',
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

  // --- react-native-screens ---
  'ScreenStack',
  'ScreenContainer',
  'ScreenStackItem',
  'InnerScreen',
  'NativeScreen',
  'NativeScreenNavigationContainer',
  'NativeScreenContainer',
  'FullWindowOverlay',
  'DebugContainer',

  // --- react-native-gesture-handler ---
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

  // --- react-native-reanimated ---
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

  // --- react-native-safe-area-context ---
  'SafeAreaProvider',
  'SafeAreaInsetsContext',
  'SafeAreaFrameContext',
  'SafeAreaConsumer',

  // --- @shopify/flash-list ---
  'FlashList',
  'FlashListComponent',
  'AutoLayoutView',
  'CellContainer',
  'WrapperComponent',

  // --- Expo / Expo Router ---
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

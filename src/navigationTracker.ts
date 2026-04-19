/**
 * React Navigation tracker for FloTrace (Phase 3).
 *
 * Subscribes to a NavigationContainer ref and maintains the set of currently
 * focused route keys across every nesting level of the navigator tree. Exposes
 * `shouldPruneNode(node)` — the walker's `pruneSubtree` predicate — which walks
 * up the fiber.return chain from a given node to decide whether it sits inside
 * an inactive screen.
 *
 * Rules (applied while walking fiber.return from the node):
 *   1. If a visible `<Modal>` ancestor is found → keep (modal content is
 *      focus-adjacent overlay regardless of underlying route focus).
 *   2. If the innermost `route.key` ancestor is in the focused set → keep.
 *   3. If the innermost ancestor is a `react-native-screens` `<Screen>` with
 *      `activityState === 2` → keep (screens-aware navigators use 2=active).
 *   4. Otherwise → prune (inactive screen subtree).
 *   5. If no route ancestor exists (e.g. pre-navigation root) → keep.
 *
 * Navigation ref is optional — when absent (plain app, no React Navigation)
 * the tracker is inert and every `shouldPruneNode` call returns false.
 */
import type { LiveTreeNode } from '@flotrace/runtime-core';
import { getFiberRefMap } from '@flotrace/runtime-core';

/**
 * Structural subset of React Navigation's NavigationState. Intentionally
 * permissive to stay compatible with both `NavigationState` and `PartialState`
 * (where `index` can be omitted) — the consumer's `NavigationContainerRef`
 * type mixes both, and a stricter shape makes `ref={navigationRef}` fail to
 * typecheck for no runtime gain (we already handle missing index safely).
 */
interface NavigationStateLike {
  index?: number;
  routes: ReadonlyArray<{ key?: string; state?: NavigationStateLike }>;
}

export interface NavigationRefLike {
  isReady?: () => boolean;
  getRootState?: () => NavigationStateLike | undefined;
  addListener?: (event: 'state', cb: () => void) => () => void;
}

interface FiberLike {
  return: FiberLike | null;
  type?: unknown;
  memoizedProps?: unknown;
}

// Poll interval + cap for waiting on the NavigationContainer to mount. React
// Navigation's `createNavigationContainerRef()` returns a proxy that emits
// uninitialized-ref warnings and silently drops listener registrations until
// the container attaches; subscribing before that yields zero state updates.
const READY_POLL_INTERVAL_MS = 100;
const READY_POLL_TIMEOUT_MS = 30_000;

let focusedRouteKeys: Set<string> = new Set();
let activeRef: NavigationRefLike | null = null;
let unsubscribe: (() => void) | null = null;
let readyPollTimer: ReturnType<typeof setInterval> | null = null;

// Clear the ready-poll interval. Safe to call when no timer is active.
// `clearInterval` on a stale handle can throw under some RN shims, so guard.
function stopReadyPolling(): void {
  if (readyPollTimer) {
    try { clearInterval(readyPollTimer); } catch { /* non-fatal */ }
    readyPollTimer = null;
  }
}

function collectFocusedKeys(state: NavigationStateLike | undefined, out: Set<string>): void {
  if (!state || !Array.isArray(state.routes)) return;
  // PartialState can omit `index` — treat as "no focused route at this level"
  if (typeof state.index !== 'number') return;
  const focused = state.routes[state.index];
  if (!focused || typeof focused.key !== 'string') return;
  out.add(focused.key);
  if (focused.state) collectFocusedKeys(focused.state, out);
}

function refreshFocusedRoutes(): void {
  if (!activeRef || typeof activeRef.getRootState !== 'function') return;
  try {
    const next = new Set<string>();
    collectFocusedKeys(activeRef.getRootState(), next);
    focusedRouteKeys = next;
  } catch (err) {
    console.warn('[FloTrace] (native) navigation state read failed:', err);
  }
}

/**
 * Bind the active ref to state updates. Assumes the container is ready.
 */
function attachSubscription(ref: NavigationRefLike): void {
  refreshFocusedRoutes();

  if (typeof ref.addListener === 'function') {
    try {
      unsubscribe = ref.addListener('state', refreshFocusedRoutes);
    } catch (err) {
      console.warn('[FloTrace] (native) navigation listener attach failed:', err);
    }
  }
}

/**
 * Subscribe to navigation state. Safe to call multiple times — later calls
 * replace the earlier subscription. Pass `null`/`undefined` to disable.
 *
 * When the ref exposes `isReady()` (React Navigation v6+), waits for the
 * NavigationContainer to mount before reading state or attaching listeners.
 * Without this guard the proxy warns ("The 'navigation' object hasn't been
 * initialize[d]") and the `addListener` call no-ops, leaving focusedRouteKeys
 * permanently empty.
 */
export function installNavigationTracker(ref: NavigationRefLike | null | undefined): void {
  disposeNavigationTracker();
  if (!ref) return;
  activeRef = ref;

  const hasReadyCheck = typeof ref.isReady === 'function';
  if (!hasReadyCheck || ref.isReady!()) {
    attachSubscription(ref);
    return;
  }

  const startedAt = Date.now();
  readyPollTimer = setInterval(() => {
    // Ref replaced or disposed while polling — abandon this loop.
    if (activeRef !== ref) {
      stopReadyPolling();
      return;
    }

    let ready = false;
    try {
      ready = ref.isReady!() === true;
    } catch {
      ready = false;
    }

    if (ready) {
      stopReadyPolling();
      attachSubscription(ref);
      return;
    }

    if (Date.now() - startedAt >= READY_POLL_TIMEOUT_MS) {
      stopReadyPolling();
      console.warn(
        '[FloTrace] (native) NavigationContainer did not become ready within 30s — active-screen filter disabled.',
      );
    }
  }, READY_POLL_INTERVAL_MS);
}

export function disposeNavigationTracker(): void {
  stopReadyPolling();
  if (unsubscribe) {
    try { unsubscribe(); } catch { /* non-fatal */ }
    unsubscribe = null;
  }
  activeRef = null;
  focusedRouteKeys = new Set();
}

// ---------------------------------------------------------------------------
// Fiber-walk decision
// ---------------------------------------------------------------------------

function isVisibleModalFiber(fiber: FiberLike): boolean {
  const props = (fiber.memoizedProps ?? null) as { visible?: unknown } | null;
  const visible = props ? props.visible : undefined;
  // Default-visible: RN Modal defaults to visible={true} when prop omitted.
  const isVisible = visible === undefined || visible === true;
  if (!isVisible) return false;

  // Host fiber: RN renders <Modal> through a RCTModalHostView host node.
  if (typeof fiber.type === 'string' && fiber.type === 'RCTModalHostView') return true;

  // React-level <Modal> component — detect by displayName/name to stay resilient
  // across minification (RN's Modal exports a named class).
  if (fiber.type && typeof fiber.type === 'object') {
    const t = fiber.type as { displayName?: string; name?: string };
    if (t.displayName === 'Modal' || t.name === 'Modal') return true;
  }
  return false;
}

function evaluatePruneDecision(fiber: FiberLike | null): boolean {
  if (!fiber) return false;
  if (focusedRouteKeys.size === 0) return false;

  let innermostRouteKey: string | null = null;
  let innermostActivityState: number | null = null;
  let cur: FiberLike | null = fiber.return ?? null;

  while (cur) {
    if (isVisibleModalFiber(cur)) return false;

    const props = cur.memoizedProps as {
      route?: { key?: string };
      activityState?: unknown;
    } | null;

    if (props) {
      if (innermostRouteKey === null) {
        const routeCandidate = props.route;
        if (routeCandidate && typeof routeCandidate.key === 'string') {
          innermostRouteKey = routeCandidate.key;
        }
      }
      if (innermostActivityState === null && typeof props.activityState === 'number') {
        innermostActivityState = props.activityState;
      }
    }

    cur = cur.return ?? null;
  }

  if (innermostRouteKey === null) return false;
  if (focusedRouteKeys.has(innermostRouteKey)) return false;
  if (innermostActivityState === 2) return false;
  return true;
}

export function shouldPruneNode(node: LiveTreeNode): boolean {
  try {
    const fiber = getFiberRefMap().get(node.id) as FiberLike | undefined;
    return evaluatePruneDecision(fiber ?? null);
  } catch {
    return false;
  }
}

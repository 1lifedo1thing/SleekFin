const HOLD_MS = 4000;
const TRANSITION_MS = 300;
const MAX_ENTRIES = 50;
const HISTORY_METHODS = ['pushState', 'replaceState'];

// Home and the library listings are the pages whose scroll position is worth keeping. Every other
// route is deliberately absent: the dashboard, configuration, detail, login and playback routes keep
// Jellyfin's own scrolling, because those are the pages a reskin must not disturb.
const LIBRARY_ROUTES = new Set([
  '/home',
  '/books',
  '/boxsets',
  '/homevideos',
  '/livetv',
  '/mixed',
  '/movies',
  '/music',
  '/musicvideos',
  '/playlists',
  '/tv',
  '/list',
]);

// Jellyfin 12 addresses a legacy page with a `.html` suffix and the modern page without one, so
// `/movies` and `/movies.html` are the same route here.
function routePath() {
  const raw = window.location.hash.slice(1) || window.location.pathname || '/';
  const path = raw.split('?')[0].toLowerCase();
  return path.endsWith('.html') ? path.slice(0, -5) : path;
}

function isLibraryRoute() {
  return LIBRARY_ROUTES.has(routePath());
}

function scrollPosition() {
  return Math.max(
    window.scrollY || 0,
    document.documentElement?.scrollTop || 0,
    document.body?.scrollTop || 0,
  );
}

function maxScrollPosition() {
  const contentHeight = Math.max(
    document.documentElement?.scrollHeight || 0,
    document.body?.scrollHeight || 0,
  );
  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
  return Math.max(0, contentHeight - viewportHeight);
}

// Jellyfin 12 routes through react-router, which keeps a key that is unique per history entry in
// window.history.state. The same route can occupy several entries with a different position in each,
// so a position is filed under that key rather than under the route. The key is only read: react-router
// owns that object, and writing to it would put this feature in the middle of the router's state. The
// first entry of a fresh load has no state yet, and falls back to the route.
function entryKey() {
  const state = window.history.state;
  return state && typeof state.key === 'string' && state.key ? state.key : routePath();
}

// Jellyfin 12 does not restore the position itself: measured here, a page scrolled to 900 is back at 0
// after a Back traversal, so the browser's own restoration is what runs and it does not land on the
// recorded position. Jellyfin's only related line is `if (!e.detail.isRestored) { window.scrollTo(0, 0); }`
// in libraryMenu, and `isRestored` is true only for a cached legacy view: the React pages that carry the
// home and library views dispatch `isRestored: false` on every navigation, so that reset runs on the way
// back too. The position is therefore recorded per history entry and re-applied here.
export function createScrollFeature() {
  let current = '';
  let currentRoute = '';
  let lastScrolled = '';
  let live = 0;
  let native = null;
  let pausedUntil = 0;
  let positions = null;
  let recordedKey = '';
  let restoring = false;
  let restoreId = 0;
  let restoreKey = '';
  let started = false;
  let stopNavigation = null;

  function remember(key, value) {
    if (positions.get(key) === value) return;
    if (positions.size >= MAX_ENTRIES) {
      positions = new Map(Array.from(positions).slice(1 - MAX_ENTRIES));
    }
    positions.set(key, value);
  }

  // The browser applies its own restoration after the traversal's listeners return, so taking it over
  // inside the handler is what stops that pending position from replacing the one being applied. Only a
  // value this feature changed is written back: if restoration is already manual, something else owns
  // it, and restoring it to `auto` on release would override that owner.
  function own(owned) {
    if (owned) {
      if (native !== null || history.scrollRestoration === 'manual') return;
      native = history.scrollRestoration;
      history.scrollRestoration = 'manual';
      return;
    }
    restoring = false;
    if (native === null) return;
    history.scrollRestoration = native;
    native = null;
  }

  function onScroll() {
    // The reading pauses for a short window after a commit, because Jellyfin's own scrollTo(0, 0) for
    // the page being opened lands inside it - measured at about 170 ms after the click - and those
    // frames report Jellyfin's reset rather than the user. The pause is bounded by time, so a click
    // that navigates nowhere - a dialog, a filter chip - cannot leave the reading stale for the rest of
    // the entry; a wheel, touch or key gesture clears it sooner. A pointer press cancels an active restore;
    // subsequent user scrolling is read normally.
    if (restoring || performance.now() < pausedUntil) return;
    // A route outside the library set is never read, so nothing is ever stored for one, and the
    // dashboard, a detail page and a player keep Jellyfin's own scrolling.
    if (!isLibraryRoute()) return;
    // History changes before Jellyfin reports that the incoming view is ready. Ignore its reset while
    // the location names that incoming route, so the outgoing entry cannot inherit a zero position.
    if (routePath() !== currentRoute) return;
    // A reading taken on this entry after the transition replaces what was recorded for it, so a click
    // that navigates nowhere does not freeze the entry at the position it happened to be at.
    recordedKey = '';
    live = scrollPosition();
    lastScrolled = current;
  }

  // The recorded position comes from a reading that belongs to the entry being left, which is what
  // `lastScrolled` tracks. One Back traversal can deliver `pageshow`, `popstate` and `hashchange` in
  // turn, and only the first of them records: each signal clears `lastScrolled` as it re-reads the
  // entry, so the later ones have no reading left to file and cannot replace the user's place with a
  // frame of the transition. `recordedKey` covers the one case those signals do not, a pointer press
  // followed by the history write it causes, which would otherwise file the same entry twice. An entry
  // the user has not scrolled on has nothing to record, and that is not a failure: it opens at the top,
  // which is what Jellyfin intends for a page being opened.
  function commit() {
    // A wrapper survives stop() when another script wrapped over it during the feature's life, so this
    // can still be called after the storage has been released.
    if (!started || restoring || lastScrolled !== current || recordedKey === current) return;
    recordedKey = current;
    pausedUntil = performance.now() + TRANSITION_MS;
    remember(current, live);
  }

  // Pointer, wheel, touch and key gestures end a restore, so a position is never held against the user.
  // Any key ends it, not only the keys that scroll: the hold cannot tell a scroll key from another one,
  // and a TV remote moves the page with the same key events as a keyboard.
  function cancelRestore() {
    pausedUntil = 0;
    if (!restoring) return;
    endRestore();
  }

  function onPointerDown() {
    if (restoring) cancelRestore();
    commit();
  }

  function watchNavigation() {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', cancelRestore, true);
    document.addEventListener('wheel', cancelRestore, { capture: true, passive: true });
    document.addEventListener('touchstart', cancelRestore, { capture: true, passive: true });

    // An in-app navigation reaches the browser as history.pushState or history.replaceState, written by
    // react-router, which Jellyfin's history shim delegates to, and neither one dispatches `hashchange`,
    // so the history methods are what catch a navigation as it starts. Both are wrapped: a replace can
    // point at a different route on the same entry, so it is a navigation even though it adds no entry.
    const restores = HISTORY_METHODS.map((method) => {
      const original = window.history[method];
      const wrapper = function (...args) {
        commit();
        const route = routePath();
        const before = current;
        const result = original.apply(this, args);
        // A wrapper another script wrapped over this one survives stop(), so this path can still run after
        // the feature released its storage.
        if (!started) return result;
        const after = entryKey();
        if (after === before) return result;
        const sameRoute = routePath() === route;
        // The entry was re-keyed while the page it belongs to is still on screen, which happens for a
        // navigation to the route already shown: measured here, that push re-keyed the entry with no
        // `pageshow` at all, because the view does not remount, and a position filed by `commit` above
        // would sit under the old key. A push adds an entry rather than rewriting one, so the older
        // entry is still in the stack behind the new key and a further Back lands on it: the record is
        // copied, so both entries keep it. A replace rewrites the entry, leaving no entry that holds the
        // old key, so the record moves. A navigation that changed the route is not this case: its two
        // keys are two different pages, and carrying the position across would file it under the page
        // just opened.
        if (sameRoute && positions.has(before)) {
          positions.set(after, positions.get(before));
          if (method === 'replaceState') positions.delete(before);
        }
        // `current` follows at once only when the route did not change: after a real route change the
        // arriving view's own signal updates it, and reading early would file the outgoing page's
        // position under the incoming entry.
        if (sameRoute) current = after;
        return result;
      };
      window.history[method] = wrapper;
      // Restored only while this wrapper is still the installed method: Jellyfin or another plugin may
      // have wrapped it after us, and assigning the original back would drop their wrapper.
      return () => {
        if (window.history[method] === wrapper) {
          window.history[method] = original;
        }
      };
    });

    stopNavigation = () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', cancelRestore, true);
      document.removeEventListener('wheel', cancelRestore, true);
      document.removeEventListener('touchstart', cancelRestore, true);
      restores.forEach((restore) => restore());
    };
  }

  // `pageshow` is the route signal for a navigation that changes the route: Jellyfin 12 dispatches it as a
  // bubbling CustomEvent on the view element, so it reaches the window. It is not sent for a navigation to
  // the route already on screen, because the view does not remount, which is why the history wrappers read
  // the entry themselves. `hashchange` and `pageshow` re-read the entry here; only `popstate` starts a
  // restore, so the several events one Back traversal produces cannot start a second one. `hashchange` is
  // also not guaranteed for a traversal between two entries carrying the same fragment, which is another
  // reason the restore hangs off `popstate` alone.
  function onRouteChange() {
    commit();
    pausedUntil = 0;
    lastScrolled = '';
    recordedKey = '';
    current = entryKey();
    currentRoute = routePath();
  }

  // Only a traversal restores: a traversal is what `popstate` reports, so a fresh navigation to a route
  // the user has already visited is left at the top. Measured here, it arrives after the incoming view has
  // been shown, so the document being scrolled is already the destination.
  function onPop() {
    onRouteChange();
    if (!isLibraryRoute()) return;
    const target = positions.get(current) || 0;
    if (target > 0) restore(target);
  }

  function restore(target) {
    restoreId += 1;
    const id = restoreId;
    restoring = true;
    restoreKey = current;
    own(true);
    const deadline = performance.now() + HOLD_MS;
    window.requestAnimationFrame(() => apply(id, target, deadline));
  }

  // Bumping the identifier is what ends a restore: the loop belonging to it stops on its next frame,
  // because its id no longer matches. A newer restore therefore always takes the page over, even when it
  // asks for the same position, so an older loop can neither keep scrolling nor cut the newer one's hold
  // short.
  function endRestore() {
    restoreId += 1;
    own(false);
  }

  function finish(id) {
    if (id !== restoreId) return;
    endRestore();
  }

  // Re-apply until the time deadline while the document grows enough to hold the saved position. A scroll
  // the document cannot reach is silently ignored, so applying it once during navigation can be dropped.
  // Both body and documentElement can own the document's scrolling depending on the client mode.
  function apply(id, target, deadline) {
    if (id !== restoreId) return;
    if (performance.now() >= deadline) return finish(id);
    // The route is read from the location rather than from the cached entry: between a navigation and the
    // view signal that reports it, `current` still names the page being left, and scrolling a route this
    // feature does not manage - the dashboard, a detail page, a player - is what must not happen.
    if (!isLibraryRoute()) return finish(id);
    // A restore belongs to the entry it was started for, and that entry is read fresh rather than from
    // the cached `current`, which names the page being left until the arriving view's signal reports it: a
    // route change reaches the history method tens to hundreds of milliseconds before that signal, and
    // reading the cached entry across that window would leave the re-apply below holding the old position
    // on the page just opened.
    if (restoreKey !== entryKey()) return finish(id);
    if (maxScrollPosition() >= target && scrollPosition() !== target) {
      window.scrollTo(0, target);
    }
    window.requestAnimationFrame(() => apply(id, target, deadline));
  }

  function start() {
    if (started) return;

    started = true;
    positions = new Map();
    current = entryKey();
    currentRoute = routePath();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('pageshow', onRouteChange);
    watchNavigation();
  }

  function stop() {
    if (!started) return;

    started = false;
    endRestore();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onRouteChange);
    window.removeEventListener('pageshow', onRouteChange);
    stopNavigation?.();
    stopNavigation = null;
    positions = null;
  }

  return { start, stop };
}

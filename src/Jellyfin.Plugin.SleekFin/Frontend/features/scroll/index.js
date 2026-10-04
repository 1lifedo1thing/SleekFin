const HOLD_MS = 4000;
const MAX_ENTRIES = 50;
const RETRY_MS = 50;
const HISTORY_METHODS = ['pushState', 'replaceState'];
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

function routePath() {
  const raw = window.location.hash.slice(1) || window.location.pathname || '/';
  const path = raw.split('?')[0].toLowerCase();
  return path.endsWith('.html') ? path.slice(0, -5) : path;
}

function isLibraryRoute() {
  return LIBRARY_ROUTES.has(routePath());
}

function entryKey() {
  return window.history.state?.key || window.location.href;
}

function scrollPosition() {
  return Math.max(window.scrollY || 0, document.documentElement?.scrollTop || 0, document.body?.scrollTop || 0);
}

function maxScrollPosition() {
  const height = Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0);
  return Math.max(0, height - (window.innerHeight || document.documentElement?.clientHeight || 0));
}

export function createScrollFeature() {
  let nativeRestoration = null;
  let positions = null;
  let restoreTimer = 0;
  let restoring = false;
  let started = false;
  let stopNavigation = null;

  function remember(key, value) {
    positions.delete(key);
    positions.set(key, value);
    if (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value);
  }

  function save(key = entryKey()) {
    if (!started || restoring || !isLibraryRoute()) return;
    remember(key, scrollPosition());
  }

  function onScroll() {
    save();
  }

  function onInteraction() {
    cancelRestore();
    save();
  }

  function cancelRestore() {
    if (!restoring) return;
    restoring = false;
    window.clearTimeout(restoreTimer);
    restoreTimer = 0;
    if (nativeRestoration !== null) {
      if (window.history.scrollRestoration === 'manual') window.history.scrollRestoration = nativeRestoration;
      nativeRestoration = null;
    }
  }

  function apply(key, target, deadline) {
    if (!restoring) return;
    // Jellyfin resets on pageshow and library rows grow later, so retry briefly without holding input.
    if (performance.now() >= deadline || entryKey() !== key || !isLibraryRoute()) {
      cancelRestore();
      return;
    }
    if (maxScrollPosition() >= target && scrollPosition() !== target) window.scrollTo(0, target);
    restoreTimer = window.setTimeout(() => apply(key, target, deadline), RETRY_MS);
  }

  function restore(key, target) {
    cancelRestore();
    restoring = true;
    if ('scrollRestoration' in window.history && window.history.scrollRestoration !== 'manual') {
      nativeRestoration = window.history.scrollRestoration;
      window.history.scrollRestoration = 'manual';
    }
    const deadline = performance.now() + HOLD_MS;
    restoreTimer = window.setTimeout(() => apply(key, target, deadline), 0);
  }

  function onPopState() {
    cancelRestore();
    if (!isLibraryRoute()) return;
    const key = entryKey();
    if (positions.has(key)) restore(key, positions.get(key));
  }

  function watchNavigation() {
    let active = true;
    document.addEventListener('pointerdown', onInteraction, true);
    document.addEventListener('keydown', onInteraction, true);
    document.addEventListener('wheel', onInteraction, { capture: true, passive: true });
    document.addEventListener('touchstart', onInteraction, { capture: true, passive: true });

    const restores = HISTORY_METHODS.map((method) => {
      const original = window.history[method];
      const wrapper = function (...args) {
        if (!active || !started) return original.apply(this, args);
        cancelRestore();
        const beforeKey = entryKey();
        const beforeUrl = window.location.href;
        save(beforeKey);
        const result = original.apply(this, args);
        if (!active || !started) return result;
        const afterKey = entryKey();
        // Only an exact same-location rekey represents the page that is still on screen.
        if (beforeUrl === window.location.href && beforeKey !== afterKey && positions.has(beforeKey)) {
          const value = positions.get(beforeKey);
          if (method === 'replaceState') positions.delete(beforeKey);
          remember(afterKey, value);
        }
        return result;
      };
      window.history[method] = wrapper;
      return () => {
        if (window.history[method] === wrapper) window.history[method] = original;
      };
    });

    stopNavigation = () => {
      active = false;
      document.removeEventListener('pointerdown', onInteraction, true);
      document.removeEventListener('keydown', onInteraction, true);
      document.removeEventListener('wheel', onInteraction, true);
      document.removeEventListener('touchstart', onInteraction, true);
      restores.forEach((stop) => stop());
    };
  }

  function start() {
    if (started) return;
    started = true;
    positions = new Map();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', onPopState);
    watchNavigation();
  }

  function stop() {
    if (!started) return;
    started = false;
    cancelRestore();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('popstate', onPopState);
    stopNavigation?.();
    stopNavigation = null;
    positions = null;
  }

  return { start, stop };
}

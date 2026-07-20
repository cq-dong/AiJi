// Node 22+ ships an experimental native `localStorage` global (opt-in via
// --localstorage-file). When it is not configured, the global exists as a
// broken getter that returns undefined, and — critically — it causes vitest's
// populateGlobal to SKIP copying jsdom's `localStorage` onto the test global
// (because `k in global` is already true). This setup file bridges jsdom's
// storage APIs back onto the global so tests can use `localStorage` directly.
//
// Ref: vitest dist `getWindowKeys` filter — keys already in `global` are only
// re-exported if they appear in vitest's static KEYS list; `localStorage` is
// not on that list.
const jsdom = (globalThis as { jsdom?: { window?: { localStorage?: Storage; sessionStorage?: Storage } } }).jsdom

function bridge(name: 'localStorage' | 'sessionStorage'): void {
  const store = jsdom?.window?.[name]
  if (!store) return
  try {
    const existing = (globalThis as Record<string, unknown>)[name]
    // Only override when the current value is missing/undefined (the broken
    // Node native stub). If something else already provides a working store,
    // leave it alone.
    if (existing === undefined || existing === null) {
      Object.defineProperty(globalThis, name, {
        value: store,
        writable: true,
        configurable: true,
      })
    }
  } catch {
    // ignore — best effort
  }
}

bridge('localStorage')
bridge('sessionStorage')

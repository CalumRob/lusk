import { vi } from 'vitest'

/**
 * The app never fetches in tests: happy-dom's real fetch tries the network
 * (ECONNREFUSED noise). A 404 stub exercises the loader's typed error path —
 * hosts (AccueilView) show the error state, exactly as when /data/ is
 * unreachable. Loader specs inject their own fetchImpl and are unaffected.
 */
vi.stubGlobal(
  'fetch',
  () =>
    Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    } as Response),
)

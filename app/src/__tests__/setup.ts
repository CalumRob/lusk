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

/**
 * ECharts renders to canvas — happy-dom has no canvas 2D implementation.
 * The GraphiqueSoldes component guards init with try/catch, but a stub keeps
 * every spec that mounts the fiche block free of canvas noise; the chart's
 * data is asserted through its text (aria-label + legend), never the canvas.
 */
vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: vi.fn(() => ({ setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() })),
}))
vi.mock('echarts/charts', () => ({ ScatterChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

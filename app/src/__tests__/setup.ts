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
 * ECharts renders to canvas or SVG — happy-dom has no canvas 2D implementation.
 * The chart components guard init with try/catch, but a stub keeps
 * every spec that mounts the fiche block free of canvas noise; the chart's
 * data is asserted through its text (aria-label + legend), never the canvas.
 */
vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
}))
vi.mock('echarts/charts', () => ({ BarChart: {}, ScatterChart: {}, LineChart: {} }))
vi.mock('echarts/components', () => ({
  AxisPointerComponent: {},
  GridComponent: {},
  TooltipComponent: {},
  MarkLineComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {}, SVGRenderer: {} }))

/**
 * MapLibre — happy-dom has no WebGL. A structural fake records the map's
 * construction options, sources/layers/paints (the specs assert the map
 * contract: Etalab positron vector basemap, GeoJSON sources, theme-driven
 * fills) and lets specs fire 'load' to walk the init path. MapExplorer tests
 * reach the fake through `instancesCarteMaple`.
 */
const maplibreMock = vi.hoisted(() => {
  type Ecouteur = (...args: unknown[]) => void

  class PopupFake {
    contenu = ''
    position: unknown = null
    enlevee = false
    options: Record<string, unknown>
    ecouteurs: Record<string, Ecouteur[]> = {}
    constructor(options: Record<string, unknown> = {}) {
      this.options = options
    }
    setLngLat(lngLat: unknown) {
      this.position = lngLat
      return this
    }
    setHTML(html: string) {
      this.contenu = html
      return this
    }
    addTo(_carte: unknown) {
      return this
    }
    remove() {
      this.enlevee = true
    }
    getLngLat() {
      return this.position
    }
    getElement() {
      // Le DOM du popup n'existe pas en happy-dom : ancre « bottom » par défaut
      // (le popup s'étend vers le haut), hauteur nulle — le tooltip sous-popup
      // utilise alors la marge fixe, comme sans mesure du DOM.
      return { offsetHeight: 0, classList: { contains: () => false } }
    }
    on(evenement: string, ecouteur: Ecouteur) {
      ;(this.ecouteurs[evenement] ??= []).push(ecouteur)
    }
    fire(evenement: string, ...args: unknown[]) {
      for (const ecouteur of this.ecouteurs[evenement] ?? []) ecouteur(...args)
    }
  }

  class CarteFake {
    options: Record<string, unknown>
    ecouteurs: Record<string, Ecouteur[]> = {}
    sources: Record<string, unknown> = {}
    sourcesSetData: Record<string, ReturnType<typeof vi.fn>> = {}
    couches: Record<string, unknown> = {}
    peintures: Record<string, Record<string, unknown>> = {}
    misesEnPage: Record<string, Record<string, unknown>> = {}
    controlesAjoutes: unknown[] = []
    appelsFitBounds: { bornes: unknown; options: unknown }[] = []
    enlevee = false
    constructor(options: Record<string, unknown>) {
      this.options = options
    }
    addControl(controle: unknown) {
      this.controlesAjoutes.push(controle)
    }
    on(evenement: string, ecouteur: Ecouteur) {
      ;(this.ecouteurs[evenement] ??= []).push(ecouteur)
    }
    fire(evenement: string, ...args: unknown[]) {
      for (const ecouteur of this.ecouteurs[evenement] ?? []) ecouteur(...args)
    }
    addSource(id: string, source: unknown) {
      this.sources[id] = source
    }
    getSource(id: string) {
      if (!(id in this.sources)) return null
      this.sourcesSetData[id] ??= vi.fn()
      return { setData: this.sourcesSetData[id] }
    }
    addLayer(couche: Record<string, unknown>) {
      this.couches[String(couche.id)] = couche
    }
    getLayer(id: string) {
      return this.couches[id] ?? null
    }
    setPaintProperty(couche: string, propriete: string, valeur: unknown) {
      ;(this.peintures[couche] ??= {})[propriete] = valeur
    }
    setLayoutProperty(couche: string, propriete: string, valeur: unknown) {
      ;(this.misesEnPage[couche] ??= {})[propriete] = valeur
    }
    getCanvas() {
      return { style: {} }
    }
    queryRenderedFeatures(_point: unknown, _options: unknown) {
      return []
    }
    resize() {
      /* no-op */
    }
    isStyleLoaded() {
      return true
    }
    getZoom() {
      return 8
    }
    fitBounds(bornes: unknown, options: unknown) {
      this.appelsFitBounds.push({ bornes, options })
    }
    remove() {
      this.enlevee = true
    }
  }

  return {
    instancesCarteMaple: [] as CarteFake[],
    instancesPopups: [] as PopupFake[],
    CarteFake,
    PopupFake,
  }
})

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class extends maplibreMock.CarteFake {
      constructor(options: Record<string, unknown>) {
        super(options)
        maplibreMock.instancesCarteMaple.push(this)
      }
    },
    Popup: class extends maplibreMock.PopupFake {
      constructor(options: Record<string, unknown>) {
        super(options)
        maplibreMock.instancesPopups.push(this)
      }
    },
    NavigationControl: class {},
    LngLat: class {
      constructor(
        public lng: number,
        public lat: number,
      ) {}
    },
  },
}))

export { maplibreMock }

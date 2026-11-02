import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { indicateursDemographieFixture, indicateursMobiliteFixture, metadonneesThemesFixtures } from '../payload/fixtures'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'
import { createNativeSemanticApiTransport } from './helpers/nativeSemanticApiTransport'

const territoires = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
const defaultTransport = createNativeSemanticApiTransport()

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(defaultTransport))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe("Page d'indicateur — coupure scalaires ordinaires du modèle de lecture (#855, #871)", () => {
  async function mountDensity() {
    const payloadCalls: string[] = []
    const payloadLoader: ChargerFichier = async (file) => {
      payloadCalls.push(file)
      if (file === 'territoires') return territoires
      throw new Error(`ordinary scalar page requested a static payload: ${file}`)
    }
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=22001&niveau=commune&epci=200067460')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: payloadLoader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    return { wrapper, payloadCalls }
  }

  it('acquires ordinary scalar facts through the semantic API with no read-model request', async () => {
    const { wrapper, payloadCalls } = await mountDensity()
    try {
      expect(wrapper.get('h1').text()).toBe('Densité de population')
      expect(wrapper.find('[data-testid="scalar-comparison-summary"]').exists()).toBe(true)
      expect(payloadCalls).toEqual(['territoires'])
      const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
      expect(requests.some((url) => url.includes('/data/modeles-lecture/')), requests.join(', ')).toBe(false)
      expect(requests).toContain('/api/resources/read-batch')
    } finally { wrapper.unmount() }
  })

  it('keeps the producer-owned scalar page independent of any committed manifest content', async () => {
    const { wrapper, payloadCalls } = await mountDensity()
    try {
      expect(wrapper.get('h1').text()).toBe('Densité de population')
      expect(payloadCalls).toEqual(['territoires'])
      const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
      expect(requests.some((url) => url.includes('/data/modeles-lecture/')), requests.join(', ')).toBe(false)
      expect(requests.some((url) => url.startsWith('/data/indicateurs_'))).toBe(false)
    } finally { wrapper.unmount() }
  })

  it('retries discovery before selecting a reader and then stays on the API path', async () => {
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources' && transport.mock.calls.filter(([url]) => String(url) === '/api/resources').length === 1) {
        return new Response('temporary catalogue outage', { status: 503 })
      }
      return defaultTransport(input, init)
    })
    vi.stubGlobal('fetch', transport)
    const payloadCalls: string[] = []
    const payloadLoader: ChargerFichier = async (file) => {
      payloadCalls.push(file)
      if (file === 'territoires') return territoires
      throw new Error(`ordinary scalar page requested a static payload: ${file}`)
    }
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=22001&niveau=commune&epci=200067460')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: payloadLoader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(wrapper.get('[role="alert"] button').text()).toContain('Réessayer')
      expect(payloadCalls).toEqual(['territoires'])
      const initialRequests = transport.mock.calls.map(([url]) => String(url))
      expect(initialRequests.some((url) => url.includes('/data/modeles-lecture/')), initialRequests.join(', ')).toBe(false)
      await wrapper.get('[role="alert"] button').trigger('click')
      await flushPromises()
      expect(wrapper.get('h1').text()).toBe('Densité de population')
      expect(payloadCalls).toEqual(['territoires'])
      expect(transport.mock.calls.map(([url]) => String(url)).filter((url) => url === '/api/resources')).toHaveLength(2)
      expect(transport.mock.calls.map(([url]) => String(url)).filter((url) => url === '/api/resources/read-batch')).toHaveLength(2)
      expect(transport.mock.calls.map(([url]) => String(url)).some((url) => url.includes('/data/modeles-lecture/'))).toBe(false)
    } finally { wrapper.unmount() }
  })
})

describe("Routes inconnues ou retirées — plus aucune requête au manifeste des modèles de lecture (#871)", () => {
  /** A stale static read model, as the retired browser runtime would accept it. */
  function modeleStatiquePerime(theme: 'demographie' | 'mobilite', indicator: string) {
    const sourceFacts = theme === 'demographie'
      ? indicateursDemographieFixture.filter((fact) => fact.key === 'densite' && fact.type !== 'region')
      : indicateursMobiliteFixture.filter((fact) => fact.type === 'commune').slice(0, 3)
    // The stale model must validate against the REAL published reference the
    // production store loads, so keep only facts whose territory exists there.
    const references = new Set((territoires as Array<{ territoire: string; type: string }>)
      .map((territory) => `${territory.type}\u0000${territory.territoire}`))
    return {
      schema_version: '1',
      snapshot_id: '2026-01-01',
      theme,
      indicator,
      theme_label: theme === 'demographie' ? 'Démographie' : 'Mobilité',
      page: {
        indicator,
        label: 'Indicateur statique périmé',
        definition: 'Une définition issue du modèle de lecture statique retiré.',
        unit: 'hab./km²',
        calculation: 'Le calcul du modèle de lecture statique retiré.',
        direction: 'high',
        caveats: 'Les réserves du modèle de lecture statique retiré.',
        levels: ['commune', 'epci', 'departement'],
        sources: [theme === 'demographie' ? 'serie_historique' : 'bpe'],
        read_model: true,
      },
      detail_labels: {},
      source_records: theme === 'demographie'
        ? metadonneesThemesFixtures.demographie.source_records
        : metadonneesThemesFixtures.mobilite.source_records,
      facts: sourceFacts
        .filter((fact) => references.has(`${fact.type}\u0000${fact.territoire}`))
        .map((fact) => ({ ...fact, key: indicator })),
    }
  }

  /**
   * The production bootstrap: NO injected payload charger, so the page's own
   * store fetches `territoires` through the transport like the deployed app.
   * The manifest and the per-indicator models are served on purpose: reaching
   * for them is exactly the residual behavior #871 retires.
   */
  function transportProduction(options: { manifeste?: () => Response; ressourcesRegionSeulement?: string[] } = {}) {
    const appels: string[] = []
    const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      appels.push(url)
      if (url === '/data/territoires.json') {
        return new Response(JSON.stringify(territoires), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === '/data/modeles-lecture/manifest.json') {
        return options.manifeste
          ? options.manifeste()
          : new Response(JSON.stringify({ schema_version: '1',
            routes: { demographie: ['inconnu_xyz'], mobilite: ['iso_alimentation'] } }),
          { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.startsWith('/data/modeles-lecture/indicateurs/')) {
        const [theme, indicator] = url
          .slice('/data/modeles-lecture/indicateurs/'.length)
          .replace(/\.json$/, '')
          .split('/')
        return new Response(JSON.stringify(modeleStatiquePerime(theme as 'demographie' | 'mobilite', indicator!)),
          { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (options.ressourcesRegionSeulement?.length && url === '/api/resources') {
        const base = await defaultTransport(input, init)
        const catalogue = await base.json() as { resources: Array<Record<string, unknown>> }
        for (const resource of catalogue.resources) {
          if (options.ressourcesRegionSeulement.includes(String(resource.resource_id))) {
            resource.allowed_levels = ['region']
          }
        }
        return new Response(JSON.stringify(catalogue), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return defaultTransport(input, init)
    }
    return { transport, appels }
  }

  async function monterSansInjection(chemin: string, transport: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    vi.stubGlobal('fetch', transport)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(chemin)
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    return { wrapper, router }
  }

  it("rend l'état inconnu sans jamais consulter le manifeste, même périmé, ni son modèle statique", async () => {
    const { transport, appels } = transportProduction()
    const { wrapper } = await monterSansInjection('/indicateurs/demographie/inconnu_xyz', transport)
    try {
      expect(wrapper.text()).toContain('Indicateur introuvable.')
      expect(wrapper.find('h1').exists()).toBe(false)
      expect(appels.some((url) => url.includes('/data/modeles-lecture/')), appels.join(', ')).toBe(false)
      expect(appels.some((url) => url === '/api/resources')).toBe(true)
    } finally { wrapper.unmount() }
  })

  it('ne transforme pas un manifeste défaillant en erreur de page pour une route inconnue', async () => {
    const { transport, appels } = transportProduction({ manifeste: () => new Response('', { status: 500 }) })
    const { wrapper } = await monterSansInjection('/indicateurs/demographie/inconnu_xyz', transport)
    try {
      expect(wrapper.text()).toContain('Indicateur introuvable.')
      expect(wrapper.text()).not.toContain('Impossible de charger l’indicateur')
      expect(appels.some((url) => url.includes('/data/modeles-lecture/')), appels.join(', ')).toBe(false)
    } finally { wrapper.unmount() }
  })

  it("garde une route retirée par le producteur dans l'état inconnu, sans requête au manifeste", async () => {
    const { transport, appels } = transportProduction()
    const { wrapper } = await monterSansInjection('/indicateurs/mobilite/iso_alimentation', transport)
    try {
      expect(wrapper.text()).toContain('Indicateur introuvable.')
      expect(wrapper.find('h1').exists()).toBe(false)
      expect(appels.some((url) => url.includes('/data/modeles-lecture/')), appels.join(', ')).toBe(false)
      expect(appels.some((url) => url === '/api/resources')).toBe(true)
    } finally { wrapper.unmount() }
  })

  it('une panne de découverte reste une erreur relançable, jamais un état inconnu ou un repli statique', async () => {
    let appelsDiscovery = 0
    const { transport, appels } = transportProduction()
    const transportPanne = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources') {
        appelsDiscovery += 1
        if (appelsDiscovery === 1) return new Response('temporary catalogue outage', { status: 503 })
      }
      return transport(input, init)
    }
    const { wrapper } = await monterSansInjection('/indicateurs/demographie/inconnu_xyz', transportPanne)
    try {
      expect(wrapper.find('[role="alert"]').text()).toContain('Impossible de charger l’indicateur')
      expect(wrapper.get('[role="alert"] button').text()).toContain('Réessayer')
      expect(wrapper.text()).not.toContain('Indicateur introuvable.')
      await wrapper.get('[role="alert"] button').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Indicateur introuvable.')
      expect(appels.some((url) => url.includes('/data/modeles-lecture/')), appels.join(', ')).toBe(false)
    } finally { wrapper.unmount() }
  })

  it('VITE_SCALAR_COHORT_API ne sélectionne plus un second runtime numérique sur la page d’indicateur', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    const { transport, appels } = transportProduction({
      ressourcesRegionSeulement: ['taille_menages'] })
    // D'abord la page scalaire ordinaire, qui charge et valide son lecteur natif.
    const { wrapper, router } = await monterSansInjection('/indicateurs/demographie/densite?territoire=22001&niveau=commune&epci=200067460', transport)
    try {
      expect(wrapper.get('h1').text()).toBe('Densité de population')
      // Puis une route enregistrée dont la publication producteur ne rejoint
      // plus aucun niveau de la page : la grammaire de page refuse la page
      // scalaire ordinaire, et aucun lecteur de cohorte réservé à l'ancien
      // drapeau ne peut se substituer à ce refus.
      const appelsAvantNavigation = appels.length
      await router.push('/indicateurs/demographie/taille_menages?territoire=22001&niveau=commune&epci=200067460')
      await flushPromises()
      expect(wrapper.text()).toContain('Indicateur introuvable.')
      expect(wrapper.find('h1').exists()).toBe(false)
      const appelsApresNavigation = appels.slice(appelsAvantNavigation)
      expect(appelsApresNavigation.some((url) => url === '/api/resources/read-batch'), appelsApresNavigation.join(', ')).toBe(false)
      expect(appelsApresNavigation.some((url) => url.includes('/data/modeles-lecture/')), appelsApresNavigation.join(', ')).toBe(false)
    } finally { wrapper.unmount() }
  })
})

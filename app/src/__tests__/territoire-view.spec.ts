import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TerritoireView from '../views/TerritoireView.vue'
import { varianteDeUrl } from '../fiche/prototype/variantes'
import {
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '../payload/fixtures'
import type { Histoire, Indicateur, Theme } from '../payload/types'
import {
  chargerModeleTerritoire,
  TERRITORY_READ_MODEL_CHARGER_KEY,
  validerModeleTerritoire,
} from '../payload/territoryReadModel'
import type { ChargerModeleTerritoire } from '../payload/territoryReadModel'
import { PayloadError } from '../payload/validate'
import { payloadDepuisModeleTerritoire } from '../payload/territoryReadModel'
import { territoryFactsFor } from '../fiche/content/territoryFacts'
import { routes } from '../router'

const indicateurs: Indicateur[] = [
  ...indicateursProgrammesFixture,
  ...indicateursDemographieFixture,
  ...indicateursHabitatFixture,
]
const histoires: Histoire[] = [...histoiresDemographieFixture, ...histoiresHabitatFixture]

const modelePublie22001 = JSON.parse(readFileSync(
  resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/22001.json'),
  'utf8',
)) as Record<string, any>

function modeleAvecContextesComparaison() {
  const model = structuredClone(modelePublie22001)
  return validerModeleTerritoire(
    model,
    'territoires/commune/22001.json',
    { type: 'commune', territoire: '22001' },
  )
}

function reponseAccesApi(type: string, code: string, kind: string | null, label?: string) {
  return {
    publication_id: 'api-access-v1',
    territory: { id: code, name: 'Territoire', type },
    scope: kind ? { kind, label, member_count: 38 } : null,
    services: ['admin', 'food', 'health', 'bank', 'school'].map((id) => ({
      id,
      modes: Object.fromEntries(['car', 'bike', 'walk_transit'].map((mode) => [mode, {
        value: mode === 'walk_transit' ? 0.42 : 0.8,
        median: kind ? 0.3 : null,
        rank: kind ? { position: 19, size: 38 } : null,
        direction: 'high', indicator_label: `${id}-${mode}`,
        source_id: 'mobilite_snapshot', source_name: 'Source API', source_version: 'api-v1',
        reference_date: null, source_publication_date: null,
      }])),
      peer_median_car_gap: kind ? 0.3 : null,
      peer_median_bike_gain: kind ? 0.2 : null,
    })),
  }
}

function modelFor(territoire: string) {
  const target = territoiresFixture.find((candidate) => candidate.territoire === territoire)!
  const themes = Object.fromEntries(
    (['programmes', 'demographie', 'habitat'] as Theme[]).map((theme) => [theme, {
      theme,
      indicateurs: indicateurs.filter((row) => row.theme === theme),
      histoires: histoires.filter((row) => row.theme === theme),
      theme_metadata: metadonneesThemesFixtures[theme],
      profils_acces_bpe: null,
      distribution_acces_batiments: null,
      rampe_acces_batiments: null,
    }]),
  )
  return validerModeleTerritoire({
    schema_version: '1',
    snapshot_id: '2026-09-15',
    territory: target,
    territoires: territoiresFixture,
    themes,
  }, `territoires/${target.type}/${territoire}.json`, {
    type: target.type,
    territoire,
  })
}

async function monter(
  chemin: string,
  charger: ChargerModeleTerritoire = vi.fn(async (_type, territoire) => modelFor(territoire)),
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(TerritoireView, {
    global: {
      plugins: [router],
      provide: { [TERRITORY_READ_MODEL_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return { router, wrapper, charger }
}

describe('TerritoireView — modèle atomique par territoire', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('API not configured in tests'))))
  afterEach(() => vi.unstubAllGlobals())
  it('keeps the building figures without exposing an interactive peer selector', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E',
      vi.fn(async () => modeleAvecContextesComparaison()))
    await flushPromises()
    expect(wrapper.find('#building-peer-search').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Choisir les territoires du groupe comparé')
    wrapper.unmount()
  })
  it('requests initial building figures and never displays static JSON figures when the API fails', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const fetchApi = vi.fn().mockRejectedValue(new Error('API indisponible'))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E',
      vi.fn(async () => modeleAvecContextesComparaison()))
    await flushPromises()
    expect(fetchApi.mock.calls.some(([url]) => String(url) ===
      '/api/territories/commune/22001/building-access?comparison=densite')).toBe(true)
    const section = wrapper.get('[data-section="distribution-acces-par-batiment"]')
    expect(section.find('.access-ramp-evidence').exists()).toBe(false)
    expect(section.find('.bivariate-evidence').exists()).toBe(false)
    expect(section.get('[role="alert"]').text()).toContain('Impossible de charger')
    await section.get('button').trigger('click')
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).includes('/building-access?'))).toHaveLength(2)
    wrapper.unmount()
  })
  it('renders both initial building figures from the API with the default mean label', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const model = modeleAvecContextesComparaison()
    const context = model.themes.mobilite!.comparisons.densite!
    const initial = territoryFactsFor(payloadDepuisModeleTerritoire(model), '22001', context)!
    const ramp = initial.mobility.accessRamp!
    const grid = initial.mobility.buildingDistribution!
    const displayModes = { c: 'car', b: 'bike', t: 'walkTransit' } as const
    const figure = {
      publication_id: 'building-v1', availability: 'complete', territory: { id: '22001', type: 'commune' },
      scope: { comparison_mode: 'densite', kind: context.scope.kind, label: context.scope.label },
      ramp: (['c', 'b', 't'] as const).flatMap((mode) =>
        ramp.curves[displayModes[mode]].points.map((p, quantile_index) => ({
          mode, quantile_index, quantile: quantile_index / 10, accessible_types: p.accessibleTypes + 1,
          total_buildings: ramp.totalBuildings,
        }))),
      peer_ramp: { statistic: 'mean', member_count: 2, total_buildings: grid.totalBuildings,
        points: (['c', 'b', 't'] as const).flatMap((mode) =>
          ramp.curves[displayModes[mode]].points.map((p, index) => ({
            mode, quantile: index / 10, accessible_types: p.accessibleTypes + 2,
          }))) },
      distribution: grid.cells.map((cell) => ({ breadth_bucket: cell.breadthBucket,
        depth_bucket: cell.depthBucket, building_count: cell.buildingCount,
        total_buildings: grid.totalBuildings })),
      peer_distribution: { statistic: 'mean', member_count: 2, total_buildings: grid.totalBuildings,
        cells: grid.cells.map((cell) => ({ breadth_bucket: cell.breadthBucket,
          depth_bucket: cell.depthBucket, building_count: cell.buildingCount,
          share: cell.buildingCount / grid.totalBuildings })) },
    }
    const fetchApi = vi.fn(async (url: string) => ({ ok: true, json: async () =>
      url.includes('/building-access?') ? figure : reponseAccesApi('commune', '22001', context.scope.kind, context.scope.label),
    }))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E', vi.fn(async () => model))
    await flushPromises()
    const section = wrapper.get('[data-section="distribution-acces-par-batiment"]')
    expect(section.find('.access-ramp-evidence').exists()).toBe(true)
    expect(section.find('.bivariate-evidence').exists()).toBe(true)
    expect(section.text()).toContain('moyenne des')
    expect(section.text()).not.toContain('territoires sélectionnés')
    wrapper.unmount()
  })
  it.each([
    ['epci', '242200715'], ['departement', '22'], ['region', '53'],
  ] as const)('requests initial %s building figures without a static fallback', async (type, code) => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      `../public/data/modeles-lecture/territoires/${type}/${code}.json`), 'utf8'))
    const model = validerModeleTerritoire(published, `${type}/${code}.json`, { type, territoire: code })
    const fetchApi = vi.fn().mockRejectedValue(new Error('API indisponible'))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter(`/territoire/${type}/${code}?theme=mobilite&variant=E`, vi.fn(async () => model))
    expect(fetchApi.mock.calls.some(([url]) => String(url) ===
      `/api/territories/${type}/${code}/building-access`)).toBe(true)
    const section = wrapper.get('[data-section="distribution-acces-par-batiment"]')
    expect(section.find('.access-ramp-evidence').exists()).toBe(false)
    expect(section.find('.bivariate-evidence').exists()).toBe(false)
    expect(section.get('[role="alert"]').text()).toContain('Impossible de charger')
    wrapper.unmount()
  })
  it('alimente les anneaux Variant E depuis l’API sans changer les autres sections', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const scope = modeleAvecContextesComparaison().themes.mobilite!.comparisons.densite!.scope
    const fetchApi = vi.fn(async () => ({ ok: true, json: async () => reponseAccesApi('commune', '22001', scope.kind, scope.label) }))
    vi.stubGlobal('fetch', fetchApi)
    try {
      const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E',
        vi.fn(async () => modeleAvecContextesComparaison()))
      await flushPromises()
      expect(fetchApi).toHaveBeenCalledWith('/api/territories/commune/22001/essential-services?comparison=densite', expect.anything())
      expect(wrapper.findAll('[data-section="services-essentiels"] .access-foot-summary')[0]?.text()).toContain('42')
      expect(wrapper.get('[data-section="services-essentiels"] .cahier-comparison-note').text()).toContain(scope.label)
      expect(wrapper.text()).toContain('Source API · api-v1')
      expect(wrapper.find('[data-section="resume"]').exists()).toBe(true)
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('n’affiche jamais les anneaux statiques si l’API échoue, et réessaie', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const scope = modeleAvecContextesComparaison().themes.mobilite!.comparisons.epci!.scope
    let accessCalls = 0
    const fetchApi = vi.fn((_url: string) => ++accessCalls === 1
        ? Promise.reject(new Error('API indisponible'))
        : Promise.resolve({ ok: true, json: async () => reponseAccesApi('commune', '22001', scope.kind, scope.label) }))
    vi.stubGlobal('fetch', fetchApi)
    try {
      const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E&comparaison=epci',
        vi.fn(async () => modeleAvecContextesComparaison()))
      await flushPromises()
      const section = wrapper.get('[data-section="services-essentiels"]')
      expect(section.findAll('.access-figure')).toHaveLength(0)
      expect(section.get('[role="alert"]').text()).toContain('Impossible de charger')
      await section.get('button').trigger('click')
      await flushPromises()
      expect(section.findAll('.access-figure')).toHaveLength(5)
      expect(fetchApi.mock.calls.filter(([url]) => String(url).includes('/essential-services'))).toHaveLength(2)
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders registered scalar API values in the mounted fiche instead of the static model value', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const registered = Object.keys(metadata.scalar_contracts) as string[]
    const referenceTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    const peer = referenceTerritories.find((territory: any) => territory.type === 'commune' &&
      territory.epci === published.territory.epci && territory.territoire !== published.territory.territoire)
    expect(published.themes.mobilite.theme_metadata.scalar_contracts).toBeUndefined()
    const pending: Array<() => void> = []
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/modeles-lecture/territoires/commune/22001.json') return new Response(JSON.stringify(published), { status: 200 })
      if (url === '/data/territoires.json') return new Response(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'), { status: 200 })
      if (url.startsWith('/data/theme_') && url.endsWith('.json')) {
        const themeMetadata = url === '/data/theme_mobilite.json' ? metadata : JSON.parse(readFileSync(
          resolve(process.cwd(), `../public/data/${url.slice('/data/'.length)}`), 'utf8'))
        return new Response(JSON.stringify(themeMetadata), { status: 200 })
      }
      if (url.startsWith('/api/territories/commune/22001/indicator-cohorts/')) {
        const indicator = url.split('/').at(-1)!.split('?')[0]!
        const page = published.themes.mobilite.theme_metadata.indicator_pages[indicator]
        const response = new Response(JSON.stringify({ indicator_id: indicator, territory_type: 'commune',
          label: page.label, unit: page.unit, direction: page.direction,
          comparison_facet: page.comparison?.indicator ?? indicator, completeness: 'sparse', content_version: 'fiche-v1',
          observations: [{ territory_id: '22001', name: published.territory.nom, value: 987654321, status: 'measured',
            rang_epci: 1, rang_epci_n: 38, rang_dep: 1, rang_dep_n: 50, rang_reg: 1, rang_reg_n: 100,
            sources: [{ source_id: page.sources[0], name: 'Source API fiche', vintage_id: 'api-v1', version: '2026',
              reference_date: null, publication_date: null }] },
          { territory_id: peer.territoire, name: peer.nom, value: 123, status: 'measured',
            rang_epci: 2, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
            sources: [{ source_id: page.sources[0], name: 'Source API fiche', vintage_id: 'api-v1', version: '2026',
              reference_date: null, publication_date: null }] }] }), { status: 200 })
        return new Promise<Response>((resolve) => pending.push(() => resolve(response)))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=A&comparaison=epci', chargerModeleTerritoire)
    expect(pending).toHaveLength(registered.length)
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('987 654 321')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('0,92')
    pending.forEach((resolve) => resolve())
    await flushPromises()
    const text = wrapper.get('[role="tabpanel"]').text()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).includes('/indicator-cohorts/'))).toHaveLength(registered.length)
    expect(fetchApi).toHaveBeenCalledWith('/data/theme_mobilite.json')
    const cohortUrls = fetchApi.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'))
      .filter((url) => url.pathname.includes('/indicator-cohorts/'))
    expect(cohortUrls.every((url) => url.searchParams.get('epci_id') === published.territory.epci &&
      !url.searchParams.has('department_id'))).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(text).toContain('987')
    expect(text).toContain('98 765 432')
    expect(text).not.toContain('0,92')
    wrapper.unmount()
  })

  it('keeps the incumbent fiche path when registration is absent or the cutover flag is off', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const requests = vi.fn().mockRejectedValue(new Error('scalar API must stay off'))
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', requests)
    const { wrapper: unregistered } = await monter('/territoire/commune/29002?theme=demographie')
    expect(unregistered.text()).toContain('Densité de population')
    expect(requests.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    unregistered.unmount()

    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.mobilite.theme_metadata.scalar_contracts = metadata.scalar_contracts
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '0')
    const { wrapper: disabled } = await monter('/territoire/commune/22001?theme=mobilite&variant=A', vi.fn(async () => model))
    expect(requests.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    expect(disabled.text()).toContain('0,92')
    disabled.unmount()
  })

  it('keeps unregistered facts when a valid registration has no eligible pages at this level', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.mobilite.theme_metadata.scalar_contracts = Object.fromEntries(
      Object.keys(metadata.scalar_contracts).map((key) => [key, { allowed_levels: ['epci'] }]),
    )
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    const fetchApi = vi.fn()
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=A', vi.fn(async () => model))
    expect(fetchApi).not.toHaveBeenCalled()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('0,92')
    wrapper.unmount()
  })

  it('reloads scalar facts when comparison scope changes and ignores the previous response', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.mobilite.theme_metadata.scalar_contracts = metadata.scalar_contracts
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    const oldResponses: Array<() => void> = []
    const newResponses: Array<() => void> = []
    const fetchApi = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const indicator = url.pathname.split('/').at(-1)!
      const page = metadata.indicator_pages[indicator]
      const value = url.searchParams.has('epci_id') ? 111111111 : 222222222
      const response = new Response(JSON.stringify({ indicator_id: indicator, territory_type: 'commune',
        label: page.label, unit: page.unit, direction: page.direction,
        comparison_facet: page.comparison?.indicator ?? indicator, completeness: 'sparse',
        content_version: url.searchParams.has('epci_id') ? 'epci-v1' : 'bretagne-v1',
        territory_reference_version: 'territories-v1',
        observations: [{ territory_id: '22001', name: published.territory.nom, value, status: 'measured',
          rang_epci: 1, rang_epci_n: 38, rang_dep: 1, rang_dep_n: 50, rang_reg: 1, rang_reg_n: 100,
          sources: [{ source_id: page.sources[0], name: 'Source API fiche', vintage_id: 'api-v1', version: '2026',
            reference_date: null, publication_date: null }] }] }), { status: 200 })
      return new Promise<Response>((resolve) => (url.searchParams.has('epci_id') ? oldResponses : newResponses).push(() => resolve(response)))
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=A&comparaison=epci', vi.fn(async () => model))
    expect(oldResponses).toHaveLength(Object.keys(metadata.scalar_contracts).length)
    await router.push('/territoire/commune/22001?theme=mobilite&variant=A&comparaison=bretagne')
    await flushPromises()
    expect(newResponses).toHaveLength(Object.keys(metadata.scalar_contracts).length)
    expect(new URL(String(fetchApi.mock.calls.at(-1)![0]), 'http://localhost').searchParams.has('epci_id')).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('111 111 111')
    newResponses.forEach((resolve) => resolve())
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('222 222 222')
    oldResponses.forEach((resolve) => resolve())
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('222 222 222')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('111 111 111')
    wrapper.unmount()
  })

  it('renders a retryable error for malformed registration and recovers without showing static facts', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.mobilite.theme_metadata.scalar_contracts = { avg_tot_t: { allowed_levels: 'commune' } }
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const indicator = String(input).split('/').at(-1)!.split('?')[0]!
      const page = metadata.indicator_pages[indicator]
      return new Response(JSON.stringify({ indicator_id: indicator, territory_type: 'commune', label: page.label,
        unit: page.unit, direction: page.direction, comparison_facet: page.comparison?.indicator ?? indicator,
        completeness: 'sparse', content_version: 'retry-v1', territory_reference_version: 'territories-v1',
        observations: [{ territory_id: '22001', name: published.territory.nom, value: 987654321, status: 'measured',
          rang_epci: 1, rang_epci_n: 38, rang_dep: 1, rang_dep_n: 50, rang_reg: 1, rang_reg_n: 100,
          sources: [{ source_id: page.sources[0], name: 'Source API fiche', vintage_id: 'api-v1', version: '2026',
            reference_date: null, publication_date: null }] }] }), { status: 200 })
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=A', vi.fn(async () => model))
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toContain('pas disponibles')
    expect(wrapper.text()).not.toContain('0,92')
    expect(fetchApi).not.toHaveBeenCalled()

    model.themes.mobilite!.metadata.scalar_contracts = metadata.scalar_contracts
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(fetchApi).toHaveBeenCalled()
    expect(wrapper.text()).toContain('987 654 321')
    expect(wrapper.text()).not.toContain('0,92')
    wrapper.unmount()
  })

  it.each([
    ['epci', '242200715', 'epcis-bretagne'],
    ['departement', '22', 'departements-bretagne'],
    ['region', '53', null],
  ] as const)('branche les parts API de %s sans nouveau sélecteur', async (type, code, kind) => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const published = JSON.parse(readFileSync(resolve(process.cwd(), `../public/data/modeles-lecture/territoires/${type}/${code}.json`), 'utf8'))
    const model = validerModeleTerritoire(published, `${type}/${code}.json`, { type, territoire: code })
    const label = model.themes.mobilite?.comparisons.bretagne?.scope.label
    const fetchApi = vi.fn(async (_url: string) => ({ ok: true, json: async () => reponseAccesApi(type, code, kind, label) }))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter(`/territoire/${type}/${code}?theme=mobilite&variant=E`, vi.fn(async () => model))
    await flushPromises()
    expect(fetchApi.mock.calls.some(([url]) => String(url) === `/api/territories/${type}/${code}/essential-services`)).toBe(true)
    expect(wrapper.findAll('[data-section="services-essentiels"] .access-figure')).toHaveLength(5)
    expect(wrapper.findAll('[data-section="services-essentiels"] .access-foot-summary')[0]?.text()).toContain('42')
    wrapper.unmount()
  })

  it('ignore une réponse API périmée après changement du contexte de comparaison', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const contexts = modeleAvecContextesComparaison().themes.mobilite!.comparisons
    let resolveOld: ((value: unknown) => void) | undefined
    const oldRequest = new Promise((resolve) => { resolveOld = resolve })
    const fetchApi = vi.fn((url: string) => url.includes('/api/')
      ? url.includes('comparison=densite')
        ? oldRequest
        : Promise.resolve({ ok: true, json: async () => reponseAccesApi('commune', '22001', contexts.epci!.scope.kind, contexts.epci!.scope.label) })
      : Promise.reject(new Error('Not part of access API')))
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E',
      vi.fn(async () => modeleAvecContextesComparaison()))
    await router.replace({ query: { theme: 'mobilite', variant: 'E', comparaison: 'epci' } })
    await flushPromises()
    const section = wrapper.get('[data-section="services-essentiels"]')
    expect(section.findAll('.access-figure')).toHaveLength(5)
    expect(section.findAll('.access-foot-summary')[0]?.text()).toContain('42')
    expect(section.get('.cahier-comparison-note').text()).toContain(contexts.epci!.scope.label)
    const stale = reponseAccesApi('commune', '22001', contexts.densite!.scope.kind, contexts.densite!.scope.label)
    stale.services[0]!.modes.walk_transit.value = 0.05
    resolveOld?.({ ok: true, json: async () => stale })
    await flushPromises()
    expect(section.findAll('.access-foot-summary')[0]?.text()).toContain('42')
    wrapper.unmount()
  })
  it('affiche les six onglets pendant que l’unique modèle charge', async () => {
    const charger = vi.fn(() => new Promise<never>(() => {}))
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    expect(wrapper.find('.squelette').exists()).toBe(true)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('rend l’identité et le contexte depuis la même réponse', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')

    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(wrapper.find('.puce-type').text()).toBe('Commune')
    expect(wrapper.find('.fiche-actions .contexte-switcher').exists()).toBe(true)
    const breadcrumb = wrapper.find('.fil-ariane')
    expect(breadcrumb.text()).toContain('Accueil')
    expect(breadcrumb.text()).toContain('Les communes')
    expect(breadcrumb.find('a[href="/"]').exists()).toBe(true)
    expect(breadcrumb.find('a[href="/communes"]').exists()).toBe(true)
    expect(wrapper.find('.contexte-switcher').text()).toContain('EPCI Y')
    expect(wrapper.find('.contexte-switcher').text()).toContain('Département 29')
    expect(wrapper.find('.contexte-switcher').text()).toContain('Bretagne')
  })

  it('présente toujours les six thèmes dans l’ordre produit', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text().trim())).toEqual([
      'Programmes et subventions',
      'Mobilité',
      'Démographie',
      'Habitat',
      'Économie',
      'Milieux',
    ])
  })

  it('ouvre Programmes et subventions par défaut', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-programmes')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et contrats')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Aucun programme référencé.')
  })

  it('sélectionne un thème depuis l’URL sans nouvelle requête', async () => {
    const charger = vi.fn<ChargerModeleTerritoire>(async (_type, territoire) => modelFor(territoire))
    const { wrapper } = await monter('/territoire/commune/29002?theme=demographie', charger)
    expect(wrapper.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-demographie')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Densité de population')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain(
      'la population de Commune C se vide et se meurt : -1,04 par an (naturel)',
    )
    expect(wrapper.find('.fiche').classes()).toContain('fiche--theme-demographie')
    expect(wrapper.find('.filigrane-fiche').attributes('style')).toContain(
      '--filigrane-accent: var(--theme-demographie-line)',
    )
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('change d’onglet sans recharger le modèle', async () => {
    const charger = vi.fn<ChargerModeleTerritoire>(async (_type, territoire) => modelFor(territoire))
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('normalise un thème inconnu vers le défaut', async () => {
    const { wrapper, router } = await monter('/territoire/commune/29002?theme=bidule')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
  })

  it('canonicalise un mode de comparaison inconnu sans perdre le thème ni la variante', async () => {
    const { router } = await monter(
      '/territoire/commune/29002?theme=mobilite&comparaison=inconnu&variant=E',
    )
    expect(router.currentRoute.value.query).toEqual({ theme: 'mobilite', variant: 'E' })
  })

  it.each(['densite', 'epci', 'bretagne'] as const)(
    'applique le contexte %s à la fiche rendue', async (mode) => {
    const label = modeleAvecContextesComparaison().themes.mobilite?.comparisons[mode]?.scope.label
    const varianteE = varianteDeUrl('E')
    expect(varianteE?.clef).toBe('E')
    await (varianteE?.composant as any).__asyncLoader?.()
    const charger = vi.fn(async () => modeleAvecContextesComparaison())
    const { router, wrapper } = await monter(
      `/territoire/commune/22001?theme=mobilite&variant=E&comparaison=${mode}`,
      charger,
    )

    expect(router.currentRoute.value.query.comparaison).toBe(mode)
    await flushPromises()
    expect(wrapper.find('.cahier-comparison-note').text()).toContain(label)
    wrapper.unmount()
  })

  it('expose le contexte sélectionné comme une divulgation synchronisable', async () => {
    const charger = vi.fn(async () => modeleAvecContextesComparaison())
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&variant=E&comparaison=densite',
      charger,
    )

    const selector = wrapper.get('.cahier-comparison-note')
    const trigger = selector.get('button[aria-haspopup="listbox"]')

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-current')).toBe('true')
    const contexts = modeleAvecContextesComparaison().themes.mobilite!.comparisons
    expect(trigger.text()).toContain(contexts.densite!.scope.label)
    expect(selector.get('.cahier-comparison-note__scope').text()).toBe(contexts.densite!.scope.label)
    expect(selector.get('.cahier-comparison-note__arrow').text()).toBe('←')
    expect(selector.get('.cahier-comparison-note__arrow').classes()).not.toContain('is-open')

    await trigger.trigger('click')

    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(selector.get('.cahier-comparison-note__arrow').classes()).toContain('is-open')
    const options = selector.findAll('[role="option"][aria-selected="false"]')
    expect(options.map((option) => option.text())).toEqual([
      contexts.epci!.scope.label,
      contexts.bretagne!.scope.label,
    ])
    expect(options[0]!.attributes('title')).toBeUndefined()

    await selector
      .get('[role="option"][aria-selected="false"]')
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.comparaison).toBe('epci')
    expect(wrapper.get('.cahier-comparison-note button').text()).toContain(
      contexts.epci!.scope.label,
    )
    const comparisonNotes = wrapper.findAll('.cahier-comparison-note')
    // Without a building API response, its two notes must not leak from JSON.
    expect(comparisonNotes).toHaveLength(5)
    expect(comparisonNotes.every((note) => note.find('button[aria-haspopup="listbox"]').exists())).toBe(true)
    wrapper.unmount()
  })

  it('ne branche pas le sélecteur de comparaison sur la variante D', async () => {
    const varianteD = varianteDeUrl('D')
    expect(varianteD?.clef).toBe('D')
    await (varianteD?.composant as any).__asyncLoader?.()
    const charger = vi.fn(async () => modeleAvecContextesComparaison())
    const { wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&variant=D&comparaison=epci',
      charger,
    )

    await flushPromises()
    const comparisonNotes = wrapper.findAll('.cahier-comparison-note')
    expect(comparisonNotes.length).toBeGreaterThan(0)
    expect(comparisonNotes.every((note) => !note.find('button[aria-haspopup="listbox"]').exists())).toBe(true)
    wrapper.unmount()
  })

  it('permet de changer de contexte au clavier et expose l’aide de la densité', async () => {
    const charger = vi.fn(async () => modeleAvecContextesComparaison())
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&variant=E&comparaison=epci',
      charger,
    )

    const selector = wrapper.get('.cahier-comparison-note')
    const trigger = selector.get('button[aria-haspopup="listbox"]')
    await trigger.trigger('keydown', { key: 'Enter' })

    expect(trigger.attributes('aria-expanded')).toBe('true')
    const densityLabel = modeleAvecContextesComparaison().themes.mobilite!.comparisons.densite!.scope.label
    const density = selector.findAll('[role="option"][aria-selected="false"]').find((option) => option.find('.cahier-comparison-note__option-label').text() === densityLabel)
    expect(density).toBeDefined()
    expect(density!.attributes('title')).toBe(
      'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
    )
    const descriptionId = density!.attributes('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(selector.get(`#${descriptionId}`).text()).toContain('Classe définie par l’Insee')

    await density!.trigger('focus')
    await density!.trigger('keydown', { key: 'Escape' })
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('keydown', { key: 'Enter' })
    const reopenedDensity = selector.findAll('[role="option"][aria-selected="false"]').find((option) => option.find('.cahier-comparison-note__option-label').text() === densityLabel)
    expect(reopenedDensity).toBeDefined()
    await reopenedDensity!.trigger('focus')
    await reopenedDensity!.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(router.currentRoute.value.query.comparaison).toBeUndefined()
    wrapper.unmount()
  })

  it('affiche l’erreur typée et réessaie le même endpoint', async () => {
    const charger = vi
      .fn()
      .mockRejectedValueOnce(new PayloadError('fetch', 'territoires/commune/29002.json', 'panne'))
      .mockResolvedValueOnce(modelFor('29002'))
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.find('.etat-erreur').exists()).toBe(true)
    expect(wrapper.text()).toContain('Impossible de charger les données')
    expect(wrapper.text()).not.toContain('territoires/commune/29002.json')
    expect(wrapper.text()).not.toContain('panne')
    await wrapper.get('.bouton-reessayer').trigger('click')
    await flushPromises()
    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(charger).toHaveBeenCalledTimes(2)
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { ThemeMetadata } from '@/payload/types'
import {
  acquireThemeComparison,
  acquireThemeFacts,
  ThemeAcquisitionCache,
} from '@/payload/themeAcquisition'
import {
  histoiresMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { routes } from '@/router'
import {
  nativeCatalogueResponse,
  nativeReadFixture,
  nativeResources,
} from './helpers/semanticApiFixtures'
import liveNetworks from './fixtures/rennes-network-live.json'

const publicMetadata = JSON.parse(readFileSync(
  join(process.cwd(), '..', 'public', 'data', 'theme_mobilite.json'), 'utf8',
)) as ThemeMetadata

const payload: Payload = {
  territoires: territoiresFixture.some((territory) => territory.territoire === '35238')
    ? territoiresFixture
    : [...territoiresFixture, { territoire: '35238', type: 'commune', nom: 'Rennes', departement: '35', epci: null }],
  indicateurs: [],
  histoires: histoiresMobiliteFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

const catalogue = nativeResources('mobilite')

const UNPUBLISHED_SCALARS = ['bornes_recharge_1000', 'stations_service', 'stations_service_1000'] as const
const UNPUBLISHED = new Set<string>(UNPUBLISHED_SCALARS)
const PUBLISHED_VALUES: Readonly<Record<string, number>> = {
  bornes_recharge_1000: 0.82,
  stations_service: 41,
  stations_service_1000: 0.03,
}

const NETWORK_CAPTURE: Readonly<Record<string, Readonly<Record<string, number | string>>>> = {
  reseaux_par_habitant: liveNetworks.reseauxParHabitant,
  reseaux: liveNetworks.reseaux,
  offre_cyclable: liveNetworks.offreCyclable,
}

function applyCoherentNetworkCapture(item: Record<string, any>, data: Record<string, any>) {
  const values = NETWORK_CAPTURE[item.resource]
  if (!values || !Array.isArray(data.observations)) return data
  for (const observation of data.observations) {
    const value = values[observation.detail]
    if (typeof value === 'number') observation.value = value
  }
  return data
}

function applyPublishedScalar(item: Record<string, any>, data: Record<string, any>, published: boolean) {
  if (!published || item.intent?.kind !== 'facts') return data
  const value = PUBLISHED_VALUES[item.resource]
  if (value === undefined) return data
  data.value = value
  data.status = 'measured'
  data.sources = []
  return data
}

function publicationAwareFetch(state: { published: boolean }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url !== '/api/resources/read-batch') {
      return new Response('not available in this fixture', { status: 404 })
    }
    const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
    const results = items.map((item) => {
      const resource = catalogue.find((candidate) => candidate.resource_id === item.resource)
      if (!resource) throw new Error(`Unknown fixture resource ${item.resource}`)
      if (!state.published && UNPUBLISHED.has(item.resource)) {
        return { id: item.id, resource: item.resource, status: 'publication_unavailable',
          reason: 'publication_absent', family: 'scalar' }
      }
      const data = applyPublishedScalar(item, applyCoherentNetworkCapture(item, nativeReadFixture(item, resource)), state.published)
      return { id: item.id, resource: item.resource, status: 'available', data }
    })
    return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results }), { status: 200 })
  })
}

function pageTwoContent(acquired: Awaited<ReturnType<typeof acquireThemeFacts>>): ThemeContent {
  const facts = mobilityFactsFromThemeApi(payload, '35238', acquired)
  return resolveMobiliteThemeContent(facts, publicMetadata)
}

async function mountPageTwo(content: ThemeContent) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(VarianteCahierLibre, {
    props: {
      content,
      pagination: cahierPaginationFor(payload, content, true),
      presentation: 'plain',
      layoutVariant: 'indexed-sections',
      showAllUnits: true,
      nativeComparisonStatus: 'ready',
    },
    global: { plugins: [router] },
  })
  await router.isReady()
  await flushPromises()
  return wrapper
}

afterEach(() => vi.unstubAllGlobals())

describe('Mobilité partial publication availability', () => {
  it('keeps the published figures while the three unpublished scalars stay honestly unavailable', async () => {
    vi.stubGlobal('fetch', publicationAwareFetch({ published: false }))
    const acquired = await acquireThemeFacts('commune', '35238', 'mobilite')

    expect(acquired.comparison_error).not.toBe(true)
    expect([...new Set(acquired.resource_failures?.map((failure) => failure.resource))].sort())
      .toEqual([...UNPUBLISHED_SCALARS].sort())
    expect(acquired.resource_failures?.filter((failure) => failure.stage === 'facts').map((failure) => failure.resource).sort())
      .toEqual([...UNPUBLISHED_SCALARS].sort())
    expect(acquired.resource_reads?.map((read) => read.resource)).toEqual(expect.arrayContaining([
      'reseaux_par_habitant', 'reseaux', 'offre_cyclable',
      'places_stationnement_velo_1000', 'places_stationnement_voiture_1000',
      'stationnement_velo_par_voiture', 'bornes_recharge', 'bornes_ev_par_station_service',
    ]))

    const content = pageTwoContent(acquired)
    const sharing = content.units.find((unit) => unit.key === 'partage-de-lespace-public')!
    const networks = sharing.sections.find((section) => section.key === 'reseaux')!
    if (networks.evidence?.kind !== 'mobilite-networks') throw new Error('Network evidence expected')
    expect(networks.evidence.figure.categories.map((category) => category.value.fact.value))
      .toEqual([
        expect.closeTo(liveNetworks.reseauxParHabitant.t_km_1000, 9),
        expect.closeTo(liveNetworks.reseauxParHabitant.b_km_1000, 9),
        expect.closeTo(liveNetworks.reseauxParHabitant.c_km_1000, 9),
      ])

    const paired = sharing.sections.find((section) => section.key === 'stationnement-ravitaillement')!
    if (paired.evidence?.kind !== 'mobilite-stationnement-ravitaillement') {
      throw new Error('Paired evidence expected')
    }
    const [parking, refuelling] = paired.evidence.columns
    expect(parking.bars.categories.map((category) => category.value.fact.value))
      .toEqual([expect.any(Number), expect.any(Number)])
    expect(parking.bars.categories.every((category) => (category.value.fact.value ?? 0) > 0)).toBe(true)
    expect(refuelling.bars.unavailableResources).toEqual(expect.arrayContaining([
      'Bornes de recharge pour 1 000 hab.',
      'Stations-service pour 1 000 hab.',
      'Stations-service',
    ]))
    const charging = refuelling.bars.categories.find((category) => category.key === 'charging')!
    const fuelStations = refuelling.bars.categories.find((category) => category.key === 'fuel-stations')!
    expect(charging.value.fact.value).toBeNull()
    expect(charging.value.fact.comparison).toBeNull()
    expect(fuelStations.value.fact.value).toBeNull()
    expect(fuelStations.value.fact.comparison).toBeNull()
    // The available ratio and the available raw charging count still render.
    expect(refuelling.ratio.value.fact.value).not.toBeNull()

    const wrapper = await mountPageTwo(content)
    expect(wrapper.find('.mobilite-section--reseaux .map-breakout').exists()).toBe(true)
    expect(wrapper.find('.mobilite-section--stationnement-ravitaillement').exists()).toBe(true)
    expect(wrapper.text()).toContain('Stationnement vélo et voiture')
    expect(wrapper.text()).toContain('Bornes de recharge et station-services')
    expect(wrapper.text()).toContain('Publication indisponible')
    expect(wrapper.text()).toContain('Bornes de recharge pour 1 000 hab.')
    expect(wrapper.text()).not.toContain('0 bornes')
    expect(wrapper.find('g[data-category="charging"] rect').exists()).toBe(false)
    expect(wrapper.find('.mobilite-comparison-bars__comparison[data-comparison="charging"]').exists()).toBe(false)
    const note = wrapper.find('.mobilite-section--stationnement-ravitaillement [role="note"]')
    expect(note.attributes('role')).toBe('note')
    wrapper.unmount()
  })

  it('recovers the same figures after a fresh publication and invalidated cache, without cached placeholders', async () => {
    const state = { published: false }
    vi.stubGlobal('fetch', publicationAwareFetch(state))
    const cache = new ThemeAcquisitionCache(
      (theme, key) => acquireThemeFacts(key!.type, key!.id, theme),
      (selection, theme, key) => acquireThemeComparison(key!.type, key!.id, theme, selection),
    )
    const first = await cache.get('commune', '35238', 'mobilite')
    expect(first.focal.resource_failures?.filter((failure) => failure.stage === 'facts')).toHaveLength(3)
    expect(first.focal.resource_reads?.some((read) => read.resource === 'bornes_recharge_1000')).toBe(false)

    state.published = true
    cache.invalidate('commune', '35238', 'mobilite')
    const recovered = await cache.get('commune', '35238', 'mobilite')
    expect(recovered.focal.resource_failures ?? []).toEqual([])
    const chargingRead = recovered.focal.resource_reads?.find((read) => read.resource === 'bornes_recharge_1000')
    expect(chargingRead?.data.value).toBe(PUBLISHED_VALUES.bornes_recharge_1000)

    const selection = [
      { territory_type: 'commune' as const, territory_id: '35238' },
      { territory_type: 'commune' as const, territory_id: '35240' },
    ]
    const comparison = await cache.select('commune', '35238', 'mobilite', selection)
    const response = comparison.comparisons.get(JSON.stringify(selection))
    expect(response?.comparison_error).not.toBe(true)
    expect(response?.comparison_reads?.map((read) => read.resource)).toEqual(expect.arrayContaining([...UNPUBLISHED_SCALARS]))
  })
})

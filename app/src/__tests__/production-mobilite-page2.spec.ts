import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { applyThemeComparisonApiFacts, mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { ThemeMetadata } from '@/payload/types'
import { acquireThemeComparison, acquireThemeFacts } from '@/payload/themeAcquisition'
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

function semanticFetch(
  requestLog: Array<Record<string, any>> = [],
  batchLog: Array<Array<Record<string, any>>> = [],
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url !== '/api/resources/read-batch') {
      return new Response('not available in this fixture', { status: 404 })
    }
    const { items } = JSON.parse(String(init?.body)) as {
      items: Array<Record<string, any>>
    }
    requestLog.push(...items)
    batchLog.push(items)
    const results = items.map((item) => {
      const resource = catalogue.find((candidate) => candidate.resource_id === item.resource)
      if (!resource) throw new Error(`Unknown fixture resource ${item.resource}`)
      return {
        id: item.id,
        resource: item.resource,
        data: applyCoherentNetworkCapture(item, nativeReadFixture(item, resource)),
      }
    })
    return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results }), { status: 200 })
  })
}

const comparisonContext = {
  mode: 'densite' as const,
  scope: { kind: 'communes-densite' as const, label: 'communes de la classe de densité' },
  facts: [],
  buildingDistribution: null,
  accessRamp: null,
}

afterEach(() => vi.unstubAllGlobals())

describe('Mobilité page 2 — production values and per-network comparisons', () => {
  it('flows the published per-capita facts and all three network references into the delegate figure', async () => {
    const requestLog: Array<Record<string, any>> = []
    const batchLog: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', semanticFetch(requestLog, batchLog))

    const acquired = await acquireThemeFacts('commune', '35238', 'mobilite')
    const selection = [
      { territory_type: 'commune' as const, territory_id: '35238' },
      { territory_type: 'commune' as const, territory_id: '35240' },
    ]
    const comparisonData = await acquireThemeComparison('commune', '35238', 'mobilite', selection)

    const focal = mobilityFactsFromThemeApi(payload, '35238', acquired)
    const facts = applyThemeComparisonApiFacts(focal, comparisonData, comparisonContext, selection)
    const content: ThemeContent = resolveMobiliteThemeContent(facts, publicMetadata)
    const sharing = content.units.find((unit) => unit.key === 'partage-de-lespace-public')!
    const section = sharing.sections.find((candidate) => candidate.key === 'reseaux')!
    if (section.evidence?.kind !== 'mobilite-networks') throw new Error('Réseaux evidence expected')
    const categories = section.evidence.figure.categories

    // The API fixture is the actual catalogue-shaped snapshot; the resolved
    // facts carry one published comparison per declared network detail.
    expect(categories.map((category) => category.value.fact.detail)).toEqual([
      't_km_1000', 'b_km_1000', 'c_km_1000',
    ])
    for (const category of categories) {
      expect(category.value.fact.value).not.toBeNull()
      expect(category.value.fact.comparison?.reference?.value).not.toBeNull()
      expect(category.value.fact.comparison?.scope.label).toBe(comparisonContext.scope.label)
    }
    const networkReferences = categories.map((category) => category.value.fact.comparison!.reference!.value)
    expect(new Set(networkReferences).size).toBe(3)
    expect(categories.every((category) => category.value.fact.comparison!.rank?.position)).toBe(true)

    // The requested declared points are exactly the ones the page consumes.
    const requestedDetails = (resource: string) => new Set(requestLog
      .filter((item) => item.resource === resource && Array.isArray(item.coordinates?.detail))
      .map((item) => item.coordinates.detail[0] as string))
    expect(requestedDetails('reseaux_par_habitant')).toEqual(new Set(['t_km_1000', 'b_km_1000', 'c_km_1000']))
    expect(requestedDetails('reseaux')).toEqual(new Set(['t_longueur', 'b_longueur', 'c_longueur']))
    expect(requestedDetails('offre_cyclable')).toEqual(new Set([
      'protege_longueur', 'partage_longueur', 'protege_km_1000', 'partage_km_1000',
    ]))

    // Each related focal/default + declared-detail group travels in one batch.
    const networkResources = ['reseaux_par_habitant', 'reseaux', 'offre_cyclable'] as const
    for (const resource of networkResources) {
      const resourceBatches = batchLog
        .map((batch) => batch.filter((item) => item.resource === resource))
        .filter((batch) => batch.length > 0)
      expect(resourceBatches.length).toBeGreaterThanOrEqual(2)
      for (const resourceBatch of resourceBatches) {
        expect(resourceBatch.length).toBeLessThanOrEqual(12)
        const details = new Set(resourceBatch
          .filter((item) => Array.isArray(item.coordinates?.detail))
          .map((item) => item.coordinates.detail[0] as string))
        if (resourceBatch.some((item) => item.intent.kind === 'facts')) {
          expect(resourceBatch.some((item) => item.intent.kind === 'fixed_comparison')).toBe(true)
          expect(details).toEqual(requestedDetails(resource))
        } else {
          expect(resourceBatch.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
          expect(details).toEqual(requestedDetails(resource))
        }
      }
    }

    const bike = categories.find((category) => category.key === 'bike')!
    expect(bike.value.fact.value).toBeCloseTo(liveNetworks.reseauxParHabitant.b_km_1000, 12)
    expect(bike.segments.map((segment) => segment.value.fact.value ?? 0)
      .reduce((sum, value) => sum + value, 0))
      .toBeCloseTo(liveNetworks.reseauxParHabitant.b_km_1000, 12)
    expect(bike.rawValue?.fact.value).toBeCloseTo(liveNetworks.reseaux.b_longueur, 9)
    expect(bike.segments.map((segment) => segment.rawValue?.fact.value ?? 0)
      .reduce((sum, value) => sum + value, 0))
      .toBeCloseTo(liveNetworks.reseaux.b_longueur, 9)
    expect(bike.splitNote).toBeNull()
    expect(bike.rawValue?.fact.comparison?.reference?.value).not.toBeNull()
    for (const segment of bike.segments) {
      expect(segment.value.fact.comparison?.reference?.value).not.toBeNull()
      expect(segment.rawValue?.fact.comparison?.reference?.value).not.toBeNull()
    }

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

    const networks = wrapper.get('.mobilite-section--reseaux')
    expect(networks.find('.map-breakout').exists()).toBe(true)
    const figure = networks.get('.mobilite-comparison-bars')
    const svg = figure.get('svg[role="img"]')
    const accessible = svg.attributes('aria-label')!
    expect(accessible).toContain('Longueur du réseau par habitant')
    expect(accessible).toContain('km / 1 000 hab.')
    expect(accessible).toContain('médiane du total non segmenté')

    for (const category of categories) {
      const value = category.value.fact.value as number
      const reference = category.value.fact.comparison!.reference!.value
      const formatted = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
      const formattedReference = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(reference)
      expect(accessible).toContain(formatted)
      expect(accessible).toContain(formattedReference)
      expect(accessible).toContain('Groupe comparé')
    }

    const comparisonBars = figure.findAll('.mobilite-comparison-bars__comparison')
    expect(comparisonBars).toHaveLength(3)
    expect(figure.findAll('.mobilite-comparison-bars__segment')).toHaveLength(2)
    const bikeGroup = figure.get('g[data-category="bike"]')
    const totalHeight = Number(bikeGroup.attributes('data-total-height'))
    const segmentHeights = bikeGroup.findAll('rect[data-segment]')
      .map((rect) => Number(rect.attributes('height')))
    expect(segmentHeights.every((height) => height > 0.5)).toBe(true)
    expect(segmentHeights.reduce((sum, height) => sum + height, 0)).toBeCloseTo(totalHeight, 5)

    const bikeHitbox = figure.findAll('.mobilite-comparison-bars__hitbox')
      .find((hitbox) => (hitbox.attributes('aria-label') ?? '').startsWith('Total vélo'))!
    await bikeHitbox.trigger('focus')
    const tooltip = figure.get('.mobilite-comparison-bars__tooltip')
    const comparisonRows = tooltip.findAll('.cahier-figure-tooltip-row-comparison')
    expect(comparisonRows.length).toBeGreaterThanOrEqual(6)
    expect(comparisonRows.every((row) => row.find('.cahier-figure-tooltip-comparison-rank').exists())).toBe(true)
    expect(tooltip.text()).toContain('Longueur protégée')
    expect(tooltip.text()).toContain('Longueur partagée')

    // Producer stamps name the actual producers and carry their published URL/licence.
    const stamps = networks.findAll('.cahier-evidence-source a')
    const stampLabels = stamps.map((stamp) => stamp.text())
    expect(stampLabels).toEqual(expect.arrayContaining([
      'OpenStreetMap', 'Geovelo',
    ]))
    expect(stamps.every((stamp) => (stamp.attributes('href') ?? '').startsWith('http'))).toBe(true)
    expect(networks.text()).toContain('Protégé')
    expect(networks.text()).toContain('Partagé')
    expect(wrapper.text()).not.toContain('Une piste ne suffit pas')
    expect(wrapper.text()).not.toContain('La motorisation')
  })

  it('rejects a cross-generation declared-detail comparison without losing the focal facts', async () => {
    const base = semanticFetch()
    let mutated = false
    const stale = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await base(input, init)
      if (String(input) !== '/api/resources/read-batch') return response
      const body = await response.clone().json() as {
        results: Array<Record<string, any>>
      }
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      const index = items.findIndex((item) =>
        item.resource === 'reseaux' && item.intent?.kind === 'fixed_comparison' &&
        item.coordinates?.detail?.[0] === 'c_longueur')
      if (index >= 0) {
        mutated = true
        body.results[index]!.data.reference_content_version = 'stale-generation-ref'
      }
      return new Response(JSON.stringify(body), { status: 200 })
    })
    vi.stubGlobal('fetch', stale)
    const acquired = await acquireThemeFacts('commune', '35238', 'mobilite')
    expect(mutated).toBe(true)
    expect(acquired.comparison_error).not.toBe(true)
    expect(acquired.resource_failures).toContainEqual(expect.objectContaining({
      resource: 'reseaux', stage: 'comparison',
    }))
    expect(acquired.resource_reads?.length).toBeGreaterThan(0)
    expect(acquired.default_comparison?.comparison_reads.some((read) => read.resource === 'reseaux')).toBe(false)
  })

  it('renders the paired parking and refuelling figures with their ratio references and ranks', async () => {
    vi.stubGlobal('fetch', semanticFetch())

    const acquired = await acquireThemeFacts('commune', '35238', 'mobilite')
    const selection = [
      { territory_type: 'commune' as const, territory_id: '35238' },
      { territory_type: 'commune' as const, territory_id: '35240' },
    ]
    const comparisonData = await acquireThemeComparison('commune', '35238', 'mobilite', selection)
    const facts = applyThemeComparisonApiFacts(
      mobilityFactsFromThemeApi(payload, '35238', acquired),
      comparisonData,
      comparisonContext,
      selection,
    )
    const content = resolveMobiliteThemeContent(facts, publicMetadata)
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

    const paired = wrapper.get('.mobilite-section--stationnement-ravitaillement')
    expect(paired.findAll('.mobilite-paired-column')).toHaveLength(2)
    expect(paired.findAll('.mobilite-ratio-scalar')).toHaveLength(2)
    expect(paired.findAll('.cahier-figure-scalar')).toHaveLength(2)
    expect(paired.findAll('.cahier-comparison-value__reference')).toHaveLength(2)
    expect(paired.text()).toContain('Stationnement vélo et voiture')
    expect(paired.text()).toContain('Bornes de recharge et station-services')
    const stampLabels = paired.findAll('.cahier-evidence-source a').map((stamp) => stamp.text())
    expect(stampLabels).toEqual(expect.arrayContaining(['Ecolab', 'OpenStreetMap', 'Etalab', 'INSEE']))
    expect(paired.text()).not.toContain('Médiane des communes de EPCI X')
  })
})

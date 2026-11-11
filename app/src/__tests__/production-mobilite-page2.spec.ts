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

const publicMetadata = JSON.parse(readFileSync(
  join(process.cwd(), '..', 'public', 'data', 'theme_mobilite.json'), 'utf8',
)) as ThemeMetadata

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: [],
  histoires: histoiresMobiliteFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

const catalogue = nativeResources('mobilite')

function semanticFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url !== '/api/resources/read-batch') {
      return new Response('not available in this fixture', { status: 404 })
    }
    const { items } = JSON.parse(String(init?.body)) as {
      items: Array<Record<string, any>>
    }
    const results = items.map((item) => {
      const resource = catalogue.find((candidate) => candidate.resource_id === item.resource)
      if (!resource) throw new Error(`Unknown fixture resource ${item.resource}`)
      return {
        id: item.id,
        resource: item.resource,
        data: nativeReadFixture(item, resource),
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
    vi.stubGlobal('fetch', semanticFetch())

    const acquired = await acquireThemeFacts('commune', '22001', 'mobilite')
    const selection = [
      { territory_type: 'commune' as const, territory_id: '22001' },
      { territory_type: 'commune' as const, territory_id: '22002' },
    ]
    const comparisonData = await acquireThemeComparison('commune', '22001', 'mobilite', selection)

    const focal = mobilityFactsFromThemeApi(payload, '22001', acquired)
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

  it('renders the paired parking and refuelling figures with their ratio references and ranks', async () => {
    vi.stubGlobal('fetch', semanticFetch())

    const acquired = await acquireThemeFacts('commune', '22001', 'mobilite')
    const selection = [
      { territory_type: 'commune' as const, territory_id: '22001' },
      { territory_type: 'commune' as const, territory_id: '22002' },
    ]
    const comparisonData = await acquireThemeComparison('commune', '22001', 'mobilite', selection)
    const facts = applyThemeComparisonApiFacts(
      mobilityFactsFromThemeApi(payload, '22001', acquired),
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
    expect(paired.findAll('.mobilite-ratio')).toHaveLength(2)
    expect(paired.findAll('.cahier-comparison-value__reference')).toHaveLength(2)
    expect(paired.text()).toContain('Stationnement vélo et voiture')
    expect(paired.text()).toContain('Bornes de recharge et station-services')
    const stampLabels = paired.findAll('.cahier-evidence-source a').map((stamp) => stamp.text())
    expect(stampLabels).toEqual(expect.arrayContaining(['Ecolab', 'OpenStreetMap', 'Etalab', 'INSEE']))
    expect(paired.text()).not.toContain('Médiane des communes de EPCI X')
  })
})

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
import { invalidateSemanticReadsForTarget } from '@/payload/semanticResourceClient'
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

type FailureState = {
  facts: Set<string>
  comparisons: Set<string>
}

function semanticFetch(state: FailureState) {
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
      const failed = item.intent?.kind === 'facts'
        ? state.facts.has(item.resource)
        : state.comparisons.has(item.resource)
      if (failed) {
        return { id: item.id, resource: item.resource, status: 'publication_unavailable',
          reason: 'publication_absent', family: 'ordered_series' }
      }
      const resource = catalogue.find((candidate) => candidate.resource_id === item.resource)
      if (!resource) throw new Error(`Unknown fixture resource ${item.resource}`)
      return { id: item.id, resource: item.resource, status: 'available', data: nativeReadFixture(item, resource) }
    })
    return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results }), { status: 200 })
  })
}

const comparisonContext = {
  mode: 'densite' as const,
  scope: { kind: 'communes-densite' as const, label: 'communes de la classe de densité' },
  facts: [],
  buildingDistribution: null,
  accessRamp: null,
}

const selection = [
  { territory_type: 'commune' as const, territory_id: '35238' },
  { territory_type: 'commune' as const, territory_id: '35240' },
]

async function resolvePage3(): Promise<{
  content: ThemeContent
  comparisonError: boolean
}> {
  const acquired = await acquireThemeFacts('commune', '35238', 'mobilite')
  const comparisonData = await acquireThemeComparison('commune', '35238', 'mobilite', selection)
  const facts = applyThemeComparisonApiFacts(
    mobilityFactsFromThemeApi(payload, '35238', acquired),
    comparisonData,
    comparisonContext,
    selection,
  )
  return {
    content: resolveMobiliteThemeContent(facts, publicMetadata),
    comparisonError: comparisonData.comparison_error === true,
  }
}

async function mountPage3(content: ThemeContent, comparisonError = false) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(VarianteCahierLibre, {
    props: {
      content,
      pagination: cahierPaginationFor(payload, content, true),
      presentation: 'plain',
      layoutVariant: 'indexed-sections',
      showAllUnits: true,
      nativeComparisonStatus: comparisonError ? 'error' : 'ready',
      nativeComparisonError: comparisonError ? 'La lecture de la comparaison a échoué.' : undefined,
    },
    global: { plugins: [router] },
  })
  await router.isReady()
  await flushPromises()
  return wrapper
}

afterEach(() => vi.unstubAllGlobals())

describe('Mobilité page 3 — per-resource publication failures', () => {
  it('names an offre_tc publication failure on the share figure without fabricating a zero', async () => {
    vi.stubGlobal('fetch', semanticFetch({ facts: new Set(['offre_tc']), comparisons: new Set() }))
    const { content } = await resolvePage3()
    const shareSection = content.units.find((unit) => unit.key === 'offre-transports-commun')!
      .sections[0]
    if (shareSection.evidence?.kind !== 'mobilite-share') throw new Error('Share evidence expected')
    expect(shareSection.evidence.value.fact.availability).toBe('absent')
    expect(shareSection.evidence.unavailableResources).toContain(publicMetadata.indicator_labels!.offre_tc)

    const wrapper = await mountPage3(content)
    const section = wrapper.get('[data-section="couverture-du-territoire"]')
    expect(section.text()).toContain('Publication indisponible')
    expect(section.text()).toContain(publicMetadata.indicator_labels!.offre_tc!)
    expect(section.find('.mobilite-share-track__fill').exists()).toBe(false)
    expect(section.find('.mobilite-share-track__reference').exists()).toBe(false)
    const graphic = section.get('.mobilite-share-track__graphic')
    expect(graphic.attributes('aria-label')).toContain('Publication indisponible')
    expect(graphic.attributes('aria-label')).toContain(publicMetadata.indicator_labels!.offre_tc!)
    // The healthy curve section remains rendered.
    expect(wrapper.find('[data-section="visiter-la-bretagne"] svg[role="img"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('names a missing curve and never renders empty axes or baseline points', async () => {
    vi.stubGlobal('fetch', semanticFetch({ facts: new Set(['raccordement_courbe']), comparisons: new Set() }))
    const { content } = await resolvePage3()
    const curveSection = content.units.find((unit) => unit.key === 'offre-transports-commun')!
      .sections[1]
    if (curveSection.evidence?.kind !== 'mobilite-raccordement') throw new Error('Curve evidence expected')
    expect(curveSection.evidence.points).toEqual([])
    expect(curveSection.evidence.unavailableResources)
      .toContain(publicMetadata.indicator_labels!.raccordement_courbe)

    const wrapper = await mountPage3(content)
    const section = wrapper.get('[data-section="visiter-la-bretagne"]')
    expect(section.text()).toContain('Publication indisponible')
    expect(section.text()).toContain(publicMetadata.indicator_labels!.raccordement_courbe!)
    expect(section.find('svg[role="img"]').exists()).toBe(false)
    expect(section.find('.cahier-figure-axis-labels').exists()).toBe(false)
    expect(section.find('.mobilite-raccordement-curve__point--territory').exists()).toBe(false)
    // The healthy share figure remains rendered.
    expect(wrapper.find('[data-section="couverture-du-territoire"] .mobilite-share-track__fill').exists()).toBe(true)
    wrapper.unmount()
  })

  it('keeps the healthy curve when the raccordement_tc scalar is unpublished, without a marker at zero', async () => {
    vi.stubGlobal('fetch', semanticFetch({ facts: new Set(['raccordement_tc']), comparisons: new Set() }))
    const { content } = await resolvePage3()
    const curveSection = content.units.find((unit) => unit.key === 'offre-transports-commun')!
      .sections[1]
    if (curveSection.evidence?.kind !== 'mobilite-raccordement') throw new Error('Curve evidence expected')
    expect(curveSection.evidence.markerValue).toBeNull()
    expect(curveSection.evidence.points.length).toBeGreaterThan(0)
    expect(curveSection.evidence.prose.flat().map((segment) => segment.value).join(' '))
      .not.toContain('À 1 h 30')

    const wrapper = await mountPage3(content)
    const section = wrapper.get('[data-section="visiter-la-bretagne"]')
    expect(section.find('svg[role="img"]').exists()).toBe(true)
    expect(section.get('.mobilite-raccordement-curve__marker-point').attributes('data-value')).not.toBe('0')
    expect(section.text()).toContain('Publication indisponible')
    expect(section.text()).toContain(publicMetadata.indicator_labels!.raccordement_tc!)
    expect(section.get('svg[role="img"]').attributes('aria-label')).toContain('Publication indisponible')
    wrapper.unmount()
  })

  it('keeps the focal curve while a comparison-only 503 leaves the reference explicitly unavailable', async () => {
    vi.stubGlobal('fetch', semanticFetch({ facts: new Set(), comparisons: new Set(['raccordement_courbe']) }))
    const { content, comparisonError } = await resolvePage3()
    const curveSection = content.units.find((unit) => unit.key === 'offre-transports-commun')!
      .sections[1]
    if (curveSection.evidence?.kind !== 'mobilite-raccordement') throw new Error('Curve evidence expected')
    expect(curveSection.evidence.points.length).toBeGreaterThan(0)
    expect(curveSection.evidence.comparison).toBeNull()
    expect(curveSection.evidence.unavailableComparisons)
      .toContain(publicMetadata.indicator_labels!.raccordement_courbe)
    expect(curveSection.evidence.prose.flat().map((segment) => segment.value).join(' '))
      .not.toContain('Le pointillé représente')

    const wrapper = await mountPage3(content, comparisonError)
    const section = wrapper.get('[data-section="visiter-la-bretagne"]')
    expect(section.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    expect(section.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)
    expect(section.text()).toContain('Comparaison indisponible')
    expect(section.find('.cahier-figure-tooltip-comparison-rank').exists()).toBe(false)
    const legendComparison = section.findAll('.mobilite-raccordement-curve__legend button')
      .find((button) => (button.attributes('aria-label') ?? '').includes('Groupe comparé'))
    expect(legendComparison?.attributes('aria-pressed')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps the share focal value while an offre_tc comparison-only 503 removes the reference tick', async () => {
    vi.stubGlobal('fetch', semanticFetch({ facts: new Set(), comparisons: new Set(['offre_tc']) }))
    const { content } = await resolvePage3()
    const shareSection = content.units.find((unit) => unit.key === 'offre-transports-commun')!
      .sections[0]
    if (shareSection.evidence?.kind !== 'mobilite-share') throw new Error('Share evidence expected')
    expect(shareSection.evidence.value.fact.value).not.toBeNull()
    expect(shareSection.evidence.unavailableComparisons)
      .toContain(publicMetadata.indicator_labels!.offre_tc)

    const wrapper = await mountPage3(content)
    const section = wrapper.get('[data-section="couverture-du-territoire"]')
    expect(section.find('.mobilite-share-track__fill').exists()).toBe(true)
    expect(section.find('.mobilite-share-track__reference').exists()).toBe(false)
    expect(section.text()).toContain('Comparaison indisponible')
    expect(section.get('.mobilite-share-track__graphic').attributes('aria-label'))
      .toContain('Comparaison indisponible')
    wrapper.unmount()
  })

  it('recovers the named page-3 figures after a fresh acquisition', async () => {
    const state: FailureState = { facts: new Set(['raccordement_courbe']), comparisons: new Set(['raccordement_courbe']) }
    vi.stubGlobal('fetch', semanticFetch(state))
    const first = await resolvePage3()
    const firstWrapper = await mountPage3(first.content)
    expect(firstWrapper.find('[data-section="visiter-la-bretagne"] svg[role="img"]').exists()).toBe(false)
    firstWrapper.unmount()

    state.facts.clear()
    state.comparisons.clear()
    // A settled absence is not re-probed automatically: the explicit retry
    // invalidates that territory's item generations first.
    invalidateSemanticReadsForTarget('commune', '35238')
    const recovered = await resolvePage3()
    const recoveredWrapper = await mountPage3(recovered.content)
    const section = recoveredWrapper.get('[data-section="visiter-la-bretagne"]')
    expect(section.find('svg[role="img"]').exists()).toBe(true)
    expect(section.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    expect(section.find('.mobilite-raccordement-curve__comparison').exists()).toBe(true)
    expect(section.text()).not.toContain('Publication indisponible')
    recoveredWrapper.unmount()
  })
})

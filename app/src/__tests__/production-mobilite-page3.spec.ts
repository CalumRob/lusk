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
import type { TerritoryFacts } from '@/fiche/content/territoryFacts'
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

async function resolvePage3(): Promise<TerritoryFacts> {
  const acquired = await acquireThemeFacts('commune', '35238', 'mobilite')
  const selection = [
    { territory_type: 'commune' as const, territory_id: '35238' },
    { territory_type: 'commune' as const, territory_id: '35240' },
  ]
  const comparisonData = await acquireThemeComparison('commune', '35238', 'mobilite', selection)
  return applyThemeComparisonApiFacts(
    mobilityFactsFromThemeApi(payload, '35238', acquired),
    comparisonData,
    comparisonContext,
    selection,
  )
}

async function mountPage3(facts: TerritoryFacts) {
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
  return { content, wrapper }
}

afterEach(() => vi.unstubAllGlobals())

describe('Mobilité page 3 — Couverture du territoire + Visiter la Bretagne', () => {
  it('resolves the two AEDAR sections from the real catalogue and renders gauge + curve', async () => {
    vi.stubGlobal('fetch', semanticFetch())
    const facts = await resolvePage3()
    const content: ThemeContent = resolveMobiliteThemeContent(facts, publicMetadata)
    const unit = content.units.find((candidate) => candidate.key === 'offre-transports-commun')!
    expect(unit.sections.map((section) => [section.key, section.label])).toEqual([
      ['couverture-du-territoire', 'Couverture du territoire'],
      ['visiter-la-bretagne', 'Visiter la Bretagne'],
    ])
    expect(unit.sections.every((section) => section.lecture === null)).toBe(true)

    const { wrapper } = await mountPage3(facts)
    const shareSection = wrapper.get('[data-section="couverture-du-territoire"]')
    const curveSection = wrapper.get('[data-section="visiter-la-bretagne"]')
    expect(shareSection.findAll('svg[role="img"]')).toHaveLength(0)
    expect(curveSection.findAll('svg[role="img"]')).toHaveLength(1)
    expect(curveSection.find('.mobilite-share-track').exists()).toBe(false)

    // Gauge: the full published label (with its threshold) is the figure title.
    const offre = facts.mobility.indicators.find((fact) => fact.key === 'offre_tc')!
    const publishedLabel = publicMetadata.indicator_labels!.offre_tc!
    expect(shareSection.get('figcaption.cahier-figure-title').text()).toBe(publishedLabel)
    expect(publishedLabel).toContain('500 m')
    const share = shareSection.get('[data-row="territory"] .mobilite-share-track__track')
    expect(share.attributes('role')).toBe('img')
    const shareAria = share.attributes('aria-label')!
    expect(shareAria).toContain(publishedLabel)
    expect(shareAria).toContain(facts.territory.name)
    const shareValue = shareSection.get('[data-row="territory"] .mobilite-share-track__value')
    expect(Number(shareValue.attributes('data-value'))).toBeCloseTo(offre.value!, 12)
    expect(shareValue.text()).toContain(' %')
    // One decimal, and the served 0,9957… never reads as a synthetic 100 %.
    expect(shareValue.text()).toContain(`${new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    }).format(offre.value! * 100)} %`)
    expect(shareAria).toContain(`${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 })
      .format(offre.value! * 100)} %`)
    const reference = offre.comparison!.reference!
    const comparisonRow = shareSection.get('[data-row="comparison"]')
    expect(comparisonRow.get('.mobilite-share-track__label').text()).toBe('Groupe comparé')
    expect(Number(comparisonRow.get('.mobilite-share-track__value').attributes('data-value')))
      .toBeCloseTo(reference.value, 12)
    expect(comparisonRow.get('.mobilite-share-track__track').attributes('aria-label'))
      .toContain(comparisonContext.scope.label)
    // The shared served rank is centred below the compared bar.
    expect(comparisonRow.get('.cahier-rank--comparison').text()).toBeTruthy()
    expect(shareSection.text()).not.toContain('nb_buildings')
    // No category legend and no 0 %/100 % endpoint labels on the coverage figure.
    expect(shareSection.find('.cahier-figure-legend').exists()).toBe(false)
    expect(shareSection.find('.mobilite-share-track__scale').exists()).toBe(false)

    // Curve: full native grid, named marker and brand territory line.
    const curve = facts.mobility.indicators.filter((fact) => fact.key === 'raccordement_courbe')
    const trajectory = publicMetadata.indicator_pages!.raccordement_courbe
    if (trajectory.family !== 'trajectory') throw new Error('Published curve metadata must be a trajectory')
    const figure = curveSection.get('.mobilite-raccordement-curve')
    const svg = figure.get('svg[role="img"]')
    const curveAria = svg.attributes('aria-label')!
    expect(curveAria).toContain('Population bretonne joignable selon le temps de trajet')
    expect(curveAria).toContain('Axe horizontal : Temps de trajet.')
    expect(curveAria).toContain(trajectory.trajectory.axisLabels!.y)
    expect(curveAria).toContain(trajectory.trajectory.marker!.label)
    expect(curveAria).toContain('Groupe comparé')
    expect(curveAria).toContain('Moyenne')
    expect(curveAria).toContain(comparisonContext.scope.label)
    expect(curveAria).toContain('Rang')
    expect(curveAria).toContain('%')
    // One straight-segment path through every published point, no point chain.
    const curvePath = figure.get('.mobilite-raccordement-curve__territory').attributes('d')!
    expect((curvePath.match(/L/gu) ?? [])).toHaveLength(curve.length - 1)
    expect(figure.findAll('.mobilite-raccordement-curve__point--territory')).toHaveLength(0)
    expect(figure.findAll('circle')).toHaveLength(0)
    expect(figure.findAll('.cahier-figure-tick-label--x')).toHaveLength(
      trajectory.trajectory.ticks!.length,
    )
    expect(figure.text()).toContain('1 h 30')
    const marker = figure.get('.mobilite-raccordement-curve__marker')
    expect(marker.attributes('data-detail')).toBe(trajectory.trajectory.marker!.detail)
    expect(marker.find('.mobilite-raccordement-curve__marker-line').exists()).toBe(true)
    // The 90-minute dot and its on-plot label are retired; only the dashed
    // reference line remains at the published coordinate.
    expect(figure.find('.mobilite-raccordement-curve__marker-point').exists()).toBe(false)
    expect(figure.find('.mobilite-raccordement-curve__marker-label').exists()).toBe(false)
    expect(figure.find('text').exists()).toBe(false)
    const comparisonPath = figure.get('.mobilite-raccordement-curve__comparison')
    expect(comparisonPath.attributes('d')).toContain('M')
    expect(comparisonPath.attributes('class')).toContain('mobilite-raccordement-curve__comparison')
    // The reference is the active header group mean, never the named Brittany
    // reference: no named-reference text or series leaks into the figure.
    expect(figure.text()).not.toContain('Bretagne — moyenne')
    expect(figure.find('[data-series="reference"]').exists()).toBe(false)
    expect(figure.findAll('.mobilite-raccordement-curve__territory')).toHaveLength(1)

    // Visible tooltip values are bare; the accessible reading keeps units and scope.
    await figure.get('.mobilite-raccordement-curve__hit-surface').trigger('focus')
    const tooltip = figure.get('.mobilite-raccordement-curve__tooltip')
    expect(tooltip.text()).not.toContain('%')
    const tooltipComparisonRow = tooltip.findAll('.cahier-figure-tooltip-row')
      .find((row) => (row.attributes('aria-label') ?? '').includes('Groupe comparé'))!
    expect(tooltipComparisonRow.attributes('aria-label')).toContain('%')
    expect(tooltipComparisonRow.attributes('aria-label')).toContain('Moyenne')
    expect(tooltipComparisonRow.attributes('aria-label')).toContain(comparisonContext.scope.label)

    // Source stamps name the actual producers and keep their published URL.
    expect(shareSection.get('.cahier-evidence-source a').text()).toBe('Bretagne Mobilité')
    expect(curveSection.get('.cahier-evidence-source a').text()).toBe('Lusk')
    expect(curveSection.get('.cahier-evidence-source a').attributes('href')).toContain('github.com/CalumRob/lusk')
    // The compact stamp states the source month (from its served clock) and the
    // owner-approved licence; no vague catch-all and no fabricated attribution.
    const curveStamp = curveSection.get('.cahier-evidence-source').text()
    expect(curveStamp).toContain('Lusk 2026-10')
    expect(curveStamp).toContain('ODbL – © OpenStreetMap contributors (GTFS SNCF/Korrigo)')
    expect(curveStamp).not.toContain('et licences des sources ouvertes')
    expect(shareSection.text()).not.toContain('Marelle')
    expect(curveSection.text()).not.toContain('Marelle')
  })
})

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { aedarPrototypeSections } from '@/fiche/content/aedarAccessSection'
import { AEDAR_AGGREGATE_READING_MEASURES } from '@/fiche/content/aedarTimeRampFacts'
import { AEDAR_TYPEQU_REGISTRY } from '@/fiche/content/aedarTypequRegistry'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { AedarFetchResult, AedarSummaryFetchResult, AedarTerritorySummary } from '@/fiche/content/aedarApiClient'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import {
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { routes } from '@/router'

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

function baseFacts() {
  const facts = territoryFactsFor(payload, '22001')
  if (!facts) throw new Error('Fixture territory missing')
  return facts
}

function aedarProvenance(contentVersion: string) {
  return {
    contentVersion,
    sources: [{
      source_id: 'aedar_bretagne',
      vintage_id: '2026-v1',
      source_url: 'https://example.com',
      licence: 'Licence Ouverte',
      attribution: 'AEDAR',
      reference_date: '2026-01-01',
      publication_date: '2026-09-30',
    }],
  }
}

function aedarFacts(count: number) {
  const types = AEDAR_TYPEQU_REGISTRY
  return types.map(({ code, label }, index) => ({
    territory_id: '22001',
    territory_type: 'commune' as const,
    typequ: code,
    typequ_label: label,
    identity: {},
    n_addresses: 100,
    n_observed: index < count ? 100 : 0,
    coverage_status: 'covered',
    measures: Object.fromEntries(
      [5, 10, 15, 20].flatMap((duration) =>
        ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'].flatMap((mode) =>
          ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, i) => `decile${i + 1}`), 'mean']
            .map((stat) => [`count_${duration}_${mode}_${stat}`, index < count ? 0.5 : 0]),
        ),
      ),
    ),
    source_id: 'aedar_bretagne',
    vintage_id: '2026-v1',
    source_url: 'https://example.com',
    licence: 'Licence Ouverte',
    attribution: 'AEDAR',
    reference_date: '2026-01-01',
    publication_date: '2026-09-30',
  }))
}

const aedarReady: Extract<AedarFetchResult, { status: 'ready' }> = {
  status: 'ready',
  facts: aedarFacts(10),
  contentVersion: 'test-version',
  referenceContentVersion: 'test-reference-version',
  provenance: aedarProvenance('test-version'),
}

function aedarSummary(value = 5): AedarTerritorySummary {
  const source = aedarProvenance('test-version').sources[0]!
  return {
    territory: { territory_type: 'commune', territory_id: '22001' },
    summaryContentVersion: 'test-summary-version',
    aedarContentVersion: 'test-version',
    referenceContentVersion: 'test-reference-version',
    readings: Object.keys(AEDAR_AGGREGATE_READING_MEASURES).map((measure) => ({
      measure,
      value,
      status: 'available',
      n_typequ: AEDAR_TYPEQU_REGISTRY.length,
      n_addresses: 100,
      n_observed: 100,
      coverage_status: 'covered',
      statistic: 'direct',
      ...source,
    })),
    provenance: aedarProvenance('test-version'),
  }
}

const summaryReady: Extract<AedarSummaryFetchResult, { status: 'ready' }> = {
  status: 'ready',
  summary: aedarSummary(),
}

function contentWithAedar(): ThemeContent {
  const content = resolveMobiliteThemeContent(baseFacts())
  const sections = aedarPrototypeSections(summaryReady.summary, aedarReady, content.territory, {
    lossMapMetadata: {
      status: 'ready',
      legend: {
        colors: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
        tickLabels: ['12', '28', '44,0', '60', '76', '92'],
      },
    },
  })
  const first = content.units[0]
  return {
    ...content,
    units: [{ ...first, sections }, ...content.units.slice(1)],
  } as unknown as ThemeContent
}

describe('AEDAR unit contract guard (#954 C7)', () => {
  it('keeps the AEDAR unit structure, order, sources, ramps, profile, sandbox, loss maps and no Marelle', async () => {
    const content = contentWithAedar()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibre, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content, true),
        showAllUnits: true,
        presentation: 'plain',
        layoutVariant: 'indexed-sections',
        aedarAccessEnabled: true,
        aedarStatus: 'ready',
        comparisonStatus: 'ready',
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    const aedarUnit = wrapper.findAll('.cahier-page')[0]!
    expect(aedarUnit.attributes('aria-labelledby')).toBeTruthy()
    const sections = aedarUnit.findAll('[data-section]')
    expect(sections.map((section) => section.attributes('data-section'))).toEqual([
      'aedar-car-overview',
      'aedar-diversity-loss',
      'aedar-access',
      'aedar-equipment-profile',
      'aedar-equipment-explorer',
    ])
    expect(sections.map((section) => section.find('.concept-group-heading h3').text())).toEqual([
      'L’offre accessible en voiture',
      'Et sans voiture alors ?',
      'La ville du 1/12, du 1/6, du 1/4 et du 1/3 d’heure',
      'Au moins un quart des adresses',
      'Bac à sable',
    ])

    // Real child structures, not superficial strings.
    expect(sections[0]!.find('.blank-map-slot').exists()).toBe(true)
    expect(sections[0]!.find('.cahier-evidence-source a').text()).toBe('AEDAR')
    expect(sections[1]!.find('.aedar-diversity-loss').exists()).toBe(true)
    expect(sections[1]!.findAll('.aedar-diversity-loss-map').length).toBeGreaterThan(0)
    expect(sections[2]!.findAll('.access-ramp-cahier--time')).toHaveLength(2)
    expect(sections[2]!.find('.aedar-reading .cahier-evidence-source a').text()).toBe('AEDAR')
    expect(sections[3]!.find('.aedar-waffle-grid').exists()).toBe(true)
    expect(sections[3]!.find('.cahier-evidence-source a').text()).toBe('AEDAR')
    expect(sections[4]!.find('.aedar-equipment-explorer-selection').exists()).toBe(true)
    expect(sections[4]!.find('.cahier-evidence-source a').text()).toBe('AEDAR')

    // No Marelle anywhere in the AEDAR unit.
    expect(aedarUnit.findAll('.cahier-marelle-anchor')).toHaveLength(0)
    expect(aedarUnit.findAll('.concept-group-narrative')).toHaveLength(0)
    expect(aedarUnit.find('.concept-group-heading-copy').exists()).toBe(false)
    expect(aedarUnit.text()).not.toContain('Marelle')
  })
})

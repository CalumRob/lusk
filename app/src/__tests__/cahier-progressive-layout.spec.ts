import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import ProductionMobiliteAedar from '@/fiche/mobilite/ProductionMobiliteAedar.vue'
import CahierEvidenceSource from '@/fiche/prototype/CahierEvidenceSource.vue'
import CahierComparisonValue from '@/fiche/prototype/CahierComparisonValue.vue'
import { CONTROLE_COMPARAISON_KEY, type ControleComparaison } from '@/fiche/comparisonContext'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { histoiresMobiliteFixture, indicateursMobiliteFixture, metadonneesThemesFixtures,
  territoiresFixture, vintagesFixture } from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { routes } from '@/router'
import { AEDAR_AGGREGATE_READING_KEYS } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarTerritorySummary } from '@/fiche/content/aedarApiClient'

const payload = { territoires: territoiresFixture, indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture, runReport: null, vintages: vintagesFixture,
  programmes: null, reseauxMobilite: null, themeMetadata: metadonneesThemesFixtures } as unknown as Payload

afterEach(() => vi.unstubAllGlobals())

it('keeps honest source and requested comparison roles mounted before focal facts arrive', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  const facts = territoryFactsFor(payload, '22001')!
  const content = resolveMobiliteThemeContent(facts, payload.themeMetadata?.mobilite)
  const control = ref<ControleComparaison>({ focal: territoiresFixture[0]!, territoires: territoiresFixture,
    selection: { etat: 'defaut' }, libelleActif: 'EPCI de référence', presetDefaut: 'epci', presets: [], choisir: () => {} })
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(ProductionMobiliteAedar, {
    props: { content, pagination: cahierPaginationFor(payload, content), aedarData: null,
      aedarStatus: 'loading', aedarSummaryData: null, aedarSummaryStatus: 'loading', retryAedar: () => {} },
    global: { plugins: [router], provide: { [CONTROLE_COMPARAISON_KEY as symbol]: control },
      stubs: { CahierBlankMapSlots: true, AedarDiversityLossMapsCahier: true,
        ConstructeurComparaison: true, MembresComparaison: true } },
  })
  await flushPromises()
  const overview = wrapper.get('#section-aedar-car-overview')
  const source = overview.findComponent(CahierEvidenceSource)
  expect(source.exists()).toBe(true)
  expect(source.find('a').exists()).toBe(false)
  expect(source.text()).toBe('') // no invented source clock/credit
  const comparisons = overview.findAllComponents(CahierComparisonValue)
  expect(comparisons).toHaveLength(2)
  expect(comparisons.every((comparison: VueWrapper<InstanceType<typeof CahierComparisonValue>>) => comparison.props('comparisonStatus') === 'loading')).toBe(true)
  expect(overview.findAll('.cahier-figure-scalar-value strong').map((value) => value.text())).toEqual(['—', '—'])
  // An explicitly empty selection has no future reference row to reserve.
  control.value = { ...control.value, selection: { etat: 'vide' }, libelleActif: null }
  await flushPromises()
  expect(overview.findAllComponents(CahierComparisonValue)).toHaveLength(0)
  const provenance = { source_id: 'aedar_bretagne', vintage_id: '2026-v1',
    source_url: 'https://example.test/served-source', licence: 'Fixture licence',
    attribution: 'AEDAR · © Lusk 2026-10', reference_date: '2026-01-01', publication_date: '2026-10-22' }
  const summary: AedarTerritorySummary = {
    territory: { territory_type: 'commune', territory_id: '22001' },
    summaryContentVersion: 'fixture-summary', aedarContentVersion: 'fixture-aedar', referenceContentVersion: 'fixture-territories',
    provenance: { contentVersion: 'fixture-aedar', sources: [provenance] },
    readings: AEDAR_AGGREGATE_READING_KEYS.map((measure) => ({ measure, value: 12,
      status: 'available', n_typequ: 235, n_addresses: 100, n_observed: 100,
      coverage_status: 'covered', statistic: 'direct', ...provenance })),
  }
  await wrapper.setProps({ aedarSummaryData: { status: 'ready', summary }, aedarSummaryStatus: 'ready' })
  await flushPromises()
  expect(overview.findComponent(CahierEvidenceSource).get('a').attributes('href')).toBe(provenance.source_url)
  expect(overview.findComponent(CahierEvidenceSource).text().replace(/\s+/gu, ' ')).toBe('AEDAR 2026-v1 · © Lusk 2026-10')
  expect(overview.findAll('.cahier-figure-scalar-value strong').map((value) => value.text())).toEqual(['12', '12'])
  expect(overview.findAllComponents(CahierComparisonValue)).toHaveLength(0)
  await wrapper.setProps({ aedarSummaryData: null })
  await wrapper.setProps({ aedarSummaryStatus: 'error', aedarStatus: 'error' })
  expect(overview.findComponent(CahierEvidenceSource).exists()).toBe(false)
  wrapper.unmount()
})

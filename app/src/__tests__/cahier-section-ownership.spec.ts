import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import type { ControleComparaison } from '@/fiche/comparisonContext'
import { aedarPrototypeSections } from '@/fiche/content/aedarAccessSection'
import { AEDAR_AGGREGATE_READING_MEASURES } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarTerritorySummary } from '@/fiche/content/aedarApiClient'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { ThemeContent } from '@/fiche/content/themeContent'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import { histoiresMobiliteFixture, indicateursMobiliteFixture, metadonneesThemesFixtures,
  territoiresFixture, vintagesFixture } from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import AedarEquipmentWaffleCahier from '@/fiche/prototype/AedarEquipmentWaffleCahier.vue'
import AedarEquipmentExplorerCahier from '@/fiche/prototype/AedarEquipmentExplorerCahier.vue'
import CahierMobiliteSection from '@/fiche/prototype/CahierMobiliteSection.vue'
import CahierComparisonValue from '@/fiche/prototype/CahierComparisonValue.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { routes } from '@/router'
import BoutonComparaison from '@/components/fiche/BoutonComparaison.vue'

const payload: Payload = { territoires: territoiresFixture, indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture, runReport: null, vintages: vintagesFixture, programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite } }
const source = { source_id: 'aedar_bretagne', vintage_id: 'test', source_url: 'https://example.test',
  licence: 'Licence Ouverte', attribution: 'AEDAR', reference_date: '2026-01-01', publication_date: '2026-09-30' }
function contentFor(): ThemeContent {
  const facts = territoryFactsFor(payload, '22001')!
  const content = resolveMobiliteThemeContent(facts)
  const summary: AedarTerritorySummary = {
    territory: { territory_type: 'commune', territory_id: '22001' },
    summaryContentVersion: 'summary', aedarContentVersion: 'facts', referenceContentVersion: 'reference',
    readings: Object.keys(AEDAR_AGGREGATE_READING_MEASURES).map((measure) => ({
      measure, value: 5, status: 'available', n_typequ: 1, n_addresses: 100, n_observed: 100,
      coverage_status: 'covered', statistic: 'direct', ...source,
    })),
    provenance: { contentVersion: 'facts', sources: [source] },
  }
  const sections = aedarPrototypeSections(summary, {
    status: 'ready', contentVersion: 'facts', referenceContentVersion: 'reference',
    provenance: summary.provenance,
    facts: [{ territory_id: '22001', territory_type: 'commune', typequ: 'B207', typequ_label: 'Équipement test',
      identity: {}, n_addresses: 100, n_observed: 100, coverage_status: 'covered', measures: {}, ...source }],
  }, content.territory, { lossMapMetadata: { status: 'loading', legend: null } })
  const overview = sections[0].evidence
  if (overview?.kind === 'aedar-car-overview') {
    overview.scalars = overview.scalars.map((scalar) => ({ ...scalar,
      reference: { kind: 'selection-mean', label: 'Moyenne — Groupe unique', value: 2, unit: scalar.unit } }))
  }
  return { ...content, units: [{ ...content.units[0]!, sections }, ...content.units.slice(1)] } as ThemeContent
}
async function render(extra = {}) {
  const content = contentFor()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const control = ref<ControleComparaison>({ focal: territoiresFixture[0]!, territoires: territoiresFixture,
    selection: { etat: 'defaut' }, libelleActif: 'Groupe unique', presetDefaut: 'epci', presets: [], choisir: vi.fn() })
  const wrapper = mount(VarianteCahierLibre, { props: { content, pagination: cahierPaginationFor(payload, content, true),
    showAllUnits: true, presentation: 'plain', aedarAccessEnabled: true, aedarChapterActive: false,
    aedarStatus: 'ready', ...extra },
  global: { plugins: [router], provide: { [CONTROLE_COMPARAISON_KEY as symbol]: control } } })
  await flushPromises()
  return { wrapper, control }
}

describe('Cahier extracted section ownership (#956)', () => {
  it('synchronizes modes, horizon and comparison visibility across compositions without remounting on evidence updates', async () => {
    const { wrapper } = await render()
    const ramps = wrapper.findAllComponents(AccessRampFigureCahier).filter((ramp) =>
      ramp.element.closest('[data-section="aedar-access"]'))
    const explorer = wrapper.getComponent(AedarEquipmentExplorerCahier)
    const profile = wrapper.getComponent(AedarEquipmentWaffleCahier)
    expect(ramps).toHaveLength(2)
    ramps[0]!.vm.$emit('update:selectedModes', ['car', 'walk'])
    profile.vm.$emit('update:selectedHorizon', 15)
    await flushPromises()
    expect(ramps[1]!.props('selectedModes')).toEqual(['car', 'walk'])
    expect(explorer.props('selectedModes')).toEqual(['car', 'walk'])
    expect(explorer.props('selectedHorizon')).toBe(15)
    explorer.vm.$emit('update:comparisonVisible', false)
    explorer.vm.$emit('update:selectedHorizon', 10)
    explorer.vm.$emit('update:selectedModes', ['bike_lts2'])
    await flushPromises()
    for (const ramp of ramps) {
      expect(ramp.props('comparisonVisible')).toBe(false)
      expect(ramp.props('selectedModes')).toEqual(['bike_lts2'])
    }
    expect(profile.props('selectedHorizon')).toBe(10)
    await wrapper.setProps({ content: contentFor(), comparisonStatus: 'loading' })
    expect(wrapper.getComponent(AedarEquipmentExplorerCahier).element).toBe(explorer.element)
    expect(profile.props('selectedHorizon')).toBe(10)
    expect(explorer.props('selectedModes')).toEqual(['bike_lts2'])
    expect(explorer.props('chapterActive')).toBe(false)
    expect(wrapper.find('.blank-map-slot img[src]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps differing acquired resource status and retry attribution under one header selection', async () => {
    const retryAedar = vi.fn()
    const retryNative = vi.fn()
    const { wrapper, control } = await render({ layoutVariant: 'indexed-sections', comparisonStatus: 'error', comparisonError: 'AEDAR échoué',
      retryComparison: retryAedar, nativeComparisonStatus: 'loading', retryNativeComparison: retryNative })
    // The fixture's raccordement has null evidence: it keeps the fallback,
    // independently of the three acquired Mobilité section bodies.
    expect(wrapper.findAllComponents(CahierMobiliteSection)).toHaveLength(3)
    for (const section of wrapper.findAllComponents(CahierMobiliteSection)) {
      expect(section.props('comparison').status).toBe('loading')
      expect(section.props('comparison').retry).toBe(retryNative)
    }
    const overview = wrapper.get('[data-section="aedar-car-overview"]')
    const values = wrapper.findAllComponents(CahierComparisonValue).filter((value) =>
      value.element.closest('[data-section="aedar-car-overview"]'))
    expect(values).toHaveLength(2)
    expect(values.every((value) => value.props('comparisonStatus') === 'error')).toBe(true)
    await overview.get('.aedar-comparison-retry').trigger('click')
    expect(retryAedar).toHaveBeenCalledTimes(1)
    expect(retryNative).not.toHaveBeenCalled()
    await wrapper.setProps({ comparisonStatus: 'ready', nativeComparisonStatus: 'error', nativeComparisonError: 'Autre ressource' })
    expect(overview.find('.aedar-comparison-retry').exists()).toBe(false)
    for (const section of wrapper.findAllComponents(CahierMobiliteSection)) {
      expect(section.props('comparison')).toMatchObject({ status: 'error', error: 'Autre ressource' })
    }
    await wrapper.get('.mobilite-comparison-retry').trigger('click')
    expect(retryNative).toHaveBeenCalledTimes(1)
    expect(retryAedar).toHaveBeenCalledTimes(1)
    const headerControls = wrapper.findAllComponents(BoutonComparaison)
    expect(headerControls).toHaveLength(3)
    for (const header of headerControls) expect(header.props('selection')).toEqual(control.value.selection)
    control.value = { ...control.value, selection: { etat: 'vide' } }
    await flushPromises()
    for (const header of headerControls) expect(header.props('selection')).toEqual({ etat: 'vide' })
    wrapper.unmount()
  })

  it('keeps null pending and disabled evidence at the same anchored wrapper with honest loading roles', async () => {
    const { wrapper } = await render({ aedarAccessEnabled: false })
    expect(wrapper.findAll('.cahier-page')[0]!.findAll('.evidence-placeholder')).toHaveLength(5)
    expect(wrapper.findComponent(AedarEquipmentExplorerCahier).exists()).toBe(false)
    const content = contentFor()
    content.units[0]!.sections = content.units[0]!.sections.map((section) => ({ ...section, evidence: null }))
    await wrapper.setProps({ content, aedarAccessEnabled: true, aedarStatus: 'loading' })
    const groups = wrapper.findAll('.cahier-page')[0]!.findAll('.figure-stack > .concept-group')
    expect(groups).toHaveLength(5)
    for (const group of groups) {
      const key = group.attributes('data-section')
      expect(group.get(`#section-${key}`).attributes('data-figure')).toBe(`section-${key}`)
      expect(group.get('.evidence-placeholder').attributes('role')).toBe('status')
      expect(group.get('.evidence-placeholder').text()).toBe('Chargement des données AEDAR…')
    }
    wrapper.unmount()
  })
})

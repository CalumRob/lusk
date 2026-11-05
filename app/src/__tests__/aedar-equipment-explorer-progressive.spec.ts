import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AedarEquipmentExplorerCahier from '@/fiche/prototype/AedarEquipmentExplorerCahier.vue'
import { AEDAR_EQUIPMENT_QUANTILE_STATISTICS } from '@/fiche/content/aedarTimeRampFacts'
import { fetchAedarAggregates } from '@/fiche/content/aedarApiClient'
import type { AedarFact, AedarFetchResult } from '@/fiche/content/aedarApiClient'
import type { AedarEquipmentExplorerEvidence } from '@/fiche/content/themeContent'
import { fetchAedarComparison } from '@/fiche/content/aedarComparisonClient'
import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import AedarEquipmentQuantileFigureCahier from '@/fiche/prototype/AedarEquipmentQuantileFigureCahier.vue'

vi.mock('@/fiche/content/aedarComparisonClient', async (original) => ({
  ...await original<typeof import('@/fiche/content/aedarComparisonClient')>(), fetchAedarComparison: vi.fn(),
}))

vi.mock('@/fiche/content/aedarApiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/fiche/content/aedarApiClient')>()
  return { ...actual, fetchAedarAggregates: vi.fn() }
})

function fact(territoryId: string): AedarFact {
  return {
    territory_id: territoryId, territory_type: 'commune', typequ: 'B207', typequ_label: 'Boulangerie',
    identity: {}, n_addresses: 10, n_observed: 10, coverage_status: 'covered',
    measures: { count_15_car_mean: 1, count_15_car_share: 0.5 },
    source_id: `source-${territoryId}`, vintage_id: 'v1', source_url: 'https://example.test',
    licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: null,
  }
}

function evidence(territoryId: string, contentVersion = 'same-content', referenceContentVersion = 'same-reference'):
AedarEquipmentExplorerEvidence {
  return {
    kind: 'aedar-equipment-explorer', contentVersion, referenceContentVersion, facts: [fact(territoryId)],
    initialTypequ: 'B207', initialHorizonMinutes: 15, introduction: [],
    volumeFigureTitle: 'Volume', volumeYAxisTitle: 'Établissements',
    distributionFigureTitle: 'Distribution', distributionStatistics: AEDAR_EQUIPMENT_QUANTILE_STATISTICS,
    distributionAxisTitle: 'Décile', distributionYAxisTitle: 'Établissements',
    distributionDescription: 'Distribution', distributionUnavailableDescription: 'Indisponible', source: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function ready(territoryId: string, contentVersion: string, referenceContentVersion: string, value: number): AedarFetchResult {
  return {
    status: 'ready', facts: [{ ...fact(territoryId), measures: { count_15_car_min: value } }],
    contentVersion, referenceContentVersion,
    provenance: { contentVersion, sources: [] },
  }
}

const selectedFact = (wrapper: ReturnType<typeof shallowMount>) =>
  ((wrapper.vm.$ as any).setupState as { selectedFact: AedarFact }).selectedFact

describe('AEDAR selected TYPEQU hydration identity', () => {
  beforeEach(() => { vi.mocked(fetchAedarAggregates).mockReset(); vi.mocked(fetchAedarComparison).mockReset() })

  it('applique la sélection au volume et aux quantiles du Bac à sable, puis efface le groupe désactivé', async () => {
    const first = deferred<Awaited<ReturnType<typeof fetchAedarComparison>>>()
    vi.mocked(fetchAedarAggregates).mockResolvedValue(ready('territory-a', 'same-content', 'same-reference', 2))
    vi.mocked(fetchAedarComparison).mockReturnValueOnce(first.promise)
    const base = evidence('territory-a')
    const request = { intent: { kind: 'selected_comparison' as const,
      members: ['territory-a', 'territory-b', 'territory-c'].map((territory_id) => ({ territory_type: 'commune' as const, territory_id })) }, label: 'Moyenne de la sélection' }
    const wrapper = mount(AedarEquipmentExplorerCahier, { props: { evidence: { ...base, comparisonRequest: request } } })
    await flushPromises()
    expect(fetchAedarComparison).toHaveBeenCalledWith('commune', 'territory-a', expect.objectContaining({
      typequ: ['B207'], intent: request.intent, expectedContentVersion: 'same-content', expectedReferenceContentVersion: 'same-reference',
      measures: expect.arrayContaining(['count_15_car_mean', 'count_15_car_decile1']),
    }))
    const comparisonCell = (measure: string) => ({ ...fact('territory-a'), measure, statistic: 'pooled' as const,
      group_coverage_status: 'covered', group_n_addresses: 30, group_n_observed: 30,
      group_value: 7.4, rank: 2, rank_size: 3, rank_ties: 1, direction: 'high' as const })
    const comparison = { label: request.label, contentVersion: base.contentVersion, referenceContentVersion: base.referenceContentVersion,
      cells: [comparisonCell('count_15_car_mean'), ...base.distributionStatistics.map((statistic) =>
        comparisonCell(`count_15_car_${statistic.key}`))] }
    first.resolve({ status: 'ready', evidence: comparison })
    await flushPromises()
    const ramp = wrapper.findComponent(AccessRampFigureCahier).props('timeRamp')
    expect(ramp!.comparisonLabel).toBe('Moyenne de la sélection')
    expect(ramp!.series[0]!.points[2]!.referenceValue).toBe(7.4)
    expect(ramp!.series[0]!.points[2]!.referenceNote).toBe('Rang du territoire : 2e/3, plus est mieux')
    expect(wrapper.find('.aedar-equipment-comparison').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Groupe comparé : 7,4')
    const rampCut = wrapper.findAll('.access-ramp-cut-hitbox').find((button) => button.attributes('aria-label')?.includes('15 min'))
    expect(rampCut).toBeDefined()
    await rampCut!.trigger('focus')
    const tooltip = wrapper.get('[role="tooltip"]')
    expect(tooltip.text()).toContain('Groupe comparé : 7,4')
    expect(tooltip.text()).toContain('Rang du territoire : 2e/3, plus est mieux')
    expect(tooltip.get('.cahier-figure-tooltip-row').attributes('aria-label')).toContain('Moyenne de la sélection')
    expect(tooltip.get('.cahier-figure-tooltip-row').attributes('aria-label')).toContain('Rang du territoire : 2e/3, plus est mieux')
    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).toContain('Rang du territoire : 2e/3, plus est mieux')
    expect(wrapper.findComponent(AedarEquipmentQuantileFigureCahier).props('comparison')).toEqual(comparison)
    const comparisonToggle = wrapper.findAll('.cahier-figure-legend-toggle').find((button) => button.text() === 'Groupe comparé')
    expect(comparisonToggle).toBeDefined()
    expect(comparisonToggle!.attributes('aria-pressed')).toBe('true')
    expect(comparisonToggle!.attributes('aria-label')).toBe('Groupe comparé : Moyenne de la sélection')
    expect(wrapper.text()).not.toContain('À droite de chaque paire de barres')
    const groupedBars = wrapper.findAll('.cahier-grouped-vertical-bar-chart__bar').length
    expect(groupedBars).toBeGreaterThan(1)
    await comparisonToggle!.trigger('click')
    expect(wrapper.find('.access-ramp-line--comparison').exists()).toBe(false)
    expect(wrapper.findComponent(AedarEquipmentQuantileFigureCahier).props('comparisonVisible')).toBe(false)
    expect(wrapper.findAll('.cahier-grouped-vertical-bar-chart__bar')).toHaveLength(groupedBars - base.distributionStatistics.length)
    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).toContain('Référence Moyenne de la sélection')
    expect(wrapper.find('.cahier-grouped-vertical-bar-chart__svg').attributes('aria-label')).toContain('Groupe comparé : Voiture')
    expect(wrapper.findAll('.cahier-figure-legend-toggle').find((button) => button.text() === 'Groupe comparé')!.attributes('aria-pressed')).toBe('false')
    await wrapper.findAll('.cahier-figure-legend-toggle').find((button) => button.text() === 'Groupe comparé')!.trigger('click')
    expect(wrapper.find('.access-ramp-line--comparison').exists()).toBe(true)
    await wrapper.setProps({ evidence: base })
    expect(wrapper.findComponent(AccessRampFigureCahier).props('timeRamp')!.comparisonLabel).toBeNull()
    wrapper.unmount()
  })

  it('rejects a late same-TYPEQU result from the previous territory even when publication tokens match', async () => {
    const requests: Array<ReturnType<typeof deferred<AedarFetchResult>>> = []
    vi.mocked(fetchAedarAggregates).mockImplementation(() => {
      const request = deferred<AedarFetchResult>()
      requests.push(request)
      return request.promise
    })
    const wrapper = shallowMount(AedarEquipmentExplorerCahier, { props: { evidence: evidence('territory-a') } })
    await nextTick()
    expect(requests).toHaveLength(1)
    expect(wrapper.text()).toContain('Chargement des valeurs pour ce type d’équipement')

    await wrapper.setProps({ evidence: evidence('territory-b') })
    await nextTick()
    expect(requests).toHaveLength(2)

    requests[0]!.resolve(ready('territory-a', 'same-content', 'same-reference', 11))
    await nextTick()
    expect(wrapper.text()).toContain('Chargement des valeurs pour ce type d’équipement')
    expect(selectedFact(wrapper).territory_id).toBe('territory-b')
    expect(selectedFact(wrapper).measures.count_15_car_min).toBeUndefined()

    requests[1]!.resolve(ready('territory-b', 'same-content', 'same-reference', 22))
    await nextTick()
    await nextTick()
    expect(selectedFact(wrapper).measures.count_15_car_min).toBe(22)
    wrapper.unmount()
  }, 30000)

  it('restarts the read when publication identity changes on the same territory', async () => {
    const requests: Array<ReturnType<typeof deferred<AedarFetchResult>>> = []
    vi.mocked(fetchAedarAggregates).mockImplementation(() => {
      const request = deferred<AedarFetchResult>()
      requests.push(request)
      return request.promise
    })
    const wrapper = shallowMount(AedarEquipmentExplorerCahier, { props: { evidence: evidence('territory-a', 'v1', 'r1') } })
    await nextTick()
    await wrapper.setProps({ evidence: evidence('territory-a', 'v2', 'r2') })
    await nextTick()
    expect(requests).toHaveLength(2)
    expect(wrapper.text()).toContain('Chargement des valeurs pour ce type d’équipement')

    requests[0]!.resolve(ready('territory-a', 'v1', 'r1', 11))
    await nextTick()
    expect(selectedFact(wrapper).measures.count_15_car_min).toBeUndefined()
    requests[1]!.resolve(ready('territory-a', 'v2', 'r2', 22))
    await nextTick()
    expect(selectedFact(wrapper).measures.count_15_car_min).toBe(22)
    wrapper.unmount()
  }, 30000)
})

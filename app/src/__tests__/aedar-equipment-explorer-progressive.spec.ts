import { shallowMount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AedarEquipmentExplorerCahier from '@/fiche/prototype/AedarEquipmentExplorerCahier.vue'
import { AEDAR_EQUIPMENT_QUANTILE_STATISTICS } from '@/fiche/content/aedarTimeRampFacts'
import { fetchAedarAggregates } from '@/fiche/content/aedarApiClient'
import type { AedarFact, AedarFetchResult } from '@/fiche/content/aedarApiClient'
import type { AedarEquipmentExplorerEvidence } from '@/fiche/content/themeContent'

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
  beforeEach(() => { vi.mocked(fetchAedarAggregates).mockReset() })

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

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { territoiresFixture } from '../payload/fixtures'
import { INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY } from '../payload/indicatorReadModel'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'

afterEach(() => vi.restoreAllMocks())

describe('Page de la série annuelle conso ENAF', () => {
  it('uses the bounded API, never loads the static facts, and offers retry on failure', async () => {
    const calls: string[] = []
    const loader: ChargerFichier = async (file) => {
      calls.push(file)
      if (file === 'territoires') return territoiresFixture
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(
      new Response(JSON.stringify({
        indicator_id: 'conso_enaf_annuel', label: 'Série ENAF', unit: 'ha',
        comparison: { point: '2024', median: 0, rank: 1, comparable_count: 2 },
        points: [{ axis: '2011', status: 'measured', value: 0, source_id: 'consoenaf', vintage_id: '2025' },
          { axis: '2012', status: 'missing', value: null, source_id: 'consoenaf', vintage_id: '2025' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/conso_enaf_annuel?territoire=22001')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { milieux: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Série annuelle indisponible')
    expect(calls).not.toContain('indicateurs_milieux')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/territories/commune/22001/series/conso_enaf_annuel')
    expect(wrapper.text()).toContain('Série ENAF')
    expect(wrapper.text()).toContain('Indisponible')
  })
})

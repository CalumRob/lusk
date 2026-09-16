import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import {
  indicateursDemographieFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '../payload/fixtures'
import {
  INDICATOR_READ_MODEL_CHARGER_KEY,
  validerModeleIndicateur,
} from '../payload/indicatorReadModel'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'

beforeEach(() => localStorage.clear())

describe("Page d'indicateur — modèle de lecture routé", () => {
  it('rend densité sans demander le payload global Démographie', async () => {
    const page = metadonneesThemesFixtures.demographie.indicator_pages!.densite
    const facts = indicateursDemographieFixture.filter(
      (fact) => fact.key === 'densite' && fact.type !== 'region',
    )
    const model = validerModeleIndicateur(
      {
        schema_version: '1',
        snapshot_id: '2026-09-15',
        theme: 'demographie',
        indicator: 'densite',
        theme_label: 'Démographie',
        page,
        detail_labels: {},
        source_records: metadonneesThemesFixtures.demographie.source_records,
        facts,
      },
      'densite.json',
      territoiresFixture,
    )
    const payloadCalls: string[] = []
    const payloadLoader: ChargerFichier = async (file) => {
      payloadCalls.push(file)
      if (file === 'territoires') return territoiresFixture
      throw new Error(`legacy payload requested: ${file}`)
    }
    const readModelLoader = vi.fn(async () => model)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }

    const wrapper = mount(IndicateurView, {
      global: {
        plugins: [router],
        provide: {
          [PAYLOAD_CHARGER_KEY]: payloadLoader,
          [INDICATOR_READ_MODEL_CHARGER_KEY]: readModelLoader,
          [GEOMETRIE_CHARGER_KEY]: async () => ({
            communes: empty,
            epcis: empty,
            departements: empty,
          }),
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Densité de population')
    expect(payloadCalls).toEqual(['territoires'])
    expect(readModelLoader).toHaveBeenCalledWith('demographie', 'densite', territoiresFixture)
  })
})

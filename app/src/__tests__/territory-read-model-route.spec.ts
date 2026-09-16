import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TerritoireView from '@/views/TerritoireView.vue'
import { routes } from '@/router'
import {
  indicateursMobiliteFixture,
  histoiresMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '@/payload/fixtures'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '@/payload/usePayload'
import {
  TERRITORY_READ_MODEL_CHARGER_KEY,
  validerModeleTerritoire,
} from '@/payload/territoryReadModel'
import { PayloadError } from '@/payload/validate'

const rawModel = {
  schema_version: '1',
  snapshot_id: '2026-09-15',
  territory: territoiresFixture[0],
  territoires: territoiresFixture,
  themes: {
    mobilite: {
      theme: 'mobilite',
      indicateurs: indicateursMobiliteFixture,
      histoires: histoiresMobiliteFixture,
      theme_metadata: metadonneesThemesFixtures.mobilite,
      profils_acces_bpe: null,
      distribution_acces_batiments: null,
      rampe_acces_batiments: null,
    },
  },
} as const

beforeEach(() => localStorage.clear())

describe('fiche — chargement par modèle de lecture de territoire', () => {
  it('affiche les six onglets immédiatement et garde un seul chargement atomique', async () => {
    let resolveModel!: (value: ReturnType<typeof validerModeleTerritoire>) => void
    const pendingModel = new Promise<ReturnType<typeof validerModeleTerritoire>>((resolve) => {
      resolveModel = resolve
    })
    const readModelLoader = vi.fn(() => pendingModel)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/territoire/commune/22001')
    await router.isReady()

    const wrapper = mount(TerritoireView, {
      global: {
        plugins: [router],
        provide: { [TERRITORY_READ_MODEL_CHARGER_KEY]: readModelLoader },
      },
    })

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(readModelLoader).toHaveBeenCalledTimes(1)

    resolveModel(validerModeleTerritoire(rawModel, 'territoires/commune/22001.json', {
      type: 'commune',
      territoire: '22001',
    }))
    await flushPromises()
    expect(readModelLoader).toHaveBeenCalledTimes(1)
  })

  it('charge Mobilité atomiquement sans ouvrir les tables globales du payload', async () => {
    const model = validerModeleTerritoire(rawModel, 'territoires/commune/22001.json', {
      type: 'commune',
      territoire: '22001',
    })
    const demandes: string[] = []
    const payloadLoader: ChargerFichier = async (file) => {
      demandes.push(file)
      throw new Error(`table legacy demandée : ${file}`)
    }
    const readModelLoader = vi.fn(async () => model)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/territoire/commune/22001?theme=mobilite')
    await router.isReady()

    const wrapper = mount(TerritoireView, {
      global: {
        plugins: [router],
        provide: {
          [PAYLOAD_CHARGER_KEY]: payloadLoader,
          [TERRITORY_READ_MODEL_CHARGER_KEY]: readModelLoader,
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Mobilité')
    expect(demandes).toEqual([])
    expect(readModelLoader).toHaveBeenCalledWith('commune', '22001')
  })

  it('réessaie le modèle de territoire quand le chargement échoue', async () => {
    const demandes: string[] = []
    const payloadLoader: ChargerFichier = async (file) => {
      demandes.push(file)
      throw new Error(`table legacy demandée : ${file}`)
    }
    const readModelLoader = vi
      .fn()
      .mockRejectedValueOnce(new PayloadError('fetch', 'territoires/commune/22001.json', 'panne'))
      .mockResolvedValueOnce(validerModeleTerritoire(rawModel, 'territoires/commune/22001.json', {
        type: 'commune',
        territoire: '22001',
      }))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/territoire/commune/22001?theme=mobilite')
    await router.isReady()

    const wrapper = mount(TerritoireView, {
      global: {
        plugins: [router],
        provide: {
          [PAYLOAD_CHARGER_KEY]: payloadLoader,
          [TERRITORY_READ_MODEL_CHARGER_KEY]: readModelLoader,
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Impossible de charger les données de la fiche.')
    await wrapper.get('button.bouton-reessayer').trigger('click')
    await flushPromises()

    expect(demandes).toEqual([])
    expect(readModelLoader).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Mobilité')
  })
})

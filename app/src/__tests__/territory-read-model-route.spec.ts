import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TerritoireView from '@/views/TerritoireView.vue'
import { routes } from '@/router'
import { varianteDeUrl } from '@/fiche/prototype/variantes'
import {
  indicateursMobiliteFixture,
  histoiresMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '@/payload/fixtures'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '@/payload/usePayload'
import {
  TERRITORY_READ_MODEL_CHARGER_KEY,
  payloadDepuisModeleTerritoire,
  validerModeleTerritoire,
} from '@/payload/territoryReadModel'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import { PayloadError } from '@/payload/validate'
import CahierComparisonNote from '@/fiche/prototype/CahierComparisonNote.vue'

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
  it('updates comparison labels and availability after navigating between communes', async () => {
    const varianteE = varianteDeUrl('E')
    await (varianteE?.composant as any).__asyncLoader?.()
    const modelFor = (id: string) => validerModeleTerritoire(
      JSON.parse(readFileSync(resolve(process.cwd(),
        `../public/data/modeles-lecture/territoires/commune/${id}.json`), 'utf8')),
      `territoires/commune/${id}.json`, { type: 'commune', territoire: id },
      { requireAllThemes: true },
    )
    const rennes = modelFor('35238')
    const destination = modelFor('22001')
    const loader = vi.fn(async (_type: string, id: string) => id === '35238' ? rennes : destination)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/territoire/commune/35238?theme=mobilite&variant=E&comparaison=epci')
    await router.isReady()
    const wrapper = mount(TerritoireView, {
      global: { plugins: [router], provide: { [TERRITORY_READ_MODEL_CHARGER_KEY]: loader } },
    })
    await flushPromises()
    const note = () => wrapper.findAllComponents(CahierComparisonNote)
      .find((candidate) => candidate.find('button[aria-haspopup="listbox"]').exists())
    expect(note()?.text()).toContain('Rennes Métropole')

    await router.push('/territoire/commune/22001?theme=mobilite&variant=E&comparaison=epci')
    await flushPromises()
    expect(note()?.text()).not.toContain('Rennes Métropole')
    expect(note()?.text()).toContain(destination.themes.mobilite?.comparisons.epci?.scope.label)

    const withoutEpci = { ...destination, territory: { ...destination.territory, epci: null },
      territories: destination.territories.map((item) => item.territoire === '22001'
        ? { ...item, epci: null } : item),
      themes: { ...destination.themes, mobilite: { ...destination.themes.mobilite!,
        comparisons: { ...destination.themes.mobilite!.comparisons, epci: undefined } } } }
    loader.mockResolvedValue(withoutEpci as typeof destination)
    await router.push('/territoire/commune/35238?theme=mobilite&variant=E')
    await flushPromises()
    await router.push('/territoire/commune/22001?theme=mobilite&variant=E&comparaison=epci')
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBeUndefined()
    expect(note()?.findAll('[role="option"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it.each([
    { type: 'epci', id: '243500139', scope: 'EPCI bretons' },
    { type: 'departement', id: '35', scope: 'départements bretons' },
  ] as const)('uses the published fixed comparison on a $type fiche', async ({ type, id, scope }) => {
    const varianteE = varianteDeUrl('E')
    await (varianteE?.composant as any).__asyncLoader?.()
    const publishedModel = JSON.parse(readFileSync(
      resolve(process.cwd(), `../public/data/modeles-lecture/territoires/${type}/${id}.json`),
      'utf8',
    ))
    const validatedModel = validerModeleTerritoire(
      publishedModel,
      `territoires/${type}/${id}.json`,
      { type, territoire: id },
      { requireAllThemes: true },
    )
    const comparison = validatedModel.themes.mobilite?.comparisons.bretagne
    expect(comparison?.scope.label).toBe(scope)
    const projectedFacts = territoryFactsFor(
      payloadDepuisModeleTerritoire(validatedModel),
      id,
      comparison,
    )
    expect(projectedFacts?.mobility.buildingDistribution?.comparisonLabel).toBe(scope)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => publishedModel,
    }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push(`/territoire/${type}/${id}?theme=mobilite&variant=E`)
      await router.isReady()
      const wrapper = mount(TerritoireView, { global: { plugins: [router] } })
      await flushPromises()

      const labels = wrapper.findAllComponents(CahierComparisonNote)
        .map((note) => note.props('label'))
      expect(wrapper.text()).not.toContain('Impossible de charger les données de la fiche.')
      expect(
        labels.some((label) =>
          typeof label === 'string' &&
          label.includes(scope) &&
          !label.includes('Comparaison indisponible'),
        ),
        `comparaison publiée ${scope}, libellés rendus : ${JSON.stringify(labels)}`,
      ).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders Rennes from the published commune read model', async () => {
    const publishedModel = JSON.parse(readFileSync(
      resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/35238.json'),
      'utf8',
    ))
    const validatedModel = validerModeleTerritoire(
      publishedModel,
      'territoires/commune/35238.json',
      { type: 'commune', territoire: '35238' },
      { requireAllThemes: true },
    )
    expect(validatedModel.themes.mobilite?.comparisons.epci?.buildingDistribution?.label)
      .toBe('communes de Rennes Métropole')
    expect(validatedModel.themes.mobilite?.comparisons.epci?.accessRamp?.label)
      .toBe('communes de Rennes Métropole')
    const comparisons = validatedModel.themes.mobilite?.comparisons
    for (const mode of ['densite', 'epci', 'bretagne'] as const) {
      const context = comparisons?.[mode]
      expect(context?.buildingDistribution?.label).toBe(context?.scope.label)
      expect(context?.accessRamp?.label).toBe(context?.scope.label)
      expect(context?.buildingDistribution?.totalBuildings).toBeGreaterThan(0)
      expect(context?.accessRamp?.totalBuildings).toBeGreaterThan(0)
    }
    expect(comparisons?.bretagne?.buildingDistribution?.totalBuildings)
      .toBeGreaterThan(comparisons?.epci?.buildingDistribution?.totalBuildings ?? 0)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => publishedModel,
    }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push('/territoire/commune/35238?theme=mobilite&variant=D&plate=C&map=rennes')
      await router.isReady()
      const wrapper = mount(TerritoireView, { global: { plugins: [router] } })
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/data/modeles-lecture/territoires/commune/35238.json')
      expect(wrapper.text()).not.toContain('Impossible de charger les données de la fiche.')
      expect(wrapper.find('h1').text()).toBe('Rennes')
    } finally {
      vi.unstubAllGlobals()
    }
  })

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

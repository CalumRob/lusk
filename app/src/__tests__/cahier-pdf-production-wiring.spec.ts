/**
 * #1025 — integration lot E's one production junction.
 *
 * The owning production component supplies the real browser composer to the
 * shared Cahier shell through the public `pdfGenerator` seam. The composer
 * itself, the controller machine and the nine-section action mount are covered
 * by their own suites; this spec proves only that production actually wires the
 * real factory and stays honest while that factory is still loading.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import type { ControleComparaison } from '@/fiche/comparisonContext'
import ProductionMobiliteAedar from '@/fiche/mobilite/ProductionMobiliteAedar.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { territoiresFixture } from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { routes } from '@/router'
import { aedarReadyFixtures, cahierExportFixture } from './helpers/cahierExportFixtures'

const GENERATEUR_EN_ATTENTE = 'La génération du PDF n’est pas encore disponible.'

// A stand-in for the composer module only so the test can OBSERVE when the
// production wrapper imports it. Production never installs this stand-in: it
// installs a wrapper that calls the real factory on export intent.
const composer = vi.hoisted(() => ({ factoryCalls: 0, generator: vi.fn() }))
vi.mock('../fiche/prototype/cahierPdfComposer', () => ({
  creerGenerateurCahierPdf: () => {
    composer.factoryCalls += 1
    return composer.generator
  },
}))

function control(): ControleComparaison {
  return {
    focal: territoiresFixture[0]!,
    territoires: territoiresFixture,
    selection: { etat: 'defaut' },
    libelleActif: null,
    presetDefaut: 'epci',
    presets: [],
    choisir: () => {},
  }
}

async function mountProduction() {
  const { content } = cahierExportFixture()
  const { summary, detail } = aedarReadyFixtures()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  return mount(ProductionMobiliteAedar, {
    props: {
      content,
      pagination: cahierPaginationFor({} as Payload, content, true),
      aedarData: detail,
      aedarStatus: 'ready',
      retryAedar: () => {},
      aedarSummaryData: { status: 'ready', summary },
      aedarSummaryStatus: 'ready',
      retryAedarSummary: () => {},
      aedarReferenceTerritoire: { type: 'epci', id: '200000001', nom: 'EPCI test' },
      aedarReferenceData: null,
      aedarReferenceStatus: 'unavailable',
      aedarActive: false,
      nativeComparisonStatus: 'ready',
    },
    global: {
      plugins: [router],
      provide: { [CONTROLE_COMPARAISON_KEY as symbol]: ref(control()) },
    },
  })
}

describe('production Cahier PDF wiring (#1025)', () => {
  it('delegates export intent to the real composer factory, not a mock or timer', async () => {
    composer.factoryCalls = 0
    const wrapper = await mountProduction()
    const shell = () => wrapper.getComponent(VarianteCahierLibre)

    // The installed generator is a function at mount, but the composer factory
    // has not been called: import and factory creation happen on export intent.
    const generator = shell().props('pdfGenerator') as (...args: unknown[]) => Promise<unknown>
    expect(typeof generator).toBe('function')
    expect(composer.factoryCalls).toBe(0)
    expect(wrapper.findAll('.cahier-pdf-action')).toHaveLength(9)
    expect(wrapper.findAll('.cahier-pdf-action__reason')
      .some((reason) => reason.text() === GENERATEUR_EN_ATTENTE)).toBe(false)
    await flushPromises()
    expect(composer.factoryCalls).toBe(0)

    // Acting on the public generator calls the real factory and returns its
    // result directly — no simulated success, no deferred timer, no object URL.
    const artifact = { blob: new Blob(['%PDF-1.7']), fileName: 'reel.pdf' }
    composer.generator.mockResolvedValueOnce(artifact)
    const result = await generator({}, { signal: new AbortController().signal })
    expect(composer.factoryCalls).toBe(1)
    expect(result).toBe(artifact)
    wrapper.unmount()
  })

  it('keeps one stable generator identity across ordinary re-renders', async () => {
    const wrapper = await mountProduction()
    await vi.waitFor(() => {
      expect(typeof wrapper.getComponent(VarianteCahierLibre).props('pdfGenerator')).toBe('function')
    })
    const generator = wrapper.getComponent(VarianteCahierLibre).props('pdfGenerator')
    expect(typeof generator).toBe('function')

    await wrapper.setProps({ aedarActive: true })
    await flushPromises()
    expect(wrapper.getComponent(VarianteCahierLibre).props('pdfGenerator')).toBe(generator)
    wrapper.unmount()
  })

  it('installs one real generator that reports an honest failure when the composer rejects', async () => {
    composer.factoryCalls = 0
    const wrapper = await mountProduction()
    const generator = wrapper.getComponent(VarianteCahierLibre).props('pdfGenerator') as
      (...args: unknown[]) => Promise<unknown>
    const failure = new Error('composer indisponible')
    composer.generator.mockRejectedValueOnce(failure)
    await expect(generator({}, { signal: new AbortController().signal })).rejects.toThrow(failure)
    expect(composer.factoryCalls).toBe(1)
    wrapper.unmount()
  })
})

/**
 * #1025 — integration lot E's one production junction.
 *
 * The owning production component supplies the real browser composer to the
 * shared Cahier shell through the public `pdfGenerator` seam. The composer
 * itself, the controller machine and the nine-section action mount are covered
 * by their own suites; this spec proves only that production actually wires the
 * real factory and stays honest while that factory is still loading.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  it('installs a lazy generator at mount and defers the composer chunk to export intent', async () => {
    const wrapper = await mountProduction()
    const shell = () => wrapper.getComponent(VarianteCahierLibre)

    // The installed generator is a thin wrapper: it is a function immediately
    // (no pending/unavailable state), but the 84.5 kB composer module is only
    // imported when the function is actually invoked by an export.
    const generator = shell().props('pdfGenerator')
    expect(typeof generator).toBe('function')
    expect(wrapper.findAll('.cahier-pdf-action')).toHaveLength(9)
    expect(wrapper.findAll('.cahier-pdf-action__reason')
      .some((reason) => reason.text() === GENERATEUR_EN_ATTENTE)).toBe(false)
    await flushPromises()
    expect(shell().props('pdfGenerator')).toBe(generator)
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

  it('wires the real composer factory without a mock generator, timer or object URL', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'fiche', 'mobilite', 'ProductionMobiliteAedar.vue'),
      'utf-8',
    )
    expect(source).toContain('creerGenerateurCahierPdf')
    expect(source).not.toContain('setTimeout')
    expect(source).not.toContain('createObjectURL')
    expect(source).not.toContain('mock')
  })
})

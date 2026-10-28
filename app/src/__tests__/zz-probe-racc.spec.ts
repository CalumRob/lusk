import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { indicateursMobiliteFixture, territoiresFixture } from '../payload/fixtures'
import { INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY } from '../payload/indicatorReadModel'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'
import { validerThemeMetadata } from '../payload/validate'
import { nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture } from './helpers/semanticApiFixtures'
import { datasetDeSource } from '../methodes/sources'
import { sourceRecords } from '../payload/selectors'

const metadataMobilite = validerThemeMetadata(JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_mobilite.json'), 'utf8')), 'theme_mobilite.json')

describe('probe raccordement card', () => {
  it('dumps the source card identity', async () => {
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_mobilite') return indicateursMobiliteFixture
      if (file === 'theme_mobilite') return metadataMobilite
      throw new Error(`unexpected static read: ${file}`)
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        return nativeBatchResponse(items, nativeReadFixture)
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/mobilite/raccordement_courbe?territoire=22001&niveau=commune')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { mobilite: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    await flushPromises()
    await wrapper.findAll('.vues button')[2].trigger('click')
    await flushPromises()
    const cards = wrapper.findAll('.source-card')
    console.log('CARDS:', cards.length)
    for (const card of cards) {
      console.log('CARD H3:', card.find('h3').text())
      console.log('CARD TEXT:', card.text().replace(/\s+/g, ' ').slice(0, 260))
      console.log('LINKS:', card.findAll('a').map((link) => link.attributes('href')))
    }
    console.log('datasetDeSource(matrice_temps_mairies):', datasetDeSource('matrice_temps_mairies'))
    console.log('fact_sources[0]:', JSON.stringify((wrapper.vm as any).$.setupState?.facts?.slice?.(0, 1)))
    wrapper.unmount()
    void sourceRecords
  })
})

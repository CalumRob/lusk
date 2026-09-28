import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { indicateursDemographieFixture, territoiresFixture } from '../payload/fixtures'
import type { ThemeMetadata } from '../payload/types'
import { INDICATOR_READ_MODEL_CHARGER_KEY, INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY } from '../payload/indicatorReadModel'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'

beforeEach(() => localStorage.clear())

const metadataCanonique = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_demographie.json'), 'utf8')) as ThemeMetadata

function profileResponse() {
  const page = metadataCanonique.indicator_pages!.structure_age!
  const facts = indicateursDemographieFixture.filter((fact) => fact.key === 'structure_age')
  const focal = facts.filter((fact) => fact.territoire === '22001')
  const stamp = focal[0]!
  return {
    indicator: 'structure_age', label: page.label, unit: page.unit, content_version: 'profile-v1', descriptor_version: 'd1',
    axes: [...page.comparison!.details!.map((key, order) => ({ name: 'detail', key, label: page.comparison!.labels![key]!, order })),
      ...page.comparison!.sexes!.map((key, order) => ({ name: 'sex', key, label: key, order }))],
    cells: focal.map((fact) => ({ detail: fact.detail!, sex: fact.sex!, value: fact.value, status: fact.value === null ? 'not_available' : 'measured' })),
    comparison: { detail: page.comparison!.detail!, sex: page.comparison!.sex!, direction: page.direction, scope: 'bretagne', scope_id: null,
      values: facts.filter((fact) => fact.type === 'commune' && fact.detail === page.comparison!.detail && fact.sex === page.comparison!.sex)
        .map((fact) => ({ territory_id: fact.territoire, name: territoiresFixture.find((territory) => territory.territoire === fact.territoire)?.nom ?? fact.territoire,
          value: fact.value, status: fact.value === null ? 'not_available' : 'measured' })) },
    sources: [{ source_id: 'age_detail', name: stamp.vintage_source, version: stamp.vintage_version,
      reference_date: stamp.vintage_date_reference, publication_date: stamp.vintage_date_publication }],
  }
}

function mountPage(fetcher: ChargerFichier) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return router.push('/indicateurs/demographie/structure_age?territoire=22001&niveau=commune').then(async () => {
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    return mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: fetcher,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { demographie: [] } }),
      [INDICATOR_READ_MODEL_CHARGER_KEY]: vi.fn(async () => { throw new Error('static read model must not load') }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
  })
}

describe("Page structure_age — lecture API sans repli statique", () => {
  it('adapte le profil API et conserve les autres faits statiques sans charger le fait structure_age depuis le snapshot', async () => {
    const payloadFiles: string[] = []
    const payloadLoader: ChargerFichier = async (file) => {
      payloadFiles.push(file)
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_demographie') return indicateursDemographieFixture
      if (file === 'theme_demographie') return metadataCanonique
      throw new Error(`unexpected static facts file ${file}`)
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input) === '/data/theme_demographie.json' ? metadataCanonique : profileResponse()), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const wrapper = await mountPage(payloadLoader)
    await flushPromises()
    expect(fetcher).toHaveBeenCalledWith('/api/territories/commune/22001/profiles/structure_age')
    expect(fetcher).toHaveBeenCalledWith('/data/theme_demographie.json')
    expect(payloadFiles).toContain('theme_demographie')
    expect(payloadFiles).toContain('indicateurs_demographie')
    expect(wrapper.text()).toContain('Structure par âge')
    wrapper.unmount()
  })

  it('montre erreur/retry et ne demande jamais le payload statique après indisponibilité API', async () => {
    const payloadFiles: string[] = []
    const payloadLoader: ChargerFichier = async (file) => {
      payloadFiles.push(file)
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_demographie') return indicateursDemographieFixture
      if (file === 'theme_demographie') return metadataCanonique
      throw new Error(`unexpected static facts file ${file}`)
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input) === '/data/theme_demographie.json'
      ? new Response(JSON.stringify(metadataCanonique), { status: 200 })
      : new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const wrapper = await mountPage(payloadLoader)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Réessayer')
    const beforeRetry = fetcher.mock.calls.filter(([url]) => String(url).includes('/profiles/structure_age')).length
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/profiles/structure_age'))).toHaveLength(beforeRetry + 1)
    expect(payloadFiles).toContain('indicateurs_demographie')
    wrapper.unmount()
  })
})

import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { indicateursEconomieFixture, territoiresFixture } from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { validerThemeMetadata } from '../payload/validate'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'

const economyMetadata = { ...JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_economie.json'), 'utf8')),
  scalar_contracts: ['effectifs_salaries', 'chomage'] }
beforeEach(() => { localStorage.clear(); vi.stubEnv('VITE_SCALAR_COHORT_API', '1') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function response(indicator = 'effectifs_salaries') {
  const page = economyMetadata.indicator_pages[indicator]
  return { indicator_id: indicator, territory_type: 'commune', label: page.label, unit: page.unit,
    direction: page.direction, comparison_facet: indicator, completeness: 'sparse', content_version: 'scalar-v1',
    observations: [
      { territory_id: '22001', name: 'Commune A1', value: 9, status: 'measured', sources: [{ source_id: page.sources[0], name: 'Source', vintage_id: 'v1', version: '2024', reference_date: null, publication_date: null }] },
      { territory_id: '22002', name: 'Commune D', value: null, status: 'not_published', sources: [] },
    ] }
}

async function mountEconomy(initial = '/indicateurs/economie/effectifs_salaries?territoire=22001&niveau=commune', allowStatic = false) {
  const payloadCalls: string[] = []
  const loader: ChargerFichier = async (file) => {
    payloadCalls.push(file)
    if (file === 'territoires') return territoiresFixture
    if (allowStatic && file === 'indicateurs_economie') return indicateursEconomieFixture
    if (allowStatic && file === 'theme_economie') return validerThemeMetadata(economyMetadata, 'theme_economie.json')
    throw new Error(`static scalar payload must not be requested: ${file}`)
  }
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(initial); await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
    [PAYLOAD_CHARGER_KEY]: loader,
    [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
  } } })
  return { wrapper, router, payloadCalls }
}

describe('Page indicateur économie — cohorte scalaire API', () => {
  it('acquiert les faits via API pour Repères et Carte sans charger les faits statiques', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/theme_economie.json') return new Response(JSON.stringify(economyMetadata), { status: 200 })
      return new Response(JSON.stringify(response()), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, payloadCalls } = await mountEconomy()
    await flushPromises()
    expect(payloadCalls).toEqual(['territoires'])
    expect(fetcher).toHaveBeenCalledWith('/api/territories/commune/22001/indicator-cohorts/effectifs_salaries?scope_level=commune')
    expect(wrapper.text()).toContain('Effectifs salariés (lieu de travail)')
    expect(wrapper.text()).toContain('9')
    await wrapper.get('.vues button:nth-child(2)').trigger('click')
    await flushPromises()
    expect(wrapper.find('.carte-indicateur').exists()).toBe(true)
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('indicator-cohorts'))).toHaveLength(1)
    wrapper.unmount()
  })

  it('montre une erreur retryable sans repli statique quand le cohort API est indisponible', async () => {
    let attempts = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/data/theme_economie.json') return new Response(JSON.stringify(economyMetadata), { status: 200 })
      attempts++
      return attempts === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify(response()), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, payloadCalls } = await mountEconomy()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Réessayer')
    expect(payloadCalls).toEqual(['territoires'])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(attempts).toBe(2)
    expect(wrapper.text()).toContain('9')
    wrapper.unmount()
  })

  it('reacts to page navigation and deduplicates requests per normalized page/scope', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/theme_economie.json') return new Response(JSON.stringify(economyMetadata), { status: 200 })
      const indicator = url.includes('/chomage?') ? 'chomage' : 'effectifs_salaries'
      return new Response(JSON.stringify(response(indicator)), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, router } = await mountEconomy()
    await flushPromises()
    await router.push('/indicateurs/economie/chomage?territoire=22001&niveau=commune')
    await flushPromises()
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('indicator-cohorts'))).toHaveLength(2)
    expect(wrapper.text()).toContain('Chômage (population active)')
    wrapper.unmount()
  })

  it('keeps the newest level cohort when a previous request resolves out of order', async () => {
    let finishCommune: ((value: Response) => void) | undefined
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/theme_economie.json') return Promise.resolve(new Response(JSON.stringify(economyMetadata), { status: 200 }))
      if (url.includes('/commune/')) return new Promise<Response>((resolve) => { finishCommune = resolve })
      const page = economyMetadata.indicator_pages.effectifs_salaries
      return Promise.resolve(new Response(JSON.stringify({ ...response(), territory_type: 'departement',
        observations: [{ territory_id: '22', name: 'Département 22', value: 222, status: 'measured',
          sources: [{ source_id: page.sources[0], name: 'Source', vintage_id: 'v1', version: '2024', reference_date: null, publication_date: null }] }] }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, router } = await mountEconomy()
    await flushPromises()
    await router.push('/indicateurs/economie/effectifs_salaries?territoire=22001&niveau=departement')
    await flushPromises()
    expect(wrapper.text()).toContain('222')
    finishCommune?.(new Response(JSON.stringify(response()), { status: 200 }))
    await flushPromises()
    expect(wrapper.text()).toContain('222')
    wrapper.unmount()
  })

  it('retains unregistered sparse-evidence pages on their static contract when scalar cutover is enabled', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/data/theme_economie.json') return new Response(JSON.stringify(economyMetadata), { status: 200 })
      throw new Error('unregistered page must not call the scalar API')
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, payloadCalls } = await mountEconomy(
      '/indicateurs/economie/eco_activites?territoire=22001&niveau=commune', true)
    await flushPromises()
    expect(payloadCalls).toEqual(['territoires', 'indicateurs_economie', 'theme_economie'])
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('indicator-cohorts'))).toHaveLength(0)
    expect(wrapper.text()).toContain('Part des éco-activités')
    wrapper.unmount()
  })
})

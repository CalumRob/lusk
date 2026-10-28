import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY, INDICATOR_READ_MODEL_CHARGER_KEY } from '../payload/indicatorReadModel'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'
import { createNativeSemanticApiTransport } from './helpers/nativeSemanticApiTransport'

const territoires = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
const defaultTransport = createNativeSemanticApiTransport()

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(defaultTransport))
})
afterEach(() => vi.unstubAllGlobals())

describe("Page d'indicateur — coupure scalaires ordinaires du modèle de lecture (#855)", () => {
  async function mountDensity(manifestIncludesScalar = true) {
    const payloadCalls: string[] = []
    const payloadLoader: ChargerFichier = async (file) => {
      payloadCalls.push(file)
      if (file === 'territoires') return territoires
      throw new Error(`ordinary scalar page requested a static payload: ${file}`)
    }
    const manifestLoader = vi.fn(async () => ({ schemaVersion: '1' as const,
      routes: { demographie: manifestIncludesScalar ? ['densite'] : [] } }))
    const readModelLoader = vi.fn()
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=22001&niveau=commune&epci=200067460')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: payloadLoader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: manifestLoader,
      [INDICATOR_READ_MODEL_CHARGER_KEY]: readModelLoader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    return { wrapper, payloadCalls, manifestLoader, readModelLoader }
  }

  it('acquires ordinary scalar facts through the semantic API before the indicator manifest', async () => {
    const { wrapper, payloadCalls, manifestLoader, readModelLoader } = await mountDensity()
    try {
      expect(wrapper.get('h1').text()).toBe('Densité de population')
      expect(wrapper.find('[data-testid="scalar-comparison-summary"]').exists()).toBe(true)
      expect(payloadCalls).toEqual(['territoires'])
      expect(manifestLoader).not.toHaveBeenCalled()
      expect(readModelLoader).not.toHaveBeenCalled()
      expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain('/api/resources/read-batch')
    } finally { wrapper.unmount() }
  })

  it('does not let an indicator manifest that omits the page downgrade a producer-owned scalar page', async () => {
    const { wrapper, payloadCalls, manifestLoader, readModelLoader } = await mountDensity(false)
    try {
      expect(wrapper.get('h1').text()).toBe('Densité de population')
      expect(payloadCalls).toEqual(['territoires'])
      expect(manifestLoader).not.toHaveBeenCalled()
      expect(readModelLoader).not.toHaveBeenCalled()
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/data/indicateurs_'))).toBe(false)
    } finally { wrapper.unmount() }
  })

  it('retries discovery before selecting a reader and then stays on the API path', async () => {
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources' && transport.mock.calls.filter(([url]) => String(url) === '/api/resources').length === 1) {
        return new Response('temporary catalogue outage', { status: 503 })
      }
      return defaultTransport(input, init)
    })
    vi.stubGlobal('fetch', transport)
    const payloadCalls: string[] = []
    const payloadLoader: ChargerFichier = async (file) => {
      payloadCalls.push(file)
      if (file === 'territoires') return territoires
      throw new Error(`ordinary scalar page requested a static payload: ${file}`)
    }
    const manifestLoader = vi.fn()
    const readModelLoader = vi.fn()
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=22001&niveau=commune&epci=200067460')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: payloadLoader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: manifestLoader,
      [INDICATOR_READ_MODEL_CHARGER_KEY]: readModelLoader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(wrapper.get('[role="alert"] button').text()).toContain('Réessayer')
      expect(payloadCalls).toEqual(['territoires'])
      expect(manifestLoader).not.toHaveBeenCalled()
      expect(readModelLoader).not.toHaveBeenCalled()
      await wrapper.get('[role="alert"] button').trigger('click')
      await flushPromises()
      expect(wrapper.get('h1').text()).toBe('Densité de population')
      expect(payloadCalls).toEqual(['territoires'])
      expect(manifestLoader).not.toHaveBeenCalled()
      expect(readModelLoader).not.toHaveBeenCalled()
      expect(transport.mock.calls.map(([url]) => String(url)).filter((url) => url === '/api/resources')).toHaveLength(2)
      expect(transport.mock.calls.map(([url]) => String(url)).filter((url) => url === '/api/resources/read-batch')).toHaveLength(2)
    } finally { wrapper.unmount() }
  })
})

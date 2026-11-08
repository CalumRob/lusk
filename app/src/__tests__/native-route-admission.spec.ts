import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { chargerAvec, histoiresDemographieFixture, indicateursDemographieFixture, runReportFraisFixture,
  territoiresFixture, vintagesFixture } from '../payload/fixtures'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { nativeResources } from './helpers/semanticApiFixtures'
import { createNativeSemanticApiTransport } from './helpers/nativeSemanticApiTransport'
import IndicateurView from '../views/IndicateurView.vue'

afterEach(() => vi.unstubAllGlobals())

describe('admission native des routes d’indicateur', () => {
  it('does not admit a trajectory page when discovery advertises only its scalar shape', async () => {
    const prix = nativeResources('habitat').find((resource) => resource.resource_id === 'prix_m2')!
    expect(prix.shapes).toContain('ordered_series')
    const nativeTransport = createNativeSemanticApiTransport()
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/api/resources') return nativeTransport(input, init)
      const response = await nativeTransport(input, init)
      const catalogue = await response.json() as { resources: Array<Record<string, unknown>> }
      catalogue.resources = catalogue.resources.map((resource) => resource.resource_id === 'prix_m2'
        ? { ...resource, shapes: ['scalar'] }
        : resource)
      return new Response(JSON.stringify(catalogue), { status: 200 })
    })
    vi.stubGlobal('fetch', transport)

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/habitat/prix_m2')
    await router.isReady()
    const payload: Payload = {
      territoires: territoiresFixture,
      indicateurs: indicateursDemographieFixture,
      histoires: histoiresDemographieFixture,
      runReport: runReportFraisFixture,
      vintages: vintagesFixture,
      programmes: null,
    }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: chargerAvec(payload),
      [GEOMETRIE_CHARGER_KEY]: async () => ({
        communes: { type: 'FeatureCollection' as const, features: [] },
        epcis: { type: 'FeatureCollection' as const, features: [] },
        departements: { type: 'FeatureCollection' as const, features: [] },
      }),
    } } })
    try {
      await flushPromises()
      expect(transport.mock.calls.some(([url]) => String(url) === '/api/resources')).toBe(true)
      expect(wrapper.text()).toContain('Indicateur introuvable')
      expect(wrapper.text()).not.toContain('Prix au m²')
    } finally {
      wrapper.unmount()
    }
  })
})

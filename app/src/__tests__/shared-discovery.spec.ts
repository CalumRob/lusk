import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../App.vue'
import AppHeader from '../components/AppHeader.vue'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { chargerAvec, histoiresDemographieFixture, indicateursDemographieFixture,
  runReportFraisFixture, territoiresFixture, vintagesFixture } from '../payload/fixtures'
import type { Payload } from '../payload/types'
import { nativeResources } from './helpers/semanticApiFixtures'

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('découverte native partagée par la coquille et le catalogue', () => {
  it('recovers the persistent header from a catalogue-only retry after shared discovery fails', async () => {
    let attempts = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/resources')
      attempts += 1
      if (attempts === 1) throw new Error('discovery unavailable')
      return new Response(JSON.stringify({
        contract: 'semantic-resource-catalogue-v1',
        resources: nativeResources(),
      }))
    })
    vi.stubGlobal('fetch', fetcher)

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs')
    await router.isReady()
    const wrapper = mount(App, { global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: chargerAvec(payload) },
    } })
    try {
      await flushPromises()
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(wrapper.find('[role="alert"]').text()).toContain('indisponible')
      expect(wrapper.find('[data-testid="search-indicators-error"]').exists()).toBe(false)

      const header = wrapper.findComponent(AppHeader)
      const headerElement = header.element
      await header.find('.bouton-recherche').trigger('click')
      const champ = header.find('.recherche-superposee input[role="combobox"]')
      await champ.trigger('focus')
      await champ.setValue('epci')
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(header.find('[role="group"][aria-label="Territoires"]').exists()).toBe(true)
      expect(header.findAll('[role="option"]').some((option) => option.text().includes('EPCI'))).toBe(true)
      expect(header.find('[data-testid="search-indicators-error"]').text())
        .toContain('La recherche d’indicateurs est indisponible.')
      expect(header.find('[data-testid="search-indicators-retry"]').exists()).toBe(true)

      // The catalogue retry alone resolves the app-scoped state observed by both consumers.
      await wrapper.find('.catalogue-retry').trigger('click')
      await flushPromises()

      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(wrapper.findComponent(AppHeader).element).toBe(headerElement)
      expect(wrapper.find('.catalogue-liste a[href="/indicateurs/demographie/densite"]').exists()).toBe(true)
      expect(header.find('[data-testid="search-indicators-error"]').exists()).toBe(false)
      expect(header.find('[data-testid="search-indicators-retry"]').exists()).toBe(false)

      await champ.setValue('densité')
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(header.find('[role="group"][aria-label="Indicateurs"]').text())
        .toContain('Densité de population')
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      wrapper.unmount()
    }
  })
})

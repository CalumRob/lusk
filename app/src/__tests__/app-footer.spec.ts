import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import AppFooter from '../components/AppFooter.vue'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { routes } from '../router'

describe('AppFooter — navigation sobre partagée (#1027)', () => {
  it.each(['/', '/indicateurs', '/sources', '/a-propos'])('conserve les liens sur %s sans biographie, fraîcheur ni acquisition de données', async (path) => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(path)
    await router.isReady()
    const charger = vi.fn(() => new Promise(() => {}))
    const wrapper = mount(AppFooter, {
      global: { plugins: [router], provide: { [PAYLOAD_CHARGER_KEY]: charger } },
    })
    expect(wrapper.findAll('a').map((l) => l.attributes('href'))).toEqual([
      '/sources', '/a-propos', 'https://calumrobertson.fr',
    ])
    expect(wrapper.text()).not.toMatch(/Conçu par|Docteur|Données actualisées/)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(charger).not.toHaveBeenCalled()
    const externe = wrapper.get('a[href="https://calumrobertson.fr"]')
    expect(externe.attributes('rel')).toBe('noopener noreferrer')
  })
})

import { mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import App from '../App.vue'
import { routes } from '../router'

/**
 * Smoke test: the app shell renders and the router-view resolves a real
 * placeholder view. Kept deliberately minimal — this ticket is the
 * foundation, not the features.
 */

function mountApp(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push(path)
  return { router, wrapper: mount(App, { global: { plugins: [router] } }) }
}

describe('App shell', () => {
  it('renders the router-view container', async () => {
    const { router, wrapper } = mountApp('/')
    await router.isReady()

    expect(wrapper.find('.app-shell').exists()).toBe(true)
    expect(wrapper.find('.app-shell > main').exists()).toBe(true)
  })

  it('renders the Accueil placeholder at /', async () => {
    const { router, wrapper } = mountApp('/')
    await router.isReady()

    expect(wrapper.text()).toContain('Accueil')
  })

  it('navigates to the Carte placeholder', async () => {
    const { router, wrapper } = mountApp('/')
    await router.isReady()

    await router.push('/carte')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Carte')
  })
})

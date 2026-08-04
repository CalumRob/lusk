import { mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import { routes } from '../router'
import MethodologieView from '../views/MethodologieView.vue'

/**
 * /methodologie — Sources & Méthodes (site-map.md). The shell ticket (D4):
 * the route must exist and render a minimal, honest shell. Content is
 * deferred (decided 2026-08-03) — so the page states factually what will
 * live here, with the empty-state pattern from ui-elements.md (icon + one
 * line + action), and never a construction banner (principles.md §1).
 */

async function monter() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/methodologie')
  await router.isReady()
  return mount(MethodologieView, { global: { plugins: [router] } })
}

describe('MethodologieView — la coquille honnête', () => {
  it('renders the page title « Sources & Méthodes »', async () => {
    const wrapper = await monter()

    expect(wrapper.find('h1').text()).toBe('Sources & Méthodes')
  })

  it('states honestly what will live here — no construction banner', async () => {
    const wrapper = await monter()

    expect(wrapper.text()).toContain(
      'Les sources, définitions et la fraîcheur des données seront documentées ici.',
    )
    expect(wrapper.text()).not.toMatch(/à venir|en construction|bientôt|under construction/i)
  })

  it('renders the deferred body as an empty state (icon + one line + action)', async () => {
    const wrapper = await monter()

    const etatVide = wrapper.find('.etat-vide')
    expect(etatVide.exists()).toBe(true)
    expect(etatVide.find('svg').exists()).toBe(true)
    expect(etatVide.find('p').exists()).toBe(true)
    expect(etatVide.find('a').exists()).toBe(true)
  })
})

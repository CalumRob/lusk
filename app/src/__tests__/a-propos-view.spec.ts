import { mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import { routes } from '../router'
import AProposView from '../views/AProposView.vue'

/**
 * /a-propos — À propos (site-map.md). The shell ticket (D4): the route must
 * exist and render a minimal, honest shell — what Lusk is, the person behind
 * it (the footer attribution line is the template). ThemeTabs per-theme
 * explainers are LATER: the route stays ready with no placeholder tab logic
 * (site-map.md §Theme subheader).
 */

async function monter() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/a-propos')
  await router.isReady()
  return mount(AProposView, { global: { plugins: [router] } })
}

describe('AProposView — la coquille honnête', () => {
  it('renders the page title « À propos »', async () => {
    const wrapper = await monter()

    expect(wrapper.find('h1').text()).toBe('À propos')
  })

  it('introduces Lusk honestly in one line — no construction banner', async () => {
    const wrapper = await monter()

    expect(wrapper.text()).toContain('Lusk')
    expect(wrapper.text()).not.toMatch(/à venir|en construction|bientôt|under construction/i)
  })

  it('renders the one-line attribution (the footer template)', async () => {
    const wrapper = await monter()

    expect(wrapper.text()).toContain('Conçu par Calum Robertson — Docteur en économie urbaine.')
    const lien = wrapper.find('.a-propos__attribution a')
    expect(lien.attributes('href')).toBe('https://calumrobertson.fr')
  })

  it('leaves the route ready without placeholder tab logic', async () => {
    const wrapper = await monter()

    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
  })
})

import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import App from '../App.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'

/**
 * Smoke test: the app shell renders header + footer around the router-view,
 * and the router-view resolves a real placeholder view. Kept deliberately
 * minimal — the shell is built, the features land in later tickets.
 */

const payloadFixture: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
}

async function mountApp(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: async () => payloadFixture },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

describe('App shell', () => {
  it('renders the header, the router-view container and the footer', async () => {
    const { wrapper } = await mountApp('/')

    expect(wrapper.find('.en-tete').exists()).toBe(true)
    expect(wrapper.find('.app-shell > main').exists()).toBe(true)
    expect(wrapper.find('.pied').exists()).toBe(true)
  })

  it('offers a skip link to the main content', async () => {
    const { wrapper } = await mountApp('/')

    const lien = wrapper.find('.lien-evitement')
    expect(lien.attributes('href')).toBe('#contenu-principal')
    expect(wrapper.find('main').attributes('id')).toBe('contenu-principal')
  })

  it('renders the landing page at /', async () => {
    const { wrapper } = await mountApp('/')

    expect(wrapper.find('.accueil').exists()).toBe(true)
    expect(wrapper.text()).toContain('Lusk transforme les données publiques éparses')
  })

  it('navigates to the Carte placeholder', async () => {
    const { router, wrapper } = await mountApp('/')

    await router.push('/carte')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Carte')
  })

  it('hides the footer on the carte route (full-bleed tool page)', async () => {
    const { wrapper } = await mountApp('/carte')

    expect(wrapper.find('.pied').exists()).toBe(false)
  })

  it('renders the fiche route inside the shell', async () => {
    const { wrapper } = await mountApp('/territoire/commune/29002')

    expect(wrapper.find('.fiche').exists()).toBe(true)
  })
})

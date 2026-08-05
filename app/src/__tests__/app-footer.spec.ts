import { mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import AppFooter from '../components/AppFooter.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'

/**
 * AppFooter (site-map.md §Footer): one serif attribution line (« Conçu par
 * Calum Robertson — Docteur en économie urbaine. »), the freshness line
 * computed from the payload via ligneFraicheur, links to Méthodes, À propos
 * and calumrobertson.fr. The freshness line degrades honestly: skeleton
 * while loading, the static-rhythm claim on error.
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
}

async function monter(charger: () => Promise<Payload>) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(AppFooter, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
    },
  })
  return wrapper
}

describe('AppFooter — la ligne d’attribution', () => {
  it('renders the serif attribution line linking to calumrobertson.fr', async () => {
    const wrapper = await monter(async () => payload)

    const attribution = wrapper.find('.pied-attribution')
    expect(attribution.exists()).toBe(true)
    expect(attribution.text()).toContain('Conçu par Calum Robertson — Docteur en économie urbaine.')
    const lien = attribution.find('a')
    expect(lien.attributes('href')).toBe('https://calumrobertson.fr')
  })

  it('links to Méthodes, À propos and calumrobertson.fr', async () => {
    const wrapper = await monter(async () => payload)

    const liens = wrapper.findAll('a').map((l) => l.attributes('href'))
    expect(liens).toContain('/methodologie')
    expect(liens).toContain('/a-propos')
    expect(liens).toContain('https://calumrobertson.fr')
  })
})

describe('AppFooter — la ligne de fraîcheur', () => {
  it('shows a skeleton while the payload loads', async () => {
    let attendre: (v: Payload) => void = () => {}
    const promesse = new Promise<Payload>((resoudre) => {
      attendre = resoudre
    })
    const wrapper = await monter(() => promesse)

    expect(wrapper.find('.squelette').exists()).toBe(true)

    attendre(payload)
    await promesse
  })

  it('renders the freshness line computed from the payload (ligneFraicheur)', async () => {
    const wrapper = await monter(async () => payload)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Données actualisées le 3 août 2026')
  })

  it('falls back to the static-rhythm claim on a payload error', async () => {
    const wrapper = await monter(async () => {
      throw new Error('panne réseau')
    })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Données actualisées chaque semaine')
  })
})

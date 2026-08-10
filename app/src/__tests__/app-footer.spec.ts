import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import AppFooter from '../components/AppFooter.vue'
import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { PayloadError } from '../payload/validate'
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
  programmes: null,
}

async function monter(charger: (fichier: import('../payload/loader').Fichier) => Promise<unknown>) {
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
    const wrapper = await monter(chargerAvec(payload))

    const attribution = wrapper.find('.pied-attribution')
    expect(attribution.exists()).toBe(true)
    expect(attribution.text()).toContain('Conçu par Calum Robertson — Docteur en économie urbaine.')
    const lien = attribution.find('a')
    expect(lien.attributes('href')).toBe('https://calumrobertson.fr')
  })

  it('links to Méthodes, À propos and calumrobertson.fr', async () => {
    const wrapper = await monter(chargerAvec(payload))

    const liens = wrapper.findAll('a').map((l) => l.attributes('href'))
    expect(liens).toContain('/methodologie')
    expect(liens).toContain('/a-propos')
    expect(liens).toContain('https://calumrobertson.fr')
  })
})

describe('AppFooter — la ligne de fraîcheur', () => {
  it('shows the honest static-rhythm claim while run-report hasn\u2019t landed (the payload grows)', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const wrapper = await monter(() => enAttente)

    // Le payload n'est jamais null : la fraîcheur tombe sur la promesse
    // statique honnête (T3) — jamais une fausse date, jamais un squelette mort.
    expect(wrapper.find('.squelette').exists()).toBe(false)
    expect(wrapper.text()).toContain('Données actualisées chaque semaine')
  })

  it('renders the freshness line computed from the payload (ligneFraicheur)', async () => {
    const wrapper = await monter(chargerAvec(payload))
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

describe('AppFooter — le wait-set de la coquille (T3, #299)', () => {
  it('rend la ligne de fraîcheur réelle dès que run-report atterrit — le reste du payload peut pendre', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const wrapper = await monter(async (fichier) => {
      if (fichier === 'territoires') return territoiresFixture
      if (fichier === 'run-report') return runReportFraisFixture
      return enAttente
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Données actualisées le 3 août 2026')
    expect(wrapper.find('.squelette').exists()).toBe(false)
  })

  it('garde le repli honnête du rythme statique tant que run-report n’a pas atterri — même si territoires est là', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const wrapper = await monter(async (fichier) => {
      if (fichier === 'territoires') return territoiresFixture
      return enAttente
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Données actualisées chaque semaine')
    expect(wrapper.find('.squelette').exists()).toBe(false)
  })

  it('un échec d’arrière-plan ne masque jamais la vraie fraîcheur — l’erreur reste scopée au wait-set', async () => {
    const wrapper = await monter(async (fichier) => {
      if (fichier === 'indicateurs_habitat') {
        throw new PayloadError('fetch', 'indicateurs_habitat.json', 'panne réseau')
      }
      return chargerAvec(payload)(fichier)
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Données actualisées le 3 août 2026')
    expect(wrapper.text()).not.toContain('Données actualisées chaque semaine')
  })

  it('un échec de wait-set (run-report) → le repli honnête, jamais une fausse fraîcheur', async () => {
    const wrapper = await monter(async (fichier) => {
      if (fichier === 'run-report') {
        throw new PayloadError('fetch', 'run-report.json', 'panne réseau')
      }
      return chargerAvec(payload)(fichier)
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Données actualisées chaque semaine')
    expect(wrapper.find('.squelette').exists()).toBe(false)
  })
})

import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import CommunesView from '../views/CommunesView.vue'
import DepartementsView from '../views/DepartementsView.vue'
import EpcisView from '../views/EpcisView.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerPayload } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'

/**
 * The three data-list pages (/communes, /epcis, /departements) are thin
 * wrappers around the shared ListeTerritoires — each view only declares its
 * config (type, columns, filters). These specs lock the contract: the right
 * title, the right columns, the right filters per page.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
}

function chargerAvec(payload: Payload): ChargerPayload {
  return async () => payload
}

async function monter(chemin: string, composant: unknown) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(composant as never, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: chargerAvec(payloadDemographie) },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

const entetes = (wrapper: ReturnType<typeof mount>) =>
  wrapper
    .findAll('thead th')
    .map((th) => th.text().trim())
    .filter((texte) => texte !== 'Actions')

describe('CommunesView — /communes', () => {
  it('renders the communes directory: titre, colonnes nom | code | EPCI, filtres département + EPCI', async () => {
    const { wrapper } = await monter('/communes', CommunesView)

    expect(wrapper.find('h1').text()).toBe('Les communes')
    expect(entetes(wrapper)).toEqual(['Nom', 'Code', 'EPCI'])
    expect(wrapper.findAll('.puce').map((p) => p.text())).toEqual(['22', '29'])
    expect(wrapper.find('.filtre-epci-select').exists()).toBe(true)
    expect(wrapper.findAll('tbody tr')).toHaveLength(4)
  })
})

describe('EpcisView — /epcis', () => {
  it('renders the EPCI directory: titre, colonnes nom | code | département, puces, pas de filtre EPCI', async () => {
    const { wrapper } = await monter('/epcis', EpcisView)

    expect(wrapper.find('h1').text()).toBe('Les EPCI')
    expect(entetes(wrapper)).toEqual(['Nom', 'Code', 'Département'])
    expect(wrapper.findAll('.puce').map((p) => p.text())).toEqual(['22', '29'])
    expect(wrapper.find('.filtre-epci-select').exists()).toBe(false)
    const lignes = wrapper.findAll('tbody tr')
    expect(lignes).toHaveLength(2)
    expect(lignes[0].find('.cellule-nom a').attributes('href')).toBe(
      '/territoire/epci/200000001',
    )
  })
})

describe('DepartementsView — /departements', () => {
  it('renders the départements directory: titre, colonnes nom | code, sans filtres', async () => {
    const { wrapper } = await monter('/departements', DepartementsView)

    expect(wrapper.find('h1').text()).toBe('Les départements')
    expect(entetes(wrapper)).toEqual(['Nom', 'Code'])
    expect(wrapper.findAll('.puce')).toHaveLength(0)
    expect(wrapper.find('.filtre-epci-select').exists()).toBe(false)
    const lignes = wrapper.findAll('tbody tr')
    expect(lignes).toHaveLength(2)
    expect(lignes[0].find('.cellule-nom a').attributes('href')).toBe(
      '/territoire/departement/22',
    )
  })
})

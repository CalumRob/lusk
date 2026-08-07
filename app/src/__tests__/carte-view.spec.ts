import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { afterEach, describe, expect, it } from 'vitest'

import CarteView from '../views/CarteView.vue'
import { COULEUR_CONTOUR, COULEUR_NEUTRE } from '../carte/couleurs'
import { maplibreMock } from './setup'
import type { ChargerGeometrie } from '../geo/useGeometrie'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import type { Masques } from '../geo/types'
import {
  apercuFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerPayload } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'

/**
 * La carte interactive (/carte — layouts.md §3): the ThemeTabs subheader
 * (reused, ?theme= in the URL), the full-bleed MapExplorer + MapSidebar, and
 * the shell's states — skeleton, typed error with Retry, and the honest
 * « Fonds de carte indisponible. » when no mask file is published.
 */

function feature(territoire: string, nom: string) {
  return {
    type: 'Feature' as const,
    properties: { territoire, nom, type: 'commune' as const },
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [0, 0]]] },
  }
}

const masquesCommunes: Masques = {
  communes: { type: 'FeatureCollection', features: [feature('22001', 'Commune A1')] },
  epcis: null,
  departements: null,
}

const masquesAbsents: Masques = { communes: null, epcis: null, departements: null }

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuFixture,
  runReport: null,
  vintages: vintagesFixture,
}

function chargerPayloadAvec(p: Payload): ChargerPayload {
  return async () => p
}

async function monter(overrides: {
  chargerPayload?: ChargerPayload
  chargerGeometrie?: ChargerGeometrie
  chemin?: string
} = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(overrides.chemin ?? '/carte')
  await router.isReady()
  const wrapper = mount(CarteView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: overrides.chargerPayload ?? chargerPayloadAvec(payload),
        [GEOMETRIE_CHARGER_KEY]: overrides.chargerGeometrie ?? (async () => masquesCommunes),
      },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

describe('CarteView — les états (chargement / erreur / fond indisponible)', () => {
  it('shows a skeleton while the payload loads', async () => {
    const enAttente = new Promise<Payload>(() => {})
    const { wrapper } = await monter({ chargerPayload: () => enAttente })

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.find('.squelette').exists()).toBe(true)
  })

  it('shows the typed error state with a Retry button for the payload', async () => {
    let appels = 0
    const charger: ChargerPayload = async () => {
      appels += 1
      if (appels === 1) throw new Error('Impossible de charger /data/territoires.json')
      return payload
    }
    const { wrapper } = await monter({ chargerPayload: charger })

    expect(wrapper.find('.carte-etat--erreur').text()).toContain('Impossible de charger les données de la carte.')
    await wrapper.find('.carte-etat-bouton').trigger('click')
    await flushPromises()
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
  })

  it('shows the typed error state with a Retry button for the geometry', async () => {
    let appels = 0
    const charger: ChargerGeometrie = async () => {
      appels += 1
      if (appels === 1) throw new Error('ECONNREFUSED')
      return masquesCommunes
    }
    const { wrapper } = await monter({ chargerGeometrie: charger })

    expect(wrapper.find('.carte-etat--erreur').text()).toContain('Impossible de charger le fond de carte.')
    await wrapper.find('.carte-etat-bouton').trigger('click')
    await flushPromises()
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
  })

  it('shows the honest « Fonds de carte indisponible. » state when no mask is published', async () => {
    const { wrapper } = await monter({ chargerGeometrie: async () => masquesAbsents })

    expect(wrapper.text()).toContain('Fonds de carte indisponible.')
    expect(wrapper.find('.carte-etat-detail').text()).toContain('pas encore publiée')
  })
})

describe('CarteView — la carte avec fond publié', () => {
  it('renders the map + sidebar and the payload-driven ThemeTabs', async () => {
    const { wrapper } = await monter()

    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MapSidebar' }).exists()).toBe(true)
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets[0]).toBe('Aperçu')
    expect(onglets).toContain('Démographie')
  })

  it('the Aperçu tab (default) runs on the brand ramp and shows the mask-level legend', async () => {
    const { wrapper } = await monter()

    expect(wrapper.find('.carte--theme-apercu').exists()).toBe(true)
    expect(wrapper.find('.carte-legendes-masques').text()).toContain('Communes')
  })

  it('selecting a theme writes ?theme= and drives the legend', async () => {
    const { router, wrapper } = await monter()

    const demographie = wrapper.findAll('[role="tab"]').find((o) => o.text().includes('Démographie'))
    await demographie?.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Densité de population')
    expect(wrapper.find('.carte--theme-demographie').exists()).toBe(true)
  })

  it('an absent ?theme= in the URL selects the theme when it is in the payload', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Densité de population')
  })

  it('an unknown ?theme= falls back to Aperçu', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=inconnu' })

    expect(wrapper.find('.carte--theme-apercu').exists()).toBe(true)
  })

  it('the layer controls only offer the published mask levels', async () => {
    const { wrapper } = await monter({ chargerGeometrie: async () => masquesCommunes })

    const boutons = wrapper.findAll('[role="radio"]').map((b) => b.text())
    expect(boutons).toEqual(['Communes'])
    expect(wrapper.find('.carte-sidebar-note').text()).toContain('sans géométrie sont indisponibles')
  })

  it('feeds the legend the map neutral rendering — map and legend share one source (issue #68)', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    const legende = wrapper.findComponent({ name: 'MapLegend' })
    expect(legende.props('couleurVide')).toBe(COULEUR_NEUTRE)
    expect(legende.props('couleurContour')).toBe(COULEUR_CONTOUR)
  })
})

afterEach(() => {
  maplibreMock.instancesCarteMaple.length = 0
  maplibreMock.instancesPopups.length = 0
})

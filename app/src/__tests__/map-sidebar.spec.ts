import { mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import MapSidebar from '../components/carte/MapSidebar.vue'
import { COULEUR_CONTOUR, COULEUR_NEUTRE } from '../carte/couleurs'
import { territoiresFixture } from '../payload/fixtures'
import { routes } from '../router'

/**
 * MapSidebar (layouts.md §3): the 360px panel with the search (GlobalSearchBar
 * — territoires prop), the mask-level controls (synced with the map — a level
 * without geometry is absent, honest) and the legend. Collapsible; the level
 * change is emitted to the view.
 */

function montage(overrides: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(MapSidebar, {
    props: {
      territoires: territoiresFixture,
      niveau: 'communes',
      niveauxDisponibles: ['communes', 'epcis', 'departements'],
      config: null,
      couleurs: [],
      seuils: [],
      unite: '',
      estPourcentage: false,
      // the map's neutral rendering, threaded through to the legend (issue #68)
      couleurVide: COULEUR_NEUTRE,
      couleurContour: COULEUR_CONTOUR,
      ...overrides,
    },
    global: { plugins: [router] },
  })
}

describe("MapSidebar — le panneau d'options de la carte", () => {
  it('embeds the search over the territoires reference table', () => {
    const wrapper = montage()

    expect(wrapper.findComponent({ name: 'GlobalSearchBar' }).exists()).toBe(true)
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(true)
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
  })

  it('renders one radio per available mask level, the active one checked', () => {
    const wrapper = montage({ niveau: 'epcis' })

    const boutons = wrapper.findAll('[role="radio"]')
    expect(boutons.map((b) => b.text())).toEqual(['Communes', 'EPCI', 'Départements'])
    expect(boutons[1].attributes('aria-checked')).toBe('true')
    expect(boutons[0].attributes('aria-checked')).toBe('false')
  })

  it('emits the chosen level and does not render absent levels', async () => {
    const wrapper = montage({ niveauxDisponibles: ['communes', 'departements'] })

    const boutons = wrapper.findAll('[role="radio"]')
    expect(boutons.map((b) => b.text())).toEqual(['Communes', 'Départements'])

    await boutons[1].trigger('click')
    expect(wrapper.emitted('niveau-change')).toEqual([['departements']])
  })

  it("explains honestly when a level's geometry is not published", () => {
    const wrapper = montage({ niveauxDisponibles: ['communes'] })

    expect(wrapper.find('.carte-sidebar-note').text()).toContain('sans géométrie sont indisponibles')
  })

  it('hides the panel on close and offers a reopen button', async () => {
    const wrapper = montage()

    await wrapper.find('.carte-sidebar-fermer').trigger('click')
    expect(wrapper.find('.carte-sidebar').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.carte-sidebar-rouvrir').exists()).toBe(true)

    await wrapper.find('.carte-sidebar-rouvrir').trigger('click')
    expect(wrapper.find('.carte-sidebar').attributes('aria-hidden')).toBe('false')
  })

  it('forwards the map neutral rendering to the legend — one shared source (issue #68)', () => {
    const wrapper = montage()

    const legende = wrapper.findComponent({ name: 'MapLegend' })
    expect(legende.props('couleurVide')).toBe(COULEUR_NEUTRE)
    expect(legende.props('couleurContour')).toBe(COULEUR_CONTOUR)
  })
})

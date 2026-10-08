import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CahierBlankMapSlots from '@/fiche/prototype/CahierBlankMapSlots.vue'

describe('CahierBlankMapSlots', () => {
  const props = {
    territory: { code: 'AEDAR', name: 'Aedar' },
    horizonMinutes: 15,
    title: 'Cartes d’accès aux services, par mode',
  }

  it('renders the three requested modes in the shared three-column circular layout', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    expect(wrapper.findAll('.blank-map-slot')).toHaveLength(3)
    expect(wrapper.text()).toContain('Voiture')
    expect(wrapper.text()).toContain('Vélo (LTS2)')
    expect(wrapper.text()).toContain('Transports en commun')
    expect(wrapper.find('.blank-map-slots__grid').classes()).toContain('cahier-map-grid')
    expect(wrapper.findAll('.blank-map-slot__viewport')).toHaveLength(3)
  })

  it('titles the map group with the shared figure-title primitive, like the page 2 map plate', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    const title = wrapper.find('.blank-map-slots > .cahier-figure-title')
    expect(title.exists()).toBe(true)
    expect(title.text()).toBe('Cartes d’accès aux services, par mode')
    // No bespoke heading, no duplicated section number inside the figure title.
    expect(wrapper.find('.blank-map-slots__heading').exists()).toBe(false)
    expect(wrapper.find('.blank-map-slots__number').exists()).toBe(false)
    // Per-map labels use the same map-panel-label grammar as the production map plate.
    expect(wrapper.findAll('.map-panel-label').map((label) => label.text())).toEqual([
      'Voiture',
      'Vélo (LTS2)',
      'Transports en commun',
    ])
  })

  it('communicates blank-state honestly without fake evidence or inspection controls', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    expect(wrapper.findAll('.blank-map-slot__state')).toHaveLength(3)
    expect(wrapper.text()).toContain('Carte à venir')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/légende|réseau recensé/i)
  })

  it('shows the horizon and exposes territory and unavailable state accessibly', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    expect(wrapper.text()).toContain('15 minutes')
    for (const slot of wrapper.findAll('.blank-map-slot')) {
      expect(slot.attributes('aria-label')).toContain('Aedar')
      expect(slot.attributes('aria-label')).toContain('Carte à venir')
    }
  })

  it('renders the content-owned reading under the map grid when provided', () => {
    const wrapper = mount(CahierBlankMapSlots, {
      props: {
        ...props,
        lecture: [[{ kind: 'text' as const, value: 'Les emplacements restent volontairement vides.' }]],
      },
    })

    const lecture = wrapper.find('.blank-map-slots .cahier-figure-lecture')
    expect(lecture.exists()).toBe(true)
    expect(lecture.text()).toContain('Les emplacements restent volontairement vides.')
  })

  it('omits the reading control when no lecture is provided', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    expect(wrapper.find('.cahier-figure-lecture').exists()).toBe(false)
  })
})

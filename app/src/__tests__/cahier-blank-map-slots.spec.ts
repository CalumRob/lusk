import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CahierBlankMapSlots from '@/fiche/prototype/CahierBlankMapSlots.vue'

describe('CahierBlankMapSlots', () => {
  const props = { territory: { code: 'AEDAR', name: 'Aedar' }, horizonMinutes: 15 }

  it('renders the three requested modes in the shared three-column circular layout', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    expect(wrapper.findAll('.blank-map-slot')).toHaveLength(3)
    expect(wrapper.text()).toContain('Voiture')
    expect(wrapper.text()).toContain('Vélo (LTS2)')
    expect(wrapper.text()).toContain('Transports en commun')
    expect(wrapper.find('.blank-map-slots__grid').classes()).toContain('cahier-map-grid')
    expect(wrapper.findAll('.blank-map-slot__viewport')).toHaveLength(3)
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
})

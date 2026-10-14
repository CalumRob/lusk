import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CahierBlankMapSlots from '@/fiche/prototype/CahierBlankMapSlots.vue'
import CahierContinuousMapLegend from '@/fiche/prototype/CahierContinuousMapLegend.vue'

describe('CahierBlankMapSlots', () => {
  const props = {
    territory: { code: '22003', name: 'Allineuc' },
    horizonMinutes: 15,
    title: [{ kind: 'text' as const, value: "Combien de types d'équipements accessibles en 15 minutes depuis les adresses résidentielles ?" }],
  }

  it('renders the three requested modes in the shared three-column layout', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    expect(wrapper.findAll('.blank-map-slot')).toHaveLength(3)
    expect(wrapper.text()).toContain('Voiture')
    expect(wrapper.text()).toContain('Vélo (LTS2)')
    expect(wrapper.text()).toContain('Transports en commun')
    expect(wrapper.find('.blank-map-slots__grid').classes()).toContain('cahier-map-grid')
    expect(wrapper.findAll('.blank-map-slot__viewport')).toHaveLength(3)
  })

  it('shows the 15-minute car map and links to its inspection image', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    const inlineMap = wrapper.find('.blank-map-slot--car img')
    expect(inlineMap.attributes('src')).toBe(
      'https://images.calumrobertson.fr/maps/aedar/v1/22003-car-inline.webp',
    )
    expect(inlineMap.attributes('alt')).toBe(`${props.title[0].value} — ${props.territory.name}`)

    const mapPanel = wrapper.find('.blank-map-slot--car .map-viewport')
    expect(mapPanel.element.tagName).toBe('BUTTON')
    expect(mapPanel.attributes('aria-label')).toContain('Agrandir')
    expect(wrapper.find('.blank-map-slot--car a').exists()).toBe(false)
  })

  it('renders the production map scale and BPE universe as an inline legend', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })
    const legend = wrapper.find('.aedar-car-map-legend')

    expect(legend.attributes('role')).toBe('group')
    expect(legend.classes()).toContain('cahier-figure-legend')
    expect(legend.find('.cahier-map-legend__title').classes()).toContain('type-figure-label')
    expect(legend.attributes('aria-label')).toContain('Types d’équipements accessibles. Échelle de 0 à 218')
    expect(legend.attributes('aria-label')).toContain('235 catégories d’équipements BPE')
    expect(legend.text()).toContain('Types d’équipements accessibles*')
    expect(legend.text()).not.toContain('en 15 minutes')
    expect(legend.findAll('.cahier-map-legend__tick').map((tick) => tick.text())).toEqual([
      '0', '44', '87', '131', '174', '218',
    ])
    expect(legend.findAll('.cahier-map-legend__swatch').map((swatch) => swatch.attributes('style'))).toEqual([
      'background-color: #E9B2BE;',
      'background-color: #D78A9C;',
      'background-color: #C4667E;',
      'background-color: #AD4562;',
      'background-color: #87334E;',
    ])
    expect(legend.text()).toContain('* Sur 235 catégories d’équipements BPE')
    expect(legend.find('.cahier-map-legend__note').classes()).toContain('cahier-evidence-source')
  })

  it('formats territorial decimal breaks in French and accepts a metric-specific accessible label', () => {
    const wrapper = mount(CahierContinuousMapLegend, {
      props: {
        title: 'Perte de diversité',
        minimum: 0,
        maximum: 212,
        colors: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
        ticks: [0, 42.4, 84.8, 127.2, 169.6, 212],
        note: 'Échelle locale au territoire.',
        ariaLabel: 'Perte de diversité, valeurs propres au territoire.',
      },
    })

    expect(wrapper.findAll('.cahier-map-legend__tick').map((tick) => tick.text())).toEqual([
      '0', '42,4', '84,8', '127,2', '169,6', '212',
    ])
    expect(wrapper.attributes('aria-label')).toBe('Perte de diversité, valeurs propres au territoire.')
  })

  it('locks background scrolling while the shared production zoom gallery is open', async () => {
    const previousRootOverflow = document.documentElement.style.overflow
    document.querySelectorAll('.lusk-map-gallery').forEach((element) => element.remove())
    const wrapper = mount(CahierBlankMapSlots, { props })
    let mounted = true

    try {
      await flushPromises()
      await wrapper.find('.blank-map-slot--car .map-viewport').trigger('click')
      await flushPromises()

      expect(wrapper.findAll('.map-gallery-source img').map((image) => image.attributes('src'))).toEqual([
        'https://images.calumrobertson.fr/maps/aedar/v1/22003-car-inspection.webp',
      ])
      const viewer = document.querySelector('.lusk-map-gallery')
      expect(viewer).not.toBeNull()
      expect(viewer?.getAttribute('aria-modal')).toBe('true')
      expect(viewer?.querySelector('.viewer-navbar')).not.toBeNull()
      expect(document.body.classList.contains('viewer-open')).toBe(true)
      expect(document.documentElement.style.overflow).toBe('clip')

      wrapper.unmount()
      mounted = false
      expect(document.documentElement.style.overflow).toBe(previousRootOverflow)
    } finally {
      if (mounted) wrapper.unmount()
      document.documentElement.style.overflow = previousRootOverflow
    }
  })

  it('titles the map group with the shared figure-title primitive, like the page 2 map plate', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    const title = wrapper.find('.blank-map-slots > .cahier-figure-title')
    expect(title.exists()).toBe(true)
    expect(title.text()).toBe("Combien de types d'équipements accessibles en 15 minutes depuis les adresses résidentielles ?")
    expect(title.find('.theme-emphasis').exists()).toBe(false)
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

  it('keeps future mode maps explicitly blank without fake evidence', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    expect(wrapper.findAll('.blank-map-slot__state')).toHaveLength(2)
    expect(wrapper.text()).toContain('Carte à venir')
    expect(wrapper.find('.blank-map-slot--bike-lts2 img').exists()).toBe(false)
    expect(wrapper.find('.blank-map-slot--transit img').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/légende|réseau recensé/i)
  })

  it('shows the horizon and exposes territory and map state accessibly', () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    expect(wrapper.text()).toContain('15 minutes')
    expect(wrapper.find('.blank-map-slot--car').attributes('aria-label')).toContain('Allineuc')
    expect(wrapper.find('.blank-map-slot--car').attributes('aria-label')).toContain('Carte disponible')
    expect(wrapper.find('.blank-map-slot--bike-lts2').attributes('aria-label')).toContain('Carte à venir')
  })

  it('replaces a failed car image with an honest unavailable state', async () => {
    const wrapper = mount(CahierBlankMapSlots, { props })

    await wrapper.find('.blank-map-slot--car img').trigger('error')

    const carSlot = wrapper.find('.blank-map-slot--car')
    expect(carSlot.text()).toContain('Carte indisponible')
    expect(carSlot.attributes('aria-label')).toContain('Carte indisponible')
    expect(carSlot.find('img').exists()).toBe(false)
    expect(carSlot.find('.map-viewport').element.tagName).toBe('BUTTON')
    expect(wrapper.find('.aedar-car-map-legend').exists()).toBe(false)
  })

  it('does not show the fixed 15-minute map for another horizon', () => {
    const wrapper = mount(CahierBlankMapSlots, { props: { ...props, horizonMinutes: 10 } })

    const carSlot = wrapper.find('.blank-map-slot--car')
    expect(carSlot.find('img').exists()).toBe(false)
    expect(carSlot.text()).toContain('Carte indisponible pour cet horizon')
    expect(carSlot.attributes('aria-label')).toContain('Carte indisponible pour cet horizon')
    expect(wrapper.find('.aedar-car-map-legend').exists()).toBe(false)
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

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CahierFigureLegend from '@/fiche/prototype/CahierFigureLegend.vue'
import { Bike, CarFront, Footprints } from 'lucide-vue-next'

describe('CahierFigureLegend', () => {
  it('renders the declared entries, optional icons, and the centered inaccessible icon', () => {
    const wrapper = mount(CahierFigureLegend, {
      props: {
        entries: [
          { key: 'walkTransit', label: 'À pied + TC', marker: 'icon', iconKey: 'walkTransit', tone: 't' },
          { key: 'bike', label: 'À vélo + TC', marker: 'icon', iconKey: 'bike', tone: 'b' },
          { key: 'car', label: 'Voiture', marker: 'icon', iconKey: 'car', tone: 'c' },
          { key: 'inaccessible', label: 'Inaccessible', marker: 'slash', tone: 'neutral' },
        ],
        icons: { walkTransit: Footprints, bike: Bike, car: CarFront },
        label: 'Modes d’accès',
      },
    })

    expect(wrapper.find('ul').attributes('aria-label')).toBe('Modes d’accès')
    expect(wrapper.findAll('li')).toHaveLength(4)
    expect(wrapper.findAll('.cahier-figure-legend-icon')).toHaveLength(4)
    expect(wrapper.find('.cahier-figure-legend-mark--slash').exists()).toBe(true)
    expect(wrapper.text()).toContain('Inaccessible')
  })

  it('supports a compact square marker for a categorical series', () => {
    const wrapper = mount(CahierFigureLegend, {
      props: {
        entries: [{ key: 'acces-pied-tc', label: 'Accès à pied ou en TC possible', marker: 'square' }],
        markColors: { 'acces-pied-tc': 'var(--cahier-mode-foot)' },
      },
    })

    expect(wrapper.find('.cahier-figure-legend-mark--square').exists()).toBe(true)
    expect(wrapper.find('.cahier-figure-legend-mark--square').attributes('style')).toContain('color: var(--cahier-mode-foot)')
  })

  it('keeps a supported layer toggle available when its data is unavailable', async () => {
    const wrapper = mount(CahierFigureLegend, { props: {
      entries: [{ key: 'reference', label: 'Groupe comparé', ariaLabel: 'Groupe comparé : Indisponible',
        marker: 'dash', persistentToggle: true }],
      selectedKeys: ['reference'],
    } })
    const toggle = wrapper.get('button.cahier-figure-legend-toggle')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(toggle.attributes('aria-label')).toBe('Groupe comparé : Indisponible')
    await toggle.trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([['reference']])
    wrapper.unmount()
  })
})

import { mount } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import MapLegend from '../components/carte/MapLegend.vue'

/**
 * MapLegend (ui-elements.md §Map shell): the theme's choropleth buckets —
 * swatch + numeric range (color is never the sole carrier, DESIGN.md §8) —
 * with the no-data row, or the active level's note in Aperçu. Collapsible.
 */

const configDemographie = {
  theme: 'demographie' as const,
  indicateur: 'densite',
  libelle: 'Densité de population',
}

function montage(overrides: Record<string, unknown> = {}) {
  return mount(MapLegend, {
    props: {
      niveau: 'communes',
      config: configDemographie,
      couleurs: ['#c1c1e9', '#a3a3df', '#8e85c4', '#6f67a8'],
      seuils: [20, 40, 60],
      unite: 'hab/km²',
      estPourcentage: false,
      ...overrides,
    },
  })
}

describe('MapLegend — the theme bucket legend', () => {
  it('titles the legend with the indicator label', () => {
    const wrapper = montage()

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Densité de population')
  })

  it('renders one bucket per class, with its numeric range and unit', () => {
    const wrapper = montage()

    const gammes = wrapper.findAll('.carte-legendes-gamme')
    expect(gammes).toHaveLength(4)
    expect(gammes[0].text()).toContain('≤ 20')
    expect(gammes[1].text()).toContain('20 – 40')
    expect(gammes[2].text()).toContain('40 – 60')
    expect(gammes[3].text()).toContain('60 et +')
    expect(gammes[0].text()).toContain('hab/km²')
  })

  it('shows the no-data row (the neutral color is labelled, never silent)', () => {
    const wrapper = montage()

    expect(wrapper.find('.carte-legendes-vide').text()).toContain('Non disponible')
  })

  it('formats % units as whole numbers (fraction × 100)', () => {
    const wrapper = montage({
      config: { theme: 'habitat' as const, indicateur: 'part_passoires', libelle: 'Part de passoires thermiques' },
      couleurs: ['#f0ddd2', '#d9ae94', '#c98f6e'],
      seuils: [0.2, 0.4],
      unite: '%',
      estPourcentage: true,
    })

    const gammes = wrapper.findAll('.carte-legendes-gamme')
    expect(gammes[0].text()).toContain('≤ 20')
    expect(gammes[1].text()).toContain('20 – 40')
    expect(gammes[2].text()).toContain('40 et +')
  })

  it('collapses and expands on the header click (aria-expanded reflects the state)', async () => {
    const wrapper = montage()

    expect(wrapper.find('.carte-legendes-entete').attributes('aria-expanded')).toBe('true')
    await wrapper.find('.carte-legendes-entete').trigger('click')
    expect(wrapper.find('.carte-legendes-entete').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.carte-legendes-chevron').classes()).toContain('est-replie')
    await wrapper.find('.carte-legendes-entete').trigger('click')
    expect(wrapper.find('.carte-legendes-entete').attributes('aria-expanded')).toBe('true')
  })
})

describe('MapLegend — in Aperçu (no theme)', () => {
  it('notes the active mask level without an indicator layer', () => {
    const wrapper = montage({ config: null, couleurs: [], seuils: [] })

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Communes')
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
    expect(wrapper.find('.carte-legendes-gammes').exists()).toBe(false)
  })
})

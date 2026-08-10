import { mount } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import MapLegend from '../components/carte/MapLegend.vue'
import { COULEUR_CONTOUR, COULEUR_NEUTRE, COULEUR_NEUTRE_ZERO } from '../carte/couleurs'
import type { Couche } from '../carte/coucheModel'

/**
 * MapLegend (ui-elements.md §Map shell): the ACTIVE LAYER's choropleth
 * buckets (ADR-0019 — the legend follows the layer: its own libelle, unit,
 * scale and breaks) — swatch + numeric range (color is never the sole
 * carrier, DESIGN.md §8) — with the no-data row, or the active level's note
 * in Aperçu. Collapsible.
 */

const coucheDensite: Couche = {
  source: 'indicateur',
  clef: 'densite',
  detail: null,
  libelle: 'Densité de population',
  parDefaut: false,
}

function montage(overrides: Record<string, unknown> = {}) {
  return mount(MapLegend, {
    props: {
      niveau: 'communes',
      couche: coucheDensite,
      couleurs: ['#c1c1e9', '#a3a3df', '#8e85c4', '#6f67a8'],
      seuils: [20, 40, 60],
      estDivergente: false,
      unite: 'hab/km²',
      estPourcentage: false,
      // the map's neutral rendering, threaded from couleurs.ts (issue #68)
      couleurVide: COULEUR_NEUTRE,
      couleurContour: COULEUR_CONTOUR,
      ...overrides,
    },
  })
}

describe('MapLegend — the active layer bucket legend', () => {
  it('titles the legend with the layer label', () => {
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

  it('paints the NA swatch with the map neutral fill — same source, no drift (issue #68)', () => {
    const wrapper = montage()

    const swatch = wrapper.find('.carte-legendes-swatch--vide')
    expect(swatch.attributes('style')).toContain(COULEUR_NEUTRE)
  })

  it('outlines the NA swatch with the map contour color — legible once lightened (issue #68)', () => {
    const wrapper = montage()

    const swatch = wrapper.find('.carte-legendes-swatch--vide')
    expect(swatch.attributes('style')).toContain(COULEUR_CONTOUR)
  })

  it('formats % units as whole numbers (fraction × 100)', () => {
    const wrapper = montage({
      couche: {
        source: 'indicateur' as const,
        clef: 'part_passoires',
        detail: null,
        libelle: 'Part de passoires thermiques',
        parDefaut: false,
      },
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

describe('MapLegend — la rampe divergente (ADR-0019)', () => {
  it('porte le signe explicite sur les bornes positives — la couleur n’est jamais le seul porteur', () => {
    const wrapper = montage({
      estDivergente: true,
      couleurs: ['#6b3745', '#f3ecee', COULEUR_NEUTRE_ZERO, '#eff1f7', '#595a7d'],
      seuils: [-20, -5, 5, 15],
      unite: '‰/an',
    })

    const gammes = wrapper.findAll('.carte-legendes-gamme')
    expect(gammes[0].text()).toContain('≤ -20')
    expect(gammes[1].text()).toContain('-20 – -5')
    expect(gammes[2].text()).toContain('-5 – +5')
    expect(gammes[3].text()).toContain('+5 – +15')
    expect(gammes[4].text()).toContain('+15 et +')
    expect(gammes[3].text()).toContain('‰/an')
  })

  it('sans la rampe divergente, les bornes positives ne portent pas de « + »', () => {
    const wrapper = montage({ seuils: [-20, -5, 5, 15] })

    const gammes = wrapper.findAll('.carte-legendes-gamme')
    expect(gammes[3].text()).toContain('5 – 15')
    expect(gammes[3].text()).not.toContain('+5')
  })
})

describe('MapLegend — in Aperçu (no theme, no layer)', () => {
  it('notes the active mask level without an indicator layer', () => {
    const wrapper = montage({ couche: null, couleurs: [], seuils: [] })

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Communes')
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
    expect(wrapper.find('.carte-legendes-gammes').exists()).toBe(false)
  })
})

import { mount } from '@vue/test-utils'
import { CarFront, Footprints } from 'lucide-vue-next'
import { describe, expect, it } from 'vitest'

import type { CahierTooltipRow } from '@/fiche/cahierFigureGrammaire'
import CahierFigureTooltip from '@/fiche/prototype/CahierFigureTooltip.vue'

const rows: readonly CahierTooltipRow[] = [
  {
    label: 'Voiture',
    value: '4 types',
    tone: 'c',
    icon: CarFront,
    comparison: {
      value: '7,4 types',
      rank: '2e/3',
      ariaLabel: 'Groupe comparé : Moyenne de l’EPCI : 7,4 types, rang 2e/3',
    },
  },
  {
    label: 'À pied',
    value: '2 types',
    tone: 't',
    icon: Footprints,
    comparison: { value: '1 type' },
  },
]

describe('CahierFigureTooltip', () => {
  it('attaches the compared reading directly beneath its own focal row', () => {
    const wrapper = mount(CahierFigureTooltip, { props: { title: '15 min', rows } })
    const focalRows = wrapper.findAll('.cahier-figure-tooltip-row')

    expect(wrapper.get('[role="tooltip"]').attributes('role')).toBe('tooltip')
    expect(focalRows).toHaveLength(2)
    expect(focalRows.map((row) => row.get('dt').text())).toEqual(['Voiture', 'À pied'])

    const firstComparison = focalRows[0]!.get('.cahier-figure-tooltip-row-comparison')
    const secondComparison = focalRows[1]!.get('.cahier-figure-tooltip-row-comparison')
    expect(firstComparison.get('.cahier-figure-tooltip-comparison-label').text()).toBe('Groupe comparé')
    expect(firstComparison.get('.cahier-figure-tooltip-comparison-value').text()).toBe('7,4 types')
    expect(firstComparison.get('.cahier-figure-tooltip-comparison-rank').text()).toBe('2e/3')
    expect(secondComparison.get('.cahier-figure-tooltip-comparison-value').text()).toBe('1 type')
    expect(secondComparison.find('.cahier-figure-tooltip-comparison-rank').exists()).toBe(false)
    // No separate block after the focal rows.
    expect(wrapper.find('.cahier-figure-tooltip-comparison').exists()).toBe(false)
  })

  it('never repeats the mode name in the compared sub-label', () => {
    const wrapper = mount(CahierFigureTooltip, { props: { title: '15 min', rows } })

    expect(wrapper.text()).not.toContain('Groupe comparé : Voiture')
    expect(wrapper.text()).not.toContain('Groupe comparé : À pied')
    for (const label of wrapper.findAll('.cahier-figure-tooltip-comparison-label')) {
      expect(label.text()).toBe('Groupe comparé')
    }
  })

  it('keeps a complete accessible name per row and never repeats a direction phrase', () => {
    const wrapper = mount(CahierFigureTooltip, { props: { title: '15 min', rows } })
    const focalRows = wrapper.findAll('.cahier-figure-tooltip-row')

    expect(focalRows[0]!.attributes('aria-label')).toBe(
      'Voiture : 4 types. Groupe comparé : Moyenne de l’EPCI : 7,4 types, rang 2e/3',
    )
    expect(focalRows[1]!.attributes('aria-label')).toBe('À pied : 2 types. Groupe comparé : 1 type')
    expect(wrapper.text()).not.toMatch(/plus est mieux|moins est mieux/u)
    expect(wrapper.html()).not.toMatch(/plus est mieux|moins est mieux/u)
  })

  it('uses a mode icon for a focal row and no glyph on its comparison', () => {
    const wrapper = mount(CahierFigureTooltip, { props: { title: '15 min', rows } })
    const firstRow = wrapper.findAll('.cahier-figure-tooltip-row')[0]!

    expect(firstRow.find('svg.cahier-figure-tooltip-icon').exists()).toBe(true)
    expect(firstRow.find('.cahier-figure-tooltip-marker').exists()).toBe(false)
    expect(firstRow.find('.cahier-figure-tooltip-row-comparison svg').exists()).toBe(false)
    expect(firstRow.find('.cahier-figure-tooltip-row-comparison .cahier-figure-tooltip-marker').exists()).toBe(false)
  })

  it('falls back to a colour dot when the series has no semantic icon', () => {
    const wrapper = mount(CahierFigureTooltip, {
      props: {
        title: '15 min',
        rows: [{ label: 'Protégé', value: '1,2', tone: 'b', marker: 'dot', markerColor: 'var(--cahier-cycle-protected)' }],
      },
    })

    expect(wrapper.find('.cahier-figure-tooltip-marker').exists()).toBe(true)
    expect(wrapper.find('svg.cahier-figure-tooltip-icon').exists()).toBe(false)
    expect(wrapper.find('.cahier-figure-tooltip-row-comparison').exists()).toBe(false)
  })

  it('honours an explicit focal and comparison aria-label', () => {
    const wrapper = mount(CahierFigureTooltip, {
      props: {
        title: '15 min',
        rows: [{
          label: 'Voiture',
          value: '4 types',
          ariaLabel: 'Territoire de test : Voiture : 4',
          comparison: {
            value: '7,4 types',
            rank: '2e/3',
            ariaLabel: 'Groupe comparé : la moyenne des communes comparables, 7,4 types, rang 2e/3',
          },
        }],
      },
    })

    expect(wrapper.get('.cahier-figure-tooltip-row').attributes('aria-label')).toBe(
      'Territoire de test : Voiture : 4. Groupe comparé : la moyenne des communes comparables, 7,4 types, rang 2e/3',
    )
  })
})

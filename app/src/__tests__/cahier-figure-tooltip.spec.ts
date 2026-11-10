import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { CahierTooltipRow } from '@/fiche/cahierFigureGrammaire'
import CahierFigureTooltip from '@/fiche/prototype/CahierFigureTooltip.vue'

const rows: readonly CahierTooltipRow[] = [
  { label: 'Voiture', value: '4 types', tone: 'c' },
  { label: 'À pied', value: '2 types', tone: 't' },
  { label: 'Groupe comparé : Voiture', value: '7,4 types', comparison: true, rank: '2e/3' },
  { label: 'Groupe comparé : À pied', value: '1 type', comparison: true },
]

describe('CahierFigureTooltip', () => {
  it('renders the comparison group as one smaller plain block after the focal rows', () => {
    const wrapper = mount(CahierFigureTooltip, { props: { title: '15 min', rows } })
    const focalRows = wrapper.findAll('.cahier-figure-tooltip-row:not(.cahier-figure-tooltip-row--comparison)')
    const comparisonBlock = wrapper.get('.cahier-figure-tooltip-comparison')
    const comparisonRows = comparisonBlock.findAll('.cahier-figure-tooltip-row--comparison')

    expect(wrapper.get('[role="tooltip"]').attributes('role')).toBe('tooltip')
    expect(focalRows).toHaveLength(2)
    expect(focalRows.map((row) => row.get('dt').text())).toEqual(['Voiture', 'À pied'])
    expect(comparisonRows).toHaveLength(2)
    expect(comparisonRows.map((row) => row.get('dt').text())).toEqual([
      'Groupe comparé : Voiture',
      'Groupe comparé : À pied',
    ])
    expect(comparisonRows[0]!.get('dd').text()).toBe('7,4 types')
    // The comparison block is the only place a rank is rendered.
    expect(wrapper.findAll('.cahier-figure-tooltip-rank')).toHaveLength(1)
    expect(comparisonRows[0]!.get('.cahier-figure-tooltip-rank').text()).toBe('2e/3')
    expect(comparisonRows[1]!.find('.cahier-figure-tooltip-rank').exists()).toBe(false)
  })

  it('keeps a complete accessible name per row and never repeats a direction phrase', () => {
    const wrapper = mount(CahierFigureTooltip, { props: { title: '15 min', rows } })
    const comparisonRows = wrapper.findAll('.cahier-figure-tooltip-row--comparison')

    expect(comparisonRows[0]!.attributes('aria-label')).toBe(
      'Groupe comparé : Voiture : 7,4 types, rang 2e/3',
    )
    expect(comparisonRows[1]!.attributes('aria-label')).toBe('Groupe comparé : À pied : 1 type')
    expect(wrapper.text()).not.toMatch(/plus est mieux|moins est mieux/u)
    expect(wrapper.html()).not.toMatch(/plus est mieux|moins est mieux/u)
  })

  it('keeps focal rows on the Distribution grammar with their marker and no rank', () => {
    const wrapper = mount(CahierFigureTooltip, {
      props: { title: '15 min', rows: [{ label: 'Voiture', value: '4 types', tone: 'c' }] },
    })

    expect(wrapper.find('.cahier-figure-tooltip-comparison').exists()).toBe(false)
    expect(wrapper.find('.cahier-figure-tooltip-row--comparison').exists()).toBe(false)
    expect(wrapper.find('.cahier-figure-tooltip-marker').exists()).toBe(true)
    expect(wrapper.findAll('.cahier-figure-tooltip-rank')).toHaveLength(0)
  })

  it('honours an explicit aria-label over the composed one', () => {
    const wrapper = mount(CahierFigureTooltip, {
      props: {
        title: '15 min',
        rows: [{
          label: 'Groupe comparé : Voiture',
          value: '7,4 types',
          comparison: true,
          rank: '2e/3',
          ariaLabel: 'Groupe comparé : la moyenne des communes comparables, 7,4 types, rang 2e/3',
        }],
      },
    })

    expect(wrapper.get('.cahier-figure-tooltip-row--comparison').attributes('aria-label')).toBe(
      'Groupe comparé : la moyenne des communes comparables, 7,4 types, rang 2e/3',
    )
  })
})

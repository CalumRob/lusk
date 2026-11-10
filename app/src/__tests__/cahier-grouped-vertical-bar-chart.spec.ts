import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import CahierGroupedVerticalBarChart from '@/fiche/prototype/CahierGroupedVerticalBarChart.vue'

const figure: CahierGroupedVerticalBarFigureData = {
  categories: [
    { key: 'early', label: 'Early period', axisLabel: 'Early' },
    { key: 'late', label: 'Late period', axisLabel: 'Late' },
  ],
  series: [
    { key: 'north', label: 'North group', color: '#356a83', values: [2, 5] },
    { key: 'south', label: 'South group', color: '#a94b65', values: [3, 4] },
  ],
  xAxisTitle: 'Period',
  yAxisTitle: 'Measured quantity',
  description: 'Grouped comparison of two independent series.',
}

describe('CahierGroupedVerticalBarChart', () => {
  it('renders grouped series by category with axis labels and a category comparison tooltip', async () => {
    const wrapper = mount(CahierGroupedVerticalBarChart, { props: { figure } })

    const chart = wrapper.get('svg[role="img"]')
    expect(chart.attributes('aria-label')).toContain('Grouped comparison of two independent series.')
    expect(wrapper.findAll('rect.cahier-grouped-vertical-bar-chart__bar')).toHaveLength(4)
    expect(wrapper.text()).toContain('Period')
    expect(wrapper.text()).toContain('Measured quantity')
    expect(wrapper.text()).toContain('Early')
    expect(wrapper.text()).toContain('Late')

    await wrapper.get('button[aria-label^="Late period"]').trigger('focus')
    const tooltip = wrapper.get('.cahier-grouped-vertical-bar-chart__tooltip')
    expect(tooltip.text()).toContain('North group')
    expect(tooltip.text()).toContain('5')
    expect(tooltip.text()).toContain('South group')
    expect(tooltip.text()).toContain('4')
  })

  it('renders a compared series as a plain comparison block with its served rank only', async () => {
    const comparedFigure: CahierGroupedVerticalBarFigureData = {
      ...figure,
      series: [
        figure.series[0]!,
        {
          key: 'north-reference',
          label: 'Groupe comparé : North group',
          color: '#8aa6b5',
          values: [3, 6],
          comparison: true,
          ranks: [{ position: 2, size: 3 }, null],
        },
      ],
    }
    const wrapper = mount(CahierGroupedVerticalBarChart, { props: { figure: comparedFigure } })

    await wrapper.get('button[aria-label^="Early period"]').trigger('focus')
    const tooltip = wrapper.get('.cahier-grouped-vertical-bar-chart__tooltip')
    const comparisonRows = tooltip.findAll('.cahier-figure-tooltip-row--comparison')

    expect(tooltip.findAll('.cahier-figure-tooltip-row:not(.cahier-figure-tooltip-row--comparison)')).toHaveLength(1)
    expect(comparisonRows).toHaveLength(1)
    expect(comparisonRows[0]!.get('dt').text()).toBe('Groupe comparé : North group')
    expect(comparisonRows[0]!.text()).toContain('3')
    expect(comparisonRows[0]!.get('.cahier-figure-tooltip-rank').text()).toBe('2e/3')
    expect(comparisonRows[0]!.attributes('aria-label')).toContain('rang 2e/3')
    expect(tooltip.text()).not.toMatch(/plus est mieux|moins est mieux/u)

    // The late category serves no rank, so the comparison row shows only its value.
    await wrapper.get('button[aria-label^="Late period"]').trigger('focus')
    expect(wrapper.find('.cahier-figure-tooltip-rank').exists()).toBe(false)
  })

  it('omits unavailable values while keeping them explicit in the category description', () => {
    const incompleteFigure: CahierGroupedVerticalBarFigureData = {
      ...figure,
      series: [{ ...figure.series[0]!, values: [null, 5] }],
    }
    const wrapper = mount(CahierGroupedVerticalBarChart, { props: { figure: incompleteFigure } })

    expect(wrapper.findAll('rect.cahier-grouped-vertical-bar-chart__bar')).toHaveLength(1)
    expect(wrapper.get('button[aria-label^="Early period"]').attributes('aria-label')).toContain('Indisponible')
  })

  it('uses a zero baseline and integer y-axis ticks for fractional values', () => {
    const fractionalFigure: CahierGroupedVerticalBarFigureData = {
      ...figure,
      series: [{ ...figure.series[0]!, values: [1.2, 8.8] }],
    }
    const wrapper = mount(CahierGroupedVerticalBarChart, { props: { figure: fractionalFigure } })

    expect(wrapper.findAll('.cahier-figure-tick-label--y').map((tick) => tick.text())).toEqual(['0', '5', '9'])
  })

  it('supports signed values as bars extending from the zero baseline', () => {
    const signedFigure: CahierGroupedVerticalBarFigureData = {
      ...figure,
      series: [{ ...figure.series[0]!, values: [-2, 3] }],
    }
    const wrapper = mount(CahierGroupedVerticalBarChart, { props: { figure: signedFigure } })

    expect(wrapper.findAll('rect.cahier-grouped-vertical-bar-chart__bar')).toHaveLength(2)
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('-2')
  })
})

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import type { TimeRampFigureData } from '@/fiche/content/territoryFacts'

const timeRamp: TimeRampFigureData = {
  availability: 'incomplete',
  xAxis: { label: 'Temps d’accès', unit: 'minutes' },
  yAxis: { label: 'Diversité accessible', unit: 'types' },
  series: [{
    key: 'diversity',
    label: 'Diversité',
    points: [5, 10, 15, 20].map((minute, index) => ({
      xValue: minute,
      xLabel: `${minute} min`,
      value: index === 1 ? null : index + 2,
      referenceValue: index === 2 ? null : index + 1,
    })),
  }],
  highlightedX: 15,
  provenance: null,
  comparisonLabel: 'Territoires comparables',
}

describe('AccessRampFigureCahier time ramp', () => {
  it('renders time ticks, horizon, unit, reference, gaps, and accessible value tooltips', async () => {
    const wrapper = mount(AccessRampFigureCahier, { props: { timeRamp, territoryName: 'Territoire test' } })
    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).toContain('Territoire test')
    expect(wrapper.find('.access-ramp-cahier').text()).toContain('types')
    expect(wrapper.findAll('.access-ramp-time-line')).toHaveLength(4)
    expect(wrapper.find('.access-ramp-horizon').exists()).toBe(true)
    expect(wrapper.findAll('.access-ramp-cahier--time .cahier-figure-legend-item')).toHaveLength(2)
    const labels = wrapper.find('.cahier-figure-axis-labels').text()
    for (const minute of [5, 10, 15, 20]) expect(labels).toContain(`${minute} min`)
    // The null territory and reference values split each corresponding line into two segments.
    expect(wrapper.findAll('.access-ramp-time-line').filter((line) => !line.classes().includes('access-ramp-line--comparison'))).toHaveLength(2)
    await wrapper.find('[aria-label="Temps d\'accès : 15 min"]').trigger('focus')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('15 min')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('Territoire test')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('Territoires comparables')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('Indisponible')
  })
})

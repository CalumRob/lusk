import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import type { MobiliteAccessRamp } from '@/fiche/content/territoryFacts'

const ramp: MobiliteAccessRamp = {
  availability: 'complete',
  xAxisLabel: 'Part cumulée des bâtiments',
  yAxisLabel: 'types d’équipements accessibles',
  curves: {
    car: {
      mode: 'car',
      modeLabel: 'Voiture',
      points: Array.from({ length: 11 }, (_, index) => ({
        quantile: index / 10,
        quantileLabel: `${index * 10} %`,
        accessibleTypes: index,
        comparisonAccessibleTypes: index + 0.5,
      })),
    },
    bike: {
      mode: 'bike',
      modeLabel: 'À vélo + TC',
      points: Array.from({ length: 11 }, (_, index) => ({
        quantile: index / 10,
        quantileLabel: `${index * 10} %`,
        accessibleTypes: index + 1,
        comparisonAccessibleTypes: index + 1.5,
      })),
    },
    walkTransit: {
      mode: 'walkTransit',
      modeLabel: 'À pied + TC',
      points: Array.from({ length: 11 }, (_, index) => ({
        quantile: index / 10,
        quantileLabel: `${index * 10} %`,
        accessibleTypes: index + 2,
        comparisonAccessibleTypes: index + 2.5,
      })),
    },
  },
  totalBuildings: 100,
  provenance: null,
  comparisonLabel: 'communes de l’EPCI',
  comparisonTotalBuildings: 100,
}

describe('AccessRampFigureCahier', () => {
  it('renders territory and comparison curves with cut-wide anchored tooltips', async () => {
    const wrapper = mount(AccessRampFigureCahier, {
      props: {
        ramp,
        territoryName: 'Communauté de communes du Pays de la Roche aux Fées',
      },
    })

    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).toContain('Communauté de communes du Pays de la Roche aux Fées')
    expect(wrapper.findAll('.access-ramp-line--territory')).toHaveLength(3)
    expect(wrapper.findAll('.access-ramp-line--comparison')).toHaveLength(3)
    expect(wrapper.findAll('.cahier-figure-legend-item')).toHaveLength(2)
    expect(wrapper.findAll('.access-ramp-mode-annotation')).toHaveLength(3)
    expect(wrapper.findAll('.access-ramp-mode-annotation').map((annotation) => annotation.attributes('aria-label'))).toEqual([
      'Voiture',
      'À vélo + TC',
      'À pied + TC',
    ])
    expect(wrapper.findAll('.access-ramp-mode-annotation text')).toHaveLength(0)
    expect(wrapper.find('.access-ramp-median-label').exists()).toBe(false)
    expect(wrapper.find('.cahier-figure-legend').text()).toContain('Communauté de communes du Pays de la Roche aux Fées')
    expect(wrapper.find('.cahier-figure-lecture').exists()).toBe(false)
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.find('.access-ramp-note').exists()).toBe(false)
    expect(wrapper.findAll('.access-ramp-cut-hitbox')).toHaveLength(11)

    await wrapper.find<HTMLButtonElement>('[data-quantile="0.5"]').trigger('focus')
    const tooltip = wrapper.find('[role="tooltip"]')
    expect(tooltip.text()).toContain('Part cumulée : 50 %')
    expect(tooltip.findAll('.cahier-figure-tooltip-row')).toHaveLength(6)
    expect(tooltip.findAll('.cahier-figure-tooltip-icon')).toHaveLength(6)
    expect(tooltip.text()).toContain('Communauté de communes du Pays de la Roche aux Fées · Voiture5')
    expect(tooltip.findAll('dd').every((value) => !value.text().includes('Communauté de communes'))).toBe(true)
    expect(tooltip.text()).not.toContain('Territoire')
    expect(tooltip.text()).toContain('Groupe comparé · Voiture5,5')
    expect(tooltip.text()).not.toContain('communes de l’EPCI')
    expect(tooltip.text()).not.toContain('types accessibles')
    expect(tooltip.classes()).toContain('cahier-figure-tooltip--chart')
  })
})

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
      })),
    },
    bike: {
      mode: 'bike',
      modeLabel: 'À vélo + TC',
      points: Array.from({ length: 11 }, (_, index) => ({
        quantile: index / 10,
        quantileLabel: `${index * 10} %`,
        accessibleTypes: index + 1,
      })),
    },
    walkTransit: {
      mode: 'walkTransit',
      modeLabel: 'À pied + TC',
      points: Array.from({ length: 11 }, (_, index) => ({
        quantile: index / 10,
        quantileLabel: `${index * 10} %`,
        accessibleTypes: index + 2,
      })),
    },
  },
  totalBuildings: 100,
  provenance: null,
  comparisonLabel: null,
}

describe('AccessRampFigureCahier', () => {
  it('renders the three payload-owned curves and a complete accessible table', () => {
    const wrapper = mount(AccessRampFigureCahier, {
      props: { ramp, territoryName: 'Commune A' },
    })

    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).toContain('Commune A')
    expect(wrapper.findAll('.access-ramp-line')).toHaveLength(3)
    expect(wrapper.findAll('.access-ramp-legend li')).toHaveLength(3)
    expect(wrapper.text()).toContain('Voiture')
    expect(wrapper.text()).toContain('À vélo + TC')
    expect(wrapper.text()).toContain('À pied + TC')
    expect(wrapper.text()).toContain('Chaque courbe classe séparément')
    expect(wrapper.find('table caption').text()).toContain('Commune A')
    expect(wrapper.findAll('tbody tr')).toHaveLength(33)
    expect(wrapper.findAll('tbody tr')[1]?.text()).toContain('10 %')
  })
})

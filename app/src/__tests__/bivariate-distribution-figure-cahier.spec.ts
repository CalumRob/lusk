import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BivariateDistributionFigureCahier from '@/fiche/prototype/BivariateDistributionFigureCahier.vue'
import type { MobiliteBuildingDistribution } from '@/fiche/content/territoryFacts'

const breadthBins = [
  { key: '0', min: 0, max: 0, label: '0 type' },
  { key: '1-9', min: 1, max: 9, label: '1 à 9 types' },
  { key: '10-24', min: 10, max: 24, label: '10 à 24 types' },
  { key: '25-39', min: 25, max: 39, label: '25 à 39 types' },
  { key: '40-53', min: 40, max: 53, label: '40 à 53 types' },
] as const

const depthBins = [
  { key: '0', min: 0, max: 0, label: '0 équipement' },
  { key: '1-9', min: 1, max: 9, label: '1 à 9 équipements' },
  { key: '10-49', min: 10, max: 49, label: '10 à 49 équipements' },
  { key: '50-199', min: 50, max: 199, label: '50 à 199 équipements' },
  { key: '200-499', min: 200, max: 499, label: '200 à 499 équipements' },
  { key: '500+', min: 500, max: null, label: '500 équipements ou plus' },
] as const

const distribution: MobiliteBuildingDistribution = {
  availability: 'complete',
  mode: 't',
  modeLabel: 'À pied + TC',
  breadthAxisLabel: 'types d’équipements accessibles',
  depthAxisLabel: 'équipements accessibles',
  breadthBins,
  depthBins,
  cells: [
    { breadthBucket: '1-9', depthBucket: '1-9', buildingCount: 40, share: 0.4 },
    { breadthBucket: '10-24', depthBucket: '10-49', buildingCount: 60, share: 0.6 },
  ],
  totalBuildings: 100,
  provenance: null,
  comparisonLabel: null,
}

describe('BivariateDistributionFigureCahier', () => {
  it('renders payload-owned bins and writes every cell for accessible reading', () => {
    const wrapper = mount(BivariateDistributionFigureCahier, {
      props: { distribution, territoryName: 'Commune A' },
    })

    expect(wrapper.find('.bivariate-distribution-svg').attributes('aria-label')).toContain('Commune A')
    expect(wrapper.findAll('.bivariate-grid-cell')).toHaveLength(30)
    expect(wrapper.text()).toContain('types d’équipements accessibles')
    expect(wrapper.text()).toContain('À pied + TC')
    expect(wrapper.find('table caption').text()).toContain('Commune A')
    expect(wrapper.findAll('tbody tr')).toHaveLength(30)
    expect(wrapper.findAll('tbody tr')[7]?.text()).toContain('40')
    expect(wrapper.findAll('tbody tr')[7]?.text()).toContain('40 %')
  })
})

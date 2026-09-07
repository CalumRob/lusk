import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BivariateDistributionFigureCahier from '@/fiche/prototype/BivariateDistributionFigureCahier.vue'
import type { MobiliteBuildingDistribution } from '@/fiche/content/territoryFacts'

const breadthBins = [
  { key: '0', min: 0, max: 0, label: '0' },
  { key: '1-9', min: 1, max: 9, label: '1–9' },
  { key: '10-24', min: 10, max: 24, label: '10–24' },
  { key: '25-39', min: 25, max: 39, label: '25–39' },
  { key: '40-53', min: 40, max: 53, label: '40–53' },
] as const

const depthBins = [
  { key: '0', min: 0, max: 0, label: '0' },
  { key: '1-9', min: 1, max: 9, label: '1–9' },
  { key: '10-49', min: 10, max: 49, label: '10–49' },
  { key: '50-199', min: 50, max: 199, label: '50–199' },
  { key: '200-499', min: 200, max: 499, label: '200–499' },
  { key: '500+', min: 500, max: null, label: '500 ou +' },
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
    { breadthBucket: '1-9', depthBucket: '1-9', buildingCount: 40, share: 0.4, comparisonBuildingCount: 40, comparisonShare: 0.4 },
    { breadthBucket: '10-24', depthBucket: '10-49', buildingCount: 60, share: 0.6, comparisonBuildingCount: 60, comparisonShare: 0.6 },
    { breadthBucket: '25-39', depthBucket: '50-199', buildingCount: 0, share: 0, comparisonBuildingCount: 0, comparisonShare: 0 },
  ],
  totalBuildings: 100,
  provenance: null,
  comparisonLabel: 'communes de l’EPCI',
  comparisonTotalBuildings: 100,
}

describe('BivariateDistributionFigureCahier', () => {
  it('renders both shares through focused cell tooltips without a duplicate table', async () => {
    const wrapper = mount(BivariateDistributionFigureCahier, {
      props: {
        distribution,
        territoryName: 'Commune A',
      },
    })

    expect(wrapper.find('.bivariate-distribution-svg').attributes('aria-label')).toContain('Commune A')
    expect(wrapper.findAll('.bivariate-grid-line')).toHaveLength(30)
    expect(wrapper.text()).toContain('types d’équipements accessibles')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.findAll('.bivariate-ramp-legend__item')).toHaveLength(2)
    expect(wrapper.find('.bivariate-ramp-legend').text()).toContain('Commune A')
    expect(wrapper.findAll('.bivariate-cell-hitbox')).toHaveLength(2)
    expect(wrapper.findAll('.bivariate-cell-territory')).toHaveLength(2)
    expect(wrapper.findAll('.bivariate-cell-comparison')).toHaveLength(2)
    expect(wrapper.find('.bivariate-cell-comparison').attributes('style')).toContain('var(--cahier-region-emphasis)')
    expect(wrapper.find('.bivariate-grid-comparison').exists()).toBe(false)
    expect(wrapper.findAll('.bivariate-grid-share--territory')).toHaveLength(2)
    expect(wrapper.findAll('.bivariate-grid-share--comparison')).toHaveLength(2)
    expect(wrapper.find('.bivariate-grid-share--inverse').exists()).toBe(false)
    expect(wrapper.findAll('.bivariate-ramp-legend__triangle')).toHaveLength(2)

    await wrapper.find<HTMLButtonElement>('[data-cell="1-9:1-9"]').trigger('focus')
    const tooltip = wrapper.find('[role="tooltip"]')
    expect(tooltip.text()).toContain('1–9 types · 1–9 équipements')
    expect(tooltip.text()).toContain('40 %')
    expect(tooltip.text()).toContain('Groupe comparé')
    expect(tooltip.text()).not.toContain('communes de l’EPCI')
    expect(tooltip.text()).not.toContain('bâtiments')
    expect(tooltip.classes()).toContain('cahier-figure-tooltip--chart')
    expect(tooltip.attributes('style')).toContain('--cahier-figure-tooltip-anchor-x')
    expect(wrapper.find('.bivariate-distribution-note').exists()).toBe(false)
    expect(wrapper.find('.cahier-figure-lecture').exists()).toBe(false)
  })
})

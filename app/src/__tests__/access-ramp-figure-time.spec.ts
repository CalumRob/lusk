import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import CahierFigureLegend from '@/fiche/prototype/CahierFigureLegend.vue'
import type { TimeRampFigureData } from '@/fiche/content/territoryFacts'

function timeRamp(overrides: Partial<TimeRampFigureData> = {}): TimeRampFigureData {
  return {
    availability: 'incomplete',
    xAxis: { label: 'Temps d’accès', unit: 'minutes' },
    yAxis: { label: 'Diversité accessible', unit: 'types' },
    series: [
      {
        key: 'car',
        label: 'Voiture',
        points: [5, 10, 15, 20].map((minute, index) => ({
          xValue: minute,
          xLabel: `${minute} min`,
          value: [2, null, 4, 5][index]!,
          referenceValue: [1, 2, null, 4][index]!,
        })),
      },
      {
        key: 'walk',
        label: 'À pied',
        points: [5, 10, 15, 20].map((minute, index) => ({
          xValue: minute,
          xLabel: `${minute} min`,
          value: [1, 1, 2, 2][index]!,
          referenceValue: [null, 1, 1, 1][index]!,
        })),
      },
    ],
    provenance: null,
    comparisonLabel: 'Territoires comparables',
    ...overrides,
  }
}

describe('AccessRampFigureCahier time ramp', () => {
  it('toggles each mode and its reference together with accessible selected state', async () => {
    const wrapper = mount(AccessRampFigureCahier, { props: { timeRamp: timeRamp(), territoryName: 'Territoire test' } })
    const car = wrapper.find('button[aria-pressed="true"]')
    expect(car.text()).toContain('Voiture')
    expect(car.classes()).toContain('cahier-figure-legend-toggle')
    expect(car.element.tagName).toBe('BUTTON')
    expect(wrapper.find('.cahier-figure-legend-item button:focus-visible').exists()).toBe(false)
    const walking = wrapper.findAll('.cahier-figure-legend-item button').find((button) => button.text().includes('pied'))!
    expect(walking.attributes('aria-pressed')).toBe('false')
    await walking.trigger('click')
    expect(walking.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.access-ramp-line--walkTransit-light')).toHaveLength(2)
    await walking.trigger('click')
    expect(walking.attributes('aria-pressed')).toBe('false')
    expect(wrapper.findAll('.access-ramp-line--walkTransit-light')).toHaveLength(0)
  })

  it('recomputes scale and accessible data from visible modes only, safely when all are hidden', async () => {
    const data = timeRamp({ series: [
      { key: 'car', label: 'Voiture', points: [5, 10, 15, 20].map((xValue) => ({ xValue, xLabel: `${xValue} min`, value: 10, referenceValue: 9 })) },
      { key: 'transit', label: 'Transports en commun', points: [5, 10, 15, 20].map((xValue) => ({ xValue, xLabel: `${xValue} min`, value: 100, referenceValue: 90 })) },
    ] })
    const wrapper = mount(AccessRampFigureCahier, { props: { timeRamp: data, territoryName: 'Territoire test' } })
    const transit = wrapper.findAll('.cahier-figure-legend-item button').find((button) => button.text().includes('Transports'))!
    expect(transit.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).toContain('Transports en commun')
    await transit.trigger('click')
    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).not.toContain('Transports en commun')
    expect(wrapper.findAll('.access-ramp-line--comparison')).toHaveLength(1)
    const carPath = wrapper.find('.access-ramp-line--territory').attributes('d') ?? ''
    expect(Number(carPath.match(/M [\d.]+ ([\d.]+)/)?.[1])).toBeLessThan(200)
    const carButton = wrapper.find('.cahier-figure-legend-item button[aria-pressed="true"]')
    await carButton.trigger('click')
    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).not.toContain('Voiture')
    expect(wrapper.findAll('.access-ramp-line--territory')).toHaveLength(0)
    expect(wrapper.findAll('.access-ramp-grid line').length).toBeGreaterThan(0)
  })

  it('renders time ticks, horizon, unit, reference, gaps, and accessible value tooltips', async () => {
    const wrapper = mount(AccessRampFigureCahier, { props: { timeRamp: timeRamp(), territoryName: 'Territoire test' } })
    await wrapper.findAll('.cahier-figure-legend-item button').find((button) => button.text().includes('pied'))!.trigger('click')
    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).toContain('Territoire test')
    expect(wrapper.find('.access-ramp-cahier').text()).toContain('types')
    expect(wrapper.find('.access-ramp-horizon').exists()).toBe(false)
    const labels = wrapper.find('.cahier-figure-axis-labels').text()
    for (const minute of [5, 10, 15, 20]) expect(labels).toContain(`${minute} min`)
    // Null territory and reference values split each corresponding line into segments.
    const lines = wrapper.findAll('.access-ramp-time-line')
    expect(lines).toHaveLength(6)
    expect(lines.filter((line) => line.classes().includes('access-ramp-line--comparison'))).toHaveLength(3)
    await wrapper.find('[aria-label="Temps d\'accès : 15 min"]').trigger('focus')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('15 min')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('Territoire test · Voiture')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('4 types')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('Territoires comparables : Indisponible')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('Territoire test · À pied')
    expect(wrapper.find('[role="tooltip"]').text()).toContain('Territoires comparables : 1')
  })

  it('colors each mode line in its mode family and lists the modes in the legend', async () => {
    const wrapper = mount(AccessRampFigureCahier, { props: { timeRamp: timeRamp(), territoryName: 'Territoire test' } })

    // Walking is opt-in for this fixture because the default only enables car,
    // transit and LTS2, none of which include its walk series.
    const walking = wrapper.findAll('.cahier-figure-legend-item button').find((button) => button.text().includes('pied'))!
    await walking.trigger('click')

    // Territory and reference paths both carry the mode color class.
    expect(wrapper.findAll('.access-ramp-line--car').length).toBeGreaterThanOrEqual(2)
    expect(wrapper.findAll('.access-ramp-line--walkTransit-light').length).toBeGreaterThanOrEqual(2)
    // The time ramp is line-only; null values split territory/reference paths.
    expect(wrapper.findAll('.access-ramp-time-line.access-ramp-line--car')).toHaveLength(4)
    expect(wrapper.findAll('.access-ramp-time-line.access-ramp-line--walkTransit-light')).toHaveLength(2)

    // One legend entry per mode (line marker in the mode color) plus the reference dash.
    const items = wrapper.findAll('.access-ramp-cahier--time .cahier-figure-legend-item')
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.text())).toEqual(['Voiture', 'À pied', 'Territoires comparables'])
    const legend = wrapper.findComponent(CahierFigureLegend)
    expect(legend.props('entries').map((entry: { label: string }) => entry.label)).toEqual(['Voiture', 'À pied', 'Territoires comparables'])
    expect(legend.props('markColors')).toEqual({
      car: 'var(--cahier-mode-car)',
      walk: 'color-mix(in srgb, var(--cahier-mode-foot) 55%, var(--paper))',
    })
    const marks = wrapper.findAll('.access-ramp-cahier--time .cahier-figure-legend-mark')
    expect(marks[2]?.classes()).toContain('cahier-figure-legend-mark--dash')
  })

  it('describes the visible modes and the reference in the accessible label', async () => {
    const wrapper = mount(AccessRampFigureCahier, { props: { timeRamp: timeRamp(), territoryName: 'Territoire test' } })
    await wrapper.findAll('.cahier-figure-legend-item button').find((button) => button.text().includes('pied'))!.trigger('click')
    const label = wrapper.find('.access-ramp-svg').attributes('aria-label') ?? ''
    expect(label).toContain('par mode de déplacement')
    expect(label).toContain('Voiture : 5 min 2, 10 min indisponible, 15 min 4, 20 min 5')
    expect(label).toContain('À pied : 5 min 1, 10 min 1, 15 min 2, 20 min 2')
    expect(label).toContain('Référence Territoires comparables')
  })

  it('renders modes only, without reference lines, when no comparison label exists', () => {
    const wrapper = mount(AccessRampFigureCahier, {
      props: { timeRamp: timeRamp({ comparisonLabel: null }), territoryName: 'Territoire test' },
    })
    expect(wrapper.findAll('.access-ramp-line--comparison')).toHaveLength(0)
    expect(wrapper.findAll('.access-ramp-cahier--time .cahier-figure-legend-item')).toHaveLength(2)
  })
})

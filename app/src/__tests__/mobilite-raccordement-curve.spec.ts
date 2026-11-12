import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import CahierMobiliteRaccordementCurve from '@/fiche/prototype/CahierMobiliteRaccordementCurve.vue'
import type { MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { ContentFact } from '@/fiche/content/themeContent'

function point(detail: string, axisValue: number, value: number | null): ContentFact {
  return {
    label: detail,
    fact: {
      key: 'raccordement_courbe',
      detail,
      axisValue,
      value,
      unit: '%',
      availability: value === null ? 'incomplete' : 'complete',
      provenance: null,
      comparison: null,
      comparisonBasis: 'territory-mean',
      reason: null,
    },
  }
}

const trajectory = {
  endpoints: ['t0000', 't0360'],
  axis: 'numeric' as const,
  axisLabels: { x: 'Temps de trajet (minutes)', y: 'Population joignable (%)' },
  ticks: [
    { detail: 't0000', label: '0', mobile: true },
    { detail: 't0090', label: '1 h 30', mobile: true },
    { detail: 't0360', label: '6 h', mobile: true },
  ],
  marker: { detail: 't0090', label: '1 h 30 (90 min)' },
}

function curveFigure(overrides: Partial<MobiliteRaccordementEvidence> = {}): MobiliteRaccordementEvidence {
  const points = [point('t0000', 0, 0), point('t0090', 90, 0.4), point('t0360', 360, 0.82)]
  return {
    kind: 'mobilite-raccordement',
    figureTitle: 'Courbe de population bretonne jointe selon le temps de trajet',
    territoryName: 'Commune A',
    level: 'commune',
    points,
    comparison: {
      statistic: 'mean',
      scope: { kind: 'selection', label: 'communes de la classe de densité' },
      selectedMemberCount: 2,
      eligibleCount: 2,
      modelZeroReasonCounts: {},
      points: points.map((item) => ({ ...item,
        fact: { ...item.fact, value: item.fact.value === null ? null : item.fact.value * 0.8 } })),
    },
    trajectory,
    axis: {
      values: points.map((item) => ({ detail: item.fact.detail!, numericValue: item.fact.axisValue! })),
      minimum: 0,
      maximum: 360,
    },
    markerValue: {
      label: 'Population bretonne jointe en 90 minutes',
      fact: { ...point('t0090', 90, 0.4).fact, key: 'raccordement_tc',
        comparison: { direction: 'plus-est-mieux',
          scope: { kind: 'communes-densite', label: 'communes de la classe de densité' },
          rank: { position: 2, size: 5 }, reference: { kind: 'mean', value: 0.32 } } },
    },
    comparisonLabel: 'Moyenne des communes de la classe de densité',
    prose: [],
    sources: [],
    ...overrides,
  }
}

const ready = { status: 'ready' as const }

describe('CahierMobiliteRaccordementCurve — Visiter la Bretagne', () => {
  it('draws the native x grid, the marker from trajectory metadata and the active group mean', () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure: curveFigure(), comparison: ready } })
    const svg = wrapper.get('svg[role="img"]')
    const aria = svg.attributes('aria-label')!
    expect(aria).toContain('Temps de trajet (minutes)')
    expect(aria).toContain('Population joignable (%)')
    expect(aria).toContain('1 h 30 (90 min)')
    expect(aria).toContain('Groupe comparé')
    expect(aria).toContain('Moyenne')
    expect(aria).toContain('communes de la classe de densité')
    expect(aria).toContain('Rang')
    expect(aria).toContain('2e/5')
    expect(wrapper.findAll('.cahier-figure-tick-label--x')).toHaveLength(3)
    expect(wrapper.text()).toContain('1 h 30')
    const marker = wrapper.get('.mobilite-raccordement-curve__marker')
    expect(marker.attributes('data-detail')).toBe('t0090')
    expect(wrapper.get('.mobilite-raccordement-curve__marker-label').text()).toBe('1 h 30 (90 min)')
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').attributes('d')).toContain('M')
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').attributes('d'))
      .not.toBe(wrapper.find('.mobilite-raccordement-curve__territory').attributes('d'))
    expect(wrapper.text()).not.toContain('Bretagne — moyenne')
  })

  it('draws a neutral dashed reference, not a colour-only distinction, toggled by its persistent legend button', async () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure: curveFigure(), comparison: ready } })
    const legend = wrapper.get('.mobilite-raccordement-curve__legend')
    const comparisonButton = legend.findAll('button')
      .find((button) => (button.attributes('aria-label') ?? '').includes('Groupe comparé'))!
    expect(comparisonButton.attributes('aria-pressed')).toBe('true')
    await comparisonButton.trigger('click')
    expect(comparisonButton.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
  })

  it('keeps a selection that resolves to no reference honest and never falls back to Brittany', () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, {
      props: { figure: curveFigure({ comparison: null }), comparison: { status: 'unavailable' } },
    })
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)
    expect(wrapper.find('[data-series="reference"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Aucun groupe comparé')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('Aucun groupe comparé actif')
    expect(wrapper.text()).not.toContain('Bretagne — moyenne')
  })

  it('keeps the curve and legend visible while the group comparison loads', () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, {
      props: { figure: curveFigure({ comparison: null }), comparison: { status: 'loading' } },
    })
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)
    expect(wrapper.get('.mobilite-raccordement-curve__legend').text()).toContain('Groupe comparé')
  })

  it('offers an error state with retry without blanking the territory curve', async () => {
    const retry = vi.fn()
    const wrapper = mount(CahierMobiliteRaccordementCurve, {
      props: {
        figure: curveFigure({ comparison: null }),
        comparison: { status: 'error', error: 'lecture refusée', retry },
      },
    })
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    expect(wrapper.text()).toContain('lecture refusée')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('Comparaison indisponible')
    await wrapper.get('.mobilite-raccordement-curve__retry').trigger('click')
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('exposes bare tooltip values with full units and the served rank in the accessible reading', async () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure: curveFigure(), comparison: ready } })
    const surface = wrapper.get('.mobilite-raccordement-curve__hit-surface')
    await surface.trigger('focus')
    const tooltip = wrapper.get('.mobilite-raccordement-curve__tooltip')
    expect(tooltip.text()).not.toContain('%')
    const row = tooltip.findAll('.cahier-figure-tooltip-row')
      .find((candidate) => (candidate.attributes('aria-label') ?? '').includes('Groupe comparé'))!
    expect(row.attributes('aria-label')).toContain('%')
    expect(row.attributes('aria-label')).toContain('Moyenne')
    expect(row.attributes('aria-label')).toContain('communes de la classe de densité')
    expect(row.attributes('aria-label')).toContain('Rang')
    const comparison = row.get('.cahier-figure-tooltip-row-comparison')
    expect(comparison.text()).toContain('32')
    expect(comparison.text()).toContain('2e')
    expect(comparison.text()).not.toContain('%')
  })

  it('shows the tooltip on focus and dismisses it with Escape or a tap outside', async () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, {
      props: { figure: curveFigure(), comparison: ready },
      attachTo: document.body,
    })
    const hitbox = wrapper.get('.mobilite-raccordement-curve__hit-surface')
    await hitbox.trigger('focus')
    expect(wrapper.find('.mobilite-raccordement-curve__tooltip').exists()).toBe(true)
    await hitbox.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.mobilite-raccordement-curve__tooltip').exists()).toBe(false)
    await hitbox.trigger('focus')
    expect(wrapper.find('.mobilite-raccordement-curve__tooltip').exists()).toBe(true)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mobilite-raccordement-curve__tooltip').exists()).toBe(false)
    wrapper.unmount()
  })

  it('breaks the path across missing values and never draws a baseline mark for them', () => {
    const figure = curveFigure({
      trajectory: {
        ...trajectory,
        ticks: [
          { detail: 't0000', label: '0' },
          { detail: 't0045', label: '45' },
          { detail: 't0090', label: '1 h 30' },
          { detail: 't0120', label: '2 h' },
          { detail: 't0360', label: '6 h' },
        ],
      },
      points: [
        point('t0000', 0, 0),
        point('t0045', 45, 0.2),
        point('t0090', 90, null),
        point('t0120', 120, 0.5),
        point('t0360', 360, 0.8),
      ],
      axis: { values: [
        { detail: 't0000', numericValue: 0 },
        { detail: 't0045', numericValue: 45 },
        { detail: 't0090', numericValue: 90 },
        { detail: 't0120', numericValue: 120 },
        { detail: 't0360', numericValue: 360 },
      ], minimum: 0, maximum: 360 },
      comparison: null,
    })
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure, comparison: { status: 'unavailable' } } })
    const points = wrapper.findAll('.mobilite-raccordement-curve__point--territory')
    expect(points).toHaveLength(4)
    expect(points.map((point) => point.attributes('data-value'))).toEqual(['0', '0.2', '0.5', '0.8'])
    const path = wrapper.get('.mobilite-raccordement-curve__territory').attributes('d')!
    expect(path).not.toContain('NaN')
    expect((path.match(/M/g) ?? [])).toHaveLength(2)
    expect((path.match(/L/g) ?? [])).toHaveLength(2)
    expect(wrapper.findAll('.cahier-figure-tick-label--x')).toHaveLength(5)
    wrapper.unmount()
  })

  it('does not draw a marker vertex at zero when the marker value is missing', () => {
    const figure = curveFigure()
    figure.points = [point('t0000', 0, 0), point('t0090', 90, null), point('t0360', 360, 0.8)]
    figure.axis = { values: [
      { detail: 't0000', numericValue: 0 },
      { detail: 't0090', numericValue: 90 },
      { detail: 't0360', numericValue: 360 },
    ], minimum: 0, maximum: 360 }
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure, comparison: ready } })
    expect(wrapper.find('.mobilite-raccordement-curve__marker').exists()).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__marker-point').exists()).toBe(false)
    const markerLabel = wrapper.get('.mobilite-raccordement-curve__marker-label')
    expect(markerLabel.text()).toBe('1 h 30 (90 min)')
    wrapper.unmount()
  })

  it('positions semantic detail names from declared numeric coordinates, never from names or indices', async () => {
    const figure = curveFigure({
      trajectory: {
        endpoints: ['depart', 'fin'],
        axis: 'numeric',
        axisLabels: { x: 'Temps de trajet (minutes)', y: 'Population joignable (%)' },
        ticks: [
          { detail: 'depart', label: '0' },
          { detail: 'milieu', label: '1 h 30' },
          { detail: 'fin', label: '6 h' },
          { detail: 'inconnu', label: 'sans coordonnée' },
        ],
        marker: { detail: 'milieu', label: '1 h 30 (90 min)' },
      },
      points: [point('depart', 0, 0), point('milieu', 90, 0.5), point('fin', 360, 0.8)],
      axis: { values: [
        { detail: 'depart', numericValue: 0 },
        { detail: 'milieu', numericValue: 90 },
        { detail: 'fin', numericValue: 360 },
      ], minimum: 0, maximum: 360 },
    })
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure, comparison: ready } })
    expect(wrapper.findAll('.cahier-figure-tick-label--x')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('sans coordonnée')
    const path = wrapper.get('.mobilite-raccordement-curve__territory').attributes('d')!
    expect(path).not.toContain('NaN')
    expect((path.match(/L/g) ?? [])).toHaveLength(2)
    const surface = wrapper.get('.mobilite-raccordement-curve__hit-surface')
    await surface.trigger('focus')
    expect(wrapper.get('.mobilite-raccordement-curve__tooltip').text()).toContain('1 h 30')
    wrapper.unmount()
  })

  it('omits a served 1/1 rank from the figure accessible name', () => {
    const figure = curveFigure()
    figure.markerValue = {
      ...figure.markerValue!,
      fact: { ...figure.markerValue!.fact,
        comparison: { ...figure.markerValue!.fact.comparison!,
          rank: { position: 1, size: 1 } } },
    }
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure, comparison: ready } })
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).not.toContain('Rang')
    wrapper.unmount()
  })

  it('keeps the 0 % and 100 % bounds inside the plot instead of clipping the axes', () => {
    const figure = curveFigure({
      points: [point('t0000', 0, 0), point('t0090', 90, 0.5), point('t0360', 360, 1)],
    })
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure, comparison: ready } })
    const points = wrapper.findAll('.mobilite-raccordement-curve__point--territory')
    expect(points[0]!.attributes('data-value')).toBe('0')
    expect(points.at(-1)!.attributes('data-value')).toBe('1')
    expect(wrapper.text()).toContain('0 %')
    expect(wrapper.text()).toContain('100 %')
  })

  it('uses the brand territory line and a neutral dashed reference from the shared tokens', () => {
    const source = readFileSync(join(
      process.cwd(), 'src', 'fiche', 'prototype', 'CahierMobiliteRaccordementCurve.vue',
    ), 'utf8')
    expect(source).toContain('stroke: var(--brand-500)')
    expect(source).toMatch(/\.mobilite-raccordement-curve__comparison\s*\{[^}]*stroke-dasharray/u)
    expect(source).toContain('stroke: var(--cahier-default, var(--editorial-muted))')
  })
})

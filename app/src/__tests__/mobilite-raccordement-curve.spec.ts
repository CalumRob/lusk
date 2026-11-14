import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import CahierMobiliteRaccordementCurve from '@/fiche/prototype/CahierMobiliteRaccordementCurve.vue'
import type { ContentFact, MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'

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
    { detail: 't0015', label: '15', mobile: false },
    { detail: 't0030', label: '30', mobile: false },
    { detail: 't0045', label: '45', mobile: true },
    { detail: 't0060', label: '1 h', mobile: false },
    { detail: 't0090', label: '1 h 30', mobile: true },
    { detail: 't0360', label: '6 h', mobile: true },
  ],
  marker: { detail: 't0090', label: '1 h 30 (90 min)' },
}

function curveFigure(overrides: Partial<MobiliteRaccordementEvidence> = {}): MobiliteRaccordementEvidence {
  const points = [point('t0000', 0, 0), point('t0090', 90, 0.4), point('t0360', 360, 0.82)]
  return {
    kind: 'mobilite-raccordement',
    figureTitle: 'Population bretonne joignable selon le temps de trajet',
    xAxisTitle: 'Temps de trajet',
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

/** 73 published points on the five-minute grid, exactly as the producer serves them. */
function fullGrid(): ContentFact[] {
  return Array.from({ length: 73 }, (_, index) => {
    const minute = index * 5
    return point(`t${String(minute).padStart(4, '0')}`, minute, Math.min(1, 0.2 + minute / 600))
  })
}

/** A figure whose declared numeric axis covers every declared tick. */
function tickedFigure(): MobiliteRaccordementEvidence {
  const base = curveFigure()
  return {
    ...base,
    axis: {
      values: trajectory.ticks.map((tick) => ({
        detail: tick.detail,
        numericValue: Number(tick.detail.slice(1)),
      })),
      minimum: 0,
      maximum: 360,
    },
  }
}

const ready = { status: 'ready' as const }

describe('CahierMobiliteRaccordementCurve — approved travel-time figure (#1006)', () => {
  it('draws the full native grid as one straight-segment path, with no permanent point chain', () => {
    const points = fullGrid()
    const figure = curveFigure({
      points,
      comparison: null,
      axis: {
        values: points.map((item) => ({ detail: item.fact.detail!, numericValue: item.fact.axisValue! })),
        minimum: 0,
        maximum: 360,
      },
    })
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure, comparison: { status: 'unavailable' } } })

    const path = wrapper.get('.mobilite-raccordement-curve__territory').attributes('d')!
    expect((path.match(/M/gu) ?? [])).toHaveLength(1)
    // 73 points, 72 straight segments: nothing resampled or smoothed.
    expect((path.match(/L/gu) ?? [])).toHaveLength(72)
    expect(path).not.toContain('NaN')
    expect(path).not.toMatch(/[CQ]/u)

    // No chain of permanent point circles.
    expect(wrapper.findAll('.mobilite-raccordement-curve__point--territory')).toHaveLength(0)
    expect(wrapper.findAll('circle')).toHaveLength(0)
    wrapper.unmount()
  })

  it('keeps the published marker as its dashed reference line only', () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure: curveFigure(), comparison: ready } })
    const marker = wrapper.get('.mobilite-raccordement-curve__marker')
    expect(marker.attributes('data-detail')).toBe('t0090')
    expect(marker.find('.mobilite-raccordement-curve__marker-line').exists()).toBe(true)
    // No permanent dot and no on-plot label: the marker is a coordinate, not a badge.
    expect(wrapper.find('.mobilite-raccordement-curve__marker-point').exists()).toBe(false)
    expect(wrapper.find('.mobilite-raccordement-curve__marker-label').exists()).toBe(false)
    expect(wrapper.find('text').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('1 h 30 (90 min)')
    // The marker evidence survives in the accessible reading and the tooltip.
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('1 h 30 (90 min)')
  })

  it('owns the figure title and the travel-time axis title while ticks name their minute unit', () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure: tickedFigure(), comparison: ready } })
    const aria = wrapper.get('svg[role="img"]').attributes('aria-label')!
    expect(aria).toContain('Population bretonne joignable selon le temps de trajet')
    expect(aria).toContain('Axe horizontal : Temps de trajet.')
    expect(aria).not.toContain('Temps de trajet (minutes)')
    expect(aria).toContain('Population joignable (%)')

    const labels = wrapper.findAll('.cahier-figure-tick-label--x').map((label) => label.text())
    expect(labels).toEqual(['0', '15 min', '30 min', '45 min', '1 h', '1 h 30', '6 h'])
    expect(labels).not.toContain('0 min')
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
    expect((path.match(/L/gu) ?? [])).toHaveLength(2)
    await wrapper.get('.mobilite-raccordement-curve__hit-surface').trigger('focus')
    expect(wrapper.get('.mobilite-raccordement-curve__tooltip').text()).toContain('1 h 30')
    wrapper.unmount()
  })

  it('shows the actual point evidence on focus, keyboard and touch', async () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, {
      props: { figure: curveFigure(), comparison: ready },
      attachTo: document.body,
    })
    const hitbox = wrapper.get('.mobilite-raccordement-curve__hit-surface')
    await hitbox.trigger('focus')
    // The current point is real evidence, not a permanent chain.
    expect(wrapper.findAll('.mobilite-raccordement-curve__cursor-point--territory')).toHaveLength(1)
    expect(wrapper.findAll('.mobilite-raccordement-curve__cursor-point--comparison')).toHaveLength(1)
    const tooltip = wrapper.get('.mobilite-raccordement-curve__tooltip')
    expect(tooltip.text()).not.toContain('%')
    const row = tooltip.findAll('.cahier-figure-tooltip-row')
      .find((candidate) => (candidate.attributes('aria-label') ?? '').includes('Groupe comparé'))!
    expect(row.attributes('aria-label')).toContain('%')
    expect(row.attributes('aria-label')).toContain('Moyenne')
    expect(row.attributes('aria-label')).toContain('communes de la classe de densité')
    expect(row.attributes('aria-label')).toContain('Rang')

    await hitbox.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.mobilite-raccordement-curve__tooltip').exists()).toBe(false)
    expect(wrapper.find('.mobilite-raccordement-curve__cursor-point--territory').exists()).toBe(false)

    // Touch/pointer exploration reads the nearest declared tick at the real width.
    const surface = hitbox.element as HTMLElement
    surface.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect
    await hitbox.trigger('pointerdown', { clientX: 200 })
    expect(wrapper.find('.mobilite-raccordement-curve__tooltip').exists()).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__cursor-point--territory').exists()).toBe(true)
    wrapper.unmount()
  })

  it('keeps a neutral dashed comparison, its toggle and the actual territory name', async () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure: curveFigure(), comparison: ready } })
    const legend = wrapper.get('.mobilite-raccordement-curve__legend')
    expect(legend.text()).toContain('Commune A')
    expect(legend.text()).toContain('Groupe comparé')
    const comparisonPath = wrapper.get('.mobilite-raccordement-curve__comparison')
    expect(comparisonPath.attributes('d')).toContain('M')

    const comparisonButton = legend.findAll('button')
      .find((button) => (button.attributes('aria-label') ?? '').includes('Groupe comparé'))!
    expect(comparisonButton.attributes('aria-pressed')).toBe('true')
    await comparisonButton.trigger('click')
    expect(comparisonButton.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    wrapper.unmount()
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
    wrapper.unmount()
  })

  it('keeps the curve and legend visible while the group comparison loads', () => {
    const wrapper = mount(CahierMobiliteRaccordementCurve, {
      props: { figure: curveFigure({ comparison: null }), comparison: { status: 'loading' } },
    })
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)
    expect(wrapper.get('.mobilite-raccordement-curve__legend').text()).toContain('Groupe comparé')
    wrapper.unmount()
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
    const path = wrapper.get('.mobilite-raccordement-curve__territory').attributes('d')!
    expect(path).not.toContain('NaN')
    expect((path.match(/M/gu) ?? [])).toHaveLength(2)
    expect((path.match(/L/gu) ?? [])).toHaveLength(2)
    expect(wrapper.findAll('circle')).toHaveLength(0)
    expect(wrapper.findAll('.cahier-figure-tick-label--x')).toHaveLength(5)
    wrapper.unmount()
  })

  it('keeps the 0 % and 100 % bounds inside the plot instead of clipping the axes', () => {
    const figure = curveFigure({
      points: [point('t0000', 0, 0), point('t0090', 90, 0.5), point('t0360', 360, 1)],
    })
    const wrapper = mount(CahierMobiliteRaccordementCurve, { props: { figure, comparison: ready } })
    const path = wrapper.get('.mobilite-raccordement-curve__territory').attributes('d')!
    const ys = [...path.matchAll(/,([0-9.]+)/gu)].map((match) => Number(match[1]))
    expect(Math.min(...ys)).toBeGreaterThan(0)
    expect(Math.max(...ys)).toBeLessThan(300)
    expect(wrapper.text()).toContain('0 %')
    expect(wrapper.text()).toContain('100 %')
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

  it('uses the brand territory line and the brand-200 dashed reference from the shared tokens', () => {
    const source = readFileSync(join(
      process.cwd(), 'src', 'fiche', 'prototype', 'CahierMobiliteRaccordementCurve.vue',
    ), 'utf8')
    expect(source).toContain('stroke: var(--brand-500)')
    expect(source).toMatch(/\.mobilite-raccordement-curve__comparison\s*\{[^}]*stroke: var\(--brand-200\)/u)
    expect(source).toMatch(/\.mobilite-raccordement-curve__comparison\s*\{[^}]*stroke-dasharray/u)
    // Compact AEDAR-ramp proportions, never a protected AEDAR component.
    expect(source).toContain('height: 300')
    expect(source).not.toContain('AccessRampFigureCahier')
  })
})

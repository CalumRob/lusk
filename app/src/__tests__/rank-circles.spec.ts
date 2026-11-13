import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { CahierTooltipRow } from '@/fiche/cahierFigureGrammaire'
import type { NumericFact } from '@/fiche/content/territoryFacts'
import { estRangExtreme } from '@/fiche/figureGrammaire'
import CahierComparisonValue from '@/fiche/prototype/CahierComparisonValue.vue'
import CahierFigureTooltip from '@/fiche/prototype/CahierFigureTooltip.vue'

// #1004 — one extreme-rank rule for the rank already on the page and the rank
// already shown in a tooltip. The outline is decoration: it must never be the
// only difference between two ranks that occupy the same layout.

function fact(position: number, size: number, ties?: number | null): NumericFact {
  return {
    key: 'stationnement_velo_par_voiture',
    detail: null,
    value: 0.3,
    unit: '%',
    availability: 'complete',
    provenance: null,
    comparisonBasis: 'territory-median',
    reason: null,
    comparison: {
      direction: 'plus-est-mieux',
      scope: { kind: 'communes-epci', label: 'communes de Rennes Métropole' },
      rank: { position, size, ...(ties === undefined ? {} : { ties }) },
      reference: { kind: 'median', value: 0.2 },
    },
  }
}

function servedRank(position: number, size: number, ties?: number | null) {
  return {
    position,
    size,
    ...(ties === undefined ? {} : { ties }),
    direction: 'moins-est-mieux' as const,
    key: 'bornes_ev_par_station_service',
  }
}

function tooltipRows(
  rank: string | null,
  evidence?: { position: number; size: number; ties?: number | null } | null,
): readonly CahierTooltipRow[] {
  return [{
    label: 'Réseau cyclable',
    value: '8',
    tone: 'b',
    marker: 'dot',
    comparison: {
      value: '6',
      rank,
      ...(evidence === undefined ? {} : { rankEvidence: evidence }),
      ariaLabel: `Groupe comparé : 6${rank ? `, rang ${rank}` : ''}`,
    },
  }]
}

function inkOf(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('.cahier-rank .cahier-rank-ink')
}

describe('Règle du rang extrême', () => {
  it('conserve la borne existante : le premier et le dernier plafond(5 %) de la population', () => {
    // size 41 → edge = max(1, ceil(2.05)) = 3
    expect([1, 2, 3].map((position) => estRangExtreme({ position, size: 41 }))).toEqual([true, true, true])
    expect([4, 20, 38].map((position) => estRangExtreme({ position, size: 41 }))).toEqual([false, false, false])
    expect([39, 40, 41].map((position) => estRangExtreme({ position, size: 41 }))).toEqual([true, true, true])
    expect(estRangExtreme({ position: 1, size: 2 })).toBe(true)
    expect(estRangExtreme({ position: 2, size: 2 })).toBe(true)
  })

  it('ne cercle jamais un rang absent, invalide ou supprimé (1/1)', () => {
    expect(estRangExtreme(null)).toBe(false)
    expect(estRangExtreme(undefined)).toBe(false)
    expect(estRangExtreme({ position: 1, size: 1 })).toBe(false)
    expect(estRangExtreme({ position: 0, size: 41 })).toBe(false)
    expect(estRangExtreme({ position: 42, size: 41 })).toBe(false)
    expect(estRangExtreme({ position: 1.5, size: 41 })).toBe(false)
  })
})

describe('Cercle du rang de la page', () => {
  it('cercle un rang natif extrême, quel que soit le placement dans le groupe', () => {
    const first = mount(CahierComparisonValue, { props: { fact: fact(1, 41) } })
    expect(first.get('.cahier-rank').text()).toBe('1er/41')
    expect(inkOf(first).classes()).toContain('is-extreme')

    const last = mount(CahierComparisonValue, { props: { fact: fact(41, 41) } })
    expect(last.get('.cahier-rank').text()).toBe('41e/41')
    expect(inkOf(last).classes()).toContain('is-extreme')

    const middle = mount(CahierComparisonValue, { props: { fact: fact(20, 41) } })
    expect(middle.get('.cahier-rank').text()).toBe('20e/41')
    expect(inkOf(middle).classes()).not.toContain('is-extreme')
  })

  it('cercle aussi un rang servi seul (scalaires AEDAR), pas seulement un fait natif', () => {
    const reference = { label: 'Moyenne du groupe comparé', value: 0.3, unit: '%' }
    const extreme = mount(CahierComparisonValue, { props: { namedReference: reference, servedRank: servedRank(1, 41) } })
    expect(extreme.get('.cahier-rank').text()).toBe('1er/41')
    expect(inkOf(extreme).classes()).toContain('is-extreme')

    const middle = mount(CahierComparisonValue, { props: { namedReference: reference, servedRank: servedRank(20, 41) } })
    expect(middle.get('.cahier-rank').text()).toBe('20e/41')
    expect(inkOf(middle).classes()).not.toContain('is-extreme')
  })

  it('fait du rang servi la seule entrée du texte, du cercle et du nom accessible', () => {
    const reference = { label: 'Moyenne du groupe comparé', value: 0.3, unit: '%' }

    const servedMiddle = mount(CahierComparisonValue, {
      props: { namedReference: reference, servedRank: servedRank(20, 41), fact: fact(1, 41) },
    })
    expect(servedMiddle.get('.cahier-rank').text()).toBe('20e/41')
    expect(inkOf(servedMiddle).classes()).not.toContain('is-extreme')
    expect(servedMiddle.get('.cahier-comparison-value__reference').attributes('aria-label')).toContain('20e/41')
    expect(servedMiddle.get('.cahier-comparison-value__reference').attributes('aria-label')).not.toContain('1er/41')

    const servedExtreme = mount(CahierComparisonValue, {
      props: { namedReference: reference, servedRank: servedRank(1, 41), fact: fact(20, 41) },
    })
    expect(servedExtreme.get('.cahier-rank').text()).toBe('1er/41')
    expect(inkOf(servedExtreme).classes()).toContain('is-extreme')
    expect(servedExtreme.get('.cahier-comparison-value__reference').attributes('aria-label')).toContain('1er/41')
    expect(servedExtreme.get('.cahier-comparison-value__reference').attributes('aria-label')).not.toContain('20e/41')
  })

  it('supprime un rang servi 1/1 sans retomber sur le rang natif du fait', () => {
    const wrapper = mount(CahierComparisonValue, {
      props: { namedReference: { label: 'Moyenne du groupe comparé', value: 0.3, unit: '%' },
        servedRank: servedRank(1, 1), fact: fact(1, 41) },
    })
    expect(wrapper.find('.cahier-rank').exists()).toBe(false)
    expect(wrapper.get('.cahier-comparison-value__reference').attributes('aria-label')).not.toContain('1er/41')
    expect(wrapper.text()).toBe('Groupe comparé : 30 %')
  })

  it('garde le marqueur « = » et le cercle sur un rang partagé extrême', () => {
    const wrapper = mount(CahierComparisonValue, {
      props: { namedReference: { label: 'Moyenne du groupe comparé', value: 0.3, unit: '%' },
        servedRank: servedRank(1, 41, 3) },
    })
    expect(wrapper.get('.cahier-rank').text()).toBe('=1er/41')
    expect(inkOf(wrapper).classes()).toContain('is-extreme')
    expect(wrapper.get('.cahier-comparison-value__reference').attributes('aria-label')).toContain('1er/41 (ex æquo)')
  })
})

describe('Cercle du rang dans les tooltips', () => {
  it('cercle le rang servi d’un tooltip à partir de son évidence structurée, jamais du texte formaté', () => {
    const circled = mount(CahierFigureTooltip, {
      props: { title: '15 min', rows: tooltipRows('1er/41', { position: 1, size: 41 }) },
    })
    const rank = circled.get('.cahier-figure-tooltip-comparison-rank')
    expect(rank.text()).toBe('1er/41')
    expect(rank.classes()).toContain('cahier-rank-ink')
    expect(rank.classes()).toContain('is-extreme')
    // Decoration only: no second rank announcement, no new role.
    expect(rank.attributes('role')).toBeUndefined()
    expect(rank.attributes('aria-label')).toBeUndefined()
    expect(rank.attributes('aria-hidden')).toBeUndefined()
    expect(circled.get('.cahier-figure-tooltip-row').attributes('aria-label'))
      .toBe('Réseau cyclable : 8. Groupe comparé : 6, rang 1er/41')

    const middle = mount(CahierFigureTooltip, {
      props: { title: '15 min', rows: tooltipRows('20e/41', { position: 20, size: 41 }) },
    })
    const plain = middle.get('.cahier-figure-tooltip-comparison-rank')
    expect(plain.classes()).toContain('cahier-rank-ink')
    expect(plain.classes()).not.toContain('is-extreme')
  })

  it('ne cercle pas un rang sans évidence structurée, même s’il ressemble à un extrême', () => {
    const wrapper = mount(CahierFigureTooltip, {
      props: { title: '15 min', rows: tooltipRows('1er/41') },
    })
    const rank = wrapper.get('.cahier-figure-tooltip-comparison-rank')
    expect(rank.text()).toBe('1er/41')
    expect(rank.classes()).not.toContain('is-extreme')
  })

  it('cercle un rang partagé extrême sans perdre le « = » visible', () => {
    const wrapper = mount(CahierFigureTooltip, {
      props: { title: '15 min', rows: tooltipRows('=1er/41', { position: 1, size: 41, ties: 3 }) },
    })
    const rank = wrapper.get('.cahier-figure-tooltip-comparison-rank')
    expect(rank.text()).toBe('=1er/41')
    expect(rank.classes()).toContain('is-extreme')
  })
})

describe('Évidence structurée du rang des tooltips', () => {
  const callers = [
    'AccessRampFigureCahier.vue',
    'CartographicBreakoutPrototype.vue',
    'CahierGroupedVerticalBarChart.vue',
    'CahierMobiliteComparisonBars.vue',
    'CahierMobiliteRaccordementCurve.vue',
  ] as const

  it.each(callers)('%s joint l’évidence structurée au rang formaté du tooltip', (file) => {
    const source = readFileSync(join(process.cwd(), 'src', 'fiche', 'prototype', file), 'utf8')
    expect(source).toMatch(/formatServedRank\(/u)
    expect(source).toMatch(/rankEvidence:/u)
  })
})

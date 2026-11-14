import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import CahierMobiliteShareTrack from '@/fiche/prototype/CahierMobiliteShareTrack.vue'
import type { MobiliteShareEvidence } from '@/fiche/content/themeContent'

function shareFigure(overrides: Partial<MobiliteShareEvidence> = {}): MobiliteShareEvidence {
  const value = overrides.value ?? {
    label: 'Part des bâtiments près d’un arrêt (à 500 m)',
    fact: {
      key: 'offre_tc',
      detail: null,
      value: 0.573,
      unit: '%',
      availability: 'complete',
      provenance: { sourceId: 'korrigo', source: 'Bretagne Mobilité', version: '2026-02', referenceDate: '2026-02-28', publicationDate: '2026-08-06' },
      comparison: {
        direction: 'plus-est-mieux',
        scope: { kind: 'communes-densite', label: 'communes de la classe de densité' },
        rank: { position: 2, size: 5 },
        reference: { kind: 'median', value: 0.5 },
      },
      comparisonBasis: 'territory-median',
      reason: null,
    },
  }
  return {
    kind: 'mobilite-share',
    figureTitle: 'Part des bâtiments près d’un arrêt (à 500 m)',
    territoryName: 'Rennes',
    value,
    unit: '%',
    comparisonLabel: 'Médiane des communes de la classe de densité',
    prose: [],
    sources: [],
    ...overrides,
  } as MobiliteShareEvidence
}

function withValue(value: number | null, availability: 'complete' | 'incomplete' = 'complete'): MobiliteShareEvidence {
  const figure = shareFigure()
  return { ...figure, value: { ...figure.value, fact: { ...figure.value.fact, value, availability } } }
}

function withRank(rank: { position: number; size: number; ties?: number } | null): MobiliteShareEvidence {
  const figure = shareFigure()
  return {
    ...figure,
    value: {
      ...figure.value,
      fact: {
        ...figure.value.fact,
        comparison: { ...figure.value.fact.comparison!, rank },
      },
    },
  }
}

const ready = { status: 'ready' as const }

describe('CahierMobiliteShareTrack — approved two-row coverage figure (#1006)', () => {
  it('draws the named territory row and the compared row, with no legend and no endpoint labels', () => {
    const wrapper = mount(CahierMobiliteShareTrack, { props: { figure: shareFigure(), comparison: ready } })

    const rows = wrapper.findAll('.mobilite-share-track__row')
    expect(rows.map((row) => row.attributes('data-row'))).toEqual(['territory', 'comparison'])
    expect(rows[0]!.get('.mobilite-share-track__label').text()).toBe('Rennes')
    expect(rows[1]!.get('.mobilite-share-track__label').text()).toBe('Groupe comparé')

    const tracks = wrapper.findAll('.mobilite-share-track__track')
    expect(tracks).toHaveLength(2)
    expect(tracks[0]!.attributes('role')).toBe('img')
    expect(tracks[1]!.attributes('role')).toBe('img')

    // The published share, then its quiet unlabelled remainder.
    const territorySegments = rows[0]!.findAll('[data-segment]')
    expect(territorySegments.map((segment) => segment.attributes('data-segment'))).toEqual(['share', 'complement'])
    expect(territorySegments[0]!.attributes('style')).toContain('width: 57.3%')
    expect(territorySegments[1]!.attributes('style')).toContain('width: 42.7%')
    expect(territorySegments[1]!.text()).toBe('')

    // No category legend, no 0 %/100 % endpoint labels.
    expect(wrapper.find('.cahier-figure-legend').exists()).toBe(false)
    expect(wrapper.find('.mobilite-share-track__scale').exists()).toBe(false)
    const texts = wrapper.findAll('*').map((element) => element.text())
    expect(texts).not.toContain('0 %')
    expect(texts).not.toContain('100 %')
    expect(wrapper.text()).not.toContain('nb_buildings')
  })

  it('keeps the served geometry and prints one decimal, never a synthetic 100 %', () => {
    const wrapper = mount(CahierMobiliteShareTrack, {
      props: { figure: withValue(0.9957355031616097), comparison: ready },
    })
    const row = wrapper.get('[data-row="territory"]')
    const width = Number(/width: ([0-9.]+)%/u.exec(
      row.get('[data-segment="share"]').attributes('style') ?? '')?.[1])
    expect(width).toBeCloseTo(0.9957355031616097 * 100, 9)
    expect(width).toBeLessThan(100)
    expect(row.get('.mobilite-share-track__value').text()).toBe('99,6 %')
    // The accessible reading keeps the served precision.
    expect(row.get('.mobilite-share-track__track').attributes('aria-label')).toContain('99,5736 %')

    const compared = wrapper.get('[data-row="comparison"]')
    expect(compared.get('[data-segment="share"]').attributes('style')).toContain('width: 50%')
    expect(compared.get('.mobilite-share-track__value').text()).toBe('50,0 %')
  })

  it('renders zero and exactly one as valid shares', () => {
    const zero = mount(CahierMobiliteShareTrack, { props: { figure: withValue(0), comparison: ready } })
    expect(zero.get('[data-row="territory"] .mobilite-share-track__value').text()).toBe('0,0 %')
    // A zero share has no focal segment; the whole bar is the quiet remainder.
    expect(zero.get('[data-row="territory"] [data-segment="share"]').attributes('style')).toContain('width: 0%')
    expect(zero.get('[data-row="territory"] [data-segment="complement"]').attributes('style')).toContain('width: 100%')
    expect(zero.text()).not.toContain('Indisponible')
    zero.unmount()

    const one = mount(CahierMobiliteShareTrack, { props: { figure: withValue(1), comparison: ready } })
    expect(one.get('[data-row="territory"] .mobilite-share-track__value').text()).toBe('100,0 %')
    expect(one.find('[data-row="territory"] [data-segment="complement"]').exists()).toBe(false)
    one.unmount()
  })

  it('centres the shared served rank below the compared bar and suppresses a singleton', () => {
    const ranked = mount(CahierMobiliteShareTrack, { props: { figure: shareFigure(), comparison: ready } })
    const rank = ranked.get('[data-row="comparison"] .cahier-rank--comparison')
    expect(rank.text()).toBe('2e/5')
    expect(rank.attributes('aria-label')).toContain('communes de la classe de densité')
    ranked.unmount()

    // Shared ties marker, no local calculation.
    const ties = mount(CahierMobiliteShareTrack, {
      props: { figure: withRank({ position: 2, size: 5, ties: 2 }), comparison: ready },
    })
    expect(ties.get('[data-row="comparison"] .cahier-rank--comparison').text()).toBe('=2e/5')
    ties.unmount()

    // A 1/1 rank has no position to show and is never drawn.
    const singleton = mount(CahierMobiliteShareTrack, {
      props: { figure: withRank({ position: 1, size: 1 }), comparison: ready },
    })
    expect(singleton.find('[data-row="comparison"] .cahier-rank').exists()).toBe(false)
    singleton.unmount()

    // An absent rank draws nothing either.
    const absent = mount(CahierMobiliteShareTrack, { props: { figure: withRank(null), comparison: ready } })
    expect(absent.find('[data-row="comparison"] .cahier-rank').exists()).toBe(false)
    absent.unmount()
  })

  it('removes the whole compared row and its rank for an explicit « Aucune comparaison »', () => {
    const wrapper = mount(CahierMobiliteShareTrack, {
      props: { figure: shareFigure(), comparison: { status: 'ready' }, comparisonNone: true },
    })
    expect(wrapper.find('[data-row="comparison"]').exists()).toBe(false)
    expect(wrapper.find('.cahier-rank').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Groupe comparé')
    expect(wrapper.text()).not.toContain('Indisponible')
    expect(wrapper.text()).not.toContain('Chargement')
    // The focal row stays intact.
    expect(wrapper.get('[data-row="territory"] .mobilite-share-track__value').text()).toBe('57,3 %')
  })

  it('keeps a null share honestly unavailable while the comparison state stays explicit', () => {
    const wrapper = mount(CahierMobiliteShareTrack, {
      props: { figure: withValue(null, 'incomplete'), comparison: { status: 'unavailable' } },
    })
    expect(wrapper.get('[data-row="territory"] .mobilite-share-track__empty').text()).toBe('Indisponible')
    expect(wrapper.find('[data-row="territory"] [data-segment]').exists()).toBe(false)
    expect(wrapper.get('[data-row="comparison"] .mobilite-share-track__empty').text()).toBe('Indisponible')
    expect(wrapper.text()).toContain('Groupe comparé indisponible pour cette sélection')
  })

  it('keeps loading, error and retry honest without blanking the focal share', async () => {
    const loading = mount(CahierMobiliteShareTrack, {
      props: { figure: shareFigure(), comparison: { status: 'loading' } },
    })
    expect(loading.get('[data-row="territory"] .mobilite-share-track__value').text()).toBe('57,3 %')
    expect(loading.get('[data-row="comparison"] .mobilite-share-track__empty').text()).toBe('Chargement…')
    expect(loading.text()).toContain('Chargement du groupe comparé')
    loading.unmount()

    const retry = vi.fn()
    const error = mount(CahierMobiliteShareTrack, {
      props: { figure: shareFigure(), comparison: { status: 'error', error: 'lecture refusée', retry } },
    })
    expect(error.get('[data-row="territory"] .mobilite-share-track__value').text()).toBe('57,3 %')
    expect(error.text()).toContain('lecture refusée')
    expect(error.find('[data-segment]').exists()).toBe(true)
    await error.get('.mobilite-share-track__retry').trigger('click')
    expect(retry).toHaveBeenCalledTimes(1)
    error.unmount()
  })

  it('names an unpublished resource on the figure without fabricating a zero', () => {
    const figure = { ...withValue(null, 'incomplete'), unavailableResources: ['Part des bâtiments près d’un arrêt'] }
    const wrapper = mount(CahierMobiliteShareTrack, {
      props: { figure, comparison: { status: 'error', error: 'échec', retry: vi.fn() } },
    })
    expect(wrapper.text()).toContain('Publication indisponible : Part des bâtiments près d’un arrêt')
    expect(wrapper.get('[data-row="territory"] .mobilite-share-track__value').attributes('data-value')).toBe('absent')
    expect(wrapper.find('[data-row="territory"] [data-segment="share"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps a non-percentage served unit instead of inventing a percentage', () => {
    const figure = withValue(0.5)
    const wrapper = mount(CahierMobiliteShareTrack, {
      props: { figure: { ...figure, unit: 'part' }, comparison: ready },
    })
    expect(wrapper.get('[data-row="territory"] .mobilite-share-track__value').text()).toBe('0,5 part')
  })
})

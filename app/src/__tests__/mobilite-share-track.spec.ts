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
    value,
    unit: '%',
    comparisonLabel: 'Médiane des communes de la classe de densité',
    prose: [],
    sources: [],
    ...overrides,
  } as MobiliteShareEvidence
}

const ready = { status: 'ready' as const }

describe('CahierMobiliteShareTrack — Couverture du territoire', () => {
  it('fills to the territory share, prints the percentage at the fill end and draws the reference tick with its value', () => {
    const wrapper = mount(CahierMobiliteShareTrack, { props: { figure: shareFigure(), comparison: ready } })
    const track = wrapper.get('.mobilite-share-track__graphic')
    expect(track.attributes('role')).toBe('img')
    const aria = track.attributes('aria-label')!
    expect(aria).toContain('57 %')
    expect(aria).toContain('50 %')
    expect(aria).toContain('Groupe comparé')
    expect(aria).toContain('communes de la classe de densité')
    expect(aria).toContain('Rang')
    expect(wrapper.get('.mobilite-share-track__fill').attributes('data-value')).toBe('0.573')
    expect(wrapper.get('.mobilite-share-track__value').text()).toBe('57 %')
    const reference = wrapper.get('.mobilite-share-track__reference')
    expect(reference.attributes('data-value')).toBe('0.5')
    expect(wrapper.get('.mobilite-share-track__reference-value').text()).toBe('50 %')
    expect(wrapper.text()).toContain('Groupe comparé')
    expect(wrapper.text()).toContain('Territoire')
    expect(wrapper.text()).not.toContain('nb_buildings')
  })

  it('renders zero as a valid share, never as a missing value', () => {
    const figure = shareFigure()
    figure.value = { ...figure.value, fact: { ...figure.value.fact, value: 0 } }
    const wrapper = mount(CahierMobiliteShareTrack, { props: { figure, comparison: ready } })
    expect(wrapper.get('.mobilite-share-track__fill').attributes('data-value')).toBe('0')
    expect(wrapper.get('.mobilite-share-track__value').text()).toBe('0 %')
    expect(wrapper.text()).not.toContain('Indisponible')
  })

  it('renders a full 100 % fill and a zero reference without losing either label', () => {
    const figure = shareFigure()
    figure.value = {
      ...figure.value,
      fact: { ...figure.value.fact, value: 1, comparison: { ...figure.value.fact.comparison!, reference: { kind: 'median', value: 0 } } },
    }
    const wrapper = mount(CahierMobiliteShareTrack, { props: { figure, comparison: ready } })
    expect(wrapper.get('.mobilite-share-track__fill').attributes('data-value')).toBe('1')
    expect(wrapper.get('.mobilite-share-track__value').text()).toBe('100 %')
    expect(wrapper.get('.mobilite-share-track__reference').attributes('data-value')).toBe('0')
    expect(wrapper.get('.mobilite-share-track__reference-value').text()).toBe('0 %')
  })

  it('keeps a null share honestly unavailable while the comparison state stays explicit', () => {
    const figure = shareFigure()
    figure.value = {
      ...figure.value,
      fact: { ...figure.value.fact, value: null, availability: 'incomplete' },
    }
    const wrapper = mount(CahierMobiliteShareTrack, {
      props: { figure, comparison: { status: 'unavailable' } },
    })
    expect(wrapper.text()).toContain('Indisponible')
    expect(wrapper.find('.mobilite-share-track__fill').exists()).toBe(false)
    expect(wrapper.find('.mobilite-share-track__reference').exists()).toBe(false)
    expect(wrapper.text()).toContain('Groupe comparé indisponible')
  })

  it('keeps comparison loading, error and exhaustively empty states honest without blanking the focal share', () => {
    const loading = mount(CahierMobiliteShareTrack, {
      props: { figure: shareFigure(), comparison: { status: 'loading' } },
    })
    expect(loading.get('.mobilite-share-track__value').text()).toBe('57 %')
    expect(loading.text()).toContain('Chargement du groupe comparé')
    expect(loading.find('.mobilite-share-track__reference').exists()).toBe(false)

    const retry = vi.fn()
    const error = mount(CahierMobiliteShareTrack, {
      props: { figure: shareFigure(), comparison: { status: 'error', error: 'lecture refusée', retry } },
    })
    expect(error.get('.mobilite-share-track__value').text()).toBe('57 %')
    expect(error.text()).toContain('lecture refusée')
    expect(error.find('.mobilite-share-track__reference').exists()).toBe(false)
    error.get('.mobilite-share-track__retry').trigger('click')
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

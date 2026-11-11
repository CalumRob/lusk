import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import CahierMobiliteComparisonBars from '@/fiche/prototype/CahierMobiliteComparisonBars.vue'
import type {
  ContentFact,
  MobiliteBarsFigureEvidence,
  MobiliteRatioEvidence,
} from '@/fiche/content/themeContent'
import type { NumericFact } from '@/fiche/content/territoryFacts'

function fact(
  key: string,
  detail: string | null,
  value: number,
  unit: string,
  reference: number | null = null,
  rank: { position: number; size: number } | null = null,
): ContentFact {
  return {
    label: detail ?? key,
    fact: {
      key,
      detail,
      value,
      unit,
      availability: 'complete',
      provenance: null,
      comparison: reference === null ? null : {
        direction: 'plus-est-mieux',
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        reference: { kind: 'median', value: reference },
        rank,
      },
      comparisonBasis: 'territory-median',
      reason: null,
    } satisfies NumericFact,
  }
}

const figure: MobiliteBarsFigureEvidence = {
  figureTitle: 'Longueur du réseau par habitant',
  unit: 'km / 1 000 hab.',
  xAxisTitle: 'Réseau',
  yAxisTitle: 'km / 1 000 hab.',
  comparisonLabel: 'Médiane des communes de EPCI X',
  categories: [
    {
      key: 'walkTransit',
      label: 'Réseau piéton',
      axisLabel: 'à pied',
      tone: 't',
      value: fact('reseaux_par_habitant', 't_km_1000', 12, 'km / 1 000 hab.', 9),
      rawValue: fact('reseaux', 't_longueur', 10, 'km'),
      segments: [],
    },
    {
      key: 'bike',
      label: 'Réseau cyclable',
      axisLabel: 'à vélo',
      tone: 'b',
      value: fact('reseaux_par_habitant', 'b_km_1000', 8, 'km / 1 000 hab.', 6),
      rawValue: fact('reseaux', 'b_longueur', 20, 'km'),
      segments: [
        { key: 'protege_km_1000', label: 'Protégé', value: fact('offre_cyclable', 'protege_km_1000', 5, 'km / 1 000 hab.') },
        { key: 'partage_km_1000', label: 'Partagé', value: fact('offre_cyclable', 'partage_km_1000', 3, 'km / 1 000 hab.') },
      ],
    },
    {
      key: 'car',
      label: 'Réseau automobile',
      axisLabel: 'en voiture',
      tone: 'c',
      value: fact('reseaux_par_habitant', 'c_km_1000', 80, 'km / 1 000 hab.', 70),
      rawValue: fact('reseaux', 'c_longueur', 30, 'km'),
      segments: [],
    },
  ],
}

const ratio: MobiliteRatioEvidence = {
  label: 'Places de stationnement vélo pour 1 place voiture',
  value: {
    label: 'Places de stationnement vélo pour 1 place voiture',
    fact: {
      key: 'stationnement_velo_par_voiture', detail: null, value: 0.2,
      unit: 'places vélo / place voiture', availability: 'complete', provenance: null,
      comparison: {
        direction: 'plus-est-mieux', scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        reference: { kind: 'median', value: 0.3 }, rank: { position: 2, size: 3 },
      },
      comparisonBasis: 'territory-median', reason: null,
    },
  },
  note: null,
}

describe('CahierMobiliteComparisonBars — comparison states and access', () => {
  it('draws one territory series, one compared series per category and an unsegmented bike comparison', () => {
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure, comparison: { status: 'ready' }, ratio },
    })
    expect(wrapper.findAll('.mobilite-comparison-bars__comparison')).toHaveLength(3)
    expect(wrapper.findAll('.mobilite-comparison-bars__segment')).toHaveLength(2)
    const label = wrapper.get('svg[role="img"]').attributes('aria-label')!
    expect(label).toContain('Longueur du réseau par habitant')
    expect(label).toContain('Groupe comparé')
    expect(label).toContain('médiane du total non segmenté')
    expect(label).toContain('Médiane des communes de EPCI X')
    expect(label).toContain('Protégé')
    expect(label).toContain('Partagé')
    const legend = wrapper.get('.mobilite-comparison-bars__legend')
    expect(legend.text()).toContain('Protégé')
    expect(legend.text()).toContain('Partagé')
    expect(legend.text()).toContain('Groupe comparé')
    expect(legend.text()).not.toContain('à pied')
    expect(legend.text()).not.toContain('en voiture')
    expect(wrapper.get('.cahier-comparison-value__reference').attributes('aria-label')).toContain('Médiane des communes de EPCI X')
    expect(wrapper.get('.cahier-comparison-value__reference').attributes('aria-label')).toContain('2e/3')
  })

  it('keeps raw values in the tooltip and out of the plotted axis labels', async () => {
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure, comparison: { status: 'ready' } },
    })
    expect(wrapper.text()).not.toContain('20 km')
    await wrapper.findAll('.mobilite-comparison-bars__hitbox')[1]!.trigger('focus')
    const tooltip = wrapper.get('.mobilite-comparison-bars__tooltip')
    expect(tooltip.text()).toContain('Protégé')
    expect(tooltip.text()).toContain('Partagé')
    expect(tooltip.text()).toContain('20')
    expect(tooltip.text()).toContain('km')
  })

  it('toggles the compared series and reports the pressed state', async () => {
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure, comparison: { status: 'ready' } },
    })
    const toggle = wrapper.findAll('.mobilite-comparison-bars__legend .cahier-figure-legend-toggle')
      .find((button) => button.text().includes('Groupe comparé'))!
    expect(toggle.attributes('aria-pressed')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(wrapper.findAll('.mobilite-comparison-bars__comparison')).toHaveLength(0)
    await toggle.trigger('click')
    expect(wrapper.findAll('.mobilite-comparison-bars__comparison')).toHaveLength(3)
  })

  it.each([
    ['loading', 'Chargement du groupe comparé…'],
    ['unavailable', 'Groupe comparé indisponible pour cette sélection.'],
  ] as const)('handles the %s state without a comparison bar or fallback', (status, copy) => {
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure, comparison: { status } },
    })
    expect(wrapper.findAll('.mobilite-comparison-bars__comparison')).toHaveLength(0)
    expect(wrapper.text()).toContain(copy)
  })

  it('offers an honest retry for a failed comparison and never draws a fallback', async () => {
    const retry = vi.fn()
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure, comparison: { status: 'error', error: 'lecture refusée', retry } },
    })
    expect(wrapper.findAll('.mobilite-comparison-bars__comparison')).toHaveLength(0)
    expect(wrapper.text()).toContain('Groupe comparé indisponible.')
    await wrapper.get('.mobilite-comparison-retry').trigger('click')
    expect(retry).toHaveBeenCalledOnce()
  })
})

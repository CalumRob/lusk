import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import CahierMobiliteComparisonBars from '@/fiche/prototype/CahierMobiliteComparisonBars.vue'
import CahierMobiliteSection from '@/fiche/prototype/CahierMobiliteSection.vue'
import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import type { ControleComparaison } from '@/fiche/comparisonContext'
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
  direction: 'plus-est-mieux' | 'moins-est-mieux' = 'plus-est-mieux',
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
        direction,
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
      value: fact('reseaux_par_habitant', 't_km_1000', 12, 'km / 1 000 hab.', 9, { position: 2, size: 3 }),
      rawValue: fact('reseaux', 't_longueur', 10, 'km'),
      segments: [],
      splitNote: null,
    },
    {
      key: 'bike',
      label: 'Réseau cyclable',
      axisLabel: 'à vélo',
      tone: 'b',
      value: fact('reseaux_par_habitant', 'b_km_1000', 8, 'km / 1 000 hab.', 6, { position: 1, size: 3 }),
      rawValue: fact('reseaux', 'b_longueur', 20, 'km'),
      segments: [
        {
          key: 'protege_km_1000',
          label: 'Protégé',
          value: fact('offre_cyclable', 'protege_km_1000', 5, 'km / 1 000 hab.'),
          rawValue: fact('offre_cyclable', 'protege_longueur', 4, 'km'),
        },
        {
          key: 'partage_km_1000',
          label: 'Partagé',
          value: fact('offre_cyclable', 'partage_km_1000', 3, 'km / 1 000 hab.'),
          rawValue: fact('offre_cyclable', 'partage_longueur', 2, 'km'),
        },
      ],
      splitNote: null,
    },
    {
      key: 'car',
      label: 'Réseau automobile',
      axisLabel: 'en voiture',
      tone: 'c',
      value: fact('reseaux_par_habitant', 'c_km_1000', 80, 'km / 1 000 hab.', 70, { position: 3, size: 3 }),
      rawValue: fact('reseaux', 'c_longueur', 30, 'km'),
      segments: [],
      splitNote: null,
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
    expect(label).toContain('rang 2e/3')
    expect(label).toContain('plus = mieux')
    expect(label).toContain('Protégé')
    expect(label).toContain('Partagé')
    const legend = wrapper.get('.mobilite-comparison-bars__legend')
    expect(legend.text()).toContain('Réseau piéton')
    expect(legend.text()).toContain('Réseau cyclable')
    expect(legend.text()).toContain('Réseau automobile')
    expect(legend.text()).toContain('Protégé')
    expect(legend.text()).toContain('Partagé')
    expect(legend.text()).toContain('Groupe comparé')
    const comparisonLegend = legend.findAll('.cahier-figure-legend-item')
      .find((item) => item.text().includes('Groupe comparé'))!
    expect(comparisonLegend.find('.cahier-figure-legend-mark--square').exists()).toBe(true)
    expect(comparisonLegend.find('.cahier-figure-legend-mark--dash').exists()).toBe(false)
    const bikeLegend = legend.findAll('.cahier-figure-legend-item')
      .find((item) => item.text().includes('Réseau cyclable'))!
    expect(bikeLegend.get('.cahier-figure-legend-mark').classes()).toContain('cahier-figure-legend-mark--composite')
    const protectedLegend = legend.findAll('.cahier-figure-legend-item')
      .find((item) => item.text().includes('Protégé'))!
    expect(protectedLegend.get('.cahier-figure-legend-mark').classes()).not.toContain('cahier-figure-legend-mark--composite')
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
    const totalRow = tooltip.findAll('.cahier-figure-tooltip-row')[0]!
    expect(totalRow.get('.cahier-figure-tooltip-label').text()).toBe('Total vélo')
    expect(totalRow.attributes('aria-label')).toContain('médiane du total non segmenté')
    expect(tooltip.text()).toContain('Protégé')
    expect(tooltip.text()).toContain('Partagé')
    expect(tooltip.text()).toContain('20')
    expect(tooltip.text()).toContain('km')
  })

  it('shows the tooltip on the first real press and dismisses on blur, Escape or a tap away', async () => {
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure, comparison: { status: 'ready' } },
      attachTo: document.body,
    })
    const tooltip = () => wrapper.find('.mobilite-comparison-bars__tooltip')
    const hitbox = (index: number) => wrapper.findAll('.mobilite-comparison-bars__hitbox')[index]!

    // Desktop hover alone already exposes the details.
    await hitbox(0).trigger('mouseenter')
    expect(tooltip().exists()).toBe(true)
    await hitbox(0).trigger('mouseleave')
    expect(tooltip().exists()).toBe(false)

    // A real pointer press focuses the control before the click: the first
    // click must open the tooltip, not toggle it back off.
    await hitbox(1).trigger('focus')
    await hitbox(1).trigger('mouseenter')
    expect(tooltip().exists()).toBe(true)
    await hitbox(1).trigger('click')
    expect(tooltip().exists()).toBe(true)
    expect(tooltip().text()).toContain('Total vélo')

    // Escape dismisses even while the control keeps focus.
    await hitbox(1).trigger('keydown', { key: 'Escape' })
    expect(tooltip().exists()).toBe(false)

    // Touch/keyboard activation (focus then click) behaves the same way.
    await hitbox(1).trigger('focus')
    await hitbox(1).trigger('click')
    expect(tooltip().exists()).toBe(true)
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(tooltip().exists()).toBe(false)

    await hitbox(2).trigger('focus')
    expect(tooltip().exists()).toBe(true)
    await hitbox(2).trigger('blur')
    expect(tooltip().exists()).toBe(false)
    wrapper.unmount()
  })

  it('toggles the compared series and reports the pressed state', async () => {
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure, comparison: { status: 'ready' } },
    })
    const toggle = () => wrapper.findAll('.mobilite-comparison-bars__legend .cahier-figure-legend-toggle')
      .find((button) => button.text().includes('Groupe comparé'))!
    expect(toggle().attributes('aria-pressed')).toBe('true')
    await toggle().trigger('click')
    expect(toggle().attributes('aria-pressed')).toBe('false')
    expect(wrapper.findAll('.mobilite-comparison-bars__comparison')).toHaveLength(0)
    await toggle().trigger('click')
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

  it('draws the known bike total as an unsegmented bar when the split is unavailable', async () => {
    const unsafe = structuredClone(figure)
    const bike = unsafe.categories.find((category) => category.key === 'bike')!
    bike.value.fact.value = 39
    bike.segments = []
    bike.splitNote = 'Répartition Protégé/Partagé indisponible : les deux parties publiées ne recomposent pas le total.'
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure: unsafe, comparison: { status: 'ready' } },
    })
    expect(wrapper.find('.mobilite-comparison-bars__bar[data-category="bike"]').exists()).toBe(true)
    expect(wrapper.findAll('.mobilite-comparison-bars__segment')).toHaveLength(0)
    expect(wrapper.text()).toContain('Répartition Protégé/Partagé indisponible')
    await wrapper.findAll('.mobilite-comparison-bars__hitbox')[1]!.trigger('focus')
    expect(wrapper.get('.mobilite-comparison-bars__tooltip').text()).toContain('Répartition Protégé/Partagé')
  })

  it('names the served comparison statistic dynamically (mean vs median)', () => {    const meanFigure = structuredClone(figure)
    const bike = meanFigure.categories.find((category) => category.key === 'bike')!
    bike.value.fact.comparison = {
      direction: 'plus-est-mieux',
      scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
      reference: { kind: 'mean', value: 6 },
      rank: { position: 2, size: 3 },
    }
    meanFigure.comparisonLabel = 'Moyenne des communes de EPCI X'
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure: meanFigure, comparison: { status: 'ready' } },
    })
    const label = wrapper.get('svg[role="img"]').attributes('aria-label')!
    expect(label).toContain('moyenne du total non segmenté')
    expect(label).not.toContain('médiane du total non segmenté')
    expect(label).toContain('Moyenne des communes de EPCI X')
  })

  it('keeps car-parking direction in the accessible name without a visible barrank chip', () => {
    const parkingFigure: MobiliteBarsFigureEvidence = {
      ...figure,
      figureTitle: 'Stationnement vélo et voiture',
      unit: 'places / 1 000 hab',
      xAxisTitle: 'Mode',
      categories: [{
        key: 'car-parking',
        label: 'Voiture',
        axisLabel: 'Voiture',
        tone: 'c',
        value: fact('places_stationnement_voiture_1000', null, 25, 'places / 1 000 hab', 30, { position: 2, size: 3 }, 'moins-est-mieux'),
        rawValue: null,
        segments: [],
        splitNote: null,
      }],
    }
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure: parkingFigure, comparison: { status: 'ready' } },
    })
    const label = wrapper.get('svg[role="img"]').attributes('aria-label')!
    expect(label).toContain('moins = mieux')
    expect(label).toContain('rang 2e/3')
    expect(wrapper.find('.cahier-rank').exists()).toBe(false)
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

  it('turns an injected empty comparison group into an honest inactive state', () => {
    const control = ref<ControleComparaison>({
      focal: { territoire: '22001', type: 'commune', nom: 'Commune', departement: '22', epci: null },
      territoires: [],
      selection: { etat: 'vide' },
      libelleActif: null,
      presetDefaut: 'epci',
      presets: [],
      choisir: () => {},
    })
    const section = {
      key: 'reseaux',
      label: 'Réseaux',
      availability: 'complete',
      indicators: [],
      evidence: {
        kind: 'mobilite-networks',
        territory: { code: '22001', name: 'Commune' },
        territoryName: 'Commune',
        mapFigureTitle: 'Cartes des réseaux de mobilité, par mode',
        figure,
        prose: [],
        sources: [],
      },
      provenance: [],
      lecture: null,
      explorationTargets: [],
    } as any
    const wrapper = mount(CahierMobiliteSection, {
      props: {
        section,
        unit: { key: 'partage-de-lespace-public', label: 'Le partage de l’espace public' },
        comparison: { status: 'ready' },
      },
      global: { provide: { [CONTROLE_COMPARAISON_KEY as symbol]: control } },
    })
    expect(wrapper.findAll('.mobilite-comparison-bars__comparison')).toHaveLength(0)
    expect(wrapper.text()).toContain('Groupe comparé indisponible pour cette sélection.')
    const legend = wrapper.get('.mobilite-comparison-bars__legend')
    expect(legend.findAll('.cahier-figure-legend-toggle')).toHaveLength(0)
    expect(legend.text()).toContain('Groupe comparé')
  })

  it('never silently drops a contributor whose source record has no published URL', () => {
    const section = {
      key: 'reseaux',
      label: 'Réseaux',
      availability: 'complete',
      indicators: [],
      evidence: {
        kind: 'mobilite-networks',
        territory: { code: '22001', name: 'Commune' },
        territoryName: 'Commune',
        mapFigureTitle: 'Cartes des réseaux de mobilité, par mode',
        figure,
        prose: [],
        sources: [{
          id: 'source-sans-url', source: 'Producteur sans URL', version: '2026-08',
          referenceDate: null, publicationDate: null, url: null, licence: 'Licence Ouverte',
        }],
      },
      provenance: ['source-sans-url'],
      lecture: null,
      explorationTargets: [],
    } as any
    const wrapper = mount(CahierMobiliteSection, {
      props: {
        section,
        unit: { key: 'partage-de-lespace-public', label: 'Le partage de l’espace public' },
        comparison: { status: 'ready' },
      },
    })
    const stamp = wrapper.get('[data-source-url-missing]')
    expect(stamp.text()).toContain('Producteur sans URL')
    expect(stamp.text()).toContain('Licence Ouverte')
    expect(stamp.element.closest('a')).toBeNull()
  })

  it('exposes the full ratio comparison in the role=img accessible name', () => {
    const section = {
      key: 'stationnement-ravitaillement',
      label: 'Se garer et se ravitailler',
      availability: 'complete',
      indicators: [],
      evidence: {
        kind: 'mobilite-stationnement-ravitaillement',
        columns: [
          { key: 'stationnement', prose: [], sources: [], bars: figure, ratio },
          { key: 'ravitaillement', prose: [], sources: [], bars: figure, ratio },
        ],
      },
      provenance: [],
      lecture: null,
      explorationTargets: [],
    } as any
    const wrapper = mount(CahierMobiliteSection, {
      props: {
        section,
        unit: { key: 'partage-de-lespace-public', label: 'Le partage de l’espace public' },
        comparison: { status: 'ready' },
      },
    })
    const scalar = wrapper.get('.mobilite-ratio-scalar .cahier-figure-scalar')
    expect(scalar.attributes('role')).toBe('img')
    const label = scalar.attributes('aria-label')!
    expect(label).toContain('Places de stationnement vélo pour 1 place voiture')
    expect(label).toContain('0,2 places vélo / place voiture')
    expect(label).toContain('0,3 places vélo / place voiture')
    expect(label).toContain('Médiane des communes de EPCI X')
    expect(label).toContain('Rang')
    expect(label).toContain('2e/3')
    expect(label).toContain('plus = mieux')
  })

  it('states loading, error and unavailable comparison states in the ratio accessible name', () => {
    const section = {
      key: 'stationnement-ravitaillement',
      label: 'Se garer et se ravitailler',
      availability: 'complete',
      indicators: [],
      evidence: {
        kind: 'mobilite-stationnement-ravitaillement',
        columns: [
          { key: 'stationnement', prose: [], sources: [], bars: figure, ratio },
          { key: 'ravitaillement', prose: [], sources: [], bars: figure, ratio },
        ],
      },
      provenance: [],
      lecture: null,
      explorationTargets: [],
    } as any
    const render = (comparison: any) => mount(CahierMobiliteSection, {
      props: {
        section,
        unit: { key: 'partage-de-lespace-public', label: 'Le partage de l’espace public' },
        comparison,
      },
    }).get('.mobilite-ratio-scalar .cahier-figure-scalar').attributes('aria-label')!

    expect(render({ status: 'loading' })).toContain('Comparaison en cours de chargement')
    expect(render({ status: 'error', error: 'lecture refusée' })).toContain('Comparaison indisponible : lecture refusée')
    expect(render({ status: 'unavailable' })).toContain('Comparaison indisponible')
  })
})

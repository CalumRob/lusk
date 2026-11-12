import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
          legendLabel: 'Réseau cyclable protégé',
          value: fact('offre_cyclable', 'protege_km_1000', 5, 'km / 1 000 hab.'),
          rawValue: fact('offre_cyclable', 'protege_longueur', 4, 'km'),
        },
        {
          key: 'partage_km_1000',
          label: 'Partagé',
          legendLabel: 'Réseau cyclable partagé',
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
    const networkLegend = legend.findAll('.cahier-figure-legend-item')
      .filter((item) => !item.text().includes('Groupe comparé'))
    // #974 — exactly the four drawn network identities, in reading order. A
    // segmented bar's parts are its series; the redundant bike total is gone.
    expect(networkLegend.map((item) => item.get('.cahier-figure-legend-label').text())).toEqual([
      'Réseau piéton',
      'Réseau cyclable protégé',
      'Réseau cyclable partagé',
      'Réseau automobile',
    ])
    expect(networkLegend.every((item) => !item.get('.cahier-figure-legend-mark')
      .classes().includes('cahier-figure-legend-mark--composite'))).toBe(true)
    const markColor = (label: string) => networkLegend
      .find((item) => item.get('.cahier-figure-legend-label').text() === label)!
      .get('.cahier-figure-legend-mark').attributes('style') ?? ''
    expect(markColor('Réseau piéton')).toContain('var(--cahier-mode-foot')
    expect(markColor('Réseau cyclable protégé')).toContain('var(--cahier-cycle-protected')
    expect(markColor('Réseau cyclable partagé')).toContain('var(--cahier-cycle-shared')
    expect(markColor('Réseau automobile')).toContain('var(--cahier-mode-car')
    // The compared bar stays its own legend key, never a fifth network identity.
    const comparisonLegend = legend.findAll('.cahier-figure-legend-item')
      .find((item) => item.text().includes('Groupe comparé'))!
    expect(comparisonLegend.get('.cahier-figure-legend-label').text()).toBe('Groupe comparé')
    expect(comparisonLegend.attributes('aria-label')).toContain('Médiane des communes de EPCI X')
    expect(comparisonLegend.find('.cahier-figure-legend-mark--square').exists()).toBe(true)
    expect(comparisonLegend.find('.cahier-figure-legend-mark--dash').exists()).toBe(false)
    expect(wrapper.get('.cahier-comparison-value__reference').attributes('aria-label')).toContain('Médiane des communes de EPCI X')
    expect(wrapper.get('.cahier-comparison-value__reference').attributes('aria-label')).toContain('2e/3')
  })

  it('keeps tooltip values bare while the accessible reading keeps units, scope and rank', async () => {
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure, comparison: { status: 'ready' } },
    })
    expect(wrapper.text()).not.toContain('20 km')
    await wrapper.findAll('.mobilite-comparison-bars__hitbox')[1]!.trigger('focus')
    const tooltip = wrapper.get('.mobilite-comparison-bars__tooltip')
    const rows = tooltip.findAll('.cahier-figure-tooltip-row')
    const totalRow = rows[0]!
    expect(totalRow.get('.cahier-figure-tooltip-label').text()).toBe('Total vélo')
    expect(totalRow.findAll('dd')[0]!.text()).toBe('8')
    expect(totalRow.get('.cahier-figure-tooltip-comparison-value').text()).toBe('6')
    expect(totalRow.attributes('aria-label')).toContain('8 km / 1 000 hab.')
    expect(totalRow.attributes('aria-label')).toContain('médiane du total non segmenté')
    expect(totalRow.attributes('aria-label')).toContain('1er/3')
    const rawRow = rows.find((row) => row.get('.cahier-figure-tooltip-label').text() === 'b_longueur')!
    expect(rawRow.findAll('dd')[0]!.text()).toBe('20')
    expect(rawRow.attributes('aria-label')).toContain('20 km (valeur brute)')
    expect(tooltip.text()).not.toContain('km')
    expect(tooltip.text()).toContain('Protégé')
    expect(tooltip.text()).toContain('Partagé')
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

  it('lists isolated publication failures visibly and in the accessible name', () => {
    const unavailableFigure: MobiliteBarsFigureEvidence = {
      ...figure,
      unavailableResources: ['Bornes de recharge pour 1 000 hab.', 'Stations-service'],
      unavailableComparisons: ['Réseau cyclable'],
    }
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure: unavailableFigure, comparison: { status: 'ready' } },
    })
    expect(wrapper.text()).toContain('Publication indisponible : Bornes de recharge pour 1 000 hab., Stations-service')
    expect(wrapper.text()).toContain('Comparaison indisponible : Réseau cyclable')
    const notes = wrapper.findAll('.mobilite-comparison-state[role="note"]')
    expect(notes).toHaveLength(2)
    const label = wrapper.get('svg[role="img"]').attributes('aria-label')!
    expect(label).toContain('Publication indisponible : Bornes de recharge pour 1 000 hab., Stations-service')
    expect(label).toContain('Comparaison indisponible : Réseau cyclable')
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

/**
 * #974 — the two paired ratios adopt the AEDAR scalar anatomy instead of an
 * ad-hoc ratio treatment: the same shared scalar brick, its value/typography
 * roles and its reference line, with the operator anatomy above the value.
 */
describe('CahierMobiliteSection — paired ratios use the AEDAR scalar anatomy', () => {
  const parking: MobiliteRatioEvidence = {
    label: 'places de stationnement vélo pour 1 place voiture',
    value: {
      label: 'places de stationnement vélo pour 1 place voiture',
      fact: {
        key: 'stationnement_velo_par_voiture', detail: null, value: 0.2,
        unit: 'places vélo / place voiture', availability: 'complete', provenance: null,
        comparison: {
          direction: 'plus-est-mieux',
          scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
          reference: { kind: 'median', value: 0.3 },
          rank: { position: 2, size: 3 },
        },
        comparisonBasis: 'territory-median', reason: null,
      },
    },
    note: null,
  }

  const refuelling: MobiliteRatioEvidence = {
    label: 'Bornes de recharge par station-service',
    value: {
      label: 'Bornes de recharge par station-service',
      fact: {
        key: 'bornes_ev_par_station_service', detail: null, value: 3.5,
        unit: 'bornes / station', availability: 'complete', provenance: null,
        comparison: {
          direction: 'plus-est-mieux',
          scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
          reference: { kind: 'median', value: 2.5 },
          rank: { position: 1, size: 3 },
        },
        comparisonBasis: 'territory-median', reason: null,
      },
    },
    note: null,
  }

  const citedFigure: MobiliteBarsFigureEvidence = {
    ...figure,
    figureTitle: 'Stationnement vélo et voiture',
    categories: figure.categories.slice(0, 2),
  }

  function mountSection(): ReturnType<typeof mount> {
    const section = {
      key: 'stationnement-ravitaillement',
      label: 'Se garer et se ravitailler',
      availability: 'complete',
      indicators: [],
      evidence: {
        kind: 'mobilite-stationnement-ravitaillement',
        columns: [
          { key: 'stationnement', prose: [], sources: [], bars: citedFigure, ratio: parking },
          { key: 'ravitaillement', prose: [], sources: [], bars: citedFigure, ratio: refuelling },
        ],
      },
      provenance: [],
      lecture: null,
      explorationTargets: [],
    } as any
    return mount(CahierMobiliteSection, {
      props: {
        section,
        unit: { key: 'partage-de-lespace-public', label: 'Le partage de l’espace public' },
        comparison: { status: 'ready' },
      },
    })
  }

  const scalarIn = (wrapper: ReturnType<typeof mountSection>, column: string) =>
    wrapper.get(`[data-column="${column}"] .mobilite-ratio-scalar .cahier-figure-scalar`)
  const partsIn = (wrapper: ReturnType<typeof mountSection>, column: string) =>
    scalarIn(wrapper, column).findAll('[data-ratio-part]')
      .map((part) => part.attributes('data-ratio-part'))

  it('draws the parking ratio as bike ÷ car above its producer-scale value, label and comparison', () => {
    const scalar = scalarIn(mountSection(), 'stationnement')

    expect(scalar.attributes('role')).toBe('img')
    // Top line: the division anatomy travels with the value, in reading order.
    const valueLine = scalar.get('.cahier-figure-scalar-value')
    expect(valueLine.findAll('[data-ratio-part]').map((part) => part.attributes('data-ratio-part')))
      .toEqual(['bike', 'divide', 'car'])
    expect(valueLine.get('[data-ratio-part="bike"]').classes()).toContain('mobilite-ratio__icon--bike')
    expect(valueLine.get('[data-ratio-part="car"]').classes()).toContain('mobilite-ratio__icon--car')
    expect(valueLine.get('[data-ratio-part="divide"]').classes()).toContain('mobilite-ratio__icon--divide')
    // The value stays on the producer's own scale: 0,2 place vélo/place voiture, never a percentage.
    expect(valueLine.get('strong').text()).toBe('0,2')
    expect(valueLine.text()).not.toContain('%')
    // The shared AEDAR green/brand value treatment, with no per-mode tone override.
    expect(scalar.classes()).toContain('cahier-figure-scalar--colored')
    expect(scalar.classes().some((name) => /^cahier-figure-scalar--(?:t|b|c)$/u.test(name))).toBe(false)
    // Second line: the exact caption, in the AEDAR scalar's metric label role
    // (#976 — the shared role itself renders the caption uppercase).
    const caption = scalar.get('.cahier-figure-scalar-label')
    expect(caption.text()).toBe('places de stationnement vélo pour 1 place voiture')
    expect(caption.classes()).toContain('type-figure-label')
    // Third line: the AEDAR comparison primitive with its rank rules.
    const reference = scalar.get('.cahier-figure-scalar-reference')
    expect(reference.get('.cahier-comparison-value').text()).toContain('Groupe comparé')
    expect(reference.get('.cahier-comparison-value').text()).toContain('0,3')
    expect(reference.find('.cahier-rank').exists()).toBe(true)
  })

  it('draws the refuelling ratio as charging ÷ fuel in the car colour above its factual label', () => {
    const scalar = scalarIn(mountSection(), 'ravitaillement')

    expect(partsIn(mountSection(), 'ravitaillement')).toEqual(['charging', 'divide', 'fuel'])
    expect(scalar.get('[data-ratio-part="charging"]').classes()).toContain('mobilite-ratio__icon--car')
    expect(scalar.get('[data-ratio-part="fuel"]').classes()).toContain('mobilite-ratio__icon--car')
    expect(scalar.get('.cahier-figure-scalar-value strong').text()).toBe('3,5')
    const caption = scalar.get('.cahier-figure-scalar-label')
    expect(caption.text()).toBe('Bornes de recharge par station-service')
    expect(caption.classes()).toContain('type-figure-label')
    expect(scalar.get('.cahier-figure-scalar-reference .cahier-comparison-value').text()).toContain('Groupe comparé')
  })

  it('keeps the accessible reading complete: units, served scope, rank and direction', () => {
    const label = scalarIn(mountSection(), 'stationnement').attributes('aria-label')!
    expect(label).toContain('places de stationnement vélo pour 1 place voiture')
    expect(label).toContain('0,2 places vélo / place voiture')
    expect(label).toContain('Médiane des communes de EPCI X')
    expect(label).toContain('Rang')
    expect(label).toContain('plus = mieux')
  })

  it('removes the horizontal separator above and between the bars and their ratio scalars', () => {
    const section = readFileSync(join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierMobiliteSection.vue'), 'utf8')
    const attribute = readFileSync(
      join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierMobiliteComparisonBars.vue'), 'utf8')
    const rule = (source: string, selector: string) =>
      source.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? ''
    for (const block of [rule(section, '.mobilite-ratio-scalar'), rule(attribute, '.mobilite-ratio')]) {
      expect(block).not.toMatch(/border(?:-top)?\s*:/u)
      expect(block).not.toMatch(/padding-top\s*:/u)
    }
    // Icons reuse the shared semantic mode inks: never a literal colour.
    for (const ink of ['var(--cahier-mode-bike', 'var(--cahier-mode-car']) {
      expect(section).toContain(ink)
    }
    expect(section).not.toMatch(/mobilite-ratio__icon[^}]*#[0-9a-f]{3,8}/iu)
  })

  it('reuses the AEDAR metric caption role, uppercase from the shared token, with no local casing copy', () => {
    const wrapper = mountSection()
    for (const column of ['stationnement', 'ravitaillement'] as const) {
      const caption = scalarIn(wrapper, column).get('.cahier-figure-scalar-label')
      expect(
        caption.classes(),
        `${column} ratio caption must use the shared AEDAR metric role`,
      ).toContain('type-figure-label')
      // No local class rides beside the shared role to re-case the caption.
      expect(caption.classes()).toEqual(['cahier-figure-scalar-label', 'type-figure-label'])
    }
    const tokens = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8')
    const sharedRole = tokens.match(/\.type-figure-label,\s*\.type-figure-column\s*\{([^}]*)\}/u)?.[1] ?? ''
    expect(sharedRole).toContain('font: var(--type-figure-label)')
    expect(sharedRole).toContain('text-transform: uppercase')
    // The caption reuses that role through the scalar's prop, never a page-2 copy.
    const section = readFileSync(join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierMobiliteSection.vue'), 'utf8')
    expect(section).toContain('label-role="metric"')
  })
})

/**
 * #976 — the owner asked for another colour for Bornes, because the charging
 * bar and the fuel-station bar must read as two distinct offers. Charging takes
 * the app's own brand role; the fuel-station category keeps its theme ink.
 */
describe('CahierMobiliteComparisonBars — the charging category keeps its own identity', () => {
  const refuellingFigure: MobiliteBarsFigureEvidence = {
    figureTitle: 'Bornes de recharge et station-services',
    unit: 'équipements / 1 000 hab.',
    xAxisTitle: 'Équipement',
    yAxisTitle: 'équipements / 1 000 hab.',
    comparisonLabel: 'Médiane des communes de EPCI X',
    categories: [
      {
        key: 'charging',
        label: 'Bornes de recharge',
        axisLabel: 'Bornes',
        tone: 'brand',
        value: fact('bornes_recharge_1000', null, 0.4, 'équipements / 1 000 hab.', 0.3, { position: 1, size: 3 }),
        rawValue: fact('bornes_recharge', null, 7, 'bornes'),
        segments: [],
        splitNote: null,
      },
      {
        key: 'fuel-stations',
        label: 'Stations-service',
        axisLabel: 'Stations-service',
        tone: 'neutral',
        value: fact('stations_service_1000', null, 0.1, 'équipements / 1 000 hab.', 0.2, { position: 2, size: 3 }),
        rawValue: fact('stations_service', null, 2, 'stations'),
        segments: [],
        splitNote: null,
      },
    ],
  }

  it('draws the charging bar, legend key and tooltip marker from the app brand role', async () => {
    const wrapper = mount(CahierMobiliteComparisonBars, {
      props: { figure: refuellingFigure, comparison: { status: 'ready' } },
    })
    expect(wrapper.get('rect[data-category="charging"]').attributes('fill')).toBe('var(--brand-500)')
    expect(wrapper.get('rect[data-category="fuel-stations"]').attributes('fill')).toBe('var(--cahier-theme-strong)')
    // The compared bar is the series' own 45 % mix so the two offers stay
    // distinguishable in both the territory and compared series.
    expect(wrapper.get('rect[data-comparison="charging"]').attributes('fill'))
      .toBe('color-mix(in srgb, var(--brand-500) 45%, var(--paper))')
    const legendMark = (label: string) => wrapper.findAll('.cahier-figure-legend-item')
      .find((item) => item.get('.cahier-figure-legend-label').text() === label)!
      .get('.cahier-figure-legend-mark').attributes('style') ?? ''
    expect(legendMark('Bornes de recharge')).toContain('var(--brand-500)')
    expect(legendMark('Stations-service')).toContain('var(--cahier-theme-strong)')

    await wrapper.findAll('.mobilite-comparison-bars__hitbox')[0]!.trigger('focus')
    const marker = wrapper.get('.mobilite-comparison-bars__tooltip .cahier-figure-tooltip-marker')
    expect(marker.attributes('style')).toContain('background: var(--brand-500)')

    // The real category identities, units and comparison stay untouched.
    const label = wrapper.get('svg[role="img"]').attributes('aria-label')!
    expect(label).toContain('Bornes de recharge')
    expect(label).toContain('Stations-service')
    expect(label).toContain('équipements / 1 000 hab.')
    expect(label).toContain('Groupe comparé')
  })
})

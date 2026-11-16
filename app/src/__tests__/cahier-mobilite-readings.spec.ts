import { describe, expect, it } from 'vitest'

import type {
  ContentFact,
  MobiliteBarsFigureEvidence,
  MobiliteRatioEvidence,
  MobiliteRaccordementEvidence,
  MobiliteShareEvidence,
} from '@/fiche/content/themeContent'
import type { NumericFact } from '@/fiche/content/territoryFacts'
import {
  mobiliteBarReadings,
  mobiliteBarTooltipRows,
  mobiliteBarsAccessibleLabel,
  mobiliteCurveAccessibleLabel,
  mobiliteCurveGrid,
  mobiliteCurveReadings,
  mobiliteCurveTooltipRows,
  mobiliteRatioAriaLabel,
  mobiliteRatioDisplayValue,
  mobiliteRatioValueLabel,
  mobiliteShareComparisonAria,
  mobiliteSharePreciseLabel,
  mobiliteShareReference,
  mobiliteShareValue,
  mobiliteShareVisibleLabel,
} from '@/fiche/prototype/cahierMobiliteReadings'

function fact(
  key: string,
  detail: string | null,
  value: number | null,
  unit: string,
  reference: number | null = null,
  rank: { position: number; size: number; ties?: number } | null = null,
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
      key: 'walkTransit', label: 'Réseau piéton', axisLabel: 'à pied', tone: 't',
      value: fact('reseaux_par_habitant', 't_km_1000', 12, 'km / 1 000 hab.', 9, { position: 2, size: 3 }),
      rawValue: fact('reseaux', 't_longueur', 10, 'km'),
      segments: [], splitNote: null,
    },
    {
      key: 'bike', label: 'Réseau cyclable', axisLabel: 'à vélo', tone: 'b',
      value: fact('reseaux_par_habitant', 'b_km_1000', 8, 'km / 1 000 hab.', 6, { position: 1, size: 3, ties: 2 }),
      rawValue: fact('reseaux', 'b_longueur', 20, 'km'),
      segments: [
        {
          key: 'protege_km_1000', label: 'Protégé', legendLabel: 'Réseau cyclable protégé',
          value: fact('offre_cyclable', 'protege_km_1000', 5, 'km / 1 000 hab.', 4, { position: 1, size: 4 }),
          rawValue: fact('offre_cyclable', 'protege_longueur', 4, 'km'),
        },
        {
          key: 'partage_km_1000', label: 'Partagé', legendLabel: 'Réseau cyclable partagé',
          value: fact('offre_cyclable', 'partage_km_1000', 3, 'km / 1 000 hab.'),
          rawValue: null,
        },
      ],
      splitNote: 'La répartition publiée est partielle.',
    },
    {
      key: 'car', label: 'Réseau automobile', axisLabel: 'en voiture', tone: 'c',
      value: fact('reseaux_par_habitant', 'c_km_1000', 0, 'km / 1 000 hab.', null),
      rawValue: null,
      segments: [], splitNote: null,
    },
    {
      key: 'absent', label: 'Réseau absent', axisLabel: 'absent', tone: 'neutral',
      value: fact('reseaux_par_habitant', 'absent_km_1000', null, 'km / 1 000 hab.', 2),
      rawValue: null,
      segments: [], splitNote: null,
    },
  ],
}

describe('Mobilité compared-bar readings (#1022)', () => {
  it('keeps raw numerators, segment notes and served ranks distinct from normalized values', () => {
    const bike = mobiliteBarReadings({
      figure, category: figure.categories[1]!, showComparison: true,
    })
    expect(bike.map((reading) => [reading.key, reading.kind, reading.display, reading.unit, reading.raw]))
      .toEqual([
        ['bike:total', 'total', '8', 'km / 1 000 hab.', false],
        ['bike:split-note', 'split-note', 'Indisponible', '', false],
        ['bike:segment:protege_km_1000', 'segment', '5', 'km / 1 000 hab.', false],
        ['bike:segment:protege_km_1000:raw', 'raw', '4', 'km', true],
        ['bike:segment:partage_km_1000', 'segment', '3', 'km / 1 000 hab.', false],
        ['bike:raw', 'raw', '20', 'km', true],
      ])
    expect(bike[0]?.comparison).toMatchObject({
      value: 6,
      display: '6',
      rank: { position: 1, size: 3, ties: 2 },
      rankDisplay: '=1er/3',
      unit: 'km / 1 000 hab.',
    })
    expect(bike[2]?.comparison).toMatchObject({ value: 4, display: '4', unit: 'km / 1 000 hab.' })
    // A raw segment numerator carries no served comparison of its own.
    expect(bike[3]?.comparison).toBeNull()
    expect(bike[4]?.comparison).toBeNull()
  })

  it('keeps a real zero and a missing total distinguishable', () => {
    const car = mobiliteBarReadings({ figure, category: figure.categories[2]!, showComparison: true })
    expect(car[0]).toMatchObject({ value: 0, display: '0', comparison: null })
    const absent = mobiliteBarReadings({ figure, category: figure.categories[3]!, showComparison: true })
    expect(absent[0]).toMatchObject({ value: null, display: 'Indisponible' })
    expect(absent[0]?.comparison).toMatchObject({ value: 2, display: '2' })
  })

  it('withholds every comparison reading when the layer is hidden', () => {
    const bike = mobiliteBarReadings({ figure, category: figure.categories[1]!, showComparison: false })
    expect(bike.every((reading) => reading.comparison === null)).toBe(true)
    const rows = mobiliteBarTooltipRows(bike)
    expect(rows.every((row) => row.comparison === undefined)).toBe(true)
    const label = mobiliteBarsAccessibleLabel({ figure, showComparison: false })
    expect(label).not.toContain('Groupe comparé')
    expect(label).not.toContain('1er/3')
    expect(label).toContain('Total vélo : 8 km / 1 000 hab.')
    expect(label).toContain('Réseau absent : Indisponible')
  })

  it('maps the visible tooltip rows without changing labels, units or rank text', () => {
    const rows = mobiliteBarTooltipRows(mobiliteBarReadings({
      figure, category: figure.categories[0]!, showComparison: true,
    }))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      label: 'Réseau piéton',
      value: '12',
      ariaLabel: 'Réseau piéton : 12 km / 1 000 hab.',
      comparison: {
        value: '9',
        rank: '2e/3',
        ariaLabel: 'Groupe comparé : 9 km / 1 000 hab. (Médiane des communes de EPCI X). Rang 2e/3 — plus = mieux',
      },
    })
    expect(rows[1]).toMatchObject({
      label: 't_longueur', value: '10', marker: 'slash',
      ariaLabel: 't_longueur : 10 km (valeur brute)',
    })
  })
})

function shareFigure(overrides: Partial<MobiliteShareEvidence> = {}): MobiliteShareEvidence {
  return {
    kind: 'mobilite-share',
    figureTitle: 'Part des bâtiments proches d’un arrêt (≤ 500 m)',
    territoryName: 'Rennes',
    unit: '%',
    comparisonLabel: 'Médiane des communes de la classe de densité',
    prose: [],
    sources: [],
    value: {
      label: 'Part des bâtiments proches d’un arrêt (≤ 500 m)',
      fact: {
        key: 'offre_tc', detail: null, value: 0.9957355031616097, unit: '%',
        availability: 'complete', provenance: null,
        comparison: {
          direction: 'plus-est-mieux',
          scope: { kind: 'communes-densite', label: 'communes de la classe de densité' },
          rank: { position: 1, size: 1 },
          reference: { kind: 'median', value: 0.5 },
        },
        comparisonBasis: 'territory-median', reason: null,
      },
    },
    ...overrides,
  }
}

describe('Mobilité coverage-share and raccordement readings (#1022)', () => {
  it('keeps a served share, its precise accessible reading and the singleton rank contract', () => {
    const figure = shareFigure()
    expect(mobiliteShareValue(figure)).toBe(0.9957355031616097)
    expect(mobiliteShareVisibleLabel(mobiliteShareValue(figure), figure)).toBe('99,6 %')
    expect(mobiliteSharePreciseLabel(mobiliteShareValue(figure), figure)).toBe('99,5736 %')
    expect(mobiliteShareReference({ figure, status: 'ready' })).toBe(0.5)
    expect(mobiliteShareReference({ figure, status: 'loading' })).toBeNull()
    expect(mobiliteShareReference({ figure, status: 'ready', comparisonNone: true })).toBeNull()
    const aria = mobiliteShareComparisonAria({ figure, status: 'ready' })
    expect(aria).toContain('Groupe comparé : 50 %')
    expect(aria).not.toContain('Rang')
    expect(aria).toContain('Médiane des communes de la classe de densité')
  })

  it('keeps zero as a valid share and an incomplete value absent', () => {
    const zero = shareFigure()
    zero.value = { ...zero.value, fact: { ...zero.value.fact, value: 0 } }
    expect(mobiliteShareValue(zero)).toBe(0)
    expect(mobiliteShareVisibleLabel(mobiliteShareValue(zero), zero)).toBe('0,0 %')

    const incomplete = shareFigure()
    incomplete.value = { ...incomplete.value, fact: { ...incomplete.value.fact, value: null, availability: 'incomplete' } }
    expect(mobiliteShareValue(incomplete)).toBeNull()
    expect(mobiliteShareVisibleLabel(mobiliteShareValue(incomplete), incomplete)).toBe('Indisponible')
  })

  it('reads the declared raccordement grid by detail identity and hides a masked comparison', () => {
    const point = (detail: string, value: number | null): ContentFact => ({
      label: detail,
      fact: {
        key: 'raccordement_courbe', detail, axisValue: Number(detail.slice(1)),
        value, unit: '%', availability: 'complete', provenance: null,
        comparison: null, comparisonBasis: 'territory-median', reason: null,
      },
    })
    const figure: MobiliteRaccordementEvidence = {
      kind: 'mobilite-raccordement',
      figureTitle: 'Part de la population bretonne joignable',
      xAxisTitle: 'Temps de trajet',
      territoryName: 'Rennes',
      level: 'commune',
      comparisonLabel: 'Moyenne des communes bretonnes',
      prose: [], sources: [],
      points: [point('t0030', 0.25), point('t0000', 0), point('t0090', 0.9), point('t0015', null)],
      comparison: {
        statistic: 'mean',
        scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
        selectedMemberCount: 3,
        eligibleCount: 2,
        modelZeroReasonCounts: {},
        points: [point('t0000', 0.1), point('t0015', 0.3), point('t0030', 0.4), point('t0090', 0.8)],
      },
      trajectory: {
        endpoints: ['t0000', 't0090'],
        axisLabels: { x: 'Temps de trajet', y: 'Population joignable (%)' },
        ticks: [
          { detail: 't0000', label: '0' },
          { detail: 't0090', label: '90 min' },
          { detail: 't0015', label: '15' },
          { detail: 't0030', label: '30 min' },
        ],
        marker: { detail: 't0090', label: '90 minutes' },
      },
      axis: {
        values: [
          { detail: 't0030', numericValue: 30 },
          { detail: 't0000', numericValue: 0 },
          { detail: 't0090', numericValue: 90 },
          { detail: 't0015', numericValue: 15 },
        ],
        minimum: 0,
        maximum: 90,
      },
      markerValue: {
        label: '90 minutes',
        fact: {
          key: 'raccordement_courbe', detail: 't0090', axisValue: 90, value: 0.9, unit: '%',
          availability: 'complete', provenance: null,
          comparison: {
            direction: 'plus-est-mieux',
            scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
            reference: { kind: 'mean', value: 0.8 },
            rank: { position: 2, size: 5 },
          },
          comparisonBasis: 'territory-mean', reason: null,
        },
      },
    }

    const readings = mobiliteCurveReadings({ figure, showComparison: true })
    expect(readings.map((reading) => [reading.detail, reading.label, reading.display, reading.comparisonDisplay]))
      .toEqual([
        ['t0000', '0', '0', '10'],
        ['t0090', '90 min', '90', '80'],
        ['t0015', '15 min', 'Indisponible', '30'],
        ['t0030', '30 min', '25', '40'],
      ])
    expect(readings[1]?.comparisonRankDisplay).toBe('2e/5')
    expect(readings[0]?.comparisonRankDisplay).toBeNull()
    const rows = mobiliteCurveTooltipRows({
      figure,
      reading: readings[1]!,
      showComparison: true,
    })
    expect(rows[0]).toMatchObject({
      label: 'Territoire',
      value: '90',
      comparison: { value: '80', rank: '2e/5' },
    })
    expect(rows[0]?.comparison?.ariaLabel).toContain('Rang 2e/5')

    const hidden = mobiliteCurveReadings({ figure, showComparison: false })
    expect(hidden.every((reading) => reading.comparisonDisplay === null && reading.comparisonRank === null)).toBe(true)
    const hiddenRows = mobiliteCurveTooltipRows({ figure, reading: hidden[1]!, showComparison: false })
    expect(hiddenRows[0]?.comparison).toBeUndefined()

    // Declared ticks are omitted but the producer numeric axis still owns the
    // coordinates/order; the point list is not used as an index axis.
    const labels: Record<string, string> = {
      t0000: '0 min', t0015: '15 min', t0030: '30 min', t0090: '90 min',
    }
    const noTicks = {
      ...figure,
      trajectory: null,
      points: figure.points.map((point) => ({
        ...point,
        label: labels[point.fact.detail ?? ''] ?? point.label,
      })),
    }
    const noTicksGrid = mobiliteCurveGrid(noTicks)
    expect(noTicksGrid.map((tick) => [tick.detail, tick.axisValue])).toEqual([
      ['t0030', 30], ['t0000', 0], ['t0090', 90], ['t0015', 15],
    ])
    expect(mobiliteCurveReadings({ figure: noTicks, showComparison: true })).toHaveLength(4)
    const noTicksLabel = mobiliteCurveAccessibleLabel({ figure: noTicks, showComparison: true, notes: [] })
    expect(noTicksLabel).toContain('Territoire : 30 min : 25 % ; 0 min : 0 % ; 90 min : 90 % ; 15 min : Indisponible')

    // No ticks and no declared axis: finite point axisValues preserve reference order.
    const noAxis = { ...figure, trajectory: null, axis: null }
    expect(mobiliteCurveGrid(noAxis).map((tick) => [tick.detail, tick.axisValue])).toEqual([
      ['t0030', 30], ['t0000', 0], ['t0090', 90], ['t0015', 15],
    ])

    // A native tick coordinate wins over the axis lookup; it is never replaced
    // by the array position or the detail string.
    const nativeTickCoordinate = {
      ...figure,
      trajectory: {
        ...figure.trajectory!,
        ticks: [
          { detail: 't0000', label: '0', numericValue: 1000 },
          { detail: 't0090', label: '90 min', numericValue: 2000 },
        ],
      },
    }
    expect(mobiliteCurveGrid(nativeTickCoordinate).map((tick) => [tick.detail, tick.axisValue]))
      .toEqual([['t0000', 1000], ['t0090', 2000]])
  })
})

describe('Mobilité ratio scalar owner formatter (#1022)', () => {
  function ratio(value: number | null): MobiliteRatioEvidence {
    return {
      label: 'Places de stationnement vélo pour 1 place voiture',
      note: null,
      value: {
        label: 'Places de stationnement vélo pour 1 place voiture',
        fact: {
          key: 'stationnement_velo_par_voiture', detail: null, value,
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
    }
  }

  it('keeps the scalar number bare and the unit/aria separate, matching the mounted scalar', () => {
    expect(mobiliteRatioDisplayValue(ratio(1.234))).toBe('1,2')
    expect(mobiliteRatioValueLabel(ratio(1.234))).toBe('1,2 places vélo / place voiture')
    expect(mobiliteRatioDisplayValue(ratio(0))).toBe('0')
    expect(mobiliteRatioDisplayValue(ratio(null))).toBe('—')
    expect(mobiliteRatioValueLabel(ratio(null))).toBe('Indisponible')
    const aria = mobiliteRatioAriaLabel({
      ratio: ratio(1.234), scope: 'communes de EPCI X', status: 'ready', comparisonIneligible: false,
    })
    expect(aria).toContain('Places de stationnement vélo pour 1 place voiture : 1,2 places vélo / place voiture')
    expect(aria).toContain('Référence 0,3 places vélo / place voiture (communes de EPCI X)')
    expect(aria).toContain('Rang 2e/3')
    expect(mobiliteRatioAriaLabel({
      ratio: ratio(1.234), scope: null, status: 'ready', comparisonIneligible: true,
    })).toBe('Places de stationnement vélo pour 1 place voiture : 1,2 places vélo / place voiture')
  })

  it('keeps zero distinct from absent and preserves a small non-zero numeric in the owner', () => {
    expect(ratio(0).value.fact.value).toBe(0)
    expect(ratio(0.04).value.fact.value).toBe(0.04)
    expect(mobiliteRatioDisplayValue(ratio(0.04))).toBe('0')
  })
})

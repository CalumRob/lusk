import { describe, expect, it } from 'vitest'

import type { AedarFact } from '@/fiche/content/aedarApiClient'
import type { AedarComparisonCell } from '@/fiche/content/aedarComparisonClient'
import { AEDAR_EQUIPMENT_QUANTILE_STATISTICS } from '@/fiche/content/aedarTimeRampFacts'
import type {
  AedarCarAccessOverviewScalar,
  AedarEquipmentExplorerEvidence,
} from '@/fiche/content/themeContent'
import {
  aedarExplorerVolumeRamp,
  aedarOverviewScalarAria,
  aedarOverviewScalarDisplayValue,
  aedarOverviewScalarRank,
  aedarQuantileReading,
  aedarWaffleReading,
  aedarWaffleShareLabel,
} from '@/fiche/prototype/aedarFigureReadings'

function aedarFact(typequ = 'B207', overrides: Partial<AedarFact> = {}): AedarFact {
  return {
    territory_id: '22001',
    territory_type: 'commune',
    typequ,
    typequ_label: typequ === 'B202' ? 'Équipement bis' : 'Boulangerie (B207)',
    identity: {},
    n_addresses: 100,
    n_observed: 100,
    coverage_status: 'covered',
    measures: {
      count_15_car_min: 0,
      count_15_car_decile1: 1,
      count_15_car_decile5: 5,
      count_15_car_decile9: 9,
      count_15_car_max: 10,
      count_15_car_mean: 4,
      count_10_car_mean: 2,
      count_20_car_mean: 6,
      count_15_walk_share: 0.3,
      count_15_transit_share: 0.1,
      count_15_bike_lts2_share: 0.1,
      count_15_bike_lts4_share: 0.1,
      count_15_car_share: 0.1,
    },
    source_id: 'aedar_bretagne',
    vintage_id: '2026-v1',
    source_url: 'https://example.test/aedar',
    licence: 'ODbL',
    attribution: 'AEDAR',
    reference_date: null,
    publication_date: null,
    ...overrides,
  }
}

function explorerEvidence(): AedarEquipmentExplorerEvidence {
  return {
    kind: 'aedar-equipment-explorer',
    contentVersion: 'facts-v1',
    referenceContentVersion: 'reference-v1',
    facts: [],
    initialTypequ: 'B207',
    initialHorizonMinutes: 15,
    introduction: [],
    volumeFigureTitle: 'Établissements accessibles',
    volumeYAxisTitle: 'Volume de l’offre',
    distributionFigureTitle: 'Distribution des établissements accessibles par décile',
    distributionStatistics: AEDAR_EQUIPMENT_QUANTILE_STATISTICS,
    distributionAxisTitle: 'Décile',
    distributionYAxisTitle: 'Nombre d’établissements',
    distributionValueUnit: 'établissement',
    distributionDescription: 'Les barres montrent les valeurs des seuils publiés.',
    distributionUnavailableDescription: 'Distribution indisponible.',
    source: null,
  }
}

function cell(measure: string, rank: number | null, ties = 1): AedarComparisonCell {
  return {
    typequ: 'B207', measure, group_value: 7.4, group_coverage_status: 'covered',
    group_n_addresses: 50, group_n_observed: 42, statistic: 'pooled',
    source_id: 'aedar_bretagne', vintage_id: '2026-v1',
    reference_date: null, publication_date: null,
    rank, rank_size: rank === null ? null : 3, rank_ties: rank === null ? null : ties,
  } as AedarComparisonCell
}

describe('AEDAR figure readings (#1022)', () => {
  it('builds the declared min/decile/max grouped bars with served ranks and a hidden comparison', () => {
    const reading = aedarQuantileReading({
      fact: aedarFact(),
      horizonMinutes: 15,
      selectedModes: ['car'],
      evidence: explorerEvidence(),
      comparison: {
        label: 'Classe de densité', contentVersion: 'facts-v1', referenceContentVersion: 'reference-v1',
        cells: [cell('count_15_car_min', 1, 2), cell('count_15_car_max', 2)],
      },
      comparisonLabel: 'Classe de densité',
      comparisonVisible: false,
    })
    expect(reading.figure.categories.map((category) => [category.key, category.axisLabel])).toEqual([
      ['min', 'Min'], ['decile1', 'D1'], ['decile2', 'D2'], ['decile3', 'D3'], ['decile4', 'D4'],
      ['decile5', 'D5'], ['decile6', 'D6'], ['decile7', 'D7'], ['decile8', 'D8'], ['decile9', 'D9'],
      ['max', 'Max'],
    ])
    expect(reading.figure.series.map((series) => [series.key, series.values.slice(0, 2), series.ranks?.slice(0, 2)]))
      .toEqual([
        ['car', [0, 1], undefined],
        ['car-reference', [7.4, null], [{ position: 1, size: 3, ties: 2 }, null]],
      ])
    expect(reading.visibleReferenceAvailable).toBe(true)
    expect(reading.referenceAvailable).toBe(true)
    expect(reading.hiddenSeriesKeys).toEqual(['car-reference'])
    expect(reading.figure.description).not.toContain('Groupe comparé')
  })

  it('uses the owner coverage and source-clock guard for a direct reference fact', () => {
    const focal = aedarFact()
    const valid = aedarQuantileReading({
      fact: focal, horizonMinutes: 15, selectedModes: ['car'], evidence: explorerEvidence(),
      referenceFact: { ...focal, territory_id: '22002' }, comparisonLabel: 'Moyenne de l’EPCI',
      comparisonVisible: true,
    })
    expect(valid.figure.series[1]?.values[0]).toBe(0)
    expect(valid.figure.description).toContain('Groupe comparé : Moyenne de l’EPCI')

    const stale = aedarQuantileReading({
      fact: focal, horizonMinutes: 15, selectedModes: ['car'], evidence: explorerEvidence(),
      referenceFact: { ...focal, territory_id: '22002', publication_date: '2025-01-01' },
      comparisonLabel: 'Moyenne de l’EPCI', comparisonVisible: true,
    })
    expect(stale.figure.series[1]?.values.every((value) => value === null)).toBe(true)
    expect(stale.visibleReferenceAvailable).toBe(false)
  })

  it('builds the explorer volume ramp from the same group resolver without adding peers', () => {
    const comparison = {
      label: 'Moyenne de la sélection', contentVersion: 'facts-v1', referenceContentVersion: 'reference-v1',
      cells: [cell('count_10_car_mean', 3), cell('count_15_car_mean', 2), cell('count_20_car_mean', 1)],
    }
    const ramp = aedarExplorerVolumeRamp({
      fact: aedarFact(), baseFact: aedarFact(), comparison, referenceDetail: null,
      comparisonRequestPresent: true, comparisonLabel: comparison.label,
      comparisonLayerSupported: true, volumeYAxisTitle: 'Volume de l’offre',
    })
    expect(ramp.series[0]?.points).toEqual([
      { xValue: 5, xLabel: '5 min', value: null, referenceValue: null, referenceRank: null },
      { xValue: 10, xLabel: '10 min', value: 2, referenceValue: 7.4, referenceRank: { position: 3, size: 3, ties: 1 } },
      { xValue: 15, xLabel: '15 min', value: 4, referenceValue: 7.4, referenceRank: { position: 2, size: 3, ties: 1 } },
      { xValue: 20, xLabel: '20 min', value: 6, referenceValue: 7.4, referenceRank: { position: 1, size: 3, ties: 1 } },
    ])
    expect(ramp.yAxis).toEqual({ label: 'Volume de l’offre', unit: '' })
    expect(ramp.availability).toBe('incomplete')
  })

  it('summarises the waffle from the resolved model and prints the declared shares', () => {
    const facts = [
      aedarFact('B207'),
      aedarFact('B202', {
        measures: {
          count_15_walk_share: 0.1,
          count_15_transit_share: 0.1,
          count_15_bike_lts2_share: 0.26,
          count_15_bike_lts4_share: 0.1,
          count_15_car_share: 0.1,
        },
      }),
    ]
    const reading = aedarWaffleReading({ facts, threshold: 0.25, horizonMinutes: 15 })
    expect(reading.profile?.status).toBe('complete')
    expect(reading.summary).toBe('Répartition des 2 types d’équipements à 15 minutes. À pied : 1. Transports en commun : 0. Vélo (LTS2) : 1. Vélo (LTS4) : 0. Voiture : 0. Inaccessible : 0.')
    expect(aedarWaffleShareLabel(facts, 15, 'B207', 'walk')).toBe('30\u00a0%')
    expect(aedarWaffleShareLabel(facts, 20, 'B207', 'car')).toBe('—')
  })

  it('reads the served scalar rank and suppresses a singleton', () => {
    const scalar: AedarCarAccessOverviewScalar = {
      key: 'meanDiversity', label: 'Types d’équipements', value: 1.04, unit: 'types / adresse',
      reference: { kind: 'selection-mean', label: 'Moyenne de l’EPCI', value: 2.2, unit: 'types / adresse' },
      rank: 1, rankSize: 1, rankTies: 1, rankDirection: 'high',
    }
    expect(aedarOverviewScalarRank(scalar)).toBeNull()
    expect(aedarOverviewScalarAria({ scalarFigureTitle: 'En voiture', scalars: [scalar] } as never, scalar, true))
      .toBe('Types d’équipements : 1 types / adresse. En voiture. Moyenne de l’EPCI : 2,2 types / adresse.')

    const tied: AedarCarAccessOverviewScalar = { ...scalar, rank: 2, rankSize: 4, rankTies: 2 }
    expect(aedarOverviewScalarRank(tied)).toEqual({ position: 2, size: 4, ties: 2 })
    expect(aedarOverviewScalarDisplayValue(scalar)).toBe('1')
    expect(aedarOverviewScalarDisplayValue({ ...scalar, value: 0 })).toBe('0')
    expect(aedarOverviewScalarDisplayValue({ ...scalar, value: null })).toBe('—')
  })
})

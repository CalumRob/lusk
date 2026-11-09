import { describe, expect, it } from 'vitest'
import type { AedarTerritorySummary } from '@/fiche/content/aedarApiClient'
import type { AedarFact } from '@/fiche/content/aedarApiClient'
import { aedarTimeRampSummary, AEDAR_AGGREGATE_READING_MEASURES, AEDAR_EQUIPMENT_QUANTILE_STATISTICS,
  AEDAR_RAMP_MODES, AEDAR_RAMP_MODE_LABELS, readAedarCountMeasure, toggleAedarRampModeSelection } from '@/fiche/content/aedarTimeRampFacts'
import { nativeResources } from './helpers/semanticApiFixtures'

const horizons = [5, 10, 15, 20]
const source = { source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test',
  licence: 'test', attribution: 'test', reference_date: '2026-01-01', publication_date: '2026-09-30' }

function summary(values: Record<string, number | null> = {}): AedarTerritorySummary {
  return {
    territory: { territory_type: 'commune', territory_id: '22001' },
    summaryContentVersion: 'summary-v1', aedarContentVersion: 'aed-1', referenceContentVersion: 'ref-1',
    readings: Object.keys(AEDAR_AGGREGATE_READING_MEASURES).map((measure) => ({
      measure, value: Object.hasOwn(values, measure) ? values[measure]! : 0,
      status: Object.hasOwn(values, measure) && values[measure] === null ? 'unavailable' as const : 'available' as const,
      n_typequ: 235, n_addresses: 100, n_observed: 97, coverage_status: 'covered', statistic: 'direct' as const, ...source,
    })),
    provenance: { contentVersion: 'aed-1', sources: [source] },
  }
}

describe('AEDAR time ramp summary adapter', () => {
  it('toggles mode membership while keeping canonical legend order', () => {
    expect(toggleAedarRampModeSelection(['car', 'bike_lts2'], 'bike_lts2')).toEqual(['car'])
    expect(toggleAedarRampModeSelection(['walk', 'car'], 'bike_lts4')).toEqual(['car', 'bike_lts4', 'walk'])
  })

  it('reads only finite non-negative typed TYPEQU count measures for detail consumers', () => {
    const fact = { measures: { count_15_car_mean: 0 } } as unknown as AedarFact
    expect(readAedarCountMeasure(fact, 15, 'car', 'mean')).toBe(0)
    fact.measures.count_15_car_mean = null
    expect(readAedarCountMeasure(fact, 15, 'car', 'mean')).toBeNull()
    fact.measures.count_15_car_mean = -1
    expect(readAedarCountMeasure(fact, 15, 'car', 'mean')).toBeNull()
    fact.measures.count_15_car_mean = Number.POSITIVE_INFINITY
    expect(readAedarCountMeasure(fact, 15, 'car', 'mean')).toBeNull()
  })

  it('exposes the five normal ramp modes with their labels, transit_gain excluded', () => {
    expect(AEDAR_RAMP_MODES).toEqual(['car', 'bike_lts2', 'bike_lts4', 'transit', 'walk'])
    expect(AEDAR_RAMP_MODE_LABELS.car).toBe('Voiture')
    expect(AEDAR_RAMP_MODE_LABELS.walk).toBe('À pied')
    expect(AEDAR_RAMP_MODE_LABELS).not.toHaveProperty('transit_gain')
  })

  it('maps the producer-published reading identities directly to diversity and volume ramps', () => {
    const data = summary({ car5Diversity: 0.75, car5Volume: 8, walk5Diversity: 0.1 })
    const result = aedarTimeRampSummary(data)
    expect(result.map((ramp) => ramp.rampKey)).toEqual(['diversity', 'volume'])
    expect(result[0]?.territory.car).toEqual([0.75, 0, 0, 0])
    expect(result[1]?.territory.car).toEqual([8, 0, 0, 0])
    expect(result[0]?.territory.walk).toEqual([0.1, 0, 0, 0])
    expect(result[0]?.xAxis).toEqual({ values: horizons, labels: ['5 min', '10 min', '15 min', '20 min'], unit: 'minutes', label: 'Temps d’accès' })
    for (const ramp of result) {
      expect(Object.keys(ramp.territory).sort()).toEqual([...AEDAR_RAMP_MODES].sort())
      for (const mode of AEDAR_RAMP_MODES) expect(ramp.territory[mode]).toHaveLength(horizons.length)
    }
    expect(result[0]?.availability).toBe('complete')
    expect(result[0]?.provenance.sourceId).toBe('aedar_bretagne')
  })

  it('keeps the app ramp projection complete against the producer-discovered summary facets', () => {
    const summary = nativeResources().find((resource) => resource.resource_id === 'aedar_territory_summary') as { measure_facets?: Record<string, unknown> } | undefined
    expect(summary?.measure_facets).toBeDefined()
    expect(Object.keys(AEDAR_AGGREGATE_READING_MEASURES).sort())
      .toEqual(Object.keys(summary!.measure_facets!).sort())
  })

  it('keeps a published zero distinct from unavailable null, per reading', () => {
    const data = summary({ car5Diversity: null, walk5Volume: null })
    const result = aedarTimeRampSummary(data)
    expect(result[0]?.territory.car).toEqual([null, 0, 0, 0])
    expect(result[0]?.availability).toBe('incomplete')
    expect(result[1]?.territory.car[0]).toBe(0)
    expect(result[1]?.territory.walk).toEqual([null, 0, 0, 0])
    expect(result[1]?.availability).toBe('incomplete')
  })

  it('declares the published quantile contract in minimum-to-maximum order for typed details', () => {
    expect(AEDAR_EQUIPMENT_QUANTILE_STATISTICS.map(({ key }) => key)).toEqual([
      'min', 'decile1', 'decile2', 'decile3', 'decile4', 'decile5', 'decile6', 'decile7', 'decile8', 'decile9', 'max',
    ])
  })
})

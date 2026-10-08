import { describe, expect, it } from 'vitest'
import { aedarTimeRampEvidence, AEDAR_RAMP_MODES, AEDAR_RAMP_MODE_LABELS } from '@/fiche/content/aedarTimeRampFacts'

const horizons = [5, 10, 15, 20]
const modes = ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car']
const stats = ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, index) => `decile${index + 1}`), 'mean']

function response() {
  const measures: Record<string, number | null> = {}
  for (const horizon of horizons) for (const mode of modes) for (const stat of stats) {
    measures[`count_${horizon}_${mode}_${stat}`] = 0
  }
  return {
    territory: { territory_type: 'commune', territory_id: '22001' },
    content_version: 'aed-1', reference_content_version: 'ref-1', limit: 50, offset: 0,
    facts: ['A', 'B'].map((typequ) => ({
      territory_id: '22001', territory_type: 'commune', typequ, typequ_label: typequ, identity: {},
      n_addresses: 100, n_observed: 97, coverage_status: 'covered', measures: { ...measures },
      source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test',
      licence: 'test', attribution: 'test', reference_date: '2026-01-01', publication_date: '2026-09-30',
    })),
  }
}

const options = { territory: { type: 'commune', id: '22001' } }

describe('aedarTimeRampEvidence', () => {
  it('exposes the five normal ramp modes with their labels, transit_gain excluded', () => {
    expect(AEDAR_RAMP_MODES).toEqual(['car', 'bike_lts4', 'bike_lts2', 'transit', 'walk'])
    expect(AEDAR_RAMP_MODE_LABELS.car).toBe('Voiture')
    expect(AEDAR_RAMP_MODE_LABELS.walk).toBe('À pied')
    expect(AEDAR_RAMP_MODE_LABELS).not.toHaveProperty('transit_gain')
  })

  it('sums per-type shares and averages per-type means for every horizon and every mode', () => {
    const data = response()
    data.facts[0]!.measures['count_5_car_share'] = 0.25
    data.facts[1]!.measures['count_5_car_share'] = 0.5
    data.facts[0]!.measures['count_5_car_mean'] = 2
    data.facts[1]!.measures['count_5_car_mean'] = 6
    data.facts[0]!.measures['count_5_walk_share'] = 0.1
    const result = aedarTimeRampEvidence(data, options)
    expect(result.map((ramp) => ramp.rampKey)).toEqual(['diversity', 'count-per-type'])
    expect(result[0]?.territory.car).toEqual([0.75, 0, 0, 0])
    expect(result[1]?.territory.car).toEqual([4, 0, 0, 0])
    expect(result[0]?.territory.walk).toEqual([0.1, 0, 0, 0])
    expect(result[0]?.xAxis).toEqual({ values: horizons, labels: ['5 min', '10 min', '15 min', '20 min'], unit: 'minutes', label: 'Temps d’accès' })
    // Every ramp mode carries a full horizon series.
    for (const ramp of result) {
      expect(Object.keys(ramp.territory).sort()).toEqual([...AEDAR_RAMP_MODES].sort())
      for (const mode of AEDAR_RAMP_MODES) expect(ramp.territory[mode]).toHaveLength(horizons.length)
    }
    expect(result[0]?.availability).toBe('complete')
    expect(result[0]?.provenance.sourceId).toBe('aedar_bretagne')
  })

  it('keeps a real zero distinct from unavailable null, per mode', () => {
    const data = response()
    data.facts[0]!.measures['count_5_car_share'] = null
    data.facts[1]!.measures['count_5_walk_mean'] = null
    const result = aedarTimeRampEvidence(data, options)
    expect(result[0]?.territory.car).toEqual([null, 0, 0, 0])
    expect(result[0]?.availability).toBe('incomplete')
    expect(result[1]?.territory.car[0]).toBe(0)
    expect(result[1]?.territory.walk).toEqual([null, 0, 0, 0])
    expect(result[1]?.availability).toBe('incomplete')
  })

  it.each(['identity', 'source', 'coverage', 'missing measure', 'pagination'])('rejects invalid %s', (kind) => {
    const data = response()
    if (kind === 'identity') data.facts[0]!.territory_id = '99999'
    if (kind === 'source') data.facts[1]!.vintage_id = 'other'
    if (kind === 'coverage') data.facts[0]!.coverage_status = 'partial'
    if (kind === 'missing measure') delete data.facts[0]!.measures['count_5_car_share']
    if (kind === 'pagination') data.facts.length = 50
    expect(() => aedarTimeRampEvidence(data, options)).toThrow()
  })

  it('accepts n_addresses different from n_observed', () => {
    const data = response()
    data.facts[0]!.n_addresses = 100
    data.facts[0]!.n_observed = 85
    data.facts[0]!.measures['count_5_car_share'] = 0.3
    data.facts[1]!.measures['count_5_car_share'] = 0.4
    expect(() => aedarTimeRampEvidence(data, options)).not.toThrow()
  })
})

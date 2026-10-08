import { describe, expect, it } from 'vitest'
import { aedarTimeRampEvidence } from '@/fiche/content/aedarTimeRampFacts'

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
      n_addresses: 100, n_observed: 100, coverage_status: 'complete', measures: { ...measures },
      source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test',
      licence: 'test', attribution: 'test', reference_date: '2026-01-01', publication_date: '2026-09-30',
    })),
  }
}

describe('aedarTimeRampEvidence', () => {
  it('sums per-type shares and averages per-type means for every horizon', () => {
    const data = response()
    data.facts[0]!.measures['count_5_car_share'] = 0.25
    data.facts[1]!.measures['count_5_car_share'] = 0.5
    data.facts[0]!.measures['count_5_car_mean'] = 2
    data.facts[1]!.measures['count_5_car_mean'] = 6
    const result = aedarTimeRampEvidence(data, { territory: { type: 'commune', id: '22001' }, mode: 'car', modeLabel: 'Voiture' })
    expect(result.map((ramp) => ramp.rampKey)).toEqual(['diversity', 'count-per-type'])
    expect(result[0]?.series.territory).toEqual([0.75, 0, 0, 0])
    expect(result[1]?.series.territory).toEqual([4, 0, 0, 0])
    expect(result[0]?.xAxis).toEqual({ values: horizons, labels: ['5 min', '10 min', '15 min', '20 min'], unit: 'minutes', label: 'Temps d’accès' })
  })

  it('keeps a real zero distinct from unavailable null', () => {
    const data = response()
    data.facts[0]!.measures['count_5_car_share'] = null
    const result = aedarTimeRampEvidence(data, { territory: { type: 'commune', id: '22001' }, mode: 'car', modeLabel: 'Voiture' })
    expect(result[0]?.series.territory).toEqual([null, 0, 0, 0])
    expect(result[0]?.availability).toBe('incomplete')
    expect(result[1]?.series.territory[0]).toBe(0)
  })

  it.each(['identity', 'source', 'coverage', 'missing measure', 'pagination'])('rejects invalid %s', (kind) => {
    const data = response()
    if (kind === 'identity') data.facts[0]!.territory_id = '99999'
    if (kind === 'source') data.facts[1]!.vintage_id = 'other'
    if (kind === 'coverage') data.facts[0]!.coverage_status = 'partial'
    if (kind === 'missing measure') delete data.facts[0]!.measures['count_5_car_share']
    if (kind === 'pagination') data.facts.length = 50
    expect(() => aedarTimeRampEvidence(data, { territory: { type: 'commune', id: '22001' }, mode: 'car', modeLabel: 'Voiture' })).toThrow()
  })
})

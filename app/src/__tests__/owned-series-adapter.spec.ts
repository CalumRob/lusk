import { describe, expect, it } from 'vitest'
import { orderedSeriesAdapterFor, orderedSeriesFacts } from '../payload/orderedSeriesAdapter'
import { territoiresFixture } from '../payload/fixtures'

describe('owned M2/M3 series adapter', () => {
  it('registers a dataset-qualified no-comparison adapter and preserves per-point revisions', () => {
    const adapter = orderedSeriesAdapterFor('milieux', 'artif_par_habitant')
    expect(adapter).toEqual({ theme: 'milieux', indicator: 'artif_par_habitant',
      pathIndicator: 'artif_par_habitant', datasetId: 'ocsge_artif_etats' })
    const response = {
      dataset_id: 'ocsge_artif_etats', indicator_id: 'artif_par_habitant', axis_kind: 'state_role' as const,
      unit: 'm²/hab', territory: { id: '22001', type: 'commune' as const, name: 'Commune A1' },
      points: [{ axis: 'M2', observation_period: '2021-2025', value: 0, status: 'measured' as const,
        provenance: [{ revision_id: 'rev-22-2021', source_id: 'ocsge_artificialisation_22_2021',
          vintage_id: '2021', source_name: 'IGN OCS-GE 22', dataset_name: 'OCS-GE', version: '2021',
          reference_date: '2021-01-01', publication_date: '2025-09-12', revision_hash: 'immutable-hash' }] },
      { axis: 'M3', observation_period: '2021-2025', value: null, status: 'missing' as const, provenance: [] }],
      comparison_point: null, comparison: null,
    }
    const facts = orderedSeriesFacts(response, 'milieux', territoiresFixture)
    expect(facts.map((fact) => [fact.detail, fact.value])).toEqual([['M2', 0], ['M3', null]])
    expect(facts[0].provenance_revisions?.[0].revision_id).toBe('rev-22-2021')
    expect(facts[0].observation_period).toBe('2021-2025')
    expect(facts[0].rang_epci).toBeNull()
    expect(facts[1].observation_status).toBe('missing')
  })
})

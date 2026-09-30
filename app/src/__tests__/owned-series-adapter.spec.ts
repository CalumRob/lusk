import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { orderedSeriesAdapterFor, orderedSeriesFacts } from '../payload/orderedSeriesAdapter'
import { territoiresFixture } from '../payload/fixtures'

const metadataMilieux = JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_milieux.json'), 'utf8'))

describe('owned M2/M3 series adapter', () => {
  it('registers a dataset-qualified no-comparison adapter and preserves per-point revisions', () => {
    const adapter = orderedSeriesAdapterFor('milieux', 'artif_par_habitant')
    expect(adapter).toEqual({ theme: 'milieux', indicator: 'artif_par_habitant', pathIndicator: 'artif_par_habitant' })
    expect(metadataMilieux.indicator_pages.artif_par_habitant.series_dataset_id).toBe('ocsge_artif_etats')
    expect(metadataMilieux.indicator_pages.artif_par_habitant.series_publication).toBe('owned')
    const response = {
      dataset_id: 'ocsge_artif_etats', indicator_id: 'artif_par_habitant', axis_kind: 'declared_detail' as const,
      unit: 'm²/hab', territory: { id: '22001', type: 'commune' as const, name: 'Commune A1' },
      points: [{ axis: 'M2', observation_period: '2021-2025', value: 0, status: 'measured' as const,
        provenance: [{ revision_id: 'rev-22-2021', source_id: 'ocsge_artificialisation_22_2021',
          vintage_id: '2021', source_name: 'IGN OCS-GE 22', dataset_name: 'OCS-GE', version: '2021',
          reference_date: '2021-01-01', publication_date: '2025-09-12', revision_hash: 'immutable-hash' }] },
      { axis: 'M3', observation_period: '2021-2025', value: null, status: 'missing' as const, provenance: [] }],
      scope_series: [
        { territory: { id: '22001', type: 'commune' as const, name: 'Commune A1' }, points: [
          { axis: 'M2', observation_period: '2021-2025', value: 0, status: 'measured' as const,
            provenance: [{ revision_id: 'rev-22-2021', source_id: 'ocsge_artificialisation_22_2021',
              vintage_id: '2021', source_name: 'IGN OCS-GE 22', dataset_name: 'OCS-GE', version: '2021',
              reference_date: '2021-01-01', publication_date: '2025-09-12', revision_hash: 'immutable-hash' }] },
          { axis: 'M3', observation_period: '2021-2025', value: null, status: 'missing' as const },
          { axis: '2025', observation_period: '2021-2025', value: 0, status: 'measured' as const, comparison_rank: 1, comparison_count: 2 },
        ] },
        { territory: { id: '22002', type: 'commune' as const, name: 'Commune A2' }, points: [
          { axis: 'M2', observation_period: '2021-2025', value: 12, status: 'measured' as const },
          { axis: 'M3', observation_period: '2021-2025', value: 15, status: 'measured' as const },
          { axis: '2025', observation_period: '2021-2025', value: 20, status: 'measured' as const, comparison_rank: 2, comparison_count: 2 },
        ] },
      ],
      comparison_point: '2025', comparison: { point: '2025', direction: 'low' as const,
        scope: { kind: 'level', territory_type: 'commune', epci_id: '243500139', rank_field: 'rang_epci' as const } },
    }
    const facts = orderedSeriesFacts(response, 'milieux', territoiresFixture)
    expect(facts.map((fact) => [fact.detail, fact.value])).toEqual([
      ['M2', 0], ['M3', null], ['2025', 0], ['M2', 12], ['M3', 15], ['2025', 20],
    ])
    expect(facts[0].provenance_revisions?.[0].revision_id).toBe('rev-22-2021')
    expect(facts[0].observation_period).toBe('2021-2025')
    expect(facts[0].rang_epci).toBeNull()
    expect(facts[1].observation_status).toBe('missing')
    expect(facts.find((fact) => fact.territoire === '22002' && fact.detail === '2025')?.rang_epci).toBe(2)
    expect(facts.find((fact) => fact.territoire === '22002' && fact.detail === 'M2')?.rang_epci).toBeNull()
  })
})

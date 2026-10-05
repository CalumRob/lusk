import { describe, expect, it } from 'vitest'
import { mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import { metadonneesThemesFixtures, histoiresMobiliteFixture } from '@/payload/fixtures'
import type { Payload } from '@/payload/types'

// Wire fields are those emitted by theme_facts and focal_profiles, not payload rows.
const sources = [{ source_id: 'mobilite_snapshot', name: 'SQL mobility', version: 'sql-v1',
  reference_date: null, publication_date: null }]
const payload: Payload = {
  territoires: [{ territoire: '22001', type: 'commune', nom: 'Commune', departement: '22', epci: null }],
  indicateurs: [], histoires: histoiresMobiliteFixture, apercu: null, runReport: null,
  vintages: [], programmes: null, themeMetadata: metadonneesThemesFixtures,
}
const readingGroup = metadonneesThemesFixtures.mobilite!.subgroups.find(
  (group) => group.reading?.params.includes('div_loss_t'),
)!.key
const response = () => ({
  contract: 'theme-facts-v1', complete_theme: false, theme_id: 'mobilite',
  territory: { territory_id: '22001', territory_type: 'commune', name: 'Commune' },
  facts: [{ indicator_id: 'places_stationnement_velo_1000', label: 'Stationnement',
    value: 123, status: 'measured', unit: 'places / 1 000 habitants', sources }],
  profiles: [{ indicator: 'reseaux_par_habitant', label: 'Réseaux', unit: 'km / 1 000 habitants',
    axes: [{ name: 'detail', key: 't_km_1000', label: 'À pied', order: 0, unit: 'km / 1 000 habitants' }],
    cells: [{ detail: 't_km_1000', sex: null, value: 456, status: 'measured',
      unit: 'km / 1 000 habitants', sources }] }],
  series: [], bpe_profile_evidence: null,
  readings: [{ groupe: readingGroup, story_key: 'sql-story', salience_reason: 'sql',
    classification_saillance: null, div_loss_t: 7, div_loss_b: 8, status: 'measured', unit: 'types',
    provenance: { source_id: 'mobilite_snapshot', source_name: 'SQL mobility', source_version: 'sql-v1',
      source_reference_date: null, source_publication_date: null } }],
})

describe('SQL Mobilité response to Variant E facts', () => {
  it('consumes scalar, profile and selected-reading wire fields with SQL provenance', () => {
    const facts = mobilityFactsFromThemeApi(payload, '22001', response())
    expect(facts.mobility.indicators.find((fact) => fact.key === 'places_stationnement_velo_1000'))
      .toMatchObject({ value: 123, provenance: { source: 'SQL mobility', referenceDate: null } })
    expect(facts.mobility.indicators.find((fact) => fact.key === 'reseaux_par_habitant'))
      .toMatchObject({ detail: 't_km_1000', value: 456, unit: 'km / 1 000 habitants' })
    expect(facts.mobility.losses.diversityWalkTransit).toMatchObject({ value: 7, unit: 'types' })
    expect(facts.mobility.losses.diversityBike).toMatchObject({ value: 8, unit: 'types' })
  })
  it('rejects measured facts without source lineage instead of presenting static provenance', () => {
    const data = response()
    data.facts[0]!.sources = []
    expect(() => mobilityFactsFromThemeApi(payload, '22001', data)).toThrow()
  })
  it('retains source missingness and never fills absent SQL values from static history', () => {
    const data = response()
    data.readings = []
    data.facts = []
    data.profiles = []
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
    expect(facts.mobility.indicators).toHaveLength(0)
    expect(facts.mobility.losses.diversityWalkTransit.value).toBeNull()
    expect(mobilityFactsFromThemeApi(payload, '22001', null).mobility.losses.diversityWalkTransit.value).toBeNull()
  })
  it('accepts immutable owned-series lineage using source_name rather than scalar name', () => {
    const data = { ...response(), series: [{ indicator_id: 'raccordement', unit: '%',
      points: [{ axis: '20', observation_period: null, value: 0.6, status: 'measured',
        provenance: [{ revision_id: 'rev-1', source_id: 'mobilite_snapshot', vintage_id: 'v1',
          source_name: 'SQL mobility', dataset_name: 'Raccordement', version: 'sql-v1',
          reference_date: null, publication_date: null, revision_hash: 'hash-1' }] }] }] }
    expect(() => mobilityFactsFromThemeApi(payload, '22001', data)).not.toThrow()
  })
  it('does not manufacture an exemplar for a source-defined empty BPE class', () => {
    const data = { ...response(), bpe_profile_evidence: { sources, classes:
      ['acces-pied-tc', 'velo-compense', 'voiture-requise', 'inaccessible-20-minutes'].map(
        (class_key) => ({ class_key, label: class_key, count: 0, universe_count: 0, exemplar: null }),
      ) } }
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
    expect(facts.mobility.bpeAccess.profiles[0]).toMatchObject({ count: 0, exemplar: null })
  })
})

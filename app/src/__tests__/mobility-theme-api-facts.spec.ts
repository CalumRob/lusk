import { describe, expect, it } from 'vitest'
import { applyThemeComparisonApiFacts, mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import type { TerritoryComparisonContext } from '@/payload/territoryReadModel'
import { metadonneesThemesFixtures, histoiresMobiliteFixture } from '@/payload/fixtures'
import type { Payload } from '@/payload/types'

// Wire fields are producer-owned indicator observations, not storage-family rows.
const sources = [{ source_id: 'mobilite_snapshot', name: 'SQL mobility', version: 'sql-v1',
  reference_date: null, publication_date: null }]
const context: TerritoryComparisonContext = { mode: 'densite', scope: {
  kind: 'communes-densite', label: 'Source-defined group' }, facts: [], buildingDistribution: null, accessRamp: null }
const payload: Payload = {
  territoires: [{ territoire: '22001', type: 'commune', nom: 'Commune', departement: '22', epci: null }],
  indicateurs: [], histoires: histoiresMobiliteFixture, apercu: null, runReport: null,
  vintages: [], programmes: null, themeMetadata: metadonneesThemesFixtures,
}
const readingGroup = metadonneesThemesFixtures.mobilite!.subgroups.find(
  (group) => group.reading?.params.includes('div_loss_t'),
)!.key
const response = (): any => ({
  contract: 'theme-facts-v1', complete_theme: false, theme_id: 'mobilite',
  territory: { territory_id: '22001', territory_type: 'commune', name: 'Commune' },
  indicators: [
    { indicator_id: 'places_stationnement_velo_1000', label: 'Stationnement',
      value: 123, status: 'measured', unit: 'places / 1 000 habitants', sources, dimensions: {} },
    { indicator_id: 'reseaux_par_habitant', label: 'Réseaux', value: 456, status: 'measured',
      unit: 'km / 1 000 habitants', sources, dimensions: { detail: 't_km_1000' } },
  ],
  indicator_metadata: [{ indicator_id: 'reseaux_par_habitant', kind: 'declared_dimensions',
    allowed_levels: ['commune'], descriptor_version: 'profile-v1', denominator_semantics: 'published denominator',
    axes: [{ name: 'detail', key: 't_km_1000', label: 'À pied', order: 0, unit: 'km / 1 000 habitants' },
      { name: 'sex', key: 'F', label: 'Femmes', order: 0, unit: null }] }],
  named_reference_evidence: [],
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
    data.indicators[0]!.sources = []
    expect(() => mobilityFactsFromThemeApi(payload, '22001', data)).toThrow()
  })
  it('rejects malformed provided coordinates instead of silently treating them as scalars', () => {
    const data = response()
    data.indicators[1]!.dimensions.detail = 42
    expect(() => mobilityFactsFromThemeApi(payload, '22001', data)).toThrow(/Dimension SQL/)
  })
  it('retains source missingness and never fills absent SQL values from static history', () => {
    const data = response()
    data.readings = []
    data.indicators = []
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
    expect(facts.mobility.indicators).toHaveLength(0)
    expect(facts.mobility.losses.diversityWalkTransit.value).toBeNull()
    expect(mobilityFactsFromThemeApi(payload, '22001', null).mobility.losses.diversityWalkTransit.value).toBeNull()
  })
  it('accepts immutable owned-series lineage using source_name rather than scalar name', () => {
    const lineage = { revision_id: 'rev-1', source_id: 'mobilite_snapshot', vintage_id: 'v1',
      source_name: 'SQL mobility', dataset_name: 'Raccordement', version: 'sql-v1',
      reference_date: null, publication_date: null, revision_hash: 'hash-1' }
    const data = { ...response(), indicator_metadata: [{ indicator_id: 'raccordement',
      axis_kind: 'duration_minute', axis_values: ['20'], axis_numeric_values: [20],
      completeness: 'dense_complete', direction: 'low', descriptor_version: 'series-v1',
      comparison_point: '20', observation_period_kind: 'source_snapshot' }],
      indicators: [...response().indicators, { indicator_id: 'raccordement', unit: '%', value: 0.6,
        status: 'measured', sources: [{ ...lineage, name: lineage.source_name }],
        dimensions: { axis: '20', numeric_axis_value: 20, observation_period: '2026-09-16' } }] }
    expect(mobilityFactsFromThemeApi(payload, '22001', data).mobility.indicators
      .find((fact) => fact.key === 'raccordement')?.provenance?.lineage?.revision_hash).toBe('hash-1')
  })
  it('does not manufacture an exemplar for a source-defined empty BPE class', () => {
    const data = { ...response(), bpe_profile_evidence: { sources, classes:
      ['acces-pied-tc', 'velo-compense', 'voiture-requise', 'inaccessible-20-minutes'].map(
        (class_key) => ({ class_key, label: class_key, count: 0, universe_count: 0, exemplar: null }),
      ) } }
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
    expect(facts.mobility.bpeAccess.profiles[0]).toMatchObject({ count: 0, exemplar: null })
  })
  it('normalizes the deployed open-ended building bucket marker to an unbounded axis', () => {
    const data = response()
    const breadth = ['0', '1-9', '10-24', '25-39', '40-53'].map((key) =>
      ({ key, label: key, min_value: 0, max_value: 10 }))
    const depth = ['0', '1-9', '10-49', '50-199', '200-499', '500+'].map((key, index) =>
      ({ key, label: key, min_value: index * 10, max_value: index === 5 ? 'NA' : index * 10 + 9 }))
    data.building_access = {
      publication_id: 'buildings-v1', availability: 'complete',
      sources: [{ ...sources[0], name: 'SQL mobility' }],
      presentation: {
        building_grid: { mode_label: 'À pied + TC', breadth_axis_label: 'types', depth_axis_label: 'équipements', breadth, depth },
        building_ramp: { modes: { b: 'Vélo', c: 'Voiture', t: 'À pied + TC' }, x_axis_label: 'Bâtiments',
          y_axis_label: 'Types', quantile_labels: Array.from({ length: 11 }, (_, index) => `${index * 10} %`) },
      },
      distribution: breadth.flatMap((breadthBucket) => depth.map((depthBucket) => ({
        breadth_bucket: breadthBucket.key, depth_bucket: depthBucket.key, total_buildings: 10,
        building_count: 1, share: 0.1,
      }))),
      ramp: ['b', 'c', 't'].flatMap((mode) => Array.from({ length: 11 }, (_, index) => ({
        mode, quantile_index: index, quantile: index / 10, accessible_types: index, total_buildings: 10,
      }))),
    }
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
    expect(facts.mobility.buildingDistribution?.depthBins.at(-1)).toMatchObject({ key: '500+', max: null })
  })
  it('matches a profile comparison only to the same detail and sex facet', () => {
    const data = response()
    data.indicators[1]!.dimensions = { detail: 't_km_1000', sex: 'F' }
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', results: [],
      profile_comparisons: [{ indicator: 'reseaux_par_habitant', facet: { detail: 't_km_1000', sex: 'F' },
        status: 'available', direction: 'high', median: 12 }] }
    expect(applyThemeComparisonApiFacts(facts, comparisons, context).mobility.indicators
      .find((fact) => fact.key === 'reseaux_par_habitant')?.comparison?.reference?.value).toBe(12)
    comparisons.profile_comparisons[0]!.facet.sex = 'M'
    expect(applyThemeComparisonApiFacts(facts, comparisons, context).mobility.indicators
      .find((fact) => fact.key === 'reseaux_par_habitant')?.comparison).toBeNull()
  })
  it('never interprets an unspecified comparison direction as more-is-better', () => {
    const facts = mobilityFactsFromThemeApi(payload, '22001', response())
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', profile_comparisons: [],
      results: [{ indicator_id: 'places_stationnement_velo_1000', status: 'available', direction: 'none', median: 12 }] }
    expect(applyThemeComparisonApiFacts(facts, comparisons, context).mobility.indicators
      .find((fact) => fact.key === 'places_stationnement_velo_1000')?.comparison).toBeNull()
  })
})

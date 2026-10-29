import { describe, expect, it } from 'vitest'
import { factsCarteDepuisLectureCohorte } from '../payload/mapSemanticAcquisition'
import type { SemanticResourceDeclaration } from '../payload/semanticResourceClient'
import type { IndicatorPageMetadata, Territoire } from '../payload/types'

const declaration = (shape: string): SemanticResourceDeclaration => ({
  resource_id: 'densite', indicator_id: 'densite', theme_id: 'demographie', label: 'Densité', unit: 'hab/km²',
  direction: 'high', allowed_levels: ['commune'], target_kinds: ['territory_cohort'], intents: ['facts'],
  shapes: [shape], sources: ['source-a'], fields: ['value'],
})
const territories = [
  { territoire: '22001', type: 'commune' as const, nom: 'A', departement: null, epci: null },
  { territoire: '22002', type: 'commune' as const, nom: 'B', departement: null, epci: null },
] as Territoire[]
const scalarPage = { family: 'scalar', unit: 'hab/km²', direction: 'high', levels: ['commune'] } as unknown as IndicatorPageMetadata

function cohort(declaration: SemanticResourceDeclaration, observations: Record<string, unknown>[]) {
  return { resource: declaration.resource_id, target: { kind: 'territory_cohort', type: 'commune' },
    shape: declaration.shapes[0], content_version: 'facts-v1', reference_content_version: 'ref-v1',
    cohort: { territory_type: 'commune', department_id: null, epci_id: null, member_count: 2,
      reference_content_version: 'ref-v1', members: [
        { id: '22001', type: 'commune', name: 'A' }, { id: '22002', type: 'commune', name: 'B' },
      ] }, observations }
}

describe('map cohort adapter', () => {
  it('adapts API scalar evidence, including zero, status, source clocks and missing members', () => {
    const resource = declaration('scalar')
    const data = { ...cohort(resource, [{ territory: { id: '22001', type: 'commune', name: 'A' },
      status: 'measured', value: 0, sources: [{ source_id: 'source-a', name: 'Source', vintage_id: 'v1',
        version: '2025', reference_date: '2025-01-01', publication_date: '2025-02-01' }] }]),
      descriptor: { indicator_id: 'densite', theme_id: 'demographie', label: 'Densité', unit: 'hab/km²',
        direction: 'high', comparison_facet: 'densite', allowed_levels: ['commune'], completeness: 'sparse',
        descriptor_version: 'descriptor-v1' } }
    const result = factsCarteDepuisLectureCohorte(resource, data, territories, [], { densite: scalarPage })
    expect(result.facts).toHaveLength(1)
    expect(result.facts[0]).toMatchObject({ territoire: '22001', value: 0, unit: 'hab/km²',
      fact_status: 'measured', vintage_version: '2025', source_id: 'source-a' })
    expect(result.identity).toMatchObject({ contentVersion: 'facts-v1', referenceContentVersion: 'ref-v1' })
  })

  it.each([
    ['wrong resource', (d: SemanticResourceDeclaration) => ({ ...cohort(d, []), resource: 'other' })],
    ['wrong reference identity', (d: SemanticResourceDeclaration) => ({ ...cohort(d, []), reference_content_version: 'stale' })],
    ['duplicate member', (d: SemanticResourceDeclaration) => ({ ...cohort(d, []), cohort: { ...cohort(d, []).cohort,
      member_count: 2, members: [{ id: '22001', type: 'commune', name: 'A' }, { id: '22001', type: 'commune', name: 'A' }] } })],
  ])('rejects %s before map admission', (_name, response) => {
    const resource = declaration('scalar')
    const data = response(resource)
    expect(() => factsCarteDepuisLectureCohorte(resource, data, territories, [], { densite: scalarPage })).toThrow()
  })

  it('adapts producer-declared numeric typed-reading parameters and provenance to story rows', () => {
    const resource = { ...declaration('typed_reading'), resource_id: 'demographie_selected_reading',
      indicator_id: 'demographie_selected_reading', fields: ['taux_solde_naturel'] }
    const base = cohort(resource, [])
    const data = { ...base, shape: 'typed_reading', territories: [{
      territory: { id: '22001', type: 'commune', name: 'A' }, facts: [{ groupe: 'growth', taux_solde_naturel: 1.25,
        source: { source_id: 'source-a', name: 'Source', vintage_id: 'v1', version: '2025',
          reference_date: null, publication_date: null } }],
    }] }
    const result = factsCarteDepuisLectureCohorte(resource, data, territories,
      [{ storyKey: 'growth', params: ['taux_solde_naturel'] }])
    expect(result.stories).toHaveLength(1)
    expect(result.stories[0]).toMatchObject({ territoire: '22001', taux_solde_naturel: 1.25,
      vintage_id: 'v1', vintage_version: '2025' })
  })

  it.each([
    ['declared profile', 'declared_profile', { descriptor: { indicator: 'densite', label: 'Profile', unit: '%',
      allowed_levels: ['commune'], completeness: 'sparse', descriptor_version: 'profile-v1',
      comparison_scalar: null, required_scalar_version: null, denominator_semantics: 'population',
      comparison_point: { detail: 'age-1', sex: 'F', direction: 'high', unit: '%' },
      axes: [{ name: 'detail', key: 'age-1', label: 'Ages', order: 0, unit: '%' },
        { name: 'sex', key: 'F', label: 'Femmes', order: 0, unit: null }] },
      profiles: [{ territory: { id: '22001', type: 'commune', name: 'A' }, cells: [
        { detail: 'age-1', sex: 'F', unit: '%', denominator_semantics: 'population', status: 'measured', value: 0,
          sources: [{ source_id: 'source-a', name: 'Source', vintage_id: 'v1', version: '2025',
            reference_date: null, publication_date: null }] }] },
        { territory: { id: '22002', type: 'commune', name: 'B' }, cells: [
          { detail: 'age-1', sex: 'F', unit: '%', denominator_semantics: 'population', status: 'measured', value: 1,
            sources: [{ source_id: 'source-a', name: 'Source', vintage_id: 'v1', version: '2025',
              reference_date: null, publication_date: null }] }] }] }],
    ['sparse collection', 'period_detail', { territories: [{ territory: { id: '22001', type: 'commune', name: 'A' },
      completeness: 'observed_sparse', availability: 'observed', entries: [{ detail: 'Agriculture',
        observation_period: '2025', status: 'measured', value: 0,
        sources: [{ source_id: 'source-a', name: 'Source', vintage_id: 'v1', version: '2025',
          reference_date: null, publication_date: null }] }] },
      { territory: { id: '22002', type: 'commune', name: 'B' }, completeness: 'observed_sparse',
        availability: 'no_record', entries: [] }], descriptor: { kind: 'period_detail', unit: 'hab/km²' } }],
  ])('maps the declared %s shape without zero/missing conflation', (_name, shape, payload) => {
    const resource = { ...declaration(shape), ...(shape === 'declared_profile'
      ? { axes: ['detail', 'sex'], axis_values: [['detail', ['age-1']], ['sex', ['F']]] as Array<[string, string[]]> }
      : {}) }
    const raw = { ...cohort(resource, []), shape, ...payload }
    const result = factsCarteDepuisLectureCohorte(resource, raw, territories)
    expect(result.facts[0]).toMatchObject({ value: 0, unit: shape === 'declared_profile' ? '%' : 'hab/km²',
      ...(shape === 'declared_profile' ? { fact_status: 'measured' } : {}) })
    expect(result.facts[0]?.dimension).toBe(shape === 'period_detail' ? '2025' : undefined)
  })
})

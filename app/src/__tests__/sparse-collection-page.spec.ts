import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireSparseCollectionFacts, periodDetailCohortFacts, reacquireSparseCollectionComparison } from '../payload/sparseCollectionPage'
import type { SemanticResourceDeclaration } from '../payload/semanticResourceClient'
import type { Territoire } from '../payload/types'

const resource = { resource_id: 'subventions_par_domaine', indicator_id: 'subventions_par_domaine',
  theme_id: 'programmes', shapes: ['period_detail'], allowed_levels: ['commune'],
  target_kinds: ['territory', 'territory_cohort'], intents: ['facts', 'selected_comparison'] } as SemanticResourceDeclaration
const source = { source_id: 'subventions_scdl', name: 'Région Bretagne', vintage_id: 'v1', version: '2025',
  reference_date: '2025-01-01', publication_date: '2025-02-01' }
const cohort = { resource: resource.resource_id, shape: 'period_detail', content_version: 'cv1',
  reference_content_version: 'rv1', descriptor: { indicator_id: resource.resource_id, kind: 'period_detail',
    unit: '€', descriptor_version: 'dv1' }, territories: [
    { territory: { id: 'c1', type: 'commune' }, completeness: 'observed_sparse', availability: 'observed',
      entries: [{ detail: 'mobility', label: 'Mobilité', observation_period: '2025', value: 0, status: 'measured', sources: [source] }] },
    { territory: { id: 'c2', type: 'commune' }, completeness: 'observed_sparse', availability: 'no_record', entries: [] },
  ] }

afterEach(() => vi.unstubAllGlobals())

describe('sparse collection indicator-page adapter', () => {
  it('keeps observed zero measured and leaves sparse no-record territories absent', () => {
    const facts = periodDetailCohortFacts(cohort, resource)
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ territoire: 'c1', detail: 'mobility', dimension: '2025', value: 0,
      vintage_source: 'Région Bretagne', vintage_version: '2025' })
    expect(facts[0]?.fact_sources?.[0]).toMatchObject({ sourceId: 'subventions_scdl', vintageId: 'v1' })
  })

  it('acquires one scoped native cohort read, not per-territory reads', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const item = JSON.parse(String(init?.body))
      expect(item.resource).toBe(resource.resource_id)
      expect(item.target).toEqual({ kind: 'territory_cohort', type: 'commune', department_id: '29', epci_id: 'e1' })
      return new Response(JSON.stringify(cohort), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await acquireSparseCollectionFacts(resource, { departmentId: '29', epciId: 'e1' })
    expect(result.periods).toEqual(['2025'])
    expect(result.identity).toEqual({ contentVersion: 'cv1', referenceContentVersion: 'rv1', descriptorVersion: 'dv1' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('retries only comparison and rejects stale or mismatched facets', async () => {
    const focal = { territoire: 'c1', type: 'commune', nom: 'Commune 1', departement: '29', epci: 'e1' } as Territoire
    const members = [focal, { ...focal, territoire: 'c2' }]
    const identity = { contentVersion: 'cv1', referenceContentVersion: 'rv1', descriptorVersion: 'dv1' }
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const item = JSON.parse(String(init?.body))
      expect(item.resource).toBe(resource.resource_id)
      expect(item.target.id).toBe('c1')
      expect(item.intent.members).toEqual([{ type: 'commune', id: 'c1' }, { type: 'commune', id: 'c2' }])
      expect(item.coordinates).toEqual({ detail: ['mobility'], period: ['2025'] })
      return new Response(JSON.stringify({ resource: resource.resource_id, content_version: 'cv1', reference_content_version: 'rv1',
        result: { descriptor_version: 'dv1', source_facet: { detail: 'mobility', observation_period: '2025' },
          status: 'available', median: 10, rank: 1, rank_size: 2 } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const comparison = await reacquireSparseCollectionComparison(resource,
      { focal, members, detail: 'mobility', period: '2025', identity })
    expect(comparison).toMatchObject({ status: 'available', median: 10, rank: 1 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ resource: resource.resource_id,
      content_version: 'new-publication', reference_content_version: 'rv1', result: {
        descriptor_version: 'dv1', source_facet: { detail: 'mobility', observation_period: '2025' },
      } }), { status: 200 }))
    await expect(reacquireSparseCollectionComparison(resource,
      { focal, members, detail: 'mobility', period: '2025', identity })).rejects.toThrow(/faits conservés/)
  })
})

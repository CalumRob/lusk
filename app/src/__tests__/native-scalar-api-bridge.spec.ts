import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chargerComparaisonsScalaires, chargerCohortePageScalaire, chargerFaitFocalPageScalaire } from '@/payload/scalarCohort'
import { validerThemeMetadata } from '@/payload/validate'
import type { ScalarComparisonRequest } from '@/payload/scalarCohort'
import type { Territoire, TerritoireType } from '@/payload/types'

type NativeCapture = {
  level: TerritoireType
  catalogue: { resources: Array<Record<string, any>> }
  territories?: Territoire[]
  cohort: { request: Record<string, any>; response_status?: number; response: Record<string, any> }
  focal: { request: Record<string, any>; response_status?: number; response: Record<string, any> }
  comparison: { request: Record<string, any>; response_status?: number; response: Record<string, any> }
}

const captures = new Map<TerritoireType, NativeCapture>([
  ['commune', JSON.parse(readFileSync(join(__dirname, 'fixtures/native-scalar-commune-api.json'), 'utf8'))],
  ['epci', JSON.parse(readFileSync(join(__dirname, 'fixtures/native-scalar-epci-api.json'), 'utf8'))],
  ['departement', JSON.parse(readFileSync(join(__dirname, 'fixtures/native-scalar-departement-api.json'), 'utf8'))],
])
const oneEligible = JSON.parse(readFileSync(join(__dirname, 'fixtures/native-scalar-commune-one-api.json'), 'utf8')) as NativeCapture
const rawMetadata = JSON.parse(readFileSync(join(process.cwd(), '..', 'public/data/theme_demographie.json'), 'utf8'))
const metadata = { ...validerThemeMetadata(rawMetadata, 'theme_demographie.json'), scalar_contracts: rawMetadata.scalar_contracts }

afterEach(() => vi.unstubAllGlobals())

function createSingleEligibleResponse(): NativeCapture {
  const wire = structuredClone(oneEligible)
  const result = wire.comparison.response.results[0].data.result
  // The original guarded capture exposed a projection mismatch: its scalar summary
  // carried rank 1/1 while its member-rank rows were null. This is the response
  // contract expected after the API projection fix, using the captured selected values.
  result.member_ranks = wire.cohort.response.results[0].data.observations.map((row: Record<string, any>) =>
    row.status === 'measured'
      ? { territory_id: row.territory.id, rank: 1, rank_size: 1, rank_ties: 1 }
      : { territory_id: row.territory.id, rank: null, rank_size: null, rank_ties: null })
  return wire
}

function createUnavailableResponse(): NativeCapture {
  const wire = structuredClone(captures.get('commune')!)
  const rows = wire.cohort.response.results[0].data.observations
  for (const row of rows) { row.status = 'suppressed'; row.value = null }
  const focal = wire.focal.response.results[0].data
  focal.status = 'suppressed'
  focal.value = null
  const result = wire.comparison.response.results[0].data.result
  Object.assign(result, { status: 'unavailable', reason: 'no_selected_comparable_values', eligible_count: 0,
    missing_count: 2, median: null, rank: null, rank_size: null, comparison_sources: [],
    member_ranks: rows.map((row: Record<string, any>) => ({ territory_id: row.territory.id,
      rank: null, rank_size: null, rank_ties: null })) })
  return wire
}

function createOutOfCohortFocalResponse(): NativeCapture {
  const wire = structuredClone(captures.get('commune')!)
  const outsideId = '22001'
  const outside: Territoire = { territoire: outsideId, type: 'commune', nom: 'Outside', departement: '22', epci: null }
  wire.territories = [
    { territoire: '29001', type: 'commune', nom: 'Focal', departement: '29', epci: null },
    { territoire: '29002', type: 'commune', nom: 'Peer', departement: '29', epci: null }, outside,
  ]
  const focalItem = wire.focal.request.items[0]
  focalItem.target.id = outsideId
  wire.focal.response_status = 404
  wire.focal.response = { detail: 'No scalar observation is published for this territory' }
  const comparison = wire.comparison
  comparison.request.items[0].target.id = outsideId
  const data = comparison.response.results[0].data
  data.target.id = outsideId
  data.result.focal_in_selection = false
  data.result.rank = null
  data.result.rank_size = null
  return wire
}

async function adaptNativeCapture(wire: NativeCapture, corruption?: 'descriptor' | 'facet') {
  const cohortData = wire.cohort.response.results[0].data
  const territories: Territoire[] = wire.territories ?? cohortData.cohort.members.map((row: { id: string; type: TerritoireType; name: string }) => ({
    territoire: row.id, type: row.type, nom: row.name,
    departement: wire.level === 'commune' ? cohortData.cohort.department_id : null, epci: null,
  }))
  const focalId = wire.focal.request.items[0].target.id
  const focal = territories.find((row) => row.territoire === focalId)!
  const comparisonResponse = structuredClone(wire.comparison.response)
  const focalResponse = structuredClone(wire.focal.response)
  if (corruption === 'descriptor') comparisonResponse.results[0].data.result.descriptor_version = 'wrong-descriptor'
  if (corruption === 'facet') focalResponse.results[0].data.comparison_facet = 'wrong-facet'

  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('/api/resources/read-batch')
    const request = JSON.parse(String(init?.body))
    const item = request.items[0]
    const captured = item.intent.kind === 'facts'
      ? item.target.kind === 'territory_cohort' ? wire.cohort : { ...wire.focal, response: focalResponse }
      : { ...wire.comparison, response: comparisonResponse }
    expect(request).toEqual(captured.request)
    return new Response(JSON.stringify(captured.response), { status: captured.response_status ?? 200 })
  })
  vi.stubGlobal('fetch', fetcher)

  const acquired = await chargerCohortePageScalaire('densite', 'demographie', metadata, focal, wire.level,
    territories, wire.level === 'commune' ? { department: cohortData.cohort.department_id } : {}, wire.catalogue.resources as any)
  const direction = acquired.contract.direction as 'high' | 'low'
  const page = { ...metadata.indicator_pages!.densite!, unit: acquired.contract.unit!, direction,
    comparison: { ...metadata.indicator_pages!.densite!.comparison!, indicator: 'densite', unit: acquired.contract.unit!,
      direction } }
  const cohortMembers = cohortData.cohort.members.map((row: { id: string; type: TerritoireType }) => ({ type: row.type, id: row.id }))
  const request: ScalarComparisonRequest = wire.level === 'commune'
    ? { kind: 'selected', members: cohortMembers,
      scope: { kind: 'explicit_selection', territoryType: wire.level, memberCount: cohortMembers.length, label: 'Selected communes' } }
    : { kind: 'fixed', scope: { kind: 'same_level', territoryType: wire.level, memberCount: territories.length, label: 'Same level' } }
  const comparisons = await chargerComparaisonsScalaires(['densite'], 'demographie', { densite: page }, focal,
    territories, request, acquired.identity, true, wire.catalogue.resources as any)
  const focalFact = await chargerFaitFocalPageScalaire(acquired.declaration, 'densite', 'demographie', metadata,
    focal, territories, acquired.identity, acquired.contract)
  return { acquired, comparisons: comparisons.densite, focalFact, fetcher, expected: wire.comparison.response.results[0].data.result }
}

describe('guarded native scalar HTTP → application adapter bridge', () => {
  it.each(['commune', 'epci', 'departement'] as TerritoireType[])('%s source responses cross the real page adapters unchanged', async (level) => {
    const wire = captures.get(level)!
    const result = await adaptNativeCapture(wire)
    expect(result.acquired.facts).toHaveLength(2)
    expect(result.acquired.contract.unit).toBe('hab/km²')
    expect(result.comparisons?.median).toBe(result.expected.median)
    expect(result.comparisons?.memberRanks).toEqual(result.expected.member_ranks.map((row: Record<string, unknown>) => ({
      territoryId: row.territory_id, rank: row.rank, rankSize: row.rank_size, rankTies: row.rank_ties,
    })))
    expect(result.focalFact?.value).toBe(100)
    expect(result.focalFact?.fact_sources?.[0]?.sourceId).toBe(result.acquired.facts[0]?.fact_sources?.[0]?.sourceId)
    expect(result.fetcher).toHaveBeenCalledTimes(3)
  })

  it('retains a native rank and median when exactly one selected value is eligible', async () => {
    await expect(adaptNativeCapture(oneEligible)).rejects.toThrow()
    const result = await adaptNativeCapture(createSingleEligibleResponse())
    expect(result.expected.eligible_count).toBe(1)
    expect(result.expected.median).toBe(100)
    expect(result.comparisons?.rank).toBe(1)
    expect(result.comparisons?.rankSize).toBe(1)
    expect(result.comparisons?.memberRanks.find((row) => row.territoryId === '29001')).toMatchObject({
      rank: 1, rankSize: 1, rankTies: 1,
    })
  })

  it('adapts a native zero-eligible comparison and keeps its suppressed focal status', async () => {
    const result = await adaptNativeCapture(createUnavailableResponse())
    expect(result.comparisons).toMatchObject({ status: 'unavailable', eligibleCount: 0, missingCount: 2, median: null,
      focalInSelection: true, rank: null, rankSize: null })
    expect(result.comparisons?.memberRanks.every((row) => row.rank === null && row.rankSize === null)).toBe(true)
    expect(result.focalFact).toMatchObject({ fact_status: 'suppressed', value: null })
  })

  it('keeps a filtered-cohort focal outside the native selected comparison unranked', async () => {
    const result = await adaptNativeCapture(createOutOfCohortFocalResponse())
    expect(result.comparisons).toMatchObject({ status: 'available', eligibleCount: 2, focalInSelection: false,
      rank: null, rankSize: null })
    expect(result.focalFact).toBeNull()
    expect(result.fetcher).toHaveBeenCalledTimes(3)
  })

  it('rejects a comparison whose producer descriptor changed after cohort acquisition', async () => {
    await expect(adaptNativeCapture(captures.get('commune')!, 'descriptor')).rejects.toThrow()
  })

  it('rejects focal facts whose comparison facet differs from the acquired descriptor', async () => {
    await expect(adaptNativeCapture(captures.get('commune')!, 'facet')).rejects.toThrow()
  })
})

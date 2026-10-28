import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createOrderedSeriesSemanticSession } from '@/payload/seriesSemanticAcquisition'
import { nativeBatchResponse, nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'

afterEach(() => vi.unstubAllGlobals())

describe('dual ordered-series pooled-facet admission', () => {
  it('admits native scalar statuses with null values and caches a valid pooled comparison', async () => {
    const territories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const focal = territories.find((territory) => territory.territoire === '22001' && territory.type === 'commune')
    expect(focal).toBeDefined()
    const resource = nativeResources().find((candidate) => candidate.resource_id === 'prix_m2')
    expect(resource).toBeDefined()
    let cohortResponse: Record<string, any> | undefined
    const fetcher = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      const { items } = JSON.parse(String(init?.body))
      const response = await nativeBatchResponse(items, (item, declaration) =>
        nativeReadFixture(item, declaration, { territories }))
      cohortResponse = (await response.clone().json()).results
        .map((result: Record<string, any>) => result.data)
        .find((data: Record<string, any>) => data.target.kind === 'territory_cohort')
      return response
    })
    vi.stubGlobal('fetch', fetcher)

    const session = createOrderedSeriesSemanticSession()
    const input = { resource: 'prix_m2', level: 'commune' as const, focal: focal!, territories,
      departmentId: '22', includeScalarFacet: true }
    const acquired = await session.acquire(input)
    const revisited = await session.acquire(input)

    expect(cohortResponse?.scalar_facet.observations.some((observation: Record<string, any>) =>
      observation.status === 'suppressed' && observation.value === null)).toBe(true)
    expect(acquired.scalar_facet?.comparison?.result.status).toBe('available')
    expect(revisited.scalar_facet?.comparison).toEqual(acquired.scalar_facet?.comparison)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

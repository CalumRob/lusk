import { describe, it, vi } from 'vitest'
import { acquireOrderedSeriesSemantic } from '../payload/seriesSemanticAcquisition'
import { nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture } from './helpers/semanticApiFixtures'
import { territoiresFixture } from '../payload/fixtures'

describe('probe artif epci', () => {
  it('dumps the rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, nativeReadFixture)
    }))
    const focal = territoiresFixture.find((territory) => territory.type === 'epci' && territory.territoire === '200000001')!
      ?? territoiresFixture.find((territory) => territory.type === 'epci')!
    console.log('focal:', focal?.territoire)
    try {
      const read = await acquireOrderedSeriesSemantic({ resource: 'artif_par_habitant', level: 'epci',
        focal, territories: territoiresFixture })
      console.log('OK artif epci points:', read.points.length, 'axes:',
        read.comparison?.axis_comparisons?.map((row) => [row.axis, row.status, row.value]))
    } catch (cause) {
      console.log('REJECTED artif epci:', cause instanceof Error
        ? `${cause.message} :: ${cause.stack?.split('\n')[1]?.trim()}` : String(cause))
    }
    // Dump one cohort member's provenance + the declared set.
    const batch = await nativeBatchResponse([
      { id: 'scalar-0-artif_par_habitant', resource: 'artif_par_habitant',
        target: { kind: 'territory_cohort', type: 'epci' }, intent: { kind: 'facts' }, fields: ['value'] },
    ], nativeReadFixture)
    const raw = await batch.json()
    const cohort = raw.results[0].data
    const member = cohort.series.find((group: any) => group.territory.id === '242900744')
    console.log('member found:', Boolean(member), 'points:', member?.points?.length)
    console.log('member point 0 provenance:', JSON.stringify(member?.points?.[0]?.provenance))
    const allSources = [...new Set(cohort.series.flatMap((group: any) =>
      group.points.flatMap((point: any) => point.provenance.map((revision: any) => revision.source_id))))]
    console.log('declared sources sample:', JSON.stringify(allSources.slice(0, 4)), 'n=', allSources.length)
    vi.unstubAllGlobals()
  })
})

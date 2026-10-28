import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { join } from 'node:path'
import { acquireOrderedSeriesSemantic, reacquireOrderedSeriesComparison }
  from '@/payload/seriesSemanticAcquisition'
import { createOrderedSeriesSemanticSession, SeriesComparisonRejectedError }
  from '@/payload/seriesSemanticAcquisition'
import { orderedSeriesFacts } from '@/payload/orderedSeriesAdapter'
import type { Territoire } from '@/payload/types'
import { dispatchIndicatorFamily } from '@/indicateurs/familySeam'
import { modeleTrajectoire } from '@/indicateurs/explorationModel'
import { validerThemeMetadata } from '@/payload/validate'
import TrajectoryFamilyRenderer from '@/components/indicateurs/TrajectoryFamilyRenderer.vue'

const capturePaths = (process.env.LUSK_NATIVE_SERIES_FAMILY_CAPTURES ?? '').split(';').filter(Boolean)
afterEach(() => vi.unstubAllGlobals())

function admittedContentVersion(read: unknown): string {
  if (typeof read !== 'object' || read === null || !('content_version' in read) ||
      typeof read.content_version !== 'string') {
    throw new Error('Expected the admitted ordered-series read to carry its native content version')
  }
  return read.content_version
}

/** One captured SQL/HTTP batch served verbatim, optionally with one wire field
 *  corrupted, exactly as the guarded capture test wrote it to disk. The
 *  comparison-only re-acquisition (a single-item request) is served from the
 *  same captured comparison evidence. */
function serveBridge(bridge: { request: { items: any[] }; response: any; response_status: number },
  mutate?: (data: unknown[]) => void) {
  const wire = structuredClone(bridge)
  const data = (wire.response as { results: Array<{ data: unknown }> }).results
    .map((result) => result.data)
  mutate?.(data)
  const comparisonIndex = wire.request.items.findIndex((item: any) => item.intent?.kind !== 'facts')
  return vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    expect(String(path)).toBe('/api/resources/read-batch')
    const body = JSON.parse(String(init?.body))
    if (body.items.length === wire.request.items.length) {
      expect(body).toEqual(wire.request)
      return Response.json(wire.response, { status: wire.response_status })
    }
    expect(body.items).toHaveLength(1)
    const requested = body.items[0]
    const expected = wire.request.items[comparisonIndex]
    expect(requested).toEqual({ ...expected, id: requested.id })
    return Response.json({ contract: 'semantic-read-batch-v1',
      results: [{ id: requested.id, resource: requested.resource, data: data[comparisonIndex] }] },
      { status: 200 })
  })
}

describe('guarded native SQL/HTTP → shared ordered-series acquisition bridge', () => {
  it('native bridge coverage requires the documented guarded capture invocation (app/README.md); an empty environment is not coverage', () => {
    // This default-suite guard is deliberately NOT counted as native coverage:
    // the maintained invocation is `npm run verify:series-native-bridge`, which
    // produces fresh guarded SQL/HTTP captures and runs every test in this file
    // against them with an explicit exact-head report.
    expect(capturePaths.every((path) => path.length > 0)).toBe(true)
  })

  for (const path of capturePaths) {
    const capturedResource = JSON.parse(readFileSync(path, 'utf8')).application_bridge.request.items[0].resource
    if (capturedResource === 'prix_m2') {
      it('native HTTP price page projection contains pooled median, population, focal rank and ties', () => {
        const capture = JSON.parse(readFileSync(path, 'utf8'))
        const page = capture.application_page
        expect(page.response_status).toBe(200)
        expect(page.request.items[2].fields).toEqual(['axis_comparisons', 'scalar_facet', 'median', 'rank',
          'rank_size', 'rank_ties', 'selected_member_count', 'eligible_count', 'missing_count', 'member_ranks'])
        const data = page.response.results.find((result: any) => result.id === page.request.items[2].id).data
        const scalar = data.scalar_facet
        expect(scalar).toMatchObject({ shape: 'scalar', source_facet: 'prix_m2',
          content_version: 'native-pooled', reference_content_version: 'native-ref',
          descriptor_version: 'pooled-desc', selection: [
          { territory_type: 'commune', territory_id: 'native-c1' },
          { territory_type: 'commune', territory_id: 'native-c2' },
            { territory_type: 'commune', territory_id: 'native-c4' },
          ], scope: { member_count: 3 }, result: {
            indicator_id: 'prix_m2', source_facet: 'prix_m2', descriptor_version: 'pooled-desc',
            statistic: 'median', status: 'available', median: 987, selected_member_count: 3,
            eligible_count: 2, missing_count: 1, rank: 1, rank_size: 2, rank_ties: 2,
            member_ranks: [
              { territory_id: 'native-c1', rank: 1, rank_size: 2, rank_ties: 2 },
              { territory_id: 'native-c2', rank: 1, rank_size: 2, rank_ties: 2 },
              { territory_id: 'native-c4', rank: null, rank_size: null, rank_ties: null },
            ],
          } })
        expect(scalar.result).not.toHaveProperty('focal_value')
        const ordered = page.response.results.find((result: any) => result.id === page.request.items[0].id).data
        expect(ordered.content_version).toBe('native-series')
        expect(scalar.content_version).not.toBe(ordered.content_version)
      })

      it('the real shared page adapter consumes the captured pooled median/ranks without annual substitution', async () => {
        const capture = JSON.parse(readFileSync(path, 'utf8'))
        const bridge = capture.application_page
        const resource = 'prix_m2'
        const focal = capture.territories.find((territory: Territoire) =>
          territory.territoire === 'native-c1' && territory.type === 'commune') as Territoire
        const fetcher = serveBridge(bridge)
        vi.stubGlobal('fetch', fetcher)
        const read = await acquireOrderedSeriesSemantic({ resource, level: 'commune', focal,
          territories: capture.territories as Territoire[], departmentId: '35', includeScalarFacet: true })
        expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(bridge.request)
        expect(read.scalar_facet?.comparison?.result).toMatchObject({ statistic: 'median', status: 'available',
          median: 987, selected_member_count: 3, eligible_count: 2, missing_count: 1, rank: 1,
          rank_size: 2, rank_ties: 2, member_ranks: [
            { territory_id: 'native-c1', rank: 1, rank_size: 2, rank_ties: 2 },
            { territory_id: 'native-c2', rank: 1, rank_size: 2, rank_ties: 2 },
            { territory_id: 'native-c4', rank: null, rank_size: null, rank_ties: null },
          ] })
        const pageFacts = orderedSeriesFacts(read, 'habitat', capture.territories as Territoire[])
        expect(pageFacts.find((fact) => fact.territoire === 'native-c1' && fact.detail === null))
          .toMatchObject({ value: 987, native_scalar_comparison: {
            status: 'available', statistic: 'median', value: 987, eligible_count: 2, missing_count: 1,
            rank: 1, rank_size: 2, rank_ties: 2,
          } })
        const nativeAnnualPoints = bridge.response.results[0].data.series
          .find((group: any) => group.territory.id === 'native-c1').points
          .filter((point: any) => point.status === 'measured').map((point: any) => point.value)
        const pageAnnualPoints = pageFacts.filter((fact) => fact.territoire === 'native-c1' && fact.detail !== null)
          .map((fact) => fact.value)
        expect(pageAnnualPoints).toEqual(nativeAnnualPoints)
        expect(pageAnnualPoints).not.toContain(987)
      })

      it('rejects corrupt pooled comparison evidence, retains native facts, and recovers by comparison-only retry', async () => {
        const capture = JSON.parse(readFileSync(path, 'utf8'))
        const bridge = capture.application_page
        const resource = 'prix_m2'
        const focal = capture.territories.find((territory: Territoire) =>
          territory.territoire === 'native-c1' && territory.type === 'commune') as Territoire
        const input = { resource, level: 'commune' as const, focal,
          territories: capture.territories as Territoire[], departmentId: '35', includeScalarFacet: true }
        const corruptions: Array<[string, (data: any[]) => void]> = [
          ['missing median', (data) => { delete data[2].scalar_facet.result.median }],
          ['missing scalar content identity', (data) => { data[2].scalar_facet.content_version = '' }],
          ['scalar reference identity', (data) => { data[2].scalar_facet.reference_content_version = 'wrong-pooled-ref' }],
          ['scalar descriptor identity', (data) => { data[2].scalar_facet.descriptor_version = 'wrong-pooled-descriptor' }],
          ['selection identity', (data) => { data[2].scalar_facet.selection[0].territory_id = 'not-selected' }],
          ['population counts', (data) => { data[2].scalar_facet.result.missing_count = 0 }],
          ['available status/value mismatch', (data) => {
            data[2].scalar_facet.result.status = 'unavailable'
            data[2].scalar_facet.result.reason = 'fixture_unavailable'
          }],
          ['peer outside population', (data) => {
            data[2].scalar_facet.result.member_ranks[0].territory_id = 'not-selected'
          }],
          ['duplicate peer identity', (data) => {
            data[2].scalar_facet.result.member_ranks[1].territory_id = 'native-c1'
          }],
          ['impossible peer tie bound', (data) => {
            data[2].scalar_facet.result.member_ranks[0].rank_ties = 3
          }],
          ['inconsistent tie group cardinality', (data) => {
            data[2].scalar_facet.result.member_ranks[0].rank_ties = 1
            data[2].scalar_facet.result.member_ranks[1].rank_ties = 1
            data[2].scalar_facet.result.rank_ties = 1
          }],
          ['undeclared scalar comparison provenance', (data) => {
            data[2].scalar_facet.result.comparison_sources[0].source_id = 'undeclared-source'
          }],
        ]

        for (const [label, corrupt] of corruptions) {
          const invalid = structuredClone(bridge)
          const invalidData = invalid.response.results.map((result: any) => result.data)
          corrupt(invalidData)
          const validData = bridge.response.results.map((result: any) => result.data)
          const fetcher = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
            const request = JSON.parse(String(init?.body))
            if (fetcher.mock.calls.length === 1) {
              expect(request).toEqual(bridge.request)
              return Response.json(invalid.response, { status: invalid.response_status })
            }
            expect(request.items).toHaveLength(1)
            expect(request.items[0]).toEqual({ ...bridge.request.items[2], id: request.items[0].id })
            return Response.json({ contract: 'semantic-read-batch-v1', results: [{
              id: request.items[0].id, resource, data: validData[2],
            }] }, { status: 200 })
          })
          vi.stubGlobal('fetch', fetcher)
          const session = createOrderedSeriesSemanticSession()
          let rejected: unknown
          try { await session.acquire(input) } catch (cause) { rejected = cause }
          expect(rejected, label).toBeInstanceOf(SeriesComparisonRejectedError)
          const admitted = (rejected as SeriesComparisonRejectedError).facts
          expect(admitted.scope_series.length, `${label}: annual facts remain admitted`).toBeGreaterThan(0)
          expect(admitted.scalar_facet?.cohort, `${label}: pooled scalar facts remain admitted`).toBeDefined()
          expect(admitted.scalar_facet?.focal, `${label}: exact focal scalar facts remain admitted`).toBeDefined()
          expect(admitted.scalar_facet?.comparison, `${label}: corrupt comparison is never admitted`).toBeUndefined()

          const recovered = await session.acquire(input)
          expect(fetcher).toHaveBeenCalledTimes(2)
          expect(recovered.scalar_facet?.comparison?.result).toMatchObject({
            status: 'available', statistic: 'median', median: 987, selected_member_count: 3,
            eligible_count: 2, missing_count: 1, rank: 1, rank_size: 2, rank_ties: 2,
          })
          const retryItems = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).items
          expect(retryItems).toHaveLength(1)
          expect(retryItems[0].intent.kind).toBe('selected_comparison')
          expect(retryItems[0].fields).toEqual(bridge.request.items[2].fields)
        }
      })
    }
    it(`passes the captured ${path.split(/[\\/]/).at(-1)} batch through the real app adapter`, async () => {
      const capture = JSON.parse(readFileSync(path, 'utf8'))
      const bridge = capture.application_bridge
      expect(bridge.response_status).toBe(200)
      const resource = bridge.request.items[0].resource as string
      const declaration = capture.catalogue.resources.find((item: any) => item.resource_id === resource)
      const fetcher = serveBridge(bridge)
      vi.stubGlobal('fetch', fetcher)
      const cohortTarget = bridge.request.items[0].target
      const focalTarget = bridge.request.items[1].target
      const focal = capture.territories.find((territory: Territoire) =>
        territory.territoire === focalTarget.id && territory.type === focalTarget.type)
      expect(focal).toBeDefined()
      const read = await acquireOrderedSeriesSemantic({ resource, level: focalTarget.type,
        focal: focal as Territoire, territories: capture.territories as Territoire[],
        ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
        ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
        includeScalarFacet: declaration.shapes.includes('scalar') })
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(read.points.length).toBeGreaterThan(0)
      expect(read.comparison?.axis_comparisons?.length).toBeGreaterThan(0)
      // The cohort's requested projection carries measured annual values.
      for (const group of read.scope_series ?? []) {
        for (const point of group.points) {
          if (point.status === 'measured') {
            expect(Number.isFinite(point.value),
              `measured ${resource} point ${point.axis}/${group.territory.id} must carry its native value`).toBe(true)
          }
        }
      }
      const facts = orderedSeriesFacts(read, declaration.theme_id, capture.territories as Territoire[])
      expect(facts.some((fact) => fact.territoire === focal?.territoire && fact.detail !== null)).toBe(true)
      if (resource === 'prix_m2') {
        expect(read.scope_series?.map((group) => group.territory.id)).toEqual(['native-c1', 'native-c2'])
        expect(facts.some((fact) => fact.territoire === 'native-c1' && fact.detail === null && fact.value === 987)).toBe(true)
        expect(facts.some((fact) => fact.territoire === 'native-c3' && fact.detail === null && fact.value === 987)).toBe(true)
        // The pooled facet stays independent of the measured annual peers.
        const annualValues = read.scope_series!.flatMap((group) => group.points)
          .filter((point) => point.status === 'measured').map((point) => point.value as number)
        expect(annualValues.every((value) => value !== 987)).toBe(true)
      }
      if (resource === 'artif_par_habitant') {
        expect(read.comparison?.axis_comparisons?.map((row) => row.axis)).toEqual(['M2', 'M3'])
        expect(read.comparison?.axis_comparisons?.map((row) => row.value)).toEqual([150, 180])
        const metadata = validerThemeMetadata(JSON.parse(readFileSync(join(process.cwd(),
          '../pipeline/inst/extdata/theme-metadata/theme_milieux.json'), 'utf8')), 'theme_milieux.json')
        const page = metadata.indicator_pages!.artif_par_habitant!
        expect(page.family).toBe('trajectory')
        if (page.family !== 'trajectory') throw new Error('OCS-GE page is not a trajectory')
        const roles = read.comparison?.axis_comparisons?.map((row) => row.axis) ?? []
        const restricted = { ...page, comparison: { ...page.comparison, details: roles, detail: roles.at(-1) } }
        const dispatch = dispatchIndicatorFamily(restricted, { theme: 'milieux', facts,
          territories: capture.territories, selected: focal!.territoire, facet: { detail: '2023' } })
        if (dispatch.family !== 'trajectory') throw new Error('Native OCS-GE UI did not select trajectory renderer')
        expect(dispatch.facet.valid).toBe(false)
        expect(dispatch.facet.detail).toBe('M3')
        const model = modeleTrajectoire(facts, dispatch.facet, restricted.trajectory.endpoints,
          capture.territories, { niveau: focal!.type, territoire: focal!.territoire }, [], null,
          { nativeSeries: true, nativeAxisComparisons: read.comparison?.axis_comparisons })
        const calendar = model.etapes.find((step) => step.detail === '2023')
        expect(model.serieTerritoire?.find((point) => point.detail === '2023')?.value).toBe(120)
        expect(calendar).toMatchObject({ mediane: null, min: null, max: null, comparisonSupported: false })
        expect(model.etapes.find((step) => step.detail === 'M3')?.mediane).toBe(180)
        const mounted = mount(TrajectoryFamilyRenderer, { props: { dispatch, modele: model } })
        expect(mounted.get('[data-detail="2023"][data-value="120"]').attributes('data-value')).toBe('120')
        expect(mounted.get('[data-etape="2023"]').attributes('data-etat')).toBe('sans-valeur')
        expect(mounted.get('[data-etape="M3"]').attributes('data-etat')).toBe('valeurs')
        expect(mounted.text()).toContain('Comparaison non publiée pour')
        mounted.unmount()
      }
      // The comparison-only re-acquisition revalidates against the admitted
      // facts with a single bounded read.
      const refetcher = serveBridge(bridge)
      vi.stubGlobal('fetch', refetcher)
      const comparison = await reacquireOrderedSeriesComparison({ resource, level: focalTarget.type,
        focal: focal as Territoire, territories: capture.territories as Territoire[],
        ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
        ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
        includeScalarFacet: declaration.shapes.includes('scalar'),
        facts: read as unknown as never })
      expect((comparison as { axis_comparisons?: unknown[] }).axis_comparisons).toEqual(
        read.comparison?.axis_comparisons)
      if (resource === 'prix_m2') {
        const wrongFacetPublication = serveBridge(bridge, (data) => {
          ;(data[2] as { scalar_facet: { content_version: string } }).scalar_facet.content_version =
            'unrelated-pooled-publication'
        })
        vi.stubGlobal('fetch', wrongFacetPublication)
        let facetRejection: unknown
        try { await acquireOrderedSeriesSemantic({ resource, level: focalTarget.type,
          focal: focal as Territoire, territories: capture.territories as Territoire[],
          ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
          ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
          includeScalarFacet: true }) } catch (cause) { facetRejection = cause }
        expect(facetRejection).toBeInstanceOf(SeriesComparisonRejectedError)
        const facetRejected = (facetRejection as SeriesComparisonRejectedError).facts
        expect(facetRejected.scope_series).toEqual(read.scope_series)
        expect(facetRejected.scalar_facet?.cohort).toBeDefined()
        expect(facetRejected.scalar_facet?.focal).toBeDefined()
        expect(facetRejected.scalar_facet?.comparison).toBeUndefined()
      }
    })

    if (capturedResource !== 'raccordement_courbe') {
    it(`keeps warm ${path.split(/[\\/]/).at(-1)} cohort/focal/comparison admissions in the page session`, async () => {
      const capture = JSON.parse(readFileSync(path, 'utf8'))
      const bridge = capture.application_bridge
      const resource = bridge.request.items[0].resource as string
      const declaration = capture.catalogue.resources.find((item: any) => item.resource_id === resource)
      const cohortTarget = bridge.request.items[0].target
      const focalTarget = bridge.request.items[1].target
      const focal = capture.territories.find((territory: Territoire) =>
        territory.territoire === focalTarget.id && territory.type === focalTarget.type)
      const fetcher = serveBridge(bridge)
      vi.stubGlobal('fetch', fetcher)
      const session = createOrderedSeriesSemanticSession()
      const input = { resource, level: focalTarget.type, focal: focal as Territoire,
        territories: capture.territories as Territoire[],
        ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
        ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
        includeScalarFacet: declaration.shapes.includes('scalar') }

      const admitted = await session.acquire(input)
      const revisited = await session.acquire(input)

      expect(admitted.points.length).toBeGreaterThan(0)
      expect(revisited.points).toEqual(admitted.points)
      expect(revisited.scope_series).toEqual(admitted.scope_series)
      if (resource === 'prix_m2') {
        expect(admitted.scalar_facet?.cohort).toBeDefined()
        expect(admitted.scalar_facet?.focal).toBeDefined()
        expect(admitted.scalar_facet?.comparison).toEqual(bridge.response.results[2]?.data.scalar_facet)
      }
      expect(fetcher).toHaveBeenCalledTimes(1)
      const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
      expect(request.items).toHaveLength(3)
      expect(request.items.filter((item: any) => item.intent.kind === 'facts')).toHaveLength(2)
      expect(request.items.filter((item: any) => item.intent.kind !== 'facts')).toHaveLength(1)
      session.clearCohort(input)
      const refreshed = await session.acquire(input)
      expect(refreshed.points).toEqual(admitted.points)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).items).toHaveLength(3)
    })

    if (capturedResource !== 'raccordement_courbe') {
      it(`fences a late native ${path.split(/[\\/]/).at(-1)} reply after scoped refresh`, async () => {
        const capture = JSON.parse(readFileSync(path, 'utf8'))
        const bridge = capture.application_bridge
        const resource = bridge.request.items[0].resource as string
        const declaration = capture.catalogue.resources.find((item: any) =>
          item.resource_id === resource)
        const cohortTarget = bridge.request.items[0].target
        const focalTarget = bridge.request.items[1].target
        const focal = capture.territories.find((territory: Territoire) =>
          territory.territoire === focalTarget.id && territory.type === focalTarget.type)
        const input = { resource, level: focalTarget.type, focal: focal as Territoire,
          territories: capture.territories as Territoire[],
          ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
          ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
          includeScalarFacet: declaration.shapes.includes('scalar') }
        let releaseOld!: (response: Response) => void
        const oldResponse = new Promise<Response>((resolve) => { releaseOld = resolve })
        const refreshed = structuredClone(bridge.response)
        for (const result of refreshed.results) {
          if (result.data?.content_version) result.data.content_version = 'native-series-refresh-v2'
          if (result.data?.publication_id) result.data.publication_id = 'native-series-refresh-v2'
        }
        const fetcher = vi.fn(async () => fetcher.mock.calls.length === 1
          ? oldResponse : Response.json(refreshed, { status: bridge.response_status }))
        vi.stubGlobal('fetch', fetcher)
        const session = createOrderedSeriesSemanticSession()
        const late = session.acquire(input)
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
        const current = await session.refresh(input)
        expect(admittedContentVersion(current)).toBe('native-series-refresh-v2')
        releaseOld(Response.json(bridge.response, { status: bridge.response_status }))
        await late
        const cached = await session.acquire(input)
        expect(admittedContentVersion(cached)).toBe('native-series-refresh-v2')
        expect(cached.points).toEqual(current.points)
        expect(fetcher).toHaveBeenCalledTimes(2)
      })
    }

    it(`does not admit ${path.split(/[\\/]/).at(-1)} facts from a cold whole-batch 503`, async () => {
      const capture = JSON.parse(readFileSync(path, 'utf8'))
      const bridge = capture.application_bridge
      const resource = bridge.request.items[0].resource as string
      const declaration = capture.catalogue.resources.find((item: any) => item.resource_id === resource)
      const cohortTarget = bridge.request.items[0].target
      const focalTarget = bridge.request.items[1].target
      const focal = capture.territories.find((territory: Territoire) =>
        territory.territoire === focalTarget.id && territory.type === focalTarget.type)
      const session = createOrderedSeriesSemanticSession()
      const requests: any[] = []
      vi.stubGlobal('fetch', vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body))
        requests.push(body)
        expect(body).toEqual(bridge.request)
        if (requests.length === 1) return new Response('native read-batch unavailable', { status: 503 })
        return Response.json(bridge.response, { status: bridge.response_status })
      }))
      const input = { resource, level: focalTarget.type, focal: focal as Territoire,
        territories: capture.territories as Territoire[],
        ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
        ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
        includeScalarFacet: declaration.shapes.includes('scalar') }

      await expect(session.acquire(input)).rejects.toThrow()
      const recovered = await session.acquire(input)

      expect(recovered.points.length).toBeGreaterThan(0)
      expect(requests).toHaveLength(2)
      expect(requests.map((body) => body.items)).toHaveLength(2)
      expect(requests.every((body) => body.items.length === 3)).toBe(true)
    })
    }
  }
})

const conditionalDescribe = capturePaths.length ? describe : describe.skip
conditionalDescribe('guarded native corrupt-evidence rejection → shared series acquirer', () => {
  const other = (statistic: string) => statistic === 'mean' ? 'median' : 'mean'
  const mutations: Array<[string, (data: any[]) => void,
    (bridge: { request: { items: any[] }; response: { results: Array<{ data: any }> } }) => boolean]> = [
    ['comparison reference publication', (data) => { data[2].reference_content_version = 'other-reference' }, () => true],
    ['comparison facts publication', (data) => { data[2].content_version = 'other-series' }, () => true],
    ['comparison resource identity', (data) => { data[2].resource = 'other-resource' }, () => true],
    ['comparison result indicator identity', (data) => { data[2].result.indicator_id = 'other-indicator' }, () => true],
    ['comparison target identity', (data) => { data[2].target.id = 'native-c1' }, () => true],
    ['comparison target type', (data) => {
      data[2].target.type = data[2].target.type === 'commune' ? 'epci' : 'commune'
    }, () => true],
    ['comparison descriptor version', (data) => { data[2].result.descriptor_version = 'other-descriptor' }, () => true],
    ['comparison typed selection echo', (data) => { data[2].selection[0].territory_id = 'wrong-selected-member' },
      (bridge) => bridge.request.items[2]?.intent?.kind === 'selected_comparison'],
    ['comparison resolved scope count', (data) => { data[2].scope.member_count = 999 }, () => true],
    ['comparison typed scope echo', (data) => { data[2].scope.territory_type = 'commune' },
      (bridge) => Boolean(bridge.request.items[2]?.intent?.kind === 'fixed_comparison' &&
        bridge.response.results[2]?.data?.scope?.territory_type)],
    ['comparison statistic', (data) => { data[2].result.statistic = other(data[2].result.statistic) }, () => true],
    ['comparison peer membership', (data) => { data[2].result.axis_comparisons[0].member_ranks[0].territory_id = 'wrong-ranked-member' }, () => true],
    ['comparison peer outside requested population', (data) => {
      data[2].result.axis_comparisons[0].member_ranks[0].territory_id = 'native-c3'
    }, (bridge) => bridge.request.items[2]?.intent?.kind === 'selected_comparison'],
    ['impossible peer rank', (data) => { data[2].result.axis_comparisons[0].member_ranks[0].rank = 999 }, () => true],
    ['focal descriptor version', (data) => { data[1].descriptor_version = 'other-focal-descriptor' }, () => true],
    ['focal provenance identity', (data) => { data[1].points[0].provenance[0].source_id = 'undeclared-producer' }, () => true],
    ['resolved cohort filter echo', (data) => { data[0].cohort.department_id = '22' }, () => true],
    ['resolved cohort reference identity', (data) => {
      data[0].cohort.reference_content_version = 'other-reference'
    }, () => true],
    ['measured point without value', (data) => { delete data[0].series[0].points[0].value }, () => true],
  ]

  for (const path of capturePaths) {
    const capture = JSON.parse(readFileSync(path, 'utf8'))
    const bridge = capture.application_bridge
    const resource = bridge.request.items[0].resource as string
    const cohortTarget = bridge.request.items[0].target
    const focalTarget = bridge.request.items[1].target
    const declaration = capture.catalogue.resources.find((item: any) => item.resource_id === resource)
    const focal = capture.territories.find((territory: Territoire) =>
      territory.territoire === focalTarget.id && territory.type === focalTarget.type)
    const applicable = mutations.filter(([, , applies]) => applies(bridge))
    it(`rejects each corrupt wire field of ${resource} before admitting the read`, async () => {
      // The selection echo applies only to selected-comparison captures.
      expect(applicable.length).toBeGreaterThanOrEqual(10)
      for (const [, mutate] of applicable) {
        const fetcher = serveBridge(bridge, mutate)
        vi.stubGlobal('fetch', fetcher)
        try {
          await expect(acquireOrderedSeriesSemantic({ resource, level: focalTarget.type,
            focal: focal as Territoire, territories: capture.territories as Territoire[],
            ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
            ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
            includeScalarFacet: declaration.shapes.includes('scalar') }))
            .rejects.toThrow()
        } finally {
          vi.unstubAllGlobals()
        }
      }
    })
    it(`a comparison-only rejection of ${resource} keeps the validated facts reacquirable`, async () => {
      const fetcher = serveBridge(bridge)
      vi.stubGlobal('fetch', fetcher)
      const read = await acquireOrderedSeriesSemantic({ resource, level: focalTarget.type,
        focal: focal as Territoire, territories: capture.territories as Territoire[],
        ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
        ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
        includeScalarFacet: declaration.shapes.includes('scalar') })
      expect(read.points.length).toBeGreaterThan(0)
      const otherFocal = (capture.territories as Territoire[]).find((territory) =>
        territory.type === focalTarget.type && territory.territoire !== focalTarget.id)
      if (otherFocal) {
        const shouldNotFetch = serveBridge(bridge)
        vi.stubGlobal('fetch', shouldNotFetch)
        await expect(reacquireOrderedSeriesComparison({ resource, level: focalTarget.type,
          focal: otherFocal, territories: capture.territories as Territoire[],
          ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
          ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
          includeScalarFacet: declaration.shapes.includes('scalar'), facts: read as never })).rejects.toThrow()
        expect(shouldNotFetch).not.toHaveBeenCalled()
      }
      // A wrong target on retry must be rejected too; the same-publication
      // valid retry then proves that neither rejection was cached.
      const corruptTarget = (data: unknown[]) => {
        ;(data[2] as { target: { id: string } }).target.id = 'native-c1'
      }
      const badRefetcher = serveBridge(bridge, corruptTarget)
      vi.stubGlobal('fetch', badRefetcher)
      await expect(reacquireOrderedSeriesComparison({ resource, level: focalTarget.type,
        focal: focal as Territoire, territories: capture.territories as Territoire[],
        ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
        ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
        includeScalarFacet: declaration.shapes.includes('scalar'), facts: read as never })).rejects.toThrow()
      const corruptPopulation = (data: unknown[]) => {
        ;(data[2] as { result: { axis_comparisons: Array<{ member_ranks: Array<{ territory_id: string }> }> } })
          .result.axis_comparisons[0]!.member_ranks[0]!.territory_id = 'native-c3'
      }
      const populationRefetcher = serveBridge(bridge, corruptPopulation)
      vi.stubGlobal('fetch', populationRefetcher)
      await expect(reacquireOrderedSeriesComparison({ resource, level: focalTarget.type,
        focal: focal as Territoire, territories: capture.territories as Territoire[],
        ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
        ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
        includeScalarFacet: declaration.shapes.includes('scalar'), facts: read as never })).rejects.toThrow()
      const refetcher = serveBridge(bridge)
      vi.stubGlobal('fetch', refetcher)
      const comparison = await reacquireOrderedSeriesComparison({ resource, level: focalTarget.type,
        focal: focal as Territoire, territories: capture.territories as Territoire[],
        ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
        ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
        includeScalarFacet: declaration.shapes.includes('scalar'), facts: read as never })
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(refetcher).toHaveBeenCalledTimes(1)
      expect((comparison as { axis_comparisons?: unknown[] }).axis_comparisons?.length).toBeGreaterThan(0)
    })
  }
})

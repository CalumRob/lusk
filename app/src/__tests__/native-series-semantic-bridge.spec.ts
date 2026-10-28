import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { join } from 'node:path'
import { acquireOrderedSeriesSemantic, reacquireOrderedSeriesComparison,
  SeriesComparisonRejectedError } from '@/payload/seriesSemanticAcquisition'
import { orderedSeriesFacts } from '@/payload/orderedSeriesAdapter'
import type { Territoire } from '@/payload/types'
import { dispatchIndicatorFamily } from '@/indicateurs/familySeam'
import { modeleTrajectoire } from '@/indicateurs/explorationModel'
import { validerThemeMetadata } from '@/payload/validate'
import TrajectoryFamilyRenderer from '@/components/indicateurs/TrajectoryFamilyRenderer.vue'

const capturePaths = (process.env.LUSK_NATIVE_SERIES_FAMILY_CAPTURES ?? '').split(';').filter(Boolean)
afterEach(() => vi.unstubAllGlobals())

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
    })
  }
})

const conditionalDescribe = capturePaths.length ? describe : describe.skip
conditionalDescribe('guarded native corrupt-evidence rejection → shared series acquirer', () => {
  const other = (statistic: string) => statistic === 'mean' ? 'median' : 'mean'
  const mutations: Array<[string, (data: any[]) => void, (bridge: { request: { items: any[] } }) => boolean]> = [
    ['comparison reference publication', (data) => { data[2].reference_content_version = 'other-reference' }, () => true],
    ['comparison facts publication', (data) => { data[2].content_version = 'other-series' }, () => true],
    ['comparison descriptor version', (data) => { data[2].result.descriptor_version = 'other-descriptor' }, () => true],
    ['comparison typed selection echo', (data) => { data[2].selection[0].territory_id = 'wrong-selected-member' },
      (bridge) => bridge.request.items[2]?.intent?.kind === 'selected_comparison'],
    ['comparison resolved scope count', (data) => { data[2].scope.member_count = 999 }, () => true],
    ['comparison statistic', (data) => { data[2].result.statistic = other(data[2].result.statistic) }, () => true],
    ['comparison peer membership', (data) => { data[2].result.axis_comparisons[0].member_ranks[0].territory_id = 'wrong-ranked-member' }, () => true],
    ['impossible peer rank', (data) => { data[2].result.axis_comparisons[0].member_ranks[0].rank = 999 }, () => true],
    ['focal descriptor version', (data) => { data[1].descriptor_version = 'other-focal-descriptor' }, () => true],
    ['focal provenance identity', (data) => { data[1].points[0].provenance[0].source_id = 'undeclared-producer' }, () => true],
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
      const fetcher = serveBridge(bridge, (data) => {
        const comparison = data[2] as { result: { axis_comparisons: Array<{ member_ranks: Array<{ rank: number }> }> } }
        comparison.result.axis_comparisons[0]!.member_ranks[0]!.rank = 999
      })
      vi.stubGlobal('fetch', fetcher)
      const read = await acquireOrderedSeriesSemantic({ resource, level: focalTarget.type,
        focal: focal as Territoire, territories: capture.territories as Territoire[],
        ...(cohortTarget.department_id ? { departmentId: cohortTarget.department_id } : {}),
        ...(cohortTarget.epci_id ? { epciId: cohortTarget.epci_id } : {}),
        includeScalarFacet: declaration.shapes.includes('scalar') }).catch((cause: unknown) => {
        expect(cause).toBeInstanceOf(SeriesComparisonRejectedError)
        return (cause as SeriesComparisonRejectedError).facts
      })
      expect(read.points.length).toBeGreaterThan(0)
      expect((read as { comparison?: unknown }).comparison).toBeUndefined()
      // The same-descriptor valid retry reacquires the rejected evidence.
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

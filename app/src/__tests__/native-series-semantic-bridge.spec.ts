import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { join } from 'node:path'
import { acquireOrderedSeriesSemantic } from '@/payload/seriesSemanticAcquisition'
import { orderedSeriesFacts } from '@/payload/orderedSeriesAdapter'
import type { Territoire } from '@/payload/types'
import { dispatchIndicatorFamily } from '@/indicateurs/familySeam'
import { modeleTrajectoire } from '@/indicateurs/explorationModel'
import { validerThemeMetadata } from '@/payload/validate'
import TrajectoryFamilyRenderer from '@/components/indicateurs/TrajectoryFamilyRenderer.vue'

const capturePaths = (process.env.LUSK_NATIVE_SERIES_FAMILY_CAPTURES ?? '').split(';').filter(Boolean)
afterEach(() => vi.unstubAllGlobals())

describe('guarded native SQL/HTTP → shared ordered-series acquisition bridge', () => {
  it('does not invent a capture dependency in the ordinary unit suite', () => {
    expect(capturePaths.every((path) => path.length > 0)).toBe(true)
  })

  for (const path of capturePaths) {
    it(`passes the captured ${path.split(/[\\/]/).at(-1)} batch through the real app adapter`, async () => {
      const capture = JSON.parse(readFileSync(path, 'utf8'))
      const bridge = capture.application_bridge
      expect(bridge.response_status).toBe(200)
      const resource = bridge.request.items[0].resource as string
      const declaration = capture.catalogue.resources.find((item: any) => item.resource_id === resource)
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('/api/resources/read-batch')
        expect(JSON.parse(String(init?.body))).toEqual(bridge.request)
        return Response.json(bridge.response, { status: bridge.response_status })
      })
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
      const facts = orderedSeriesFacts(read, declaration.theme_id, capture.territories as Territoire[])
      expect(facts.some((fact) => fact.territoire === focal?.territoire && fact.detail !== null)).toBe(true)
      if (resource === 'prix_m2') {
        expect(read.scope_series?.map((group) => group.territory.id)).toEqual(['native-c1', 'native-c2'])
        expect(facts.some((fact) => fact.territoire === 'native-c1' && fact.detail === null && fact.value === 987)).toBe(true)
        expect(facts.some((fact) => fact.territoire === 'native-c3' && fact.detail === null && fact.value === 987)).toBe(true)
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
          { nativeSeries: true })
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
    })
  }
})

import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { maplibreMock } from './setup'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { chargerAvec, indicateursDemographieFixture, territoiresFixture } from '../payload/fixtures'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'
import CarteView from '../views/CarteView.vue'
import type { ChargerFichier } from '../payload/usePayload'
import type { Payload } from '../payload/types'

const metadata = (theme: string) => JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8'))

function resource(theme: string, indicator: string) {
  const file = metadata(theme)
  const page = file.indicator_pages[indicator]
  const contract = file.scalar_contracts[indicator]
  return {
    resource_id: indicator,
    theme_id: theme,
    indicator_id: indicator,
    label: 'Libellé source différent du libellé éditorial',
    unit: page.unit,
    direction: page.comparison?.direction ?? page.direction,
    allowed_levels: contract.allowed_levels,
    sources: page.sources,
    shapes: ['scalar'],
    axes: [],
    axis_values: [],
    target_kinds: ['territory', 'territory_cohort'],
    target_ids: [],
    dynamic_axes: [],
    fields: ['value', 'support_count', 'denominator_count'],
    intents: ['facts', 'fixed_comparison', 'selected_comparison'],
    resource_kind: 'indicator',
  }
}

function sourceFor(theme: string, indicator: string) {
  const source_id = metadata(theme).indicator_pages[indicator].sources[0]
  return { source_id, name: 'Source API mesurée', vintage_id: `${source_id}-2026`, version: '2026',
    reference_date: '2026-06-30', publication_date: '2026-07-01' }
}

function observation(theme: string, indicator: string, territory: string, status: string, value: number | null) {
  const ref = territoiresFixture.find((item) => item.territoire === territory)!
  return { territory: { id: ref.territoire, type: ref.type, name: ref.nom }, status, value,
    support_count: status === 'measured' ? 41 : 7,
    denominator_count: 100,
    sources: [sourceFor(theme, indicator)] }
}

function cohortResult(theme: string, indicator: string, target: Record<string, unknown>, memberIds: string[], observations: unknown[]) {
  const declaration = resource(theme, indicator)
  const file = metadata(theme)
  return { resource: indicator, target,
    shape: 'scalar',
    cohort: { territory_type: target.type, department_id: target.department_id ?? null,
      epci_id: target.epci_id ?? null, member_count: memberIds.length,
      members: memberIds.map((id) => {
        const ref = territoiresFixture.find((item) => item.territoire === id)!
        return { id, type: ref.type, name: ref.nom }
      }), reference_content_version: 'reference-v7' },
    content_version: 'scalar-publication-v4',
    reference_content_version: 'reference-v7',
    descriptor: { indicator_id: indicator, theme_id: theme, label: declaration.label,
      unit: declaration.unit, direction: declaration.direction, comparison_facet: file.scalar_contracts[indicator].comparison_facet,
      allowed_levels: declaration.allowed_levels, denominator_semantics: 'producer-declared denominator',
      completeness: file.scalar_contracts[indicator].completeness, descriptor_version: 'scalar-descriptor-v3' },
    observations }
}

function discovery(...resources: ReturnType<typeof resource>[]) {
  return { contract: 'semantic-resource-catalogue-v1', resources }
}

function batch(...entries: Array<{ id: string; resource: string; data: unknown }>) {
  return { contract: 'semantic-read-batch-v1', results: entries }
}

function readBatchCall(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.find(([url]) => String(url) === '/api/resources/read-batch')
}

const staticPayload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture.map((row) => row.key === 'densite'
    ? { ...row, value: 123456, rang_epci: 1, rang_epci_n: 1, rang_dep: 1, rang_dep_n: 1, rang_reg: 1, rang_reg_n: 1 }
    : row),
  histoires: [], apercu: [], runReport: null, vintages: [], programmes: null,
}
const communeMasks = {
  type: 'FeatureCollection' as const,
  features: ['22001', '22002', '29001', '29002'].map((territoire) => ({
    type: 'Feature' as const, properties: { territoire },
    geometry: { type: 'Polygon' as const, coordinates: [] as number[][][] },
  })),
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  maplibreMock.instancesCarteMaple.length = 0
  maplibreMock.instancesPopups.length = 0
})

describe('ordinary scalar consumers on semantic resources', () => {
  it('mounted indicator page sends a filtered cohort read-batch and renders API value, status and provenance', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    const body = cohortResult('economie', 'effectifs_salaries', {
      kind: 'territory_cohort', type: 'commune', department_id: '22', epci_id: '200000001',
    }, ['22001', '22002'], [
      observation('economie', 'effectifs_salaries', '22001', 'measured', 9999),
      observation('economie', 'effectifs_salaries', '22002', 'suppressed', null),
    ])
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
       if (url === '/data/theme_economie.json') return new Response(JSON.stringify(metadata('economie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(resource('economie', 'effectifs_salaries'))))
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string)
        return new Response(JSON.stringify(batch({ id: request.items[0].id, resource: 'effectifs_salaries', data: body })))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/economie/effectifs_salaries?territoire=22001&niveau=commune&departement=22&epci=200000001')
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`API-selected page requested static numeric facts: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()

    const call = readBatchCall(fetcher)
    expect(call).toBeDefined()
    const request = JSON.parse((call?.[1] as RequestInit).body as string)
    expect(request.items).toHaveLength(1)
    expect(request.items[0]).toMatchObject({ resource: 'effectifs_salaries',
      target: { kind: 'territory_cohort', type: 'commune', department_id: '22', epci_id: '200000001' },
      intent: { kind: 'facts' } })
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/') || String(url).includes('/communes/'))).toBe(false)
    expect(wrapper.text()).toContain('9 999')
    expect(wrapper.text()).toContain('Repères partiels')
    expect(wrapper.text()).not.toContain('1 234 560')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('standalone map replaces deceptive static values while one all-Bretagne cohort is pending or fails', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    let failRead: ((error: Error) => void) | undefined
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(resource('demographie', 'densite'))))
      if (url === '/api/resources/read-batch') return new Promise<Response>((_resolve, reject) => { failRead = reject })
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/carte?theme=demographie')
    await router.isReady()
    const wrapper = mount(CarteView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: chargerAvec(staticPayload),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: communeMasks, epcis: null, departements: null }),
    } } })
    await flushPromises()
    maplibreMock.instancesCarteMaple.at(-1)?.fire('load')
    await flushPromises()
    await wrapper.findAll('.carte-sidebar-couche').find((button) => button.text().includes('Densité'))?.trigger('click')
    await flushPromises()

    const map = maplibreMock.instancesCarteMaple.at(-1)
    const joined = () => map?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; valeur: number | null } }[]
    }
    expect(joined().features.find((item) => item.properties.territoire === '22001')?.properties.valeur).toBeNull()
    const call = readBatchCall(fetcher)
    expect(call).toBeDefined()
    const request = JSON.parse((call?.[1] as RequestInit).body as string)
    expect(request.items).toHaveLength(1)
    expect(request.items[0]).toMatchObject({ resource: 'densite', target: {
      kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null,
    } })
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/') || String(url).includes('/communes/'))).toBe(false)

    failRead?.(new Error('API offline'))
    await flushPromises()
    expect(joined().features.find((item) => item.properties.territoire === '22001')?.properties.valeur).toBeNull()
    expect(wrapper.find('[role="alert"]').text()).toContain('Réessayer')
    wrapper.unmount()
  })

  it('standalone map paints only native cohort values and does not trust static ranks', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    const target = { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null }
    const facts = cohortResult('demographie', 'densite', target, ['22001', '22002', '29001', '29002'], [
      observation('demographie', 'densite', '22001', 'measured', 9876),
      observation('demographie', 'densite', '22002', 'suppressed', null),
    ])
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(resource('demographie', 'densite'))))
      if (url === '/api/resources/read-batch') {
        const item = JSON.parse(init?.body as string).items[0]
        if (item.intent.kind === 'selected_comparison') return new Response(JSON.stringify(batch({
          id: item.id, resource: 'densite', data: {
            resource: 'densite', target: item.target, contract: 'indicator-comparison-v1', indicator_id: 'densite', shape: 'scalar',
            content_version: 'scalar-publication-v4', reference_content_version: 'reference-v7',
            selection: item.intent.members.map((member: { type: string; id: string }) => ({ territory_type: member.type, territory_id: member.id })),
            scope: { kind: 'explicit_selection', member_count: 2 }, result: { indicator_id: 'densite', status: 'available',
              unit: metadata('demographie').indicator_pages.densite.unit, direction: 'high', source_facet: 'densite',
              descriptor_version: 'scalar-descriptor-v3', selected_member_count: 2, eligible_count: 2, missing_count: 0, rank: 2, rank_size: 2 },
          },
        })))
        return new Response(JSON.stringify(batch({ id: item.id, resource: 'densite', data: facts })))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/carte?theme=demographie')
    await router.isReady()
    const wrapper = mount(CarteView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: chargerAvec(staticPayload),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { territoire: '22001' }, geometry: { type: 'Polygon', coordinates: [] } },
        { type: 'Feature', properties: { territoire: '22002' }, geometry: { type: 'Polygon', coordinates: [] } },
        { type: 'Feature', properties: { territoire: '29001' }, geometry: { type: 'Polygon', coordinates: [] } },
        { type: 'Feature', properties: { territoire: '29002' }, geometry: { type: 'Polygon', coordinates: [] } },
      ] }, epcis: null, departements: null }),
    } } })
    await flushPromises()
    maplibreMock.instancesCarteMaple.at(-1)?.fire('load')
    await flushPromises()
    await wrapper.findAll('.carte-sidebar-couche').find((button) => button.text().includes('Densité'))?.trigger('click')
    await flushPromises()

    const map = maplibreMock.instancesCarteMaple.at(-1)
    const joined = map?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; valeur: number | null } }[]
    }
    expect(joined.features.find((item) => item.properties.territoire === '22001')?.properties.valeur).toBe(9876)
    expect(joined.features.find((item) => item.properties.territoire === '22002')?.properties.valeur).toBeNull()
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Densité de population')
    const call = readBatchCall(fetcher)
    expect(call).toBeDefined()
    const request = JSON.parse((call?.[1] as RequestInit).body as string)
    expect(request.items[0].target).toEqual(target)
    expect(JSON.parse((call?.[1] as RequestInit).body as string).items).toHaveLength(1)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/') || String(url).includes('/communes/'))).toBe(false)
    const mapClick = vi.spyOn(map!, 'queryRenderedFeatures').mockReturnValue([{ properties: { territoire: '22001' } }] as never)
    map?.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: -2, lat: 48 } })
    await flushPromises()
    expect(mapClick).toHaveBeenCalled()
    const rankRead = fetcher.mock.calls.find(([url, init]) => String(url) === '/api/resources/read-batch' &&
      JSON.parse((init as RequestInit).body as string).items[0].intent.kind === 'selected_comparison')
    expect(rankRead).toBeDefined()
    const rankItem = JSON.parse((rankRead?.[1] as RequestInit).body as string).items[0]
    expect(rankItem.intent.members).toEqual([{ type: 'commune', id: '22001' }, { type: 'commune', id: '22002' }])
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).toContain('2e/2 · dans l\'EPCI')
    wrapper.unmount()
  })

  it('shows a failed map rank read and retries it without restoring a static rank', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    const target = { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null }
    const facts = cohortResult('demographie', 'densite', target, ['22001', '22002', '29001', '29002'], [
      observation('demographie', 'densite', '22001', 'measured', 9876),
      observation('demographie', 'densite', '22002', 'measured', 7654),
    ])
    let comparisonAttempts = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(resource('demographie', 'densite'))))
      if (url === '/api/resources/read-batch') {
        const item = JSON.parse(init?.body as string).items[0]
        if (item.intent.kind === 'selected_comparison') {
          comparisonAttempts++
          if (comparisonAttempts === 1) throw new Error('Comparison API offline')
          const members = item.intent.members.map((member: { type: string; id: string }) => ({
            territory_type: member.type, territory_id: member.id,
          }))
          return new Response(JSON.stringify(batch({ id: item.id, resource: 'densite', data: {
            resource: 'densite', target: item.target, contract: 'indicator-comparison-v1', indicator_id: 'densite',
            shape: 'scalar', content_version: 'scalar-publication-v4',
            reference_content_version: 'reference-v7', selection: members,
            scope: { kind: 'explicit_selection', member_count: members.length },
            result: { indicator_id: 'densite', status: 'available',
              unit: metadata('demographie').indicator_pages.densite.unit, direction: 'high', source_facet: 'densite',
              descriptor_version: 'scalar-descriptor-v3', selected_member_count: members.length,
              eligible_count: members.length, missing_count: 0, rank: 1, rank_size: members.length },
          } })))
        }
        return new Response(JSON.stringify(batch({ id: item.id, resource: 'densite', data: facts })))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/carte?theme=demographie')
    await router.isReady()
    const wrapper = mount(CarteView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: chargerAvec(staticPayload),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: communeMasks, epcis: null, departements: null }),
    } } })
    await flushPromises()
    const map = maplibreMock.instancesCarteMaple.at(-1)
    map?.fire('load')
    await flushPromises()
    await wrapper.findAll('.carte-sidebar-couche').find((button) => button.text().includes('Densité'))?.trigger('click')
    await flushPromises()
    vi.spyOn(map!, 'queryRenderedFeatures').mockReturnValue([{ properties: { territoire: '22001' } }] as never)
    map?.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: -2, lat: 48 } })
    await flushPromises()

    expect(comparisonAttempts).toBe(1)
    expect(wrapper.get('[role="alert"]').text()).toContain('Le rang de comparaison est indisponible.')
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).not.toContain('1e/2')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(comparisonAttempts).toBe(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).toContain("1er/2 · dans l'EPCI")
    wrapper.unmount()
  })

  it('ignores a pending map rank when the active scalar layer changes', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    const indicators = ['densite', 'evolution_1968'] as const
    const resources = indicators.map((indicator) => resource('demographie', indicator))
    let resolveRank: (() => void) | undefined
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(...resources)))
      if (url === '/api/resources/read-batch') {
        const item = JSON.parse(init?.body as string).items[0]
        if (item.intent.kind === 'selected_comparison') {
          const members = item.intent.members.map((member: { type: string; id: string }) => ({
            territory_type: member.type, territory_id: member.id,
          }))
          const response = new Response(JSON.stringify(batch({ id: item.id, resource: 'densite', data: {
            resource: 'densite', target: item.target, contract: 'indicator-comparison-v1', indicator_id: 'densite',
            shape: 'scalar', content_version: 'scalar-publication-v4',
            reference_content_version: 'reference-v7', selection: members,
            scope: { kind: 'explicit_selection', member_count: members.length },
            result: { indicator_id: 'densite', status: 'available',
              unit: metadata('demographie').indicator_pages.densite.unit, direction: 'high', source_facet: 'densite',
              descriptor_version: 'scalar-descriptor-v3', selected_member_count: members.length,
              eligible_count: members.length, missing_count: 0, rank: 2, rank_size: members.length },
          } })))
          return new Promise<Response>((resolve) => { resolveRank = () => resolve(response) })
        }
        const indicator = item.resource as typeof indicators[number]
        const facts = cohortResult('demographie', indicator, item.target, ['22001', '22002', '29001', '29002'], [
          observation('demographie', indicator, '22001', 'measured', indicator === 'densite' ? 9876 : 0.25),
          observation('demographie', indicator, '22002', 'measured', indicator === 'densite' ? 7654 : 0.15),
        ])
        return new Response(JSON.stringify(batch({ id: item.id, resource: indicator, data: facts })))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/carte?theme=demographie')
    await router.isReady()
    const wrapper = mount(CarteView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: chargerAvec(staticPayload),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: communeMasks, epcis: null, departements: null }),
    } } })
    await flushPromises()
    const map = maplibreMock.instancesCarteMaple.at(-1)
    map?.fire('load')
    await flushPromises()
    await wrapper.findAll('.carte-sidebar-couche').find((button) => button.text().includes('Densité'))?.trigger('click')
    await flushPromises()
    vi.spyOn(map!, 'queryRenderedFeatures').mockReturnValue([{ properties: { territoire: '22001' } }] as never)
    map?.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: -2, lat: 48 } })
    await flushPromises()
    expect(resolveRank).toBeDefined()

    const evolutionLayer = wrapper.findAll('.carte-sidebar-couche')
      .find((button) => button.text().includes('depuis 1968'))
    expect(evolutionLayer).toBeDefined()
    await evolutionLayer!.trigger('click')
    await flushPromises()
    resolveRank!()
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).not.toContain('popup-carte-rang')
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).not.toContain("dans l'EPCI")
    wrapper.unmount()
  })
})

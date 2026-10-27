import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { indicateursHabitatFixture, indicateursMilieuxFixture, indicateursMobiliteFixture, territoiresFixture } from '../payload/fixtures'
import { INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY } from '../payload/indicatorReadModel'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import type { Territoire } from '../payload/types'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'
import { validerThemeMetadata } from '../payload/validate'
import { nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

const rawMetadataMilieux = JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_milieux.json'), 'utf8'))
const metadataMilieux = validerThemeMetadata(rawMetadataMilieux, 'theme_milieux.json')
const rawMetadataHabitat = JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_habitat.json'), 'utf8'))
const metadataHabitat = validerThemeMetadata(rawMetadataHabitat, 'theme_habitat.json')
const rawMetadataMobilite = JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_mobilite.json'), 'utf8'))
const metadataMobilite = validerThemeMetadata(rawMetadataMobilite, 'theme_mobilite.json')

type RaccordementPageOptions = {
  targetId: string
  targetType: Territoire['type']
  query?: string
  territories?: Territoire[]
  transformRead?: (item: Record<string, any>, resource: any, data: Record<string, any>) => Record<string, any>
  readBatch?: (items: Array<Record<string, any>>, respond: () => Response) => Response | Promise<Response>
}

async function mountRaccordementPage(options: RaccordementPageOptions) {
  vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
  const densityModel = options.targetType === 'commune' && options.targetId === '22001'
    ? JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data',
      'modeles-lecture', 'territoires', 'commune', '22001.json'), 'utf8')) : null
  const territories = (options.territories ?? territoiresFixture).map((territory) =>
    territory.territoire === options.targetId && territory.type === options.targetType && densityModel
      ? { ...territory, classe_densite_code: densityModel.territory.classe_densite_code,
        classe_densite_libelle_public: densityModel.territory.classe_densite_libelle_public }
      : territory)
  const loader: ChargerFichier = async (file) => {
    if (file === 'territoires') return territories
    if (file === 'indicateurs_mobilite') return indicateursMobiliteFixture
    if (file === 'theme_mobilite') return metadataMobilite
    throw new Error(`unexpected static read: ${file}`)
  }
  const requests: Array<Array<Record<string, any>>> = []
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input); calls.push(url)
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url === '/api/resources/read-batch') {
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      requests.push(items)
      const respond = () => nativeBatchResponse(items, (item, resource) => {
        const data = nativeReadFixture(item, resource, { territories })
        return options.transformRead?.(item, resource, data) ?? data
      })
      return options.readBatch ? options.readBatch(items, respond) : respond()
    }
    throw new Error(`unexpected request: ${url}`)
  })
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/indicateurs/mobilite/raccordement_courbe?territoire=${options.targetId}&niveau=${options.targetType}${options.query ?? ''}`)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
    [PAYLOAD_CHARGER_KEY]: loader,
    [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { mobilite: [] } }),
    [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
  } } })
  return { wrapper, router, requests, calls, territories }
}

describe("Page d'indicateur — lecture ordonnée dans le contrat existant", () => {
  it('mounts the current 73-point national trajectory and visible selected mean on the ordinary indicator route', async () => {
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    const territoryModel = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data',
      'modeles-lecture', 'territoires', 'commune', '22001.json'), 'utf8'))
    const target = { ...territoiresFixture.find((row) => row.territoire === '22001')!,
      classe_densite_code: territoryModel.territory.classe_densite_code,
      classe_densite_libelle_public: territoryModel.territory.classe_densite_libelle_public }
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const reference = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_reference')!
    const targetIdentity = { kind: 'territory', type: target.type, id: target.territoire }
    const nativeRead = nativeReadFixture({ target: targetIdentity, intent: { kind: 'facts' } }, curve)
    const nativeComparison = nativeReadFixture({ target: targetIdentity,
      intent: { kind: 'fixed_comparison', context: 'default' } }, curve)
    const namedReference = nativeReadFixture({ target: { kind: 'named_reference', id: reference.target_ids[0] },
      intent: { kind: 'facts' } }, reference)
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture.map((item) =>
        item.territoire === target.territoire ? target : item)
      if (file === 'indicateurs_mobilite') return indicateursMobiliteFixture
      if (file === 'theme_mobilite') return metadataMobilite
      throw new Error(`unexpected static read: ${file}`)
    }
    const requests: Array<Array<Record<string, any>>> = []
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); calls.push(url)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        return nativeBatchResponse(items, nativeReadFixture)
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(`/indicateurs/mobilite/raccordement_courbe?territoire=${target.territoire}&niveau=commune`)
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { mobilite: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(calls).toContain('/api/resources')
      expect(calls.some((url) => url === '/api/resources/read-batch')).toBe(true)
      expect(calls.some((url) => url.includes('/indicators/raccordement_courbe'))).toBe(false)
      expect(requests.flat().some((item) => item.resource === curve.resource_id && item.intent.kind === 'facts')).toBe(true)
      expect(requests.flat().some((item) => item.resource === curve.resource_id && item.intent.kind === 'fixed_comparison')).toBe(true)
      expect(requests.flat().some((item) => item.resource === reference.resource_id &&
        item.target.kind === 'named_reference' && item.target.id === reference.target_ids[0])).toBe(true)
      expect(wrapper.findAll('.trajectoire-territoire-point')).toHaveLength(73)
      const meanPoints = wrapper.findAll('.trajectoire-comparaison-point')
      expect(meanPoints).toHaveLength(73)
      expect(meanPoints.map((point) => [point.attributes('data-detail'), Number(point.attributes('data-value'))]))
        .toEqual((nativeComparison.result as any).mean_curve.points.map((point: { axis: string; value: number }) => [point.axis, point.value]))
      expect(wrapper.find('[data-testid="raccordement-selected-mean"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="selected-mean-legend"]').exists()).toBe(true)
      const referencePath = wrapper.find('.trajectoire-reference')
      expect.soft(referencePath.exists()).toBe(true)
      expect.soft((referencePath.attributes('d')?.match(/\bL\b/g) ?? [])).toHaveLength(72)
      expect(wrapper.findAll('.trajectoire-reference, .trajectoire-comparaison, .trajectoire-territoire')).toHaveLength(3)
      const ticks = wrapper.findAll('.trajectoire-tick .trajectoire-axe-x-tick')
      expect.soft(Number(ticks[0]?.attributes('x'))).toBe(60)
      expect.soft(Number(ticks.at(-1)?.attributes('x'))).toBe(588)
      expect(wrapper.text()).toContain(target.classe_densite_libelle_public)
      expect(wrapper.text()).toContain((nativeRead.points as any[])[0].provenance[0].source_name)
      expect(wrapper.text()).not.toContain('Médiane')
      expect(namedReference.target.kind).toBe('named_reference')
    } finally { wrapper.unmount() }
  })
  it.each([
    { targetId: '200000001', targetType: 'epci' as const, label: 'EPCI bretons', available: true },
    { targetId: '22', targetType: 'departement' as const, label: 'départements bretons', available: true },
    { targetId: '53', targetType: 'region' as const, label: null, available: false },
  ])('keeps the native raccordement curve visible at the published $targetType level', async ({ targetId, targetType, label, available }) => {
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const reference = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_reference')!
    expect(curve.allowed_levels).toContain(targetType)
    expect(metadataMobilite.indicator_pages?.raccordement_courbe.levels).toContain(targetType)
    let focalRead: Record<string, any> | undefined
    let comparisonRead: Record<string, any> | undefined
    const mounted = await mountRaccordementPage({ targetId, targetType,
      transformRead: (item, resource, data) => {
        if (resource.resource_id === curve.resource_id && item.intent.kind === 'facts') focalRead = data
        if (resource.resource_id === curve.resource_id && item.intent.kind === 'fixed_comparison') comparisonRead = data
        return data
      } })
    try {
      await flushPromises()
      expect(mounted.wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(mounted.wrapper.findAll('.trajectoire-territoire-point')).toHaveLength(73)
      expect(mounted.wrapper.findAll('.trajectoire-reference')).toHaveLength(1)
      expect(Number(mounted.wrapper.find('.trajectoire-territoire-point').attributes('data-value')))
        .toBe((focalRead!.points as Array<Record<string, any>>)[0]!.value)
      const fixedRequest = mounted.requests.flat().find((item) => item.resource === curve.resource_id &&
        item.intent.kind === 'fixed_comparison')
      expect(fixedRequest?.target).toEqual({ kind: 'territory', type: targetType, id: targetId })
      expect(comparisonRead?.result.source_facet).toBe(focalRead?.comparison_point)
      if (!available) {
        expect(comparisonRead?.scope).toBeNull()
        expect(comparisonRead?.result).toMatchObject({ status: 'unavailable', reason: 'unsupported_comparison_contract',
          selected_member_count: 0, eligible_count: 0, mean: null, mean_curve: null, rank: null, rank_size: null })
        expect(mounted.wrapper.find('[data-testid="raccordement-selected-mean"]').exists()).toBe(false)
        expect(mounted.wrapper.text()).toContain('La comparaison est indisponible')
        expect(mounted.wrapper.findAll('.trajectoire-comparaison-point')).toHaveLength(0)
      } else {
        expect(comparisonRead?.scope).toMatchObject({ kind: 'same_level', territory_type: targetType })
        expect(comparisonRead?.result.comparison_sources).toEqual([expect.objectContaining({
          source_id: focalRead?.points[0]?.provenance[0]?.source_id,
          vintage_id: focalRead?.points[0]?.provenance[0]?.vintage_id,
          source_name: focalRead?.points[0]?.provenance[0]?.source_name,
          version: focalRead?.points[0]?.provenance[0]?.version,
          revision_hash: focalRead?.points[0]?.provenance[0]?.revision_hash,
        })])
        expect(mounted.wrapper.find('[data-testid="raccordement-selected-mean"]').exists()).toBe(true)
        expect(mounted.wrapper.find('[data-testid="raccordement-selected-mean"]').text()).toContain(label)
        expect(mounted.wrapper.findAll('.trajectoire-comparaison-point')).toHaveLength(73)
      }
      expect(reference.target_ids).toContain('bretagne_all_assessed_communes_mean')
      expect(mounted.wrapper.find('.trajectoire-reference').exists()).toBe(true)
    } finally { mounted.wrapper.unmount() }
  })

  it('shows focal facts and the named reference when an explicit singleton comparison is legitimately unavailable', async () => {
    const target = territoiresFixture.find((territory) => territory.territoire === '22001')!
    const subset = territoiresFixture.filter((territory) => territory.territoire === target.territoire)
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const singleton = [{ territory_type: 'commune', territory_id: '22001' }]
    let selectedRead: Record<string, any> | undefined
    const mounted = await mountRaccordementPage({ targetId: target.territoire, targetType: 'commune',
      query: '&departement=22', territories: subset,
      transformRead: (item, resource, data) => {
        if (resource.resource_id === curve.resource_id && item.intent.kind === 'selected_comparison') selectedRead = data
        return data
      } })
    try {
      await flushPromises()
      expect(selectedRead?.selection).toEqual(singleton)
      expect(selectedRead?.scope).toMatchObject({ kind: 'explicit_selection', member_count: 1 })
      expect(selectedRead?.result).toMatchObject({ status: 'unavailable', reason: 'fewer_than_two_comparable_values',
        selected_member_count: 1, eligible_count: 1, mean: null, mean_curve: null, rank: null, rank_size: null })
      expect(mounted.wrapper.findAll('.trajectoire-territoire-point')).toHaveLength(73)
      expect(mounted.wrapper.find('.trajectoire-reference').exists()).toBe(true)
      expect(mounted.wrapper.findAll('.trajectoire-comparaison-point')).toHaveLength(0)
      expect(mounted.wrapper.find('[data-testid="raccordement-selected-mean"]').exists()).toBe(false)
      expect(mounted.wrapper.text()).toContain('La comparaison est indisponible')
      expect(mounted.wrapper.text()).not.toContain('Rang à t0090')
      expect(mounted.requests.flat().some((item) => item.resource === curve.resource_id &&
        item.intent.kind === 'selected_comparison' && item.intent.members.length === 1)).toBe(true)
      expect(mounted.requests.flat().filter((item) => item.resource === curve.resource_id &&
        item.intent.kind === 'selected_comparison')).toHaveLength(1)
    } finally { mounted.wrapper.unmount() }
  })

  it('retries only a failed selected comparison while keeping the acquired curve and named reference', async () => {
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    let comparisonAvailable = false
    const mounted = await mountRaccordementPage({ targetId: '22001', targetType: 'commune', query: '&departement=22',
      readBatch: (items, respond) => {
        if (items.some((item) => item.resource === curve.resource_id && item.intent.kind === 'selected_comparison') &&
            !comparisonAvailable) return new Response('comparison temporarily unavailable', { status: 503 })
        return respond()
      } })
    try {
      await flushPromises()
      expect(mounted.wrapper.findAll('.trajectoire-territoire-point')).toHaveLength(73)
      expect(mounted.wrapper.find('.trajectoire-reference').exists()).toBe(true)
      expect(mounted.wrapper.findAll('.trajectoire-comparaison-point')).toHaveLength(0)
      expect(mounted.wrapper.find('[data-testid="raccordement-comparison-error"]').exists()).toBe(true)
      const focalFactReadsBeforeRetry = mounted.requests.flat().filter((item) => item.resource === curve.resource_id &&
        item.intent.kind === 'facts').length
      const namedReferenceReadsBeforeRetry = mounted.requests.flat().filter((item) => item.resource === 'raccordement_reference').length
      const comparisonReadsBeforeRetry = mounted.requests.flat().filter((item) => item.resource === curve.resource_id &&
        item.intent.kind === 'selected_comparison').length

      comparisonAvailable = true
      await mounted.wrapper.get('[data-testid="raccordement-comparison-retry"]').trigger('click')
      await flushPromises()

      expect(mounted.wrapper.find('[data-testid="raccordement-comparison-error"]').exists()).toBe(false)
      expect(mounted.wrapper.findAll('.trajectoire-territoire-point')).toHaveLength(73)
      expect(mounted.wrapper.findAll('.trajectoire-comparaison-point')).toHaveLength(73)
      expect(mounted.wrapper.find('.trajectoire-reference').exists()).toBe(true)
      expect(mounted.requests.flat().filter((item) => item.resource === curve.resource_id && item.intent.kind === 'facts'))
        .toHaveLength(focalFactReadsBeforeRetry)
      expect(mounted.requests.flat().filter((item) => item.resource === 'raccordement_reference'))
        .toHaveLength(namedReferenceReadsBeforeRetry)
      expect(mounted.requests.flat().filter((item) => item.resource === curve.resource_id && item.intent.kind === 'selected_comparison'))
        .toHaveLength(comparisonReadsBeforeRetry + 1)
    } finally { mounted.wrapper.unmount() }
  })

  it('does not let a delayed comparison from the previous territory overwrite the new route', async () => {
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    let releaseOldComparison!: () => void
    let oldComparisonStarted!: () => void
    const oldStarted = new Promise<void>((resolve) => { oldComparisonStarted = resolve })
    const oldResponse = new Promise<Response>((resolve) => { releaseOldComparison = () => resolve(oldRespond()) })
    let oldRespond = () => new Response('old response not prepared', { status: 500 })
    const mounted = await mountRaccordementPage({ targetId: '22001', targetType: 'commune', query: '&departement=22',
      readBatch: (items, respond) => {
        const selected = items.some((item) => item.resource === curve.resource_id && item.intent.kind === 'selected_comparison')
        const focalId = items.find((item) => item.resource === curve.resource_id)?.target?.id
        if (selected && focalId === '22001') {
          oldRespond = respond
          oldComparisonStarted()
          return oldResponse
        }
        return respond()
      } })
    try {
      await oldStarted
      await flushPromises()
      expect(mounted.wrapper.findAll('.trajectoire-territoire-point')).toHaveLength(73)
      await mounted.router.replace({ query: { territoire: '29001', niveau: 'commune', departement: '29' } })
      await flushPromises()
      const currentPoint = () => mounted.wrapper.findAll('.trajectoire-territoire-point')
        .find((point) => point.attributes('data-detail') === 't0090')
      expect(Number(currentPoint()?.attributes('data-value'))).toBe(0.275)
      expect(mounted.wrapper.find('[data-testid="raccordement-selected-mean"]').exists()).toBe(true)
      releaseOldComparison()
      await flushPromises()
      expect(Number(currentPoint()?.attributes('data-value'))).toBe(0.275)
      expect(mounted.wrapper.find('[data-testid="raccordement-selected-mean"]').exists()).toBe(true)
      expect(mounted.wrapper.find('[data-testid="raccordement-comparison-error"]').exists()).toBe(false)
    } finally { mounted.wrapper.unmount() }
  })
  it('mounts prix_m2 through the shared default-off owned-series reader gate', async () => {
    vi.stubEnv('VITE_OWNED_SERIES_API', '1')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_habitat') return indicateursHabitatFixture
      if (file === 'theme_habitat') return metadataHabitat
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input) === '/api/resources'
      ? nativeCatalogueResponse() : new Response(JSON.stringify({
      dataset_id: 'dvf_prix_m2', indicator_id: 'prix_m2', axis_kind: 'year', unit: '€/m²',
      territory: { id: '22001', type: 'commune', name: 'Commune A1' },
      points: [{ axis: '2024', observation_period: '2024', value: null, status: 'missing', provenance: [] },
        { axis: '2025', observation_period: '2025', value: 525, status: 'measured', provenance: [] }],
      scope_series: [{ territory: { id: '22001', type: 'commune', name: 'Commune A1' }, points: [
        { axis: '2024', observation_period: '2024', value: null, status: 'missing', provenance: [] },
        { axis: '2025', observation_period: '2025', value: 525, status: 'measured', provenance: [] },
      ] }], comparison: { point: '2025', value: 525, median: 525, rank: 1, ties: 1, comparable_count: 1,
        direction: 'low', scope: { kind: 'level', territory_type: 'commune', department_id: '22' } },
    }), { status: 200 }))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/habitat/prix_m2?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { habitat: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/resources')
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/series-datasets/dvf_prix_m2/territories/commune/22001/prix_m2?scope_level=commune&department_id=22')
      expect(wrapper.text()).toContain('525')
      expect(wrapper.text()).toContain('Prix')
    } finally { wrapper.unmount() }
  })
  it('waits for delayed metadata before choosing a series route when both API gates are enabled', async () => {
    vi.stubEnv('VITE_OCSGE_STATE_SERIES_API', '1')
    vi.stubEnv('VITE_CONSO_ENAF_SERIES_API', '1')
    let publishMetadata!: (metadata: typeof metadataMilieux) => void
    const metadata = new Promise<typeof metadataMilieux>((resolve) => { publishMetadata = resolve })
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadata
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input) === '/api/resources'
      ? nativeCatalogueResponse() : new Response(JSON.stringify({
      dataset_id: 'ocsge_artif_etats', indicator_id: 'artif_par_habitant', points: [], scope_series: [],
      territory: { id: '22001', type: 'commune', name: 'Commune A1' },
    }), { status: 200 }))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { milieux: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/resources')
      publishMetadata(metadataMilieux)
      await flushPromises()
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/series-datasets/ocsge_artif_etats/territories/commune/22001/artif_par_habitant?scope_level=commune&department_id=22')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })

  it('preserves validated dataset bindings and rejects invalid publication identities', () => {
    expect(metadataMilieux.indicator_pages?.artif_par_habitant.series_dataset_id).toBe('ocsge_artif_etats')
    expect(metadataMilieux.indicator_pages?.artif_par_habitant.series_publication).toBe('owned')
    for (const patch of [{ series_dataset_id: '../invalid' }, { series_publication: 'unknown' }, { series_dataset_id: undefined, series_publication: 'owned' }]) {
      const metadata = structuredClone(rawMetadataMilieux)
      Object.assign(metadata.indicator_pages.artif_par_habitant, patch)
      expect(() => validerThemeMetadata(metadata, 'theme_milieux.json')).toThrow()
    }
  })
  it('completes a pending owned read when URL normalization repeats the same scope', async () => {
    vi.stubEnv('VITE_OCSGE_STATE_SERIES_API', '1')
    localStorage.removeItem('lusk:niveau-indicateur')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    let complete!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => String(input) === '/api/resources'
      ? Promise.resolve(nativeCatalogueResponse()) : new Promise<Response>((resolve) => { complete = resolve }))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { milieux: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Chargement des données actualisées')
    await router.replace({ query: { ...router.currentRoute.value.query, detail: '2025' } })
    await flushPromises()
    const point = { axis: '2025', state_role: 'M3', observation_period: '2021-2025', value: 42, status: 'measured', provenance: [] }
    complete(new Response(JSON.stringify({ dataset_id: 'ocsge_artif_etats', indicator_id: 'artif_par_habitant',
      axis_kind: 'declared_detail', unit: 'm²/hab', comparison_point: '2025',
      territory: { id: '22001', type: 'commune', name: 'Commune A1' }, points: [point],
      scope_series: [{ territory: { id: '22001', type: 'commune', name: 'Commune A1' }, points: [point] }],
    }), { status: 200 }))
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/resources')
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      '/api/series-datasets/ocsge_artif_etats/territories/commune/22001/artif_par_habitant?scope_level=commune&department_id=22')
    expect(wrapper.text()).not.toContain('Chargement des données actualisées')
    expect(wrapper.text()).toContain('42')
    wrapper.unmount()
  })

  it('uses the separately gated, dataset-qualified M2/M3 reader and does not reuse ENAF state', async () => {
    vi.stubEnv('VITE_OCSGE_STATE_SERIES_API', '1')
    vi.stubEnv('VITE_CONSO_ENAF_SERIES_API', '')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    let apiAvailable=false
    const fetchMock = vi.spyOn(globalThis,'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      if(!apiAvailable) throw new Error('owned API unavailable')
      return new Response(JSON.stringify({
      dataset_id:'ocsge_artif_etats',indicator_id:'artif_par_habitant',axis_kind:'declared_detail',unit:'m²/hab',
      territory:{id:'22001',type:'commune',name:'Commune A1'},comparison_point:'2025',
      comparison:{point:'2025',direction:'low',scope:{kind:'level',territory_type:'commune',
        department_id:'22',rank_field:'rang_dep'},rank:1,ties:1,median:61,comparable_count:2},
      points:[{axis:'2021',state_role:'M2',observation_period:'2021-2025',value:0,status:'measured',provenance:[]},
        {axis:'2025',state_role:'M3',observation_period:'2021-2025',value:42,status:'measured',provenance:[]}],
      scope_series:[{territory:{id:'22001',type:'commune',name:'Commune A1'},points:[
        {axis:'2021',state_role:'M2',observation_period:'2021-2025',value:0,status:'measured',provenance:[]},
        {axis:'2025',state_role:'M3',observation_period:'2021-2025',value:42,status:'measured',comparison_rank:1,comparison_ties:1,comparison_count:2,provenance:[]}]},
      {territory:{id:'22002',type:'commune',name:'Commune A2'},points:[
        {axis:'2021',state_role:'M2',observation_period:'2021-2025',value:2,status:'measured',provenance:[]},
        {axis:'2025',state_role:'M3',observation_period:'2021-2025',value:80,status:'measured',comparison_rank:2,comparison_ties:1,comparison_count:2,provenance:[]}]}],
      }),{status:200,headers:{'Content-Type':'application/json'}})
    })
    const router=createRouter({history:createMemoryHistory(),routes})
    await router.push('/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune&departement=22&detail=2021')
    await router.isReady()
    const empty={type:'FeatureCollection' as const,features:[]}
    const wrapper=mount(IndicateurView,{global:{plugins:[router],provide:{
      [PAYLOAD_CHARGER_KEY]:loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]:async()=>({schemaVersion:'1' as const,routes:{milieux:[]}}),
      [GEOMETRIE_CHARGER_KEY]:async()=>({communes:empty,epcis:empty,departements:empty}),
    }}})
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/series-datasets/ocsge_artif_etats/territories/commune/22001/artif_par_habitant?scope_level=commune&department_id=22')
    expect(wrapper.text()).toContain('momentanément indisponibles')
    apiAvailable=true
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('momentanément indisponibles')
    expect(wrapper.text()).toContain('42')
  })

  it('preserves the page grammar and comparison scope, adapts API facts, and never falls back to static series on failure', async () => {
    vi.stubEnv('VITE_CONSO_ENAF_SERIES_API', '1')
    const calls: string[] = []
    const loader: ChargerFichier = async (file) => {
      calls.push(file)
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    const fixtureFacts = indicateursMilieuxFixture.filter((fact) => fact.key === 'conso_enaf_annuel' && fact.type === 'commune')
    const axis: string[] = rawMetadataMilieux.indicator_pages.conso_enaf_annuel.comparison.details
    const scopeSeries = [...new Set(fixtureFacts.map((fact) => fact.territoire))].map((id) => {
      const territory = territoiresFixture.find((item) => item.territoire === id)!
      return { territory: { id, type: territory.type, name: territory.nom }, points: fixtureFacts
        .filter((fact) => fact.territoire === id).map((fact) => ({ axis: fact.detail!, observation_period: fact.detail,
          value: fact.value, status: fact.value === null ? 'missing' : 'measured', source_id: 'consoenaf',
          vintage_id: 'v2025', source_version: '2025', source_reference_date: '2025-01-01', source_publication_date: '2026-07-24' })) }
    })
    const apiRead = {
      dataset_id: 'conso_enaf_annuel', availability: 'complete',
      indicator_id: 'conso_enaf_annuel', axis_kind: 'year', unit: 'ha',
      territory: { id: '22001', type: 'commune', name: 'Commune A1' }, points: axis.map((year) => ({ axis: year,
        observation_period: year, value: fixtureFacts.find((fact) => fact.territoire === '22001' && fact.detail === year)?.value ?? null,
        status: fixtureFacts.some((fact) => fact.territoire === '22001' && fact.detail === year)
          ? (fixtureFacts.find((fact) => fact.territoire === '22001' && fact.detail === year)?.value === null ? 'missing' : 'measured') : 'missing',
        source_id: 'consoenaf', vintage_id: 'v2025' })), scope_series: scopeSeries,
      comparison: { point: '2024', value: null, median: null, rank: null, ties: null, comparable_count: 0,
        scope: { kind: 'level', territory_type: 'commune', department_id: '22', epci_id: null } },
    }
    let apiCalls = 0
    let retryEnabled = false
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      if (!String(input).startsWith('/api/series-datasets/')) return new Response('{}', { status: 404 })
      apiCalls++
      if (!retryEnabled) throw new Error('offline')
      return new Response(JSON.stringify(apiRead), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/conso_enaf_annuel?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { milieux: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(wrapper.text()).toContain('momentanément indisponibles')
    expect(wrapper.find('.vues').exists()).toBe(true)
    expect(wrapper.text()).toContain('L’indicateur')
    expect(wrapper.text()).not.toContain(String(fixtureFacts.find((fact) => fact.territoire === '22001' && fact.detail === '2011')?.value))
    const beforeRetry = apiCalls
    retryEnabled = true
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(apiCalls).toBeGreaterThan(beforeRetry)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/series-datasets/conso_enaf_annuel/territories/commune/22001/conso_enaf_annuel?scope_level=commune&department_id=22')
    expect(wrapper.find('.vues').exists()).toBe(true)
    expect(wrapper.find('.controls').exists()).toBe(true)
    expect(wrapper.text()).toContain('Consommation')
    expect(wrapper.text()).toContain('4,32')
    expect(wrapper.text()).toContain('Département 22')
    expect(wrapper.text()).not.toContain('Territoire de la série')
    await wrapper.findAll('.vues button')[2].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Précautions')
    expect(calls).toContain('theme_milieux')
  })

  it('keeps the legacy indicator facts and does not call the API when the build gate is off by default', async () => {
    vi.stubEnv('VITE_CONSO_ENAF_SERIES_API', '')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/conso_enaf_annuel?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { milieux: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/resources')
    expect(wrapper.text()).not.toContain('momentanément indisponibles')
    expect(wrapper.text()).toContain('12 ha')
    expect(wrapper.find('.vues').exists()).toBe(true)
  })
})

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { indicateursHabitatFixture, indicateursMilieuxFixture, indicateursMobiliteFixture, territoiresFixture } from '../payload/fixtures'
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

// #868 — la classe de densité se lit dans la référence compacte, plus dans le
// modèle par territoire retiré du navigateur.
const referenceReelle: Territoire[] = JSON.parse(readFileSync(
  join(process.cwd(), '..', 'public', 'data', 'territoires.json'), 'utf8'))
function densiteDepuisReference(id: string) {
  const row = referenceReelle.find((territory) => territory.territoire === id)
  return { classe_densite_code: row?.classe_densite_code, classe_densite_libelle_public: row?.classe_densite_libelle_public }
}

async function mountRaccordementPage(options: RaccordementPageOptions) {
  const territories = (options.territories ?? territoiresFixture).map((territory) =>
    territory.territoire === options.targetId && territory.type === options.targetType
      ? { ...territory, ...densiteDepuisReference(options.targetId) }
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
    [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
  } } })
  return { wrapper, router, requests, calls, territories }
}

describe("Page d'indicateur — lecture ordonnée dans le contrat existant", () => {
  it('mounts the current 73-point national trajectory and visible selected mean on the ordinary indicator route', async () => {
      const target = { ...territoiresFixture.find((row) => row.territoire === '22001')!,
      ...densiteDepuisReference('22001') }
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
    { targetId: '200000001', targetType: 'epci' as const, label: 'même niveau territorial (EPCI)', available: true },
    { targetId: '22', targetType: 'departement' as const, label: 'même niveau territorial (départements)', available: true },
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
  it('mounts prix_m2 through the shared producer-declared semantic acquisition', async () => {
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_habitat') return indicateursHabitatFixture
      if (file === 'theme_habitat') return metadataHabitat
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, (item, resource) =>
        nativeReadFixture(item, resource, { territories: territoiresFixture }))
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/habitat/prix_m2?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/resources')
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/resources/read-batch')
      const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
      expect(request.items.map((item: any) => item.resource)).toEqual(['prix_m2', 'prix_m2', 'prix_m2'])
      expect(wrapper.text()).toContain('1 604,33')
      expect(wrapper.text()).toContain('Prix')
    } finally { wrapper.unmount() }
  })
  it('sparse series facts filter the missing member while ranks use published axis_comparisons evidence (#892 P2)', async () => {
    // classes de densité réelles sur les communes du fixture (référence commise) :
    // la portée density_class du fixed_comparison doit porter un code valide égal
    // à celui du focal acquis, sinon l'évidence est rejetée au seam (#892 fail-closed)
    const classe = densiteDepuisReference('22001')
    const territories = territoiresFixture.map((territory) =>
      territory.type === 'commune' ? { ...territory, ...classe } : territory)
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territories
      if (file === 'indicateurs_habitat') return indicateursHabitatFixture
      if (file === 'theme_habitat') return metadataHabitat
      throw new Error(`unexpected static read: ${file}`)
    }
    let sparseSeriesFacts: Array<Record<string, any>> = []
    let sparseEvidence: Record<string, any> | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, (item, resource) => {
        const data = nativeReadFixture(item, resource, { territories })
        // Faits API compacts de la cohorte : quatre membres, mais 22001 n'a
        // aucune observation publiée en 2025. Le point reste déclaré, sans
        // valeur ni provenance, comme une absence de série native.
        if (item.intent?.kind === 'facts' && Array.isArray(data?.series)) {
          sparseSeriesFacts = data.series
          const missingMember = data.series.find((member: any) => member.territory.id === '22001')
          const missingPoint = missingMember?.points.find((point: any) => point.axis === '2025')
          if (missingPoint) Object.assign(missingPoint, {
            value: null, status: 'missing', missing_reason: null, provenance: [],
          })
          for (const member of data.series) {
            const point = member.points.find((candidate: any) => candidate.axis === '2025')
            if (point && member.territory.id !== '22001') {
              point.value = ({ '22002': 3000, '29001': 1000, '29002': 2000 } as Record<string, number>)[member.territory.id]
              point.status = 'measured'
              point.missing_reason = null
            }
          }
        }
        // Preuve sémantique : l'axe 2024 est OBSERVÉ (faits publiés) mais sa
        // comparaison est publiée « unavailable » (aucun rang publié — forme
        // valide du contrat, membre_ranks tous null) ; l'axe 2025 porte une
        // médiane/min/max pour les trois faits mesurés et des rangs API explicites,
        // indépendants de l'ordre des valeurs, jamais recalculés par le navigateur.
        if (item.intent?.kind !== 'facts' && Array.isArray(data?.result?.axis_comparisons)) {
          data.result.axis_comparisons = data.result.axis_comparisons
            .map((comparison: any) => {
              if (comparison.axis === '2024') {
                return { ...comparison, status: 'unavailable', value: null, min: null, max: null,
                  eligible_count: 0, missing_count: comparison.selected_member_count,
                  member_ranks: comparison.member_ranks.map((rank: any) => ({
                    territory_id: rank.territory_id, rank: null, rank_size: null, rank_ties: null })) }
              }
              if (comparison.axis === '2025') {
                const fixtureRanks: Record<string, number> = { '22002': 1, '29001': 2, '29002': 3 }
                return { ...comparison, status: 'available', value: 2000, min: 1000, max: 3000,
                  selected_member_count: 4, eligible_count: 3, missing_count: 1,
                  member_ranks: comparison.member_ranks.map((rank: any) => ({
                    ...rank, rank: fixtureRanks[rank.territory_id] ?? null,
                    rank_size: fixtureRanks[rank.territory_id] ? 3 : null,
                    rank_ties: fixtureRanks[rank.territory_id] ? 1 : null,
                  })) }
              }
              return comparison
            })
          sparseEvidence = data.result.axis_comparisons.find((comparison: any) => comparison.axis === '2025')
        }
        return data
      })
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      const rankCell = (row: ReturnType<typeof wrapper.findAll>[number]) => row.findAll('td')[2]!.text().trim()
      const rowTerritoire = (row: ReturnType<typeof wrapper.findAll>[number]) =>
        (row.find('td a')?.attributes('href') ?? '').split('?')[0]?.split('/').at(-1) ?? ''

      // --- axe comparé (2025, détail par défaut) : quatre membres, trois faits/rangs
      const missing2025 = sparseSeriesFacts.find((member) => member.territory.id === '22001')!
        .points.find((point: any) => point.axis === '2025')
      expect(sparseSeriesFacts).toHaveLength(4)
      expect(missing2025).toMatchObject({ value: null, status: 'missing', missing_reason: null, provenance: [] })
      expect(sparseEvidence).toMatchObject({ status: 'available', statistic: 'median', value: 2000,
        min: 1000, max: 3000, selected_member_count: 4, eligible_count: 3, missing_count: 1 })
      expect(sparseEvidence!.member_ranks).toEqual([
        { territory_id: '22001', rank: null, rank_size: null, rank_ties: null },
        { territory_id: '22002', rank: 1, rank_size: 3, rank_ties: 1 },
        { territory_id: '29001', rank: 2, rank_size: 3, rank_ties: 1 },
        { territory_id: '29002', rank: 3, rank_size: 3, rank_ties: 1 },
      ])
      let rows = wrapper.findAll('.comparison-table-scroll tbody tr')
      expect(rows.length).toBe(3) // le point 2025 manquant de 22001 filtre cette ligne
      expect(new Set(rows.map(rowTerritoire))).toEqual(new Set(['22002', '29001', '29002']))
      const focal = rows.find((row) => row.classes().includes('selection'))!
      expect(rowTerritoire(focal)).toBe('22002')
      // Valeurs mesurées : 3000, 1000, 2000 ; le tableau garde les rangs publiés,
      // non un reclassement local (qui mettrait 22002 dernier, pas premier).
      expect(rankCell(focal)).toBe('1er / 3')
      const parRang = Object.fromEntries(rows.map((row) => [rowTerritoire(row), rankCell(row)]))
      expect(parRang).toEqual({ '22002': '1er / 3', '29001': '2e / 3', '29002': '3e / 3' })

      // --- tri par rang : suit l évidence API (1, 2, 3), pas un autre ordre
      const boutonRang = wrapper.findAll('.comparison-table-scroll thead button')
        .find((bouton) => bouton.text().startsWith('Rang'))!
      await boutonRang.trigger('click')
      await flushPromises()
      rows = wrapper.findAll('.comparison-table-scroll tbody tr')
      expect(rows.map(rowTerritoire)).toEqual(['22002', '29001', '29002'])

      // --- axe observé SANS comparaison publiée (2024) : AUCUN rang affiché, ni focal ni pairs
      await router.push({ query: { ...router.currentRoute.value.query, detail: '2024' } })
      await flushPromises()
      rows = wrapper.findAll('.comparison-table-scroll tbody tr')
      expect(rows.length).toBe(4) // 22001 reste mesurée en 2024
      for (const row of rows) {
        expect(rankCell(row)).toBe('')
      }
    } finally { wrapper.unmount() }
  })

  it('unfiltered commune route: the rank scope note carries the API-declared density class, the caption keeps the listed universe (#892)', async () => {
    // Toutes les communes du fixture partagent la classe de densité de 22001 :
    // le fixed_comparison non filtré du producteur résout alors scope density_class
    // (api/snapshot_reads.py) — la cohorte de rang est la classe, pas la région.
    const classe = densiteDepuisReference('22001')
    expect(classe.classe_densite_code).toBeTruthy()
    const territories = territoiresFixture.map((territory) =>
      territory.type === 'commune' ? { ...territory, ...classe } : territory)
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territories
      if (file === 'indicateurs_habitat') return indicateursHabitatFixture
      if (file === 'theme_habitat') return metadataHabitat
      throw new Error(`unexpected static read: ${file}`)
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, (item, resource) =>
        nativeReadFixture(item, resource, { territories }))
    })
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const monterPrix = async (url: string) => {
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push(url)
      await router.isReady()
      const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
        [PAYLOAD_CHARGER_KEY]: loader,
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      } } })
      return { wrapper, router }
    }
    const { wrapper, router } = await monterPrix('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune')
    try {
      await flushPromises()
      // la légende du tableau garde l'univers LISTÉ (toutes les communes de l'URL)
      const caption = wrapper.find('.comparison-table-scroll caption')
      expect(caption.text()).toContain('Bretagne')
      // Les quatre observations de test sont synthétiques et mesurées ; le rang
      // API porte donc /4, sans dépendre d'une couverture numérique publiée.
      const cells = wrapper.findAll('.comparison-table-scroll tbody tr')
        .map((row) => row.findAll('td')[2]!.text().trim())
      expect(cells.length).toBe(4)
      expect(cells.every((cell) => /^\d+(er|e) \/ 4$/.test(cell))).toBe(true)
      // la note nomme la portée DÉCLARÉE du rang (classe de densité du focal acquis)
      // et la COHORTE (member_count = 4) — sans confondre avec les 3 classés (/3)
      const note = wrapper.get('[data-testid="rang-scope-note"]')
      expect(note.text()).toContain(`portée : ${classe.classe_densite_libelle_public!}`)
      expect(note.text()).toContain('cohorte de comparaison : 4 territoires')
      expect(note.text()).not.toContain('classés')
      // la note utilise le token de texte accessible (contraste AA), pas text-secondary
      const source = readFileSync(join(process.cwd(), 'src', 'views', 'IndicateurPage.vue'), 'utf8')
      expect(source).toMatch(/\.rang-scope-note\{[^}]*var\(--text-primary\)/)
      // changement d'axe réactif : la note garde la portée de la lecture acquise
      // (cohorte 4), les cellules suivent l'axe (2022 : 4 éligibles → /4)
      await router.push({ query: { ...router.currentRoute.value.query, detail: '2022' } })
      await flushPromises()
      const cells2022 = wrapper.findAll('.comparison-table-scroll tbody tr')
        .map((row) => row.findAll('td')[2]!.text().trim())
      expect(cells2022.every((cell) => /^\d+(er|e) \/ 4$/.test(cell))).toBe(true)
      expect(wrapper.get('[data-testid="rang-scope-note"]').text()).toContain('cohorte de comparaison : 4 territoires')
    } finally { wrapper.unmount() }

    // cas filtré (sélection explicite = l'univers listé) : légende seule, pas de note parasite
    const { wrapper: wrapperFiltre } = await monterPrix('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune&departement=22&detail=2022')
    try {
      await flushPromises()
      expect(wrapperFiltre.find('.comparison-table-scroll caption').text()).toContain('Département 22')
      // rangs présents à 2022 (22001 et 22002 mesurées, eligible = 2) mais la portée
      // est la sélection explicite = l'univers listé : aucune note de portée séparée
      const cells = wrapperFiltre.findAll('.comparison-table-scroll tbody tr')
        .map((row) => row.findAll('td')[2]!.text().trim())
      expect(cells.length).toBe(2)
      expect(cells.every((cell) => /^\d+(er|e) \/ \d+$/.test(cell))).toBe(true)
      expect(wrapperFiltre.find('[data-testid="rang-scope-note"]').exists()).toBe(false)
    } finally { wrapperFiltre.unmount() }

    // filtre COMBINÉ département+EPCI : la légende nomme les DEUX identités sourcées
    // (jamais le département seul), sélection explicite = univers listé → pas de note
    const { wrapper: wrapperCombine } = await monterPrix('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune&departement=22&epci=200000001&detail=2022')
    try {
      await flushPromises()
      expect(wrapperCombine.find('.comparison-table-scroll caption').text()).toContain('Département 22 · EPCI 200000001')
      expect(wrapperCombine.find('[data-testid="rang-scope-note"]').exists()).toBe(false)
    } finally { wrapperCombine.unmount() }

    // SANS territoire dans l'URL : le focal réel vient de la lecture acquise
    // (repli du chargeur), pas d'une devinette d'URL — la note se résout quand même
    const { wrapper: wrapperSansCible } = await monterPrix('/indicateurs/habitat/prix_m2?niveau=commune')
    try {
      await flushPromises()
      expect(wrapperSansCible.find('.comparison-table-scroll caption').text()).toContain('Bretagne')
      const note = wrapperSansCible.get('[data-testid="rang-scope-note"]')
      expect(note.text()).toContain(`portée : ${classe.classe_densite_libelle_public!}`)
    } finally { wrapperSansCible.unmount() }
  })

  it('mixed density classes: only cohort members carry API ranks, outside IDs stay rankless; mismatch scope is rejected at the acquisition seam (#892)', async () => {
    // classes réelles de la référence : 22001/22002 -> 5 (bourgs ruraux bretons), 29001/29002 -> 6
    const classe5 = densiteDepuisReference('22002')
    const classe6 = densiteDepuisReference('29001')
    expect(classe5.classe_densite_code).not.toBe(classe6.classe_densite_code)
    const territories = territoiresFixture.map((territory) => {
      if (territory.territoire === '29001' || territory.territoire === '29002') return { ...territory, ...classe6 }
      if (territory.type === 'commune') return { ...territory, ...classe5 }
      return territory
    })
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territories
      if (file === 'indicateurs_habitat') return indicateursHabitatFixture
      if (file === 'theme_habitat') return metadataHabitat
      throw new Error(`unexpected static read: ${file}`)
    }
    let forcerClasseIncoherente = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, (item, resource) => {
        const data = nativeReadFixture(item, resource, { territories })
        // cas de rejet : la comparaison déclare une classe de densité qui ne
        // correspond PAS au focal acquis (code '1' vs classe 5 du focal 22002)
        if (forcerClasseIncoherente && item.intent?.kind !== 'facts' && data?.scope) {
          data.scope = { ...data.scope, density_class_code: '1' }
        }
        return data
      })
    })
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const monterPrix = async (url: string) => {
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push(url)
      await router.isReady()
      return mount(IndicateurView, { global: { plugins: [router], provide: {
        [PAYLOAD_CHARGER_KEY]: loader,
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      } } })
    }
    const celluleRang = (row: ReturnType<typeof wrapper.findAll>[number]) => row.findAll('td')[2]!.text().trim()
    const territoireDe = (row: ReturnType<typeof wrapper.findAll>[number]) =>
      (row.find('td a')?.attributes('href') ?? '').split('?')[0]?.split('/').at(-1) ?? ''

    // --- cas nominal : focal 22002 (classe 5), non filtré, axe 2022 (22001+22002 mesurées)
    const wrapper = await monterPrix('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune&detail=2022')
    try {
      await flushPromises()
      const rows = wrapper.findAll('.comparison-table-scroll tbody tr')
      expect(rows.length).toBe(4) // le tableau LISTE les 4 communes de l'URL
      const rangs = Object.fromEntries(rows.map((row) => [territoireDe(row), celluleRang(row)]))
      // dans la cohorte (classe 5 = 22001+22002) : rangs API publiés ; hors cohorte : aucun
      expect(rangs['22001']).toMatch(/^\d+(er|e) \/ 2$/)
      expect(rangs['22002']).toMatch(/^\d+(er|e) \/ 2$/)
      expect(rangs['29001']).toBe('')
      expect(rangs['29002']).toBe('')
      const note = wrapper.get('[data-testid="rang-scope-note"]')
      expect(note.text()).toContain(`portée : ${classe5.classe_densite_libelle_public!}`)
      expect(note.text()).toContain('cohorte de comparaison : 2 territoires')
    } finally { wrapper.unmount() }

    // --- cas de rejet : scope density_class incohérent avec le focal acquis ->
    // la comparaison est rejetée au seam d'acquisition (facts admis, pas de rangs)
    forcerClasseIncoherente = true
    const wrapperRejet = await monterPrix('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune&detail=2022')
    try {
      await flushPromises()
      const rows = wrapperRejet.findAll('.comparison-table-scroll tbody tr')
      expect(rows.length).toBe(4) // les faits admis restent listés
      for (const row of rows) expect(celluleRang(row)).toBe('') // aucun rang sans évidence valide
      expect(wrapperRejet.find('[data-testid="rang-scope-note"]').exists()).toBe(false)
    } finally { wrapperRejet.unmount() }
  })

  it('retains admitted prix_m2 cohort facts when a warm same-cohort focal read gets HTTP 503', async () => {
      const requests: Array<{ items: Array<Record<string, any>>; status: number }> = []
    let admittedCohort: Record<string, any> | undefined
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_habitat') return indicateursHabitatFixture
      if (file === 'theme_habitat') return metadataHabitat
      throw new Error(`unexpected static read: ${file}`)
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === '/api/resources') return nativeCatalogueResponse()
      if (path !== '/api/resources/read-batch') throw new Error(`unexpected network request: ${path}`)
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      if (requests.length === 0) {
        requests.push({ items, status: 200 })
        const response = await nativeBatchResponse(items, (item, resource) =>
          nativeReadFixture(item, resource, { territories: territoiresFixture }))
        const json = await response.clone().json() as { results: Array<{ data: Record<string, any> }> }
        admittedCohort = json.results.find((result) => result.data.target?.kind === 'territory_cohort')!.data
        return response
      }
      const status = requests.length === 1 || requests.length === 3 ? 503 : 200
      requests.push({ items, status })
      if (status === 503) return new Response('native read-batch unavailable', { status })
      return nativeBatchResponse(items, (item, resource) =>
        nativeReadFixture(item, resource, { territories: territoiresFixture }))
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/habitat/prix_m2?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(requests[0]?.status).toBe(200)
      expect(requests[0]?.items).toHaveLength(3)
      expect(wrapper.text()).toContain('1 604,33')
      expect(wrapper.find('figure[data-renderer="trajectory"]').exists()).toBe(true)
      const oldFocalFact = requests[0]!.items[1]
      expect(oldFocalFact.target).toMatchObject({ kind: 'territory', id: '22001' })

      await router.replace('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune&departement=22')
      await flushPromises()

      expect(requests).toHaveLength(2)
      expect(requests[1]?.status).toBe(503)
      expect(requests[1]?.items).toHaveLength(1)
      expect(requests[1]?.items[0]).toMatchObject({ intent: { kind: 'facts' },
        target: { kind: 'territory', type: 'commune', id: '22002' } })
      // A failed new-focal read may not leave the previous focal's curve on screen;
      // render only values actually admitted in the correct cohort, if present.
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
      expect(wrapper.find('figure[data-renderer="trajectory"]').exists()).toBe(true)
      const focalGroup = admittedCohort!.series.find((group: any) => group.territory.id === '22002')
      expect(focalGroup).toBeDefined()
      expect(wrapper.findAll('.trajectoire-territoire-point').map((point) => [
        point.attributes('data-detail'), Number(point.attributes('data-value')),
      ])).toEqual(focalGroup.points.filter((point: any) => point.status === 'measured')
        .map((point: any) => [point.axis, point.value]))
      const exactFocalValues = wrapper.findAll('.trajectoire-territoire-point')
        .map((point) => Number(point.attributes('data-value')))
      expect(exactFocalValues).not.toEqual([])

      // Retry the genuinely uncached focal facts, then make the later
      // comparison-only batch fail. Both admitted cohort and focal facts remain.
      await wrapper.get('[role="alert"] button').trigger('click')
      await flushPromises()
      expect(requests).toHaveLength(4)
      expect(requests[2]?.items).toHaveLength(1)
      expect(requests[2]?.items[0]).toMatchObject({ intent: { kind: 'facts' },
        target: { kind: 'territory', type: 'commune', id: '22002' } })
      expect(requests[2]?.status).toBe(200)
      expect(requests[3]?.items).toHaveLength(1)
      expect(requests[3]?.items[0]?.intent.kind).toBe('selected_comparison')
      expect(requests[3]?.status).toBe(503)
      expect(wrapper.find('[data-testid="series-comparison-error"]').exists()).toBe(true)
      expect(wrapper.findAll('.trajectoire-territoire-point').map((point) => Number(point.attributes('data-value'))))
        .toEqual(exactFocalValues)
      await wrapper.get('[data-testid="series-comparison-error"] button').trigger('click')
      await flushPromises()
      expect(requests).toHaveLength(5)
      expect(requests[4]?.items).toHaveLength(1)
      expect(requests[4]?.items[0]?.intent.kind).toBe('selected_comparison')
      expect(requests[4]?.status).toBe(200)
      expect(requests.slice(2).flatMap((entry) => entry.items.filter((item) => item.intent.kind === 'facts')))
        .toHaveLength(1)
      const requestTrace = requests.map(({ items, status }) => ({ status, items: items.map((item) => ({
        resource: item.resource, intent: item.intent.kind, target: item.target,
      })) }))
      expect(wrapper.find('figure[data-renderer="trajectory"]').exists(),
        `warm validated cohort facts should remain rendered after comparison batch 503; trace=${JSON.stringify(requestTrace)}`)
        .toBe(true)
    } finally { wrapper.unmount() }
  })

  it.each(['series', 'scalar'] as const)(
    'refreshes only the mounted prix_m2 scope after the %s publication changes', async (changedFacet) => {
      const requests: Array<Array<Record<string, any>>> = []
    let publication = 1
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_habitat') return indicateursHabitatFixture
      if (file === 'theme_habitat') return metadataHabitat
      throw new Error(`unexpected static read: ${file}`)
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === '/api/resources') return nativeCatalogueResponse()
      if (path !== '/api/resources/read-batch') throw new Error(`unexpected network request: ${path}`)
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      requests.push(items)
      return nativeBatchResponse(items, (item, resource) => {
        const data = nativeReadFixture(item, resource, { territories: territoiresFixture })
        if (publication === 2) {
          if (changedFacet === 'series') {
            data.content_version = 'prix_m2-fixture-publication-v2'
            if (data.publication_id) data.publication_id = 'prix_m2-fixture-publication-v2'
          }
          if (data.scalar_facet) {
            data.scalar_facet.content_version = changedFacet === 'scalar'
              ? 'prix_m2-fixture-publication-v2-scalar-facet-v1'
              : 'prix_m2-fixture-publication-v1-scalar-facet-v1'
            data.scalar_facet.reference_content_version = 'semantic-reference-fixture-v1'
          }
        }
        if (publication === 2 && changedFacet === 'series' &&
            item.target.kind === 'territory' && item.intent.kind === 'facts') {
          data.points = data.points.map((point: Record<string, any>) => ({ ...point,
            value: point.value === null ? null : point.value + 100 }))
        }
        if (publication === 2 && changedFacet === 'series' && Array.isArray(data.series)) {
          data.series = data.series.map((group: Record<string, any>) => ({ ...group,
            points: group.points.map((point: Record<string, any>) => ({ ...point,
              value: point.value === null ? null : point.value + 100 })) }))
        }
        if (publication === 2 && changedFacet === 'series' && item.intent.kind !== 'facts') {
          data.content_version = 'prix_m2-fixture-publication-v2'
        }
        return data
      })
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/habitat/prix_m2?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(requests).toHaveLength(1)
      await router.replace('/indicateurs/habitat/prix_m2?territoire=29001&niveau=commune&departement=29')
      await flushPromises()
      expect(requests).toHaveLength(2)
      const siblingValues = wrapper.findAll('.trajectoire-territoire-point')
        .map((point) => Number(point.attributes('data-value')))
      publication = 2
      await router.replace('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune&departement=22')
      await flushPromises()
      expect(requests).toHaveLength(3)
      expect(requests[2]).toHaveLength(1)
      expect(requests[2]?.[0]?.intent.kind).toBe('facts')
      expect(wrapper.get('[data-testid="series-comparison-error"]').text()).toContain('publication a changé')
      expect(wrapper.get('[data-testid="series-comparison-error"] button').text()).toContain('Actualiser les faits')
      const staleValues = wrapper.findAll('.trajectoire-territoire-point')
        .map((point) => Number(point.attributes('data-value')))
      await wrapper.get('[data-testid="series-comparison-error"] button').trigger('click')
      await flushPromises()
      expect(requests).toHaveLength(4)
      expect(requests[3]).toHaveLength(3)
      expect(requests[3]?.map((item) => item.intent.kind)).toEqual(['facts', 'facts', 'selected_comparison'])
      expect(wrapper.find('[data-testid="series-comparison-error"]').exists()).toBe(false)
      const refreshedValues = wrapper.findAll('.trajectoire-territoire-point')
        .map((point) => Number(point.attributes('data-value')))
      expect(refreshedValues).toEqual(changedFacet === 'series'
        ? staleValues.map((value) => value + 100) : staleValues)
      await router.replace('/indicateurs/habitat/prix_m2?territoire=29001&niveau=commune&departement=29')
      await flushPromises()
      expect(requests).toHaveLength(4)
      expect(wrapper.findAll('.trajectoire-territoire-point').map((point) => Number(point.attributes('data-value'))))
        .toEqual(siblingValues)
    } finally { wrapper.unmount() }
    })

  it('keeps a delayed old focal reply out of the refreshed mounted page and cache generation', async () => {
      const requests: Array<Array<Record<string, any>>> = []
    let publication: 1 | 2 = 1
    let deferOldFocal = true
    let initialPeerValues: number[] = []
    let refreshedPeerValues: number[] = []
    let refreshedInitialFocalValues: number[] = []
    let releaseOldFocal!: (response: Response) => void
    let oldFocalStarted!: () => void
    const oldFocalSeen = new Promise<void>((resolve) => { oldFocalStarted = resolve })
    const oldFocalReply = new Promise<Response>((resolve) => { releaseOldFocal = resolve })
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_habitat') return indicateursHabitatFixture
      if (file === 'theme_habitat') return metadataHabitat
      throw new Error(`unexpected static read: ${file}`)
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === '/api/resources') return nativeCatalogueResponse()
      if (path !== '/api/resources/read-batch') throw new Error(`unexpected network request: ${path}`)
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      requests.push(items)
      const response = await nativeBatchResponse(items, (item, resource) => {
        const data = nativeReadFixture(item, resource, { territories: territoiresFixture })
        if (item.target.kind === 'territory_cohort' && Array.isArray(data.series)) {
          const peer = data.series.find((group: Record<string, any>) => group.territory.id === '22002')
          if (peer && publication === 1) initialPeerValues = peer.points
            .filter((point: Record<string, any>) => point.status === 'measured').map((point: Record<string, any>) => point.value)
        }
        if (publication === 2) {
          data.content_version = 'prix_m2-fixture-publication-v2'
          if (data.publication_id) data.publication_id = 'prix_m2-fixture-publication-v2'
          if (data.scalar_facet) {
            data.scalar_facet.content_version = 'prix_m2-fixture-publication-v1-scalar-facet-v1'
            data.scalar_facet.reference_content_version = 'semantic-reference-fixture-v1'
          }
          if (item.target.kind === 'territory' && item.intent.kind === 'facts') {
            data.points = data.points.map((point: Record<string, any>) => ({ ...point,
              value: point.value === null ? null : point.value + 100 }))
          }
          if (Array.isArray(data.series)) data.series = data.series.map((group: Record<string, any>) => ({ ...group,
            points: group.points.map((point: Record<string, any>) => ({ ...point,
              value: point.value === null ? null : point.value + 100 })) }))
          if (item.target.kind === 'territory_cohort' && Array.isArray(data.series)) {
            const peer = data.series.find((group: Record<string, any>) => group.territory.id === '22002')
            if (peer) refreshedPeerValues = peer.points
              .filter((point: Record<string, any>) => point.status === 'measured')
              .map((point: Record<string, any>) => point.value)
            const initialFocal = data.series.find((group: Record<string, any>) => group.territory.id === '22001')
            if (initialFocal) refreshedInitialFocalValues = initialFocal.points
              .filter((point: Record<string, any>) => point.status === 'measured')
              .map((point: Record<string, any>) => point.value)
          }
          if (item.intent.kind !== 'facts') data.content_version = 'prix_m2-fixture-publication-v2'
        }
        return data
      })
      if (deferOldFocal && items.length === 1 && items[0]?.target.kind === 'territory' &&
          items[0]?.target.id === '22002') {
        deferOldFocal = false
        oldFocalStarted()
        return oldFocalReply
      }
      return response
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/habitat/prix_m2?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      await router.replace('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune&departement=22')
      await oldFocalSeen
      await router.replace('/indicateurs/habitat/prix_m2?territoire=29001&niveau=commune&departement=29')
      await flushPromises()
      publication = 2
      await router.replace('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune&departement=22')
      await flushPromises()
      expect(wrapper.get('[data-testid="series-comparison-error"] button').text()).toContain('Actualiser les faits')
      await wrapper.get('[data-testid="series-comparison-error"] button').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="series-comparison-error"]').exists()).toBe(false)
      const refreshedValues = wrapper.findAll('.trajectoire-territoire-point')
        .map((point) => Number(point.attributes('data-value')))
      expect(refreshedValues).toEqual(refreshedPeerValues)
      expect(refreshedValues).toEqual(initialPeerValues.map((value) => value + 100))

      releaseOldFocal(await nativeBatchResponse(requests[1]!, (item, resource) =>
        nativeReadFixture(item, resource, { territories: territoiresFixture })))
      await flushPromises()
      expect(wrapper.findAll('.trajectoire-territoire-point').map((point) => Number(point.attributes('data-value'))))
        .toEqual(refreshedValues)
      await router.replace('/indicateurs/habitat/prix_m2?territoire=22001&niveau=commune&departement=22')
      await flushPromises()
      expect(wrapper.find('[data-testid="series-comparison-error"]').exists()).toBe(false)
      expect(wrapper.findAll('.trajectoire-territoire-point')
        .filter((point) => point.attributes('data-value') !== undefined)
        .map((point) => Number(point.attributes('data-value'))))
        .toEqual(refreshedInitialFocalValues)
      const countAfterRefresh = requests.length
      await router.replace('/indicateurs/habitat/prix_m2?territoire=29001&niveau=commune&departement=29')
      await flushPromises()
      await router.replace('/indicateurs/habitat/prix_m2?territoire=22002&niveau=commune&departement=22')
      await flushPromises()
      expect(requests).toHaveLength(countAfterRefresh)
      expect(wrapper.findAll('.trajectoire-territoire-point').map((point) => Number(point.attributes('data-value'))))
        .toEqual(refreshedValues)
      expect(requests[1]?.[0]?.target).toMatchObject({ kind: 'territory', id: '22002' })
    } finally { wrapper.unmount() }
  })
  it('waits for delayed metadata before choosing a series route when both API gates are enabled', async () => {
    let publishMetadata!: (metadata: typeof metadataMilieux) => void
    const metadata = new Promise<typeof metadataMilieux>((resolve) => { publishMetadata = resolve })
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadata
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, (item, resource) =>
        nativeReadFixture(item, resource, { territories: territoiresFixture }))
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/resources')
      publishMetadata(metadataMilieux)
      await flushPromises()
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/resources/read-batch')
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).items[0].resource).toBe('artif_par_habitant')
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
  it('uses one API batch when a legacy calendar URL canonicalizes to the supported M3 role', async () => {
    localStorage.removeItem('lusk:niveau-indicateur')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, (item, resource) =>
        nativeReadFixture(item, resource, { territories: territoiresFixture }))
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await router.replace({ query: { ...router.currentRoute.value.query, detail: '2025' } })
    await flushPromises()
    const batchCalls = fetchMock.mock.calls.filter(([input]) => String(input) === '/api/resources/read-batch')
    expect(batchCalls).toHaveLength(1)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/resources')
    expect(batchCalls[0]?.[0]).toBe('/api/resources/read-batch')
    expect(JSON.parse(String(batchCalls[0]?.[1]?.body)).items.map((item: any) => item.resource))
      .toEqual(['artif_par_habitant', 'artif_par_habitant', 'artif_par_habitant'])
    expect(router.currentRoute.value.query.detail).toBe('M3')
    expect(wrapper.text()).toContain('Comparaison non publiée')
    wrapper.unmount()
  })

  it('keeps OCS-GE calendar observations factual while exposing only supported comparison roles', async () => {
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    let apiAvailable = false
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      if (!apiAvailable) throw new Error('semantic API unavailable')
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, (item, resource) =>
        nativeReadFixture(item, resource, { territories: territoiresFixture }))
    })
    const router=createRouter({history:createMemoryHistory(),routes})
    await router.push('/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune&departement=22&detail=2021')
    await router.isReady()
    const empty={type:'FeatureCollection' as const,features:[]}
    const wrapper=mount(IndicateurView,{global:{plugins:[router],provide:{
      [PAYLOAD_CHARGER_KEY]:loader,
      [GEOMETRIE_CHARGER_KEY]:async()=>({communes:empty,epcis:empty,departements:empty}),
    }}})
    await flushPromises()
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/resources/read-batch')).toBe(true)
    expect(wrapper.text()).toContain('momentanément indisponibles')
    apiAvailable=true
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('momentanément indisponibles')
    const producerResource = nativeResources('milieux').find((resource) =>
      resource.resource_id === 'artif_par_habitant')!
    const syntheticFacts = nativeReadFixture({ target: { kind: 'territory', type: 'commune', id: '22001' },
      intent: { kind: 'facts' } }, producerResource, { territories: territoiresFixture })
    const expectedValue = (syntheticFacts.points as Array<Record<string, any>>)
      .find((point) => point.axis === '2025')?.value
    expect(wrapper.find('.trajectoire-territoire-point[data-detail="2025"]').attributes('data-value'))
      .toBe(String(expectedValue))
    expect(wrapper.text()).toContain('Comparaison non publiée pour')
  })

  it('preserves the page grammar and comparison scope, adapts API facts, and never falls back to static series on failure', async () => {
    const calls: string[] = []
    const loader: ChargerFichier = async (file) => {
      calls.push(file)
      if (file === 'territoires') return territoiresFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    let apiCalls = 0
    let retryEnabled = false
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === '/api/resources') return nativeCatalogueResponse()
      if (String(input) !== '/api/resources/read-batch') return new Response('{}', { status: 404 })
      apiCalls++
      if (!retryEnabled) throw new Error('offline')
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, (item, resource) =>
        nativeReadFixture(item, resource, { territories: territoiresFixture }))
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/conso_enaf_annuel?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(wrapper.text()).toContain('momentanément indisponibles')
    expect(wrapper.find('.vues').exists()).toBe(true)
    expect(wrapper.text()).toContain('L’indicateur')
    expect(wrapper.find('.trajectoire-territoire-point[data-detail="2011"]').exists()).toBe(false)
    const beforeRetry = apiCalls
    retryEnabled = true
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(apiCalls).toBeGreaterThan(beforeRetry)
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/resources/read-batch')
    expect(wrapper.find('.vues').exists()).toBe(true)
    expect(wrapper.find('.controls').exists()).toBe(true)
    expect(wrapper.text()).toContain('Consommation')
    const annualResource = nativeResources('milieux').find((resource) =>
      resource.resource_id === 'conso_enaf_annuel')!
    const expectedSeries = nativeReadFixture({ target: { kind: 'territory', type: 'commune', id: '22001' },
      intent: { kind: 'facts' } }, annualResource, { territories: territoiresFixture })
    const expected2011 = (expectedSeries.points as Array<Record<string, any>>)
      .find((point) => point.axis === '2011')?.value
    expect(wrapper.find('.trajectoire-territoire-point[data-detail="2011"]').attributes('data-value'))
      .toBe(String(expected2011))
    expect(wrapper.text()).toContain('Département 22')
    expect(wrapper.text()).not.toContain('Territoire de la série')
    await wrapper.findAll('.vues button')[2].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Précautions')
    expect(calls).toContain('theme_milieux')
  })

  it('uses the API with retired gate variables absent and never exposes the legacy page facts on failure', async () => {
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input) === '/api/resources' ? nativeCatalogueResponse() : new Response('', { status: 503 }))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/conso_enaf_annuel?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/resources/read-batch')).toBe(true)
    expect(wrapper.text()).toContain('momentanément indisponibles')
    expect(wrapper.find('.vues').exists()).toBe(true)
  })
})

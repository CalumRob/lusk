import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TerritoireView from '../views/TerritoireView.vue'
import BlocProgrammes from '../components/fiche/BlocProgrammes.vue'
import GraphiqueQuadrantMilieux from '../components/fiche/GraphiqueQuadrantMilieux.vue'
import GraphiqueSoldes from '../components/fiche/GraphiqueSoldes.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import { contextesDepuisReference } from '../fiche/comparisonContext'
import { chapitreDemande } from '../fiche/content/demandInventory'
import type { SemanticResourceDeclaration } from '../payload/semanticResourceClient'
import { formaterValeur } from '../payload/selectors'
import {
  territoiresFixture,
} from '../payload/fixtures'
import type { Payload, Territoire } from '../payload/types'
import { chargerMetadonneesTheme, THEME_METADATA_CHARGER_KEY } from '../payload/themeCatalogue'
import type { ChargerMetadonneesTheme } from '../payload/themeCatalogue'
import { TERRITORY_REFERENCE_CHARGER_KEY } from '../payload/territoryReference'
import type { ChargerReferenceTerritoires } from '../payload/territoryReference'
import { acquireThemeFacts } from '../payload/themeAcquisition'
import { fetchAedarAggregates } from '../fiche/content/aedarApiClient'
import { AEDAR_AGGREGATE_READING_KEYS } from '../fiche/content/aedarTimeRampFacts'
import { AEDAR_TYPEQU_REGISTRY } from '../fiche/content/aedarTypequRegistry'
import {
  semanticComparisonForTheme,
  themeFactsRowsFromSemantic,
  validerReponseComparaisonTheme,
} from '../payload/themeFactsAdapter'
import { PayloadError, validerTerritoires, validerCatalogueNavigateur } from '../payload/validate'
import { routes } from '../router'
import {
  nativeBatchResponse,
  nativeCatalogueResponse,
  nativePublicationFamily,
  nativeReadFixture,
  nativeResources,
} from './helpers/semanticApiFixtures'

const fetchBloque = vi.fn(async (input: RequestInfo | URL) => {
  throw new Error(`Accès réseau réel interdit dans ce test : ${String(input)}`)
})

/** #868 — the mounted fiche bootstraps from the reference seam, never from a
 *  per-territory model. The default reference is the synthetic fixture table;
 *  tests that need the real published reference inject `chargerReferenceReelle`. */
const chargerReferenceFixture: ChargerReferenceTerritoires = async () => territoiresFixture
const referenceReelle = validerTerritoires(
  JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8')),
  'territoires.json',
)
const chargerReferenceReelle: ChargerReferenceTerritoires = async () => referenceReelle
const cibleReference = (id: string): Territoire =>
  referenceReelle.find((candidate) => candidate.territoire === id)!
const contextesReference = (id: string) => contextesDepuisReference(cibleReference(id), referenceReelle)
const lireMetadataSnapshot = (theme: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), `../public/data/theme_${theme}.json`), 'utf8')) as Record<string, any>

function syntheticResourceRead(theme: string, resourceId: string, territoryId = '22001') {
  const resource = nativeResources(theme).find((candidate) => candidate.resource_id === resourceId)
  if (!resource) throw new Error(`Missing producer resource ${theme}/${resourceId}`)
  return nativeReadFixture({ target: { kind: 'territory', type: 'commune', id: territoryId },
    intent: { kind: 'facts' } }, resource)
}

function syntheticReadingRead(theme: string, territoryId = '22001'): Record<string, any> {
  const resource = nativeResources(theme).find((candidate) =>
    candidate.shapes.includes('typed_reading') && candidate.target_kinds.includes('territory'))
  if (!resource) throw new Error(`Missing producer reading resource for ${theme}`)
  const response = nativeReadFixture({ target: { kind: 'territory', type: 'commune', id: territoryId },
    intent: { kind: 'facts' } }, resource)
  return response.facts?.[0] ?? {}
}

function syntheticTopActivityLabel(): string {
  const resource = nativeResources('economie').find((candidate) =>
    candidate.resource_id === 'economie_selected_reading')!
  const response = nativeReadFixture({ target: { kind: 'territory', type: 'commune', id: '22001' },
    intent: { kind: 'facts' } }, resource)
  return response.ranked_activities?.[0]?.activity_label ?? ''
}

function nativeFicheReadFixture(item: Record<string, any>, resource: Parameters<typeof nativeReadFixture>[1]) {
  return nativeReadFixture(item, resource, { syntheticProfileComparisons: true })
}

function aedarSummaryFixture(item: Record<string, any>, summaryContentVersion = 'aedar-summary-fixture-v1',
  aedarContentVersion = 'aedar_territorial_aggregate-fixture-publication-v1',
  referenceContentVersion = 'semantic-reference-fixture-v1') {
  const target = item.target
  const diversity = target.id === '22001' ? 5 : target.type === 'epci' ? 2.5 : 3.5
  const volume = target.id === '22001' ? 11 : target.type === 'epci' ? 7 : 9
  return {
    resource: item.resource, target,
    territory: { territory_type: target.type, territory_id: target.id },
    summary_content_version: summaryContentVersion,
    aedar_content_version: aedarContentVersion,
    reference_content_version: referenceContentVersion,
    readings: AEDAR_AGGREGATE_READING_KEYS.map((measure) => ({
      measure, value: measure.toLowerCase().includes('diversity') ? diversity : volume,
      status: 'available', n_typequ: AEDAR_TYPEQU_REGISTRY.length, n_addresses: 100,
      n_observed: 90, coverage_status: 'covered', statistic: 'direct',
      source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
      licence: 'ODbL', attribution: 'AEDAR', reference_date: '2026-01-01', publication_date: '2026-09-30',
    })),
  }
}

function aedarComparisonFixture(item: Record<string, any>, summaryClock: string,
  aedarContentVersion = 'aedar_territorial_aggregate-fixture-publication-v1',
  referenceContentVersion = 'semantic-reference-fixture-v1') {
  const measures = item.coordinates.measure as string[]
  const selected = item.intent.kind === 'selected_comparison'
  const memberCount = selected ? item.intent.members.length : 0
  const context = selected ? null : item.intent.context
  const values = selected
    ? memberCount === 1 ? { diversity: 5, volume: 11 } : { diversity: 23, volume: 41 }
    : context === 'epci' ? { diversity: 13, volume: 29 }
      : context === 'density_class' ? { diversity: 17, volume: 31 }
        : context === 'bretagne' ? { diversity: 19, volume: 37 }
          : { diversity: 21, volume: 39 }
  const rows = measures.map((measure) => ({
    typequ: null, measure,
    comparison_context: selected ? 'selected_comparison' : item.intent.context,
    statistic: selected ? 'pooled' : 'direct',
    group_value: measure.toLowerCase().includes('diversity') ? values.diversity : values.volume,
    group_n_addresses: 100, group_n_observed: 90, group_coverage_status: 'covered',
    source_id: 'aedar_bretagne', vintage_id: '2026-v1', reference_date: '2026-01-01', publication_date: '2026-09-30',
    direction: 'high',
    rank: selected && memberCount > 1 ? 1 : null,
    rank_size: selected && memberCount > 1 ? memberCount : null,
    rank_ties: selected && memberCount > 1 ? 1 : null,
  }))
  return {
    resource: item.resource, target: item.target, content_version: 'aedar-comparison-fixture-v1',
    summary_content_version: summaryClock,
    aedar_content_version: aedarContentVersion,
    reference_content_version: referenceContentVersion,
    ...(selected ? {
      selection: item.intent.members.map((member: any) => ({ territory_type: member.type, territory_id: member.id })),
      scope: { kind: 'explicit_selection', member_count: memberCount }, comparisons: rows,
    } : { comparison: rows[0] }),
  }
}

function nativeSemanticFetch(requests: Array<Array<Record<string, any>>> = [], options: {
  failSummary?: (items: Array<Record<string, any>>) => boolean
  failTypedDetail?: (items: Array<Record<string, any>>) => boolean
  unavailableTypedDetail?: (items: Array<Record<string, any>>) => boolean
  summaryContentVersion?: () => string
  aedarContentVersion?: () => string
  referenceContentVersion?: () => string
  comparisonSummaryClock?: () => string
  comparisonAedarClock?: () => string
  comparisonReferenceClock?: () => string
} = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url === '/api/resources/read-batch') {
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      requests.push(items)
      if (items.some((item) => item.resource === 'aedar_territory_summary') && options.failSummary?.(items)) {
        return new Response('', { status: 503 })
      }
      if (items.some((item) => item.resource === 'aedar_territorial_aggregate' && item.intent?.kind === 'facts')
        && options.failTypedDetail?.(items)) return new Response('', { status: 503 })
      if (items.every((item) => item.resource === 'aedar_territorial_aggregate' && item.intent?.kind === 'facts')
        && options.unavailableTypedDetail?.(items)) {
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
          results: items.map((item) => ({ id: item.id, resource: item.resource,
            status: 'publication_unavailable', reason: 'publication_absent', family: 'aedar' })) }),
        { status: 200 })
      }
      const comparisonClock = options.comparisonSummaryClock?.() ?? 'aedar-summary-fixture-v1'
      const comparisonAedarClock = options.comparisonAedarClock?.() ?? 'aedar_territorial_aggregate-fixture-publication-v1'
      const comparisonReferenceClock = options.comparisonReferenceClock?.() ?? 'semantic-reference-fixture-v1'
      if (items.every((item) => item.resource === 'aedar_territorial_aggregate' && item.intent?.kind !== 'facts'
        && !(item.coordinates?.typequ?.length))) {
        const results = items.map((item) => ({ id: item.id, resource: item.resource, status: 'available',
          data: aedarComparisonFixture(item, comparisonClock, comparisonAedarClock, comparisonReferenceClock) }))
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results }), { status: 200 })
      }
      return nativeBatchResponse(items, (item, resource) => {
        if (resource.resource_id === 'aedar_territory_summary') return aedarSummaryFixture(item,
          options.summaryContentVersion?.() ?? 'aedar-summary-fixture-v1',
          options.aedarContentVersion?.() ?? 'aedar_territorial_aggregate-fixture-publication-v1',
          options.referenceContentVersion?.() ?? 'semantic-reference-fixture-v1')
        if (resource.resource_id === 'aedar_territorial_aggregate' && item.intent?.kind !== 'facts'
          && !(item.coordinates?.typequ?.length)) {
          return aedarComparisonFixture(item, comparisonClock, comparisonAedarClock, comparisonReferenceClock)
        }
        return nativeFicheReadFixture(item, resource)
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

async function monter(
  chemin: string,
  charger: ChargerReferenceTerritoires = chargerReferenceFixture,
  chargerMetadata: ChargerMetadonneesTheme = async (theme) => validerCatalogueNavigateur(
    JSON.parse(readFileSync(resolve(process.cwd(), `../public/data/theme_${theme}.json`), 'utf8')),
    `theme_${theme}.json`,
  ),
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(TerritoireView, {
    global: {
      plugins: [router],
      provide: {
        [TERRITORY_REFERENCE_CHARGER_KEY]: charger,
        [THEME_METADATA_CHARGER_KEY]: chargerMetadata,
      },
    },
  })
  await flushPromises()
  return { router, wrapper, charger }
}

describe('TerritoireView — modèle atomique par territoire', () => {
  it('renders native Programmes facts while the active catalogue is held, then retries it metadata-only', async () => {
    let notifyMetadataStarted!: () => void
    const metadataStarted = new Promise<void>((resolve) => { notifyMetadataStarted = resolve })
    let releaseMetadata!: (response: Response) => void
    const heldMetadata = new Promise<Response>((resolve) => { releaseMetadata = resolve })
    const focalRequests: Array<Array<Record<string, any>>> = []
    let metadataCalls = 0
    const programmeResources = nativeResources('programmes')
    const annual = programmeResources.find((resource) => resource.resource_id === 'subventions_annuelles')!
    const fetchAll = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/data/theme_')) {
        metadataCalls += 1
        if (metadataCalls === 1) {
          notifyMetadataStarted()
          return heldMetadata
        }
        const metadata = readFileSync(resolve(process.cwd(), '../public/data/theme_programmes.json'), 'utf8')
        return new Response(metadata, { status: 200 })
      }
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        focalRequests.push(items)
        return nativeBatchResponse(items, (item, resource) => {
          const data = nativeReadFixture(item, resource)
          if (item.intent.kind !== 'facts') return data
          if (resource.resource_id === annual.resource_id && Array.isArray(data.points)) {
            return { ...data, points: data.points.map((point: Record<string, any>) => ({
              ...point, value: 8_765_432,
            })) }
          }
          if (resource.resource_kind === 'collection') {
            return { ...data, entries: data.entries.map((entry: Record<string, any>) => ({ ...entry, value: 9_876 })) }
          }
          return data
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchAll)
    let wrapper: ReturnType<typeof mount> | null = null

    try {
      const mounted = await monter('/territoire/commune/22001', chargerReferenceReelle, chargerMetadonneesTheme)
      wrapper = mounted.wrapper
      await flushPromises()
      expect(metadataCalls).toBe(1)
      await metadataStarted
      await flushPromises()

      expect(focalRequests.length).toBeGreaterThan(0)
      expect(wrapper.find('.subvention-total').text()).toContain('8,77 M€')
      expect(wrapper.find('.subvention-total').text()).not.toContain('10,00 M€')
      expect(wrapper.get('[data-groupe="subventions"]').text()).toContain(
        'Explication des conditions d’éligibilité en cours de chargement.',
      )

      const focalFactReads = () => focalRequests.flat().filter((item) =>
        item.resource === annual.resource_id && item.intent.kind === 'facts').length
      const factReadsBeforeMetadataRetry = focalFactReads()
      releaseMetadata(new Response('legacy catalogue unavailable', { status: 503 }))
      await flushPromises()
      expect(wrapper.get('[data-groupe="subventions"]').text()).toContain(
        'L’explication des conditions d’éligibilité n’est pas disponible.',
      )
      const retry = wrapper.findAll('[data-groupe="subventions"] button')
        .find((button) => button.text() === 'Réessayer l’explication')
      expect(retry).toBeDefined()
      await retry!.trigger('click')
      await flushPromises()
      expect(metadataCalls).toBe(2)
      expect(focalFactReads()).toBe(factReadsBeforeMetadataRetry)
      expect(wrapper.find('.subvention-total').text()).toContain('8,77 M€')
      expect(wrapper.get('[data-groupe="subventions"]').text()).not.toContain(
        'L’explication des conditions d’éligibilité n’est pas disponible.',
      )
    } finally {
      releaseMetadata(new Response('legacy catalogue unavailable', { status: 503 }))
      await flushPromises()
      wrapper?.unmount()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  }, 20000)

  it('ignores a late catalogue response after the fiche route changes', async () => {
    let resolveFirstMetadata!: (metadata: Awaited<ReturnType<ChargerMetadonneesTheme>>) => void
    const firstMetadata = new Promise<Awaited<ReturnType<ChargerMetadonneesTheme>>>((resolve) => {
      resolveFirstMetadata = resolve
    })
    let notifySecondRequest!: () => void
    const secondRequest = new Promise<void>((resolve) => { notifySecondRequest = resolve })
    const canonical = validerCatalogueNavigateur(JSON.parse(readFileSync(
      resolve(process.cwd(), '../public/data/theme_programmes.json'), 'utf8')),
    'theme_programmes.json')
    const lateMetadata = structuredClone(canonical)
    lateMetadata.subgroups.find((item) => item.key === 'subventions')!.framing = 'Une explication périmée arrivée trop tard.'
    let metadataCalls = 0
    const loadMetadata: ChargerMetadonneesTheme = vi.fn(async () => {
      metadataCalls += 1
      if (metadataCalls === 1) return firstMetadata
      notifySecondRequest()
      return canonical
    })
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))

    const { router, wrapper } = await monter('/territoire/commune/22001',
      chargerReferenceFixture, loadMetadata)
    try {
      expect(metadataCalls).toBe(1)
      await router.push('/territoire/commune/22002?theme=programmes')
      await secondRequest
      await flushPromises()
      const focalProgrammesReadCount = () => requests.flat().filter((item) =>
        item.resource === 'subventions_annuelles' && item.intent.kind === 'facts').length
      const readsBeforeLateResponse = focalProgrammesReadCount()
      expect(wrapper.find('h1').text()).toBe(territoiresFixture.find((t) => t.territoire === '22002')!.nom)

      resolveFirstMetadata(lateMetadata)
      await flushPromises()

      expect(wrapper.find('h1').text()).toBe(territoiresFixture.find((t) => t.territoire === '22002')!.nom)
      expect(wrapper.get('[data-groupe="subventions"]').text()).not.toContain('Une explication périmée arrivée trop tard.')
      expect(focalProgrammesReadCount()).toBe(readsBeforeLateResponse)
    } finally {
      resolveFirstMetadata(lateMetadata)
      wrapper.unmount()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  }, 20000)

  it('keeps typed facts visible while the active catalogue 404s, and retries only that catalogue', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const readingResource = nativeResources('economie').find((resource) =>
      resource.resource_id === 'economie_selected_reading')!
    let metadataCalls = 0
    const fetchAll = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_economie.json') {
        metadataCalls += 1
        return metadataCalls === 1
          ? new Response('not found', { status: 404 })
          : new Response(readFileSync(resolve(process.cwd(), '../public/data/theme_economie.json'), 'utf8'), { status: 200 })
      }
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        return nativeBatchResponse(items, (item, resource) => {
          const data = nativeReadFixture(item, resource)
          if (item.intent.kind !== 'facts' || resource.resource_id !== readingResource.resource_id) return data
          return { ...data, ranked_activities: data.ranked_activities.map((activity: Record<string, any>, index: number) =>
            index === 0 ? { ...activity, activity_label: 'Sentinelle API — activité' } : activity) }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchAll)

    const { wrapper } = await monter('/territoire/commune/22001?theme=economie',
      chargerReferenceReelle, chargerMetadonneesTheme)
    try {
      await flushPromises()
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('Sentinelle API — activité')
      const focalReadingReads = () => requests.flat().filter((item) =>
        item.resource === readingResource.resource_id && item.intent.kind === 'facts').length
      const readsBeforeMetadataRetry = focalReadingReads()
      expect(requests.flat().some((item) => item.resource === readingResource.resource_id &&
        item.intent.kind === 'facts')).toBe(true)
      expect(fetchAll.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/data/theme_')))
        .toEqual(['/data/theme_economie.json'])
      await wrapper.get('[role="tabpanel"] button').trigger('click')
      await flushPromises()
      expect(metadataCalls).toBe(2)
      expect(focalReadingReads()).toBe(readsBeforeMetadataRetry)
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('Sentinelle API — activité')
    } finally {
      wrapper.unmount()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  }, 20000)

  it('ouvre la fiche Programmes par défaut depuis les ressources sémantiques natives, sans route thème ni repli statique', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const programmeResources = nativeResources('programmes')
    const series = programmeResources.find((resource) => resource.shapes.includes('ordered_series'))!
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        return nativeBatchResponse(items, (item, resource) => {
          const data = nativeReadFixture(item, resource)
          if (item.intent.kind !== 'facts') return data
          if (resource.resource_id === series.resource_id) {
            const points = data.points as Array<Record<string, any>>
            return { ...data, points: points.map((point) => ({
              ...point,
              // A distinct test sentinel proves the native response drives the displayed value.
              value: 9_999_999,
            })) }
          }
          if (Array.isArray(data.entries)) return { ...data, entries: data.entries.map((entry: Record<string, any>) => ({
            ...entry, value: 9_876,
          })) }
          return data
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001', chargerReferenceReelle)
    await flushPromises()
    expect(fetchApi.mock.calls.some(([url]) => String(url) === '/api/resources')).toBe(true)
    expect(fetchApi.mock.calls.some(([url]) => String(url) === '/api/resources/read-batch'),
      `fetch calls: ${JSON.stringify(fetchApi.mock.calls.map(([url]) => String(url)))}`).toBe(true)
    const expectedFacts = programmeResources.filter((resource) => resource.target_kinds.includes('territory') &&
      resource.intents.includes('facts')).map((resource) => [resource.resource_id, 'facts'])
    const expectedComparisons = programmeResources.filter((resource) => resource.target_kinds.includes('territory') &&
      resource.intents.includes('selected_comparison')).map((resource) => [resource.resource_id, 'selected_comparison'])
    const programmeIds = new Set(programmeResources.map((resource) => resource.resource_id))
    const programmeBatches = requests.filter((items) =>
      items.length > 0 && items.every((item) => programmeIds.has(item.resource)))
    expect(programmeBatches[0]?.map((item) => [item.resource, item.intent.kind])).toEqual(expectedFacts)
    expect(programmeBatches[1]?.map((item) => [item.resource, item.intent.kind])).toEqual(expectedComparisons)
    expect(requests[0]?.every((item) => item.target.kind === 'territory' && item.target.id === '22001')).toBe(true)
    const text = wrapper.get('[role="tabpanel"]').text()
    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(false)
    expect(text).toContain('10,00 M€')
    expect(text).toContain('Subventions attribuées')
    const syntheticSeries = syntheticResourceRead('programmes', series.resource_id)
    const sourceName = (syntheticSeries.points as Array<Record<string, any>>)[0]?.provenance?.[0]?.source_name
    expect(text).toContain(sourceName)
    expect(text).toContain('9 876 €')
    expect(text).not.toContain('1 600 €')
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    expect(fetchApi.mock.calls.filter(([url]) => String(url) === '/api/resources/read-batch').length).toBeGreaterThan(0)
    wrapper.unmount()
  }, 20000)

  it('keeps the measured Programmes year visible when a legacy no-record axis follows it', async () => {
    const legacy = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const producerMetadata = lireMetadataSnapshot('programmes')
    const sourceId = legacy.sources[0]!
    const descriptorVintageId = producerMetadata.source_records[sourceId].vintages[0].id
    const requests: Array<Array<Record<string, any>>> = []
    const focalReads: Array<Record<string, any>> = []
    let successfulComparison: Record<string, any> | undefined
    let selectedComparisonAttempts = 0
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return new Response(JSON.stringify({
        contract: 'semantic-resource-catalogue-v1', resources: [legacy],
      }))
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        const results = items.map((item) => {
          if (item.intent.kind === 'facts') {
            const data = { resource: legacy.resource_id, target: item.target,
              publication_id: 'legacy-series-v1',
              territory: { id: item.target.id, type: item.target.type, name: cibleReference('22001').nom },
              indicator_id: legacy.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
              label: legacy.label, unit: legacy.unit, direction: legacy.direction,
              descriptor_version: 'legacy-series-descriptor-v1', comparison_point: null,
              points: [
                { axis: '2024', status: 'measured', observation_period: '2024', value: 230,
                  source_id: sourceId, vintage_id: 'api-vintage-2027', source_version: 'api-v7-updated',
                  source_reference_date: null, source_publication_date: '2027-09-01' },
                { axis: '2025', status: 'missing', observation_period: null, value: null,
                  source_id: sourceId, vintage_id: descriptorVintageId, source_version: null,
                  source_reference_date: null, source_publication_date: null },
              ], availability: 'incomplete' }
            focalReads.push(data)
            return { id: item.id, resource: item.resource, status: 'available', data }
          }
          if (item.intent.kind === 'fixed_comparison') {
            // The paired publication is absent: an explicit item outcome in the
            // same snapshot, never a whole-request 503 nor a facts-only re-read.
            return { id: item.id, resource: item.resource, status: 'publication_unavailable',
              reason: 'publication_absent', family: 'ordered_series' }
          }
          if (selectedComparisonAttempts++ === 0) {
            return { id: item.id, resource: item.resource, status: 'publication_unavailable',
              reason: 'publication_absent', family: 'ordered_series' }
          }
          // #860 — la sélection par défaut d'une commune est niveau-natif (son
          // EPCI) : la passe selected_comparison échoie les membres tapés demandés.
          const members = (item.intent as { members?: Array<{ type: string; id: string }> }).members ?? null
          const selection = members?.map((member) => ({ territory_type: member.type, territory_id: member.id })) ?? null
          const data = { resource: legacy.resource_id, target: item.target,
            contract: 'indicator-comparison-v1', complete_theme: false,
            indicator_id: legacy.indicator_id, shape: 'series', content_version: 'legacy-series-v1',
            reference_content_version: 'legacy-reference-v1', selection,
            scope: selection
              ? { kind: 'explicit_selection', territory_type: 'commune', member_count: 2 }
              : { kind: 'density_class', territory_type: 'commune',
                density_class_code: cibleReference('22001').classe_densite_code, member_count: 2 },
            result: { indicator_id: legacy.indicator_id, label: legacy.label, facet: null,
              source_facet: null, unit: legacy.unit, direction: legacy.direction,
              descriptor_version: 'legacy-series-descriptor-v1', status: 'unavailable',
              reason: 'unsupported_comparison_contract', selected_member_count: 2,
              eligible_count: 0, missing_count: 2, median: null, rank: null, comparison_sources: [] } }
          successfulComparison = data
          return { id: item.id, resource: item.resource, status: 'available', data }
        })
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results }))
      }
      if (url.startsWith('/data/')) {
        return new Response(readFileSync(resolve(process.cwd(), `../public/data/${url.slice('/data/'.length)}`), 'utf8'))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001', chargerReferenceReelle)
    await flushPromises()

    expect(focalReads[0]).not.toHaveProperty('dataset_id')
    expect(focalReads[0]).not.toHaveProperty('reference_content_version')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.programmes-comparison-retry').exists()).toBe(true)
    expect(wrapper.find('.subvention-total').text()).toContain('230 €')
    expect(wrapper.find('.subvention-total').text()).toContain('en 2024')
    expect(wrapper.find('.subvention-total').text()).not.toMatch(/(^|\s)0\s*€/)
    expect(wrapper.find('.subvention-vintage').text()).toContain('Région Bretagne')
    const renderedPayload = wrapper.findComponent(BlocProgrammes).props('payload') as Payload
    const renderedAnnual = renderedPayload.indicateurs.filter((row) => row.territoire === '22001' &&
      row.theme === 'programmes' && row.key === 'subventions_annuelles')
    expect(renderedAnnual.map((row) => [row.dimension, row.value, row.observation_status])).toEqual([
      ['2024', 230, 'measured'], ['2025', null, 'missing'],
    ])
    expect(renderedAnnual[1]).toMatchObject({ source_id: sourceId, vintage_id: descriptorVintageId,
      source_version: null, source_reference_date: null, source_publication_date: null,
      vintage_version: null, vintage_date_reference: null, vintage_date_publication: null })
    expect(renderedAnnual[1]).not.toHaveProperty('fact_sources')
    // #860 — le défaut d'une commune est niveau-natif : la passe de comparaison
    // part en selected_comparison avec la cohorte communale de son EPCI.
    const membresDefaut = referenceReelle
      .filter((candidate) => candidate.type === 'commune' && candidate.epci === cibleReference('22001').epci)
      .map((candidate) => ({ territory_type: 'commune' as const, territory_id: candidate.territoire }))
      .sort((a, b) => a.territory_id.localeCompare(b.territory_id))
    expect(requests.map((items) => items.map((item) => item.intent.kind))).toEqual([
      ['facts'], ['selected_comparison'],
    ])
    expect(requests[1]![0]!.intent.members).toEqual(membresDefaut.map((m) => ({ type: m.territory_type, id: m.territory_id })))

    await wrapper.get('.programmes-comparison-retry').trigger('click')
    await flushPromises()

    expect(requests).toHaveLength(3)
    expect(requests[2]!.map((item) => item.intent.kind)).toEqual(['selected_comparison'])
    const comparison = { theme_id: 'programmes' as const, selection: membresDefaut, comparison_reads: [{
      resource: legacy.resource_id, shapes: legacy.shapes, declaration: legacy, data: successfulComparison!,
    }] }
    expect(() => validerReponseComparaisonTheme('programmes', comparison, membresDefaut,
      { type: 'commune', id: '22001' })).not.toThrow()
    expect(() => semanticComparisonForTheme(comparison, {
      target: { territoire: '22001', type: 'commune', classe_densite_code: cibleReference('22001').classe_densite_code },
      territories: referenceReelle,
    }, [{ resource: legacy.resource_id, shapes: legacy.shapes, declaration: legacy, data: focalReads[0]! }],
    { type: 'commune', id: '22001' })).not.toThrow()
    expect(wrapper.findAll('[role="alert"]').map((alert) => alert.text())).toEqual([])
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    expect(focalReads).toHaveLength(1)
    wrapper.unmount()
  })

  it('selects a commune EPCI perimeter by its typed parent identity from the reference, without scalar cohorts', async () => {
    const territoryId = '22285'
    const cible = cibleReference(territoryId)
    // #868 — the compact reference carries the full join table (not just the
    // target's ladder parents): comparison cohorts resolve against it.
    expect(referenceReelle.length).toBeGreaterThan(1000)
    const parent = referenceReelle.find((candidate) => candidate.type === 'epci' &&
      candidate.territoire === cible.epci)!
    const resolvedMembers = referenceReelle.filter((candidate) => candidate.type === 'commune' &&
      candidate.epci === parent.territoire)
    const resolvedBretagne = referenceReelle.filter((candidate) => candidate.type === 'commune')
    expect(resolvedMembers.length).toBeGreaterThan(1)

    const legacy = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const sourceId = legacy.sources[0]!
    const vintageId = lireMetadataSnapshot('programmes').source_records?.[sourceId]?.vintages?.[0]?.id
    expect(vintageId).toBeTruthy()
    const descriptorVersion = 'programmes-series-descriptor-v1'
    const publicationVersion = 'programmes-api-facts-sentinel-v1'
    const factValue = 987654
    const requests: Array<Array<Record<string, any>>> = []
    const selectedReads: Array<Record<string, any>> = []

    const comparisonData = (item: Record<string, any>) => {
      const isSelected = item.intent.kind === 'selected_comparison'
      const selection = isSelected ? item.intent.members.map((member: { type: string; id: string }) => ({
        territory_type: member.type, territory_id: member.id,
      })) : null
      // Model the API resolver: one typed EPCI identity expands against the
      // canonical reference to the actual commune perimeter used for rank;
      // typed commune members (densité, sélection tapée) resolve as themselves.
      const selectedIdentity = selection?.[0]
      const resolvedSelection = !selection || selection.length === 0 ? []
        : selectedIdentity?.territory_type === 'epci'
          ? resolvedMembers
          : selectedIdentity?.territory_type === 'region' ? resolvedBretagne : selection
      const memberCount = isSelected ? resolvedSelection.length : referenceReelle.filter((candidate) =>
        candidate.type === 'commune' && candidate.classe_densite_code === cible.classe_densite_code).length
      const data = { resource: legacy.resource_id, target: item.target,
        contract: 'indicator-comparison-v1', complete_theme: false,
        indicator_id: legacy.indicator_id, shape: 'series', content_version: publicationVersion,
        reference_content_version: 'programmes-reference-v1', selection,
        scope: isSelected ? { kind: 'explicit_selection', member_count: memberCount }
          : { kind: 'density_class', territory_type: 'commune',
            density_class_code: cible.classe_densite_code, member_count: memberCount },
        result: { indicator_id: legacy.indicator_id, source_facet: '2024', unit: legacy.unit,
          direction: legacy.direction, descriptor_version: descriptorVersion, status: 'available',
          selected_member_count: memberCount, eligible_count: memberCount, missing_count: 0,
          median: factValue, rank: 1, rank_size: memberCount } }
      if (isSelected) selectedReads.push(data)
      return data
    }

    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') {
        return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: [legacy] }))
      }
      if (url !== '/api/resources/read-batch') throw new Error(`Unexpected request: ${url}`)
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      requests.push(items)
      return nativeBatchResponse(items, (item) => {
        if (item.intent.kind !== 'facts') return comparisonData(item)
        return { resource: legacy.resource_id, target: item.target,
          publication_id: publicationVersion,
          territory: { id: territoryId, type: 'commune', name: cible.nom },
          indicator_id: legacy.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
          label: legacy.label, unit: legacy.unit, direction: legacy.direction,
          descriptor_version: descriptorVersion, comparison_point: '2024',
          points: [{ axis: '2024', status: 'measured', observation_period: '2024', value: factValue,
            source_id: sourceId, vintage_id: vintageId, source_version: 'api-facts-clock-v1',
            source_reference_date: null, source_publication_date: '2026-08-05' }],
          availability: 'observed' }
      })
    })
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter(`/territoire/commune/${territoryId}?theme=programmes`,
      chargerReferenceReelle)
    await flushPromises()

    expect(wrapper.find('.subvention-total').text()).toContain('987')
    // #860 — la fiche untouched d'une commune lit son défaut NIVEAU-NATIF : une
    // passe selected_comparison part dès le chargement avec la cohorte communale
    // de son EPCI (la densité n'est plus le défaut silencieux).
    const typedOf = (rows: Territoire[]) => rows
      .map((row) => ({ type: 'commune' as const, id: row.territoire }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const epciTyped = typedOf(resolvedMembers)
    const bretagneTyped = typedOf(resolvedBretagne)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.map((item) => item.intent.kind)).toEqual(['facts'])
    const defaultBatch = requests[1]!
    expect(defaultBatch.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect(defaultBatch[0]!.intent.members).toEqual(epciTyped)
    expect(requests.flat().filter((item) => item.intent.kind === 'facts')).toHaveLength(1)
    expect(wrapper.find('.subvention-total').text()).toContain('987')
    expect(selectedReads.at(-1)?.selection).toEqual(epciTyped.map((m) => ({ territory_type: m.type, territory_id: m.id })))
    expect(selectedReads.at(-1)?.scope.member_count).toBe(resolvedMembers.length)
    expect(selectedReads.at(-1)?.result.selected_member_count).toBe(resolvedMembers.length)
    expect(selectedReads.at(-1)?.result.rank_size).toBe(resolvedMembers.length)
    const renderedPayload = wrapper.findComponent(BlocProgrammes).props('payload') as Payload
    const annual = renderedPayload.indicateurs.find((row) => row.territoire === territoryId &&
      row.theme === 'programmes' && row.key === 'subventions_annuelles')
    expect(annual?.comparaisonApi).toMatchObject({ rang: 1, taille: resolvedMembers.length,
      portee: contextesReference(territoryId).epci!.scope.label, direction: 'high' })
    expect(wrapper.findAll('[role="alert"]').map((alert) => alert.text())).toEqual([])

    // Le preset explicite « epci » résout la même portée que le défaut : le cache
    // (territoire, thème, sélection) sert la réponse, aucune nouvelle requête.
    await router.replace({ query: { theme: 'programmes', comparaison: 'epci' } })
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('epci')
    expect(requests).toHaveLength(2)
    expect(requests.flat().filter((item) => item.intent.kind === 'facts')).toHaveLength(1)

    const epciRead = selectedReads.at(-1)
    await router.replace({ query: { theme: 'programmes', comparaison: 'bretagne' } })
    await flushPromises()
    expect(requests).toHaveLength(3)
    const bretagneBatch = requests.at(-1)!
    const bretagneItem = bretagneBatch.find((item) => item.intent.kind === 'selected_comparison')!
    expect(bretagneItem.intent.members).toEqual(bretagneTyped)
    expect(bretagneBatch.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect(requests.flat().filter((item) => item.intent.kind === 'facts')).toHaveLength(1)
    expect(selectedReads.at(-1)?.selection).toEqual(bretagneTyped.map((m) => ({ territory_type: m.type, territory_id: m.id })))
    expect(selectedReads.at(-1)?.scope.member_count).toBe(resolvedBretagne.length)
    expect(selectedReads.at(-1)?.result.selected_member_count).toBe(resolvedBretagne.length)
    expect(selectedReads.at(-1)?.result.rank_size).toBe(resolvedBretagne.length)
    expect(epciRead?.result.selected_member_count).toBe(resolvedMembers.length)
    const bretagnePayload = wrapper.findComponent(BlocProgrammes).props('payload') as Payload
    const bretagneAnnual = bretagnePayload.indicateurs.find((row) => row.territoire === territoryId &&
      row.theme === 'programmes' && row.key === 'subventions_annuelles')
    expect(bretagneAnnual?.comparaisonApi).toMatchObject({ rang: 1, taille: resolvedBretagne.length,
      portee: contextesReference(territoryId).bretagne!.scope.label, direction: 'high' })
    expect(wrapper.findAll('[role="alert"]').map((alert) => alert.text())).toEqual([])

    // Le preset « densite » devient explicite : cohorte de la classe de densité,
    // membres tapés en communes (plus de défaut silencieux niché).
    const densityMembers = referenceReelle.filter((candidate) => candidate.type === 'commune' &&
      candidate.classe_densite_code === cible.classe_densite_code)
      .map((candidate) => ({ type: 'commune' as const, id: candidate.territoire }))
      .sort((a, b) => a.id.localeCompare(b.id))
    await router.replace({ query: { theme: 'programmes', comparaison: 'densite' } })
    await flushPromises()
    expect(requests).toHaveLength(4)
    const densityBatch = requests.at(-1)!
    expect(densityBatch.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect([...densityBatch[0]!.intent.members].sort((a, b) => a.id.localeCompare(b.id))).toEqual(densityMembers)
    expect(selectedReads.at(-1)?.scope.member_count).toBe(densityMembers.length)

    // Une sélection explicitement vide part avec [] : aucune comparaison.
    await router.replace({ query: { theme: 'programmes', comparaison: '' } })
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('')
    expect(requests).toHaveLength(5)
    const emptyBatch = requests.at(-1)!
    expect(emptyBatch.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect(emptyBatch[0]!.intent.members).toEqual([])

    // Des membres tapés même niveau partent tels quels, dans l'ordre de l'URL.
    const typed = `${territoryId},${resolvedMembers.find((m) => m.territoire !== territoryId)!.territoire}`
    await router.replace({ query: { theme: 'programmes', comparaison: typed.split(',').map((id) => `commune:${id}`).join(',') } })
    await flushPromises()
    expect(requests).toHaveLength(6)
    const typedBatch = requests.at(-1)!
    expect(typedBatch[0]!.intent.members).toEqual(typed.split(',').map((id) => ({ type: 'commune', id })))
    wrapper.unmount()

    // If a named scope's canonical identity is missing from the reference, fail
    // closed rather than send [] or silently request the density/default comparison.
    const sansRegion: ChargerReferenceTerritoires = async () =>
      referenceReelle.filter((candidate) => candidate.type !== 'region')
    const requestCountBeforeMissingParent = requests.length
    const manquant = await monter(`/territoire/commune/${territoryId}?theme=programmes&comparaison=bretagne`, sansRegion)
    await flushPromises()
    expect(requests.length).toBeGreaterThan(requestCountBeforeMissingParent)
    expect(requests.slice(requestCountBeforeMissingParent).flat()
      .some((item) => item.intent.kind === 'selected_comparison')).toBe(false)
    expect(manquant.wrapper.find('.programmes-comparison-retry').exists()).toBe(false)
    expect(manquant.wrapper.find('.comparison-unavailable-note').text()).toContain('identité du groupe comparé')
    expect(manquant.wrapper.find('[role="alert"]').exists()).toBe(false)
    manquant.wrapper.unmount()
  })

  it('ne rend pas la section subventions quand les lectures natives déclarent leur absence', async () => {
    const subventions = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const syntheticFacts = syntheticResourceRead('programmes', subventions.resource_id)
    expect(Array.isArray(syntheticFacts.points) && syntheticFacts.points.length > 0).toBe(true)
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        return nativeBatchResponse(items, (item, resource) => {
          const data = nativeReadFixture(item, resource)
          if (item.intent.kind !== 'facts') return data
          if (resource.shapes.includes('anchored_membership')) {
            return { ...data, availability: 'no_record', entries: [], relationships: [], summaries: [] }
          }
          if (resource.shapes.includes('ordered_series')) {
            return { ...data, axis_values: [], axis_numeric_values: [], points: [], availability: 'no_record' }
          }
          if (resource.shapes.includes('period_detail')) {
            return { ...data, entries: [], availability: 'no_record' }
          }
          return data
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001', chargerReferenceReelle)

    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Aucun programme référencé.')
    expect(wrapper.find('.programme-subventions').exists()).toBe(false)
    expect(wrapper.find('.subvention-total').exists()).toBe(false)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    wrapper.unmount()
  })

  it('acquiert et réchauffe les faits natifs des thèmes, puis réutilise le cache pendant la navigation', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const fetchApi = nativeSemanticFetch(requests)
    vi.stubGlobal('fetch', nativeSemanticFetch())
    const activityLabel = syntheticTopActivityLabel()
    const acquired = await acquireThemeFacts('commune', '22001', 'programmes')
    expect(() => themeFactsRowsFromSemantic('programmes', acquired, {
      territoire: '22001', type: 'commune' })).not.toThrow()
    const acquiredHabitat = await acquireThemeFacts('commune', '22001', 'habitat')
    expect(() => themeFactsRowsFromSemantic('habitat', acquiredHabitat, {
      territoire: '22001', type: 'commune' })).not.toThrow()
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001', chargerReferenceReelle)

    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const themeByResource = new Map(nativeResources().map((resource) => [resource.resource_id, resource.theme_id]))
    // #860 — les passes selected_comparison (sélection de comparaison) ne sont
    // pas des réchauffages de faits : ne compter que les lots « facts ».
    const requestsByTheme = () => Object.fromEntries(
      ['programmes', 'habitat', 'demographie', 'milieux', 'economie', 'mobilite'].map((theme) => [theme,
        requests.filter((items) => items.some((item) => item.intent.kind === 'facts' &&
          item.target.kind === 'territory' && themeByResource.get(item.resource) === theme)).length]),
    )
    const warmedCounts = requestsByTheme()
    const themeRequests = requests.filter((items) => items.some((item) =>
      item.intent.kind === 'facts' && themeByResource.has(item.resource)))

    expect(themeRequests[0]?.every((item) => themeByResource.get(item.resource) === 'programmes')).toBe(true)
    expect(Object.values(warmedCounts).every((count) => count > 0)).toBe(true)
    expect(requests.every((items) => items.length >= 1)).toBe(true)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)

    for (const [theme, heading] of [
      ['habitat', 'Part de passoires thermiques'],
      ['demographie', 'Densité de population'],
      ['milieux', 'Consommation d’ENAF'],
      ['economie', 'Chômage'],
      ['mobilite', 'Mobilité'],
    ] as const) {
      await router.replace({ query: { theme } })
      await flushPromises()
      expect(wrapper.get('[role="tabpanel"]').text(),
        `${theme}; alert=${wrapper.find('[role="alert"]').exists() ? wrapper.find('[role="alert"]').text() : 'none'}; calls=${JSON.stringify(fetchApi.mock.calls.map(([url]) => String(url)))}`)
        .toContain(heading)
      if (theme === 'demographie') {
        // The native typed-reading descriptor publishes rate_unit and cohort facts.
        expect(wrapper.find('[role="alert"]').exists()).toBe(false)
        const syntheticDensity = syntheticResourceRead('demographie', 'densite')
        expect(syntheticDensity.synthetic_fixture).toMatchObject({ kind: 'synthetic_test_fixture', publication_parity: false })
        expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe(
          formaterValeur({ value: syntheticDensity.value, unit: syntheticDensity.unit }),
        )
      } else if (theme === 'habitat') {
        const passoires = nativeResources(theme).find((resource) => resource.resource_id === 'part_passoires')!
        expect(wrapper.get(`[data-clef="${passoires.resource_id}"] .valeur-numerique`).text()).toBe('13')
      } else if (theme === 'milieux') {
        const syntheticReading = syntheticReadingRead('milieux')
        const period = syntheticReading.periode_pop as string
        const visibleResource = nativeResources(theme).find((resource) =>
          resource.shapes.includes('ordered_series') && resource.target_kinds.includes('territory'))!
        expect(wrapper.get('[role="tabpanel"]').text()).toContain(period)
        const syntheticSeries = syntheticResourceRead('milieux', visibleResource.resource_id)
        const sourceName = (syntheticSeries.points as Array<Record<string, any>>)[0]?.provenance?.[0]?.source_name
        expect(wrapper.get('[role="tabpanel"]').text()).toContain(sourceName)
      } else if (theme === 'economie') {
        expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)
      } else if (theme === 'mobilite') {
        // A separate AEDAR comparison request may fail without making the
        // independently valid native trajectory look unavailable.
        expect(wrapper.find('.mobilite-raccordement-curve__legend .cahier-figure-legend-comparison-error').exists()).toBe(false)
        expect(wrapper.findAll('[role="alert"]').some((node) => node.text().includes('Groupe comparé indisponible'))).toBe(false)
      } else {
        expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      }
    }

    // #986 — a sibling chapter is read only when it is requested: navigating to
    // the page-3 chapter reads its facts, its comparison and its named reference.
    await router.replace({ query: { theme: 'mobilite' }, hash: '#figure-offre-transports-commun' })
    await flushPromises()
    await flushPromises()
    const namedResource = nativeResources('mobilite').find((resource) => resource.shapes.includes('named_reference'))!
    const curveResource = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const mobilityReads = requests.flat()
    expect(mobilityReads.some((item) => item.resource === namedResource.resource_id &&
      item.target.kind === 'named_reference' && namedResource.target_ids.includes(item.target.id))).toBe(true)
    expect(mobilityReads.some((item) => item.resource === curveResource.resource_id && item.intent.kind === 'facts')).toBe(true)

    // Navigating between the (already warmed) tabs re-reads no focal facts; the
    // page-3 chapter read is the requested chapter's own demand.
    const afterNavigation = requestsByTheme()
    for (const theme of ['programmes', 'habitat', 'demographie', 'milieux', 'economie'] as const) {
      expect(afterNavigation[theme]).toBe(warmedCounts[theme])
    }
    expect(afterNavigation.mobilite).toBeLessThanOrEqual(warmedCounts.mobilite + 1)
    wrapper.unmount()
  }, 20_000)

  it('ne laisse pas un échec de réchauffage natif entacher le thème actif et le réessaie à la visite', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let failedEconomyWarmup = false
    const economyResources = new Set(nativeResources('economie').map((resource) => resource.resource_id))
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        if (!failedEconomyWarmup && items.some((item) => economyResources.has(item.resource) &&
            item.target.kind === 'territory' && item.intent.kind === 'facts')) {
          failedEconomyWarmup = true
          return new Response('background fixture unavailable', { status: 503 })
        }
        return nativeBatchResponse(items, nativeFicheReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001', chargerReferenceReelle)
    await flushPromises()

    expect(failedEconomyWarmup).toBe(true)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const beforeVisit = requests.filter((items) => items.some((item) => economyResources.has(item.resource))).length

    await router.replace({ query: { theme: 'economie' } })
    await flushPromises()

    expect(requests.filter((items) => items.some((item) => economyResources.has(item.resource))).length)
      .toBeGreaterThan(beforeVisit)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Chômage')
    wrapper.unmount()
  })

  it('ignore les faits natifs tardifs d’un thème quitté sans remplacer le thème courant', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const habitatResources = new Set(nativeResources('habitat').map((resource) => resource.resource_id))
    let resolveHabitat: (() => void) | undefined
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        if (!resolveHabitat && items.some((item) => habitatResources.has(item.resource) &&
            item.target.kind === 'territory' && item.intent.kind === 'facts')) {
          return new Promise<Response>((resolve) => {
            resolveHabitat = () => resolve(nativeBatchResponse(items, nativeFicheReadFixture))
          })
        }
        return nativeBatchResponse(items, nativeFicheReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=habitat', chargerReferenceReelle)
    expect(resolveHabitat).toBeTypeOf('function')

    await router.replace({ query: { theme: 'economie' } })
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Chômage')
    expect(requests.flat().some((item) => item.resource === 'economie_selected_reading')).toBe(true)

    resolveHabitat!()
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Chômage')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('réessaie une acquisition native du thème après échec, sans repli sur les faits statiques', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const habitatResources = new Set(nativeResources('habitat').map((resource) => resource.resource_id))
    let failedFocalRead = false
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        const habitatFocalReads = items.filter((item) =>
          habitatResources.has(item.resource) && item.target.kind === 'territory')
        if (!failedFocalRead && habitatFocalReads.length) {
          // One settled absence per requested item: the whole theme is
          // unavailable, but this is not a request-level failure and no
          // discovery/facts-only retry follows automatically.
          failedFocalRead = true
          return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
            results: items.map((item) => ({ id: item.id, resource: item.resource,
              status: 'publication_unavailable', reason: 'publication_absent',
              family: nativePublicationFamily(item.resource) })) }))
        }
        return nativeBatchResponse(items, nativeFicheReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat',
      chargerReferenceReelle)

    expect(wrapper.get('[role="alert"]').text()).toContain('Les lectures de ce thème')
    expect(failedFocalRead).toBe(true)
    const failedRequests = requests.length
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(requests.length).toBeGreaterThan(failedRequests)
    expect(failedFocalRead).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const passoires = nativeResources('habitat').find((resource) => resource.resource_id === 'part_passoires')!
    expect(wrapper.get(`[data-clef="${passoires.resource_id}"] .valeur-numerique`).text()).toBe('13')
    expect(requests.every((items) => items.length >= 1)).toBe(true)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    wrapper.unmount()
  })

  it('masque les faits Habitat statiques pendant la lecture native en attente', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let resolveFirstRead: (() => void) | undefined
    let shouldDefer = true
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        if (shouldDefer && items.some((item) => item.target.kind === 'territory')) {
          shouldDefer = false
          return new Promise<Response>((resolve) => {
            resolveFirstRead = () => resolve(nativeBatchResponse(items, nativeFicheReadFixture))
          })
        }
        return nativeBatchResponse(items, nativeFicheReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat',
      chargerReferenceReelle)
    const passoires = nativeResources('habitat').find((resource) => resource.resource_id === 'part_passoires')!
    const passoiresFacts = syntheticResourceRead('habitat', passoires.resource_id)
    const sourceLabel = passoiresFacts.sources?.[0]?.name

    expect(requests.length).toBeGreaterThan(0)
    expect(resolveFirstRead).toBeTypeOf('function')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain(sourceLabel)
    resolveFirstRead!()
    await flushPromises()

    expect(wrapper.get('[role="tabpanel"]').text()).toContain(sourceLabel)
    expect(wrapper.get(`[data-clef="${passoires.resource_id}"] .valeur-numerique`).text()).toBe('13')
    wrapper.unmount()
  })

  it('ne remplace pas les faits focaux lorsqu’une comparaison native échoue puis est réessayée', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let selectedFailures = 1
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        if (items.some((item) => item.intent.kind === 'selected_comparison') && selectedFailures > 0) {
          selectedFailures--
          return new Response('comparison unavailable', { status: 503 })
        }
        return nativeBatchResponse(items, nativeFicheReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const activityLabel = syntheticTopActivityLabel()
    const { wrapper } = await monter('/territoire/commune/22001?theme=economie&comparaison=epci',
      chargerReferenceReelle)
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.comparison-section-retry').exists()).toBe(true)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)
    await wrapper.get('.comparison-section-retry').trigger('click')
    await flushPromises()

    const selectedReads = requests.filter((items) => items.some((item) => item.intent.kind === 'selected_comparison'))
    expect(selectedReads).toHaveLength(2)
    expect(selectedReads[1]!.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    wrapper.unmount()
  })

  it('ignore une réponse de comparaison native périmée après un changement de portée', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let resolveOldComparison: (() => void) | undefined
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        const response = nativeBatchResponse(items, nativeFicheReadFixture)
        if (!resolveOldComparison && items.some((item) => item.intent.kind === 'selected_comparison')) {
          return new Promise<Response>((resolve) => {
            resolveOldComparison = () => resolve(response)
          })
        }
        return response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const activityLabel = syntheticTopActivityLabel()
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=economie&comparaison=epci',
      chargerReferenceReelle,
    )
    expect(resolveOldComparison).toBeTypeOf('function')

    await router.replace({ query: { theme: 'economie', comparaison: 'bretagne' } })
    await flushPromises()
    const selectedReads = requests.filter((items) =>
      items.some((item) => item.intent.kind === 'selected_comparison'))
    const bretagneTyped = referenceReelle.filter((territory) => territory.type === 'commune')
      .map((territory) => ({ type: 'commune' as const, id: territory.territoire }))
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(selectedReads.at(-1)?.[0]?.intent.members).toEqual(bretagneTyped)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)

    resolveOldComparison!()
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('bretagne')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)
    wrapper.unmount()
  })

  beforeEach(() => {
    // #868 — no static path exists anymore: tests that exercise the native API
    // stub fetch with /api/resources fixtures; the default stays "API down".
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('API not configured in tests')))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    // Late Vue watchers/retries must never reach Happy DOM's real base URL.
    vi.stubGlobal('fetch', fetchBloque)
  })

  it('keeps the building figures without exposing an interactive peer selector', async () => {
    vi.stubGlobal('fetch', nativeSemanticFetch())
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite',
      chargerReferenceReelle)
    await flushPromises()
    expect(wrapper.find('#building-peer-search').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Choisir les territoires du groupe comparé')
    wrapper.unmount()
  }, 20_000)

  it.each(['demographie', 'milieux'] as const)(
    'renders API-resolved named-scope reading clouds for %s from the full compact reference',
    async (theme) => {
      const cible = cibleReference('22001')
      const parent = referenceReelle.find((territory) => territory.type === 'epci' &&
        territory.territoire === cible.epci)!
      const region = referenceReelle.find((territory) => territory.type === 'region')!
      const apiReference = referenceReelle as any[]
      const epciMembers = apiReference.filter((territory) => territory.type === 'commune' && territory.epci === parent.territoire)
      const bretagneMembers = apiReference.filter((territory) => territory.type === 'commune')
      const resources = nativeResources(theme)
      const readingResource = resources.find((resource) => resource.shapes.includes('typed_reading') &&
        resource.target_kinds.includes('territory_cohort'))!
      const rankResource = resources.find((resource) => resource.shapes.includes('scalar') &&
        resource.intents.includes('selected_comparison')) ?? resources.find((resource) =>
        resource.shapes.includes('ordered_series') && resource.intents.includes('selected_comparison'))!
      const selectedRanks: Array<{ scopeCount: number; rankSize: number | null }> = []
      const focalReads = new Map<string, Record<string, any>>()
      const requests: Array<Array<Record<string, any>>> = []
      const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/resources') {
          return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1',
            resources: [rankResource, readingResource] }))
        }
        if (url !== '/api/resources/read-batch') throw new Error(`Unexpected request: ${url}`)
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        return nativeBatchResponse(items, (item, resource) => {
          let data = nativeReadFixture(item, resource)
          if (item.intent.kind === 'facts' && item.target.kind === 'territory' &&
              resource.resource_id === rankResource.resource_id && resource.shapes.includes('ordered_series')) {
            const comparisonPoint = lireMetadataSnapshot(theme).indicator_pages?.[resource.indicator_id]?.comparison?.detail
            if (!comparisonPoint) throw new Error(`No producer comparison facet for ${resource.resource_id}`)
            data = { ...data, comparison_point: comparisonPoint }
          }
          if (item.intent.kind === 'facts' && item.target.kind === 'territory') {
            focalReads.set(resource.resource_id, data)
          }
          if (item.intent.kind !== 'selected_comparison') return data
          // #860 — les membres partent en cohorte communale développée (triée) ;
          // reconnaître la portée EPCI à l'ensemble des ids demandés.
          const selectedIds = item.intent.members.map((member: { type: string; id: string }) => member.id)
          const isEpciScope = selectedIds.length === epciMembers.length &&
            epciMembers.every((member) => selectedIds.includes(member.territoire))
          const selectedMembers = isEpciScope ? epciMembers
            : selectedIds.length === bretagneMembers.length &&
              bretagneMembers.every((member) => selectedIds.includes(member.territoire))
              ? bretagneMembers
              : item.intent.members
          const scopeCount = selectedMembers.length
          const focal = focalReads.get(resource.resource_id)
          const comparisonFacet = resource.shapes.includes('ordered_series')
            ? focal?.comparison_point : resource.indicator_id
          const result = { ...data.result, status: 'available', direction: resource.direction,
            source_facet: comparisonFacet, selected_member_count: scopeCount, eligible_count: scopeCount,
            missing_count: 0, rank: 1, rank_size: scopeCount }
          selectedRanks.push({ scopeCount, rankSize: result.rank_size })
          return { ...data, selection: item.intent.members.map((member: { type: string; id: string }) =>
            ({ territory_type: member.type, territory_id: member.id })),
          scope: { kind: 'explicit_selection', member_count: scopeCount }, result }
        })
      })
      vi.stubGlobal('fetch', fetchApi)
      const { router, wrapper } = await monter(
        `/territoire/commune/22001?theme=${theme}&comparaison=epci`, chargerReferenceReelle)

      const graph = () => theme === 'demographie'
        ? wrapper.findComponent(GraphiqueSoldes) : wrapper.findComponent(GraphiqueQuadrantMilieux)
      const cloudPoints = () => theme === 'demographie'
        ? wrapper.findComponent(GraphiqueSoldes).props().nuage
        : wrapper.findComponent(GraphiqueQuadrantMilieux).props().nuage
      const themePayload = () => wrapper.findComponent(OngletTheme).props('payload') as Payload
      const verifyCloudAndRank = (count: number, label: string, memberIds: string[]) => {
        expect(graph().exists()).toBe(true)
        const cloud = cloudPoints()
        expect(cloud.length).toBeGreaterThan(0)
        expect(cloud.every((point) => memberIds.includes(point.territoire))).toBe(true)
        const rows = themePayload().indicateurs.filter((row) => row.theme === theme &&
          row.key === rankResource.indicator_id)
        expect(rows.some((row) => row.comparaisonApi?.taille === count && row.comparaisonApi.portee === label)).toBe(true)
        expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      }

      await flushPromises()
      const epciLabel = contextesReference('22001').epci!.scope.label
      verifyCloudAndRank(epciMembers.length, epciLabel, epciMembers.map((member) => member.territoire))
      // #860 — la sélection EPCI part en membres communaux développés : la
      // lecture de cohorte n'a plus de filtre epci_id (cohorte Bretagne entière,
      // le nuage valide la sélection contre la cohorte lue).
      expect(requests.flat().some((item) => item.target.kind === 'territory_cohort' &&
        !item.target.epci_id && item.resource === readingResource.resource_id)).toBe(true)
      expect(selectedRanks.at(-1)).toEqual({ scopeCount: epciMembers.length, rankSize: epciMembers.length })

      const requestCountBeforeRegion = requests.length
      await router.replace({ query: { theme, comparaison: 'bretagne' } })
      await flushPromises()
      const bretagneLabel = contextesReference('22001').bretagne!.scope.label
      verifyCloudAndRank(bretagneMembers.length, bretagneLabel, bretagneMembers.map((member) => member.territoire))
      // The unfiltered Bretagne cohort is one publication read for this
      // acquisition identity: it is reused across preset changes, never
      // duplicated, and the switched cloud/rank above prove it is the right
      // group rather than an arbitrary cached cohort.
      const unfilteredCohort = (batches: Array<Array<Record<string, any>>>) =>
        batches.flat().filter((item) => item.target.kind === 'territory_cohort' &&
          item.resource === readingResource.resource_id && item.target.type === 'commune' &&
          !item.target.epci_id && !item.target.department_id)
      expect(unfilteredCohort(requests)).toHaveLength(1)
      expect(unfilteredCohort(requests.slice(requestCountBeforeRegion))).toHaveLength(0)
      expect(selectedRanks.at(-1)).toEqual({ scopeCount: bretagneMembers.length, rankSize: bretagneMembers.length })
      expect(region.type).toBe('region')
      wrapper.unmount()
    },
  )

  it('renders the pooled DVF scalar/rank beside annual points without borrowing the annual rank', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        return nativeBatchResponse(items, (item, resource) => {
          const data = nativeReadFixture(item, resource)
          if (resource.resource_id !== 'prix_m2') return data
          if (item.intent.kind === 'facts') {
            data.points = (data.points as Array<Record<string, any>>).map((point) => point.axis === '2025'
              ? { ...point, value: 230, status: 'measured', missing_reason: null }
              : point.axis === '2024' ? { ...point, value: 211, status: 'measured', missing_reason: null } : point)
            data.scalar_facet.observation = { ...data.scalar_facet.observation,
              status: 'measured', value: 700, support_count: 12, denominator_count: 20 }
          } else {
            data.result = { ...data.result, source_facet: '2025', status: 'available',
              direction: 'low', rank: 2, rank_size: 2 }
            data.scalar_facet.result = { ...data.scalar_facet.result, source_facet: 'prix_m2',
              status: 'available', direction: 'low', rank: 1, rank_size: 2 }
          }
          return data
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat', chargerReferenceReelle)
    await flushPromises()

    const figure = wrapper.get('.figure-trajectoire[data-clef="prix_m2"]')
    expect(figure.get('.trajectoire-repere__valeur').text()).toContain('700')
    expect(figure.get('.trajectoire-repere__valeur').text()).toContain('€/m²')
    expect(figure.get('.trajectoire-repere .puce-rang-texte').text()).toContain('1er/2')
    // #860 — le défaut d'une commune est niveau-natif (son EPCI), jamais la densité
    expect(figure.get('.trajectoire-repere [role="img"]').attributes('aria-label'))
      .toContain(contextesReference('22001').epci!.scope.label)
    expect(figure.get('svg[role="img"]').attributes('aria-label')).toContain('2025')
    expect(figure.get('svg[role="img"]').attributes('aria-label')).toContain('230')
    expect(requests.flat().some((item) => item.resource === 'prix_m2' && item.intent.kind === 'facts')).toBe(true)
    expect(requests.flat().some((item) => item.resource === 'prix_m2' && item.intent.kind === 'selected_comparison')).toBe(true)
    wrapper.unmount()
  }, 20_000)

  it('does not attach the initial fixed-group price rank to a scope selected while facts are pending', async () => {
    const initialPending: Array<{ release: () => void; released: boolean }> = []
    const selectedPending: Array<{ release: () => void; released: boolean }> = []
    let comparisonBatches = 0
    const habitatResources = new Set(nativeResources('habitat').map((resource) => resource.resource_id))
    const makeResponse = (items: Array<Record<string, any>>) => nativeBatchResponse(items, (item, resource) => {
      const data = nativeReadFixture(item, resource)
      if (resource.resource_id !== 'prix_m2') return data
      if (item.intent.kind === 'facts') {
        data.points = (data.points as Array<Record<string, any>>).map((point) => point.axis === '2025'
          ? { ...point, value: 230, status: 'measured', missing_reason: null }
          : point.axis === '2024' ? { ...point, value: 211, status: 'measured', missing_reason: null } : point)
        data.scalar_facet.observation = { ...data.scalar_facet.observation,
          status: 'measured', value: 700, support_count: 12, denominator_count: 20 }
      } else {
        data.result = { ...data.result, source_facet: '2025', status: 'available',
          direction: 'low', rank: 2, rank_size: 2 }
        data.scalar_facet.result = { ...data.scalar_facet.result, source_facet: 'prix_m2',
          status: 'available', direction: 'low', rank: 1, rank_size: 2 }
      }
      return data
    })
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        const targetThemeReads = items.some((item) => habitatResources.has(item.resource) && item.target.kind === 'territory')
        if (targetThemeReads) {
          const comparisonRead = items.some((item) =>
            habitatResources.has(item.resource) && item.intent.kind !== 'facts')
          if (!comparisonRead) return makeResponse(items)
          // The first comparison read is the initial scope; the second one is
          // the scope selected while that first read is still pending.
          const queue = comparisonBatches++ === 0 ? initialPending : selectedPending
          return new Promise<Response>((resolve) => {
            const pending = { released: false, release: () => {
              pending.released = true
              resolve(makeResponse(items))
            } }
            queue.push(pending)
          })
        }
        return makeResponse(items)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=habitat&comparaison=epci', chargerReferenceReelle)
    await vi.waitFor(() => expect(initialPending.some((entry) => !entry.released)).toBe(true))
    await router.replace({ query: { theme: 'habitat', comparaison: 'bretagne' } })
    await flushPromises()

    for (let attempt = 0; attempt < 12 && !selectedPending.some((entry) => !entry.released); attempt++) {
      await vi.waitFor(() => expect(initialPending.some((entry) => !entry.released)).toBe(true))
      initialPending.find((entry) => !entry.released)!.release()
      await flushPromises()
    }
    expect(selectedPending.some((entry) => !entry.released)).toBe(true)
    const figure = wrapper.get('.figure-trajectoire[data-clef="prix_m2"]')
    expect(figure.get('.trajectoire-repere__valeur').text()).toContain('700')
    expect(figure.find('.trajectoire-repere .puce-rang').exists()).toBe(false)

    selectedPending.find((entry) => !entry.released)!.release()
    await flushPromises()
    expect(figure.get('.trajectoire-repere .puce-rang-texte').text()).toContain('1er/2')
    expect(figure.get('.trajectoire-repere .puce-rang[aria-label]').attributes('aria-label'))
      .toContain(contextesReference('22001').bretagne!.scope.label)
    expect(figure.get('svg[role="img"]').attributes('aria-label')).toContain('230')
    wrapper.unmount()
  }, 30_000)

  it('affiche les six onglets pendant que la référence charge', async () => {
    const charger = vi.fn<ChargerReferenceTerritoires>(() => new Promise<never>(() => {}))
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    expect(wrapper.find('.squelette').exists()).toBe(true)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('rend l’identité et le contexte depuis la même réponse', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')

    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(wrapper.find('.puce-type').text()).toBe('Commune')
    expect(wrapper.find('.fiche-actions .echelle-territoriale').exists()).toBe(true)
    const breadcrumb = wrapper.find('.fil-ariane')
    expect(breadcrumb.text()).toContain('Accueil')
    expect(breadcrumb.text()).toContain('Les communes')
    expect(breadcrumb.find('a[href="/"]').exists()).toBe(true)
    expect(breadcrumb.find('a[href="/communes"]').exists()).toBe(true)
    expect(wrapper.find('.echelle-territoriale').text()).toContain('EPCI Y')
    expect(wrapper.find('.echelle-territoriale').text()).toContain('Département 29')
    expect(wrapper.find('.echelle-territoriale').text()).toContain('Bretagne')
  })

  it('présente toujours les six thèmes dans l’ordre produit', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text().trim())).toEqual([
      'Programmes et subventions',
      'Mobilité',
      'Démographie',
      'Habitat',
      'Économie/Emploi',
      'Milieux',
    ])
  })

  it('ouvre Programmes et subventions par défaut', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-programmes')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et contrats')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Aucun programme référencé.')
  })

  it('sélectionne un thème depuis l’URL sans nouvelle requête', async () => {
    const charger = vi.fn<ChargerReferenceTerritoires>(async () => territoiresFixture)
    const { wrapper } = await monter('/territoire/commune/29002?theme=demographie', charger)
    expect(wrapper.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-demographie')
    expect(wrapper.find('.fiche').classes()).toContain('fiche--theme-demographie')
    expect(wrapper.find('.filigrane-fiche').attributes('style')).toContain(
      '--filigrane-accent: var(--theme-demographie-line)',
    )
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('change d’onglet sans recharger la référence', async () => {
    const charger = vi.fn<ChargerReferenceTerritoires>(async () => territoiresFixture)
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('normalise un thème inconnu vers le défaut', async () => {
    const { wrapper, router } = await monter('/territoire/commune/29002?theme=bidule')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
  })

  it('canonicalise un mode de comparaison inconnu sans perdre le thème', async () => {
    const { router } = await monter(
      '/territoire/commune/29002?theme=mobilite&comparaison=inconnu&variant=E',
    )
    expect(router.currentRoute.value.query).toEqual({ theme: 'mobilite' })
  })

  it('renders the producer-declared Mobility curve and scopes explicit comparisons through native reads', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    // #986 — the curve belongs to the page-3 chapter: it is read when that
    // chapter is the requested one, never speculatively from page 1 or page 2.
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite#figure-offre-transports-commun',
      chargerReferenceReelle)
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const reference = nativeResources('mobilite').find((resource) => resource.shapes.includes('named_reference'))!
    const fixtureCurve = nativeReadFixture({ target: { kind: 'territory', type: 'commune', id: '22001' },
      intent: { kind: 'facts' } }, curve)
    const declaredAxisCount = curve.axis_values?.[0]?.[1].length ?? 0
    const fixturePoint = (fixtureCurve.points as Array<Record<string, any>>)[0]!
    const reads = () => requests.flat()

    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    const territoryPath = wrapper.get('[data-series="territory"]').attributes('d') ?? ''
    expect(declaredAxisCount).toBe(73)
    // One straight-segment path through every declared axis point, no dot chain.
    expect((territoryPath.match(/L/g) ?? [])).toHaveLength(declaredAxisCount - 1)
    expect(wrapper.findAll('.mobilite-raccordement-curve__point--territory')).toHaveLength(0)
    expect(territoryPath).not.toContain('NaN')
    expect(wrapper.text()).toContain(fixturePoint.provenance[0].source_name)
    expect(reads().some((item) => item.resource === curve.resource_id && item.intent.kind === 'facts')).toBe(true)
    expect(reads().some((item) => item.resource === reference.resource_id &&
      item.target.kind === 'named_reference' && reference.target_ids.includes(item.target.id))).toBe(true)

    const cohort = referenceReelle
    const epciMembers = cohort.filter((territory: any) =>
      territory.type === 'commune' && territory.epci === cibleReference('22001').epci)
      .map((territory: any) => ({ type: territory.type, id: territory.territoire }))
      .sort((left: any, right: any) => left.id.localeCompare(right.id))
    await router.replace({ query: { theme: 'mobilite', comparaison: 'epci' }, hash: '#figure-offre-transports-commun' })
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('epci')
    const epciRead = reads().find((item) => item.resource === curve.resource_id &&
      item.intent.kind === 'selected_comparison')
    expect(epciRead?.intent.members).toEqual(epciMembers)
    // The comparison switch never drops the focal curve's published points.
    expect((((wrapper.get('[data-series="territory"]').attributes('d') ?? '').match(/L/g)) ?? []))
      .toHaveLength(declaredAxisCount - 1)
    expect(wrapper.findAll('.mobilite-raccordement-curve__point--territory')).toHaveLength(0)

    const bretagneMembers = cohort.filter((territory: any) => territory.type === 'commune')
      .map((territory: any) => ({ type: territory.type, id: territory.territoire }))
      .sort((left: any, right: any) => left.id.localeCompare(right.id))
    await router.replace({ query: { theme: 'mobilite', comparaison: 'bretagne' }, hash: '#figure-offre-transports-commun' })
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('bretagne')
    const bretagneReads = reads().filter((item) => item.resource === curve.resource_id &&
      item.intent.kind === 'selected_comparison')
    expect(bretagneReads.at(-1)?.intent.members).toEqual(bretagneMembers)

    await router.replace({ query: { theme: 'mobilite', comparaison: 'epci' }, hash: '#figure-offre-transports-commun' })
    await flushPromises()
    expect(reads().filter((item) => item.resource === curve.resource_id &&
      item.intent.kind === 'selected_comparison' &&
      JSON.stringify(item.intent.members) === JSON.stringify(epciMembers))).toHaveLength(1)
    expect(reads().filter((item) => item.resource === curve.resource_id && item.intent.kind === 'facts')).toHaveLength(1)
    expect(fetchBloque).not.toHaveBeenCalled()
    wrapper.unmount()
  }, 20_000)

  it.each(['epci', 'bretagne'] as const)(
    'la portée %s est nommée par le contrôle, jamais répétée visuellement par les figures', async (mode) => {
      const requests: Array<Array<Record<string, any>>> = []
      vi.stubGlobal('fetch', nativeSemanticFetch(requests))
      const { wrapper } = await monter(
        `/territoire/commune/22001?theme=mobilite&comparaison=${mode}`, chargerReferenceReelle)
      await flushPromises()

      expect(wrapper.findAll('.cahier-comparison-note')).toHaveLength(0)
      const contextes = contextesReference('22001')
      const labels = wrapper.findAll('.cahier-comparison-value__scope, .cahier-figure-legend-label, .cahier-network-bar-chart__reference-key')
        .map((el) => el.text())
      expect(labels.some((texte) => texte.includes(contextes[mode]!.scope.label))).toBe(false)
      const accessibleReferences = wrapper.findAll('.cahier-network-bar-chart__reference-key, .cahier-figure-legend-item[aria-label]')
      expect(accessibleReferences.some((reference) => reference.attributes('aria-label')?.includes(contextes[mode]!.scope.label))).toBe(true)
      wrapper.unmount()
    },
    20_000,
  )

  it('affiche l’erreur typée et réessaie le même endpoint', async () => {
    const charger = vi
      .fn<ChargerReferenceTerritoires>()
      .mockRejectedValueOnce(new PayloadError('fetch', 'territoires.json', 'panne'))
      .mockResolvedValueOnce(territoiresFixture)
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.find('.etat-erreur').exists()).toBe(true)
    expect(wrapper.text()).toContain('Impossible de charger les données')
    expect(wrapper.text()).not.toContain('territoires.json')
    expect(wrapper.text()).not.toContain('panne')
    await wrapper.get('.bouton-reessayer').trigger('click')
    await flushPromises()
    expect(wrapper.find('.fiche-en-tete .etat-erreur').exists()).toBe(false)
    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(charger).toHaveBeenCalledTimes(2)
  })

  it('renders the approved AEDAR cahier from the normal Mobility route', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const fetchApi = nativeSemanticFetch(requests)
    vi.stubGlobal('fetch', fetchApi)

    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', chargerReferenceReelle)
    await flushPromises()

    expect(wrapper.find('.prototype-toggle').exists()).toBe(false)
    expect(wrapper.find('.aedar-state').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
    expect(wrapper.find('[data-section="aedar-access"]').exists()).toBe(true)
    expect(wrapper.find('.page-heading-index').exists()).toBe(true)
    const semanticReads = fetchApi.mock.calls.filter(([url]) => String(url) === '/api/resources/read-batch')
    expect(semanticReads.length).toBeGreaterThanOrEqual(6)
    const projectedBodies = semanticReads.map(([, init]) => JSON.parse(String(init?.body)))
    const aedarItems = projectedBodies.flatMap((body) => body.items)
      .filter((item: Record<string, any>) => Array.isArray(item.coordinates?.typequ))
    expect(aedarItems.every((item: Record<string, any>) => item.fields.length <= 32)).toBe(true)
    expect(aedarItems.some((item: Record<string, any>) => item.coordinates.typequ.length === 100)).toBe(true)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/api/aedar/territories/'))).toBe(false)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    wrapper.unmount()
  })

  it('shows the loading state while the production AEDAR read is pending (#627)', async () => {
    const fetchApi = vi.fn(async (url: string) => {
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') return await new Promise<Response>(() => {})
      return { ok: false, status: 404, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchApi)

    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', chargerReferenceReelle)
    const firstPage = wrapper.find('.cahier-page')

    expect(fetchApi.mock.calls.some(([url]) => String(url) === '/api/resources/read-batch')).toBe(true)
    // #627 - the retired legacy placeholder body no longer renders its
    // « Contenu indisponible » placeholders while AEDAR is pending: the
    // acces-aux-services unit keeps its structural identity and the
    // production AEDAR evidence owns the surface.
    expect(firstPage.text()).toContain('L’accès aux services')
    expect(firstPage.text()).not.toContain('Résumé')
    expect(firstPage.text()).not.toContain('Profils d’accès par mode')
    expect(firstPage.text()).not.toContain('Services essentiels')
    expect(firstPage.text()).not.toContain("Distribution de l'accès par bâtiment")
    expect(firstPage.text()).not.toContain('Contenu indisponible pour ce territoire.')
    wrapper.unmount()
  })

  it('keeps a scoped semantic-facts retry for Mobilité while AEDAR succeeds (#627 correction)', async () => {
    const mobiliteResourceIds = new Set(nativeResources('mobilite').map((resource) => resource.resource_id))
    const requests: Array<Array<Record<string, any>>> = []
    let mobiliteFactsFailing = true
    const mobiliteFactsBatches = { failed: 0, served: 0 }
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        const aedarOnly = items.every((item) => item.resource === 'aedar_territorial_aggregate')
        const carriesMobiliteFacts = !aedarOnly &&
          items.some((item) => mobiliteResourceIds.has(item.resource) && item.intent?.kind === 'facts')
        if (carriesMobiliteFacts) {
          // The acquisition is a bounded-chunk plan with a built-in facts-only
          // recovery pass. Chunks are read sequentially, so the initial
          // acquisition aborts at its first failing chunk: the whole
          // acquisition rejects instead of degrading to a partial recovery.
          if (mobiliteFactsFailing) {
            mobiliteFactsBatches.failed += 1
            return new Response('', { status: 503 })
          }
          mobiliteFactsBatches.served += 1
          return nativeBatchResponse(items, (item, resource) => resource.resource_id === 'aedar_territory_summary'
            ? aedarSummaryFixture(item) : nativeFicheReadFixture(item, resource))
        }
        return nativeBatchResponse(items, (item, resource) => resource.resource_id === 'aedar_territory_summary'
          ? aedarSummaryFixture(item) : nativeFicheReadFixture(item, resource))
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchApi)

    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', chargerReferenceReelle)
    await flushPromises()

    const aedarReads = () => requests.filter((items) =>
      items.every((item) => item.resource === 'aedar_territorial_aggregate' && item.intent?.kind === 'facts'))
    // The legitimate Mobilité semantic plan, derived independently from the
    // app's chapter inventory over the fixture catalogue (the same declarations
    // production filters), not from the observed requests: the REQUESTED page-2
    // chapter's territory facts only — no page-3 sibling and no named reference
    // (#986: a chapter is read only when it is requested). Deduplication means
    // each item of this plan is admitted exactly once per acquisition generation.
    const catalogue = nativeResources('mobilite')
    const pageTwoChapter = chapitreDemande('mobilite', 'partage-de-lespace-public',
      catalogue as unknown as SemanticResourceDeclaration[])!
    const territoireFacts = catalogue.filter((resource) =>
      pageTwoChapter.indicators.includes(resource.resource_id) &&
      resource.allowed_levels.includes('commune') &&
      resource.target_kinds.includes('territory') && resource.intents.includes('facts'))
    expect(territoireFacts.length, 'the fixture must declare Mobilité territory facts to read').toBe(13)
    const factsCle = (resource: string, cible: Record<string, any>) =>
      `${resource}|${cible.kind}|${cible.type ?? ''}|${cible.id ?? ''}`
    const clesAttendues = territoireFacts.map((resource) => factsCle(resource.resource_id,
      { kind: 'territory', type: 'commune', id: '22001' })).sort()
    const lotFaitsMobilite = (items: Array<Record<string, any>>) =>
      !items.every((item) => item.resource === 'aedar_territorial_aggregate') &&
      items.some((item) => mobiliteResourceIds.has(item.resource) && item.intent?.kind === 'facts')
    const clesFaitsLot = (items: Array<Record<string, any>>) => items
      .filter((item) => item.intent?.kind === 'facts' && mobiliteResourceIds.has(item.resource))
      .map((item) => factsCle(item.resource, item.target ?? {}))

    // Initial phase. The paired pass aborts at its first chunk (it always
    // carries the first catalogue facts item); the Mobilite isolation seam then
    // retries each bounded resource group and its facts-only fallback before the
    // acquisition rejects: zero admitted batches, and every failed batch only
    // carries plan items. The request count is bounded by the declared groups.
    expect(mobiliteFactsBatches.served).toBe(0)
    expect(mobiliteFactsBatches.failed).toBeGreaterThanOrEqual(2)
    const failedBeforeRetry = mobiliteFactsBatches.failed
    const lotsEchoues = requests.filter(lotFaitsMobilite)
    expect(lotsEchoues.length).toBeGreaterThanOrEqual(2)
    const clesTerritoireAttendues = new Set(territoireFacts.map((resource) =>
      factsCle(resource.resource_id, { kind: 'territory', type: 'commune', id: '22001' })))
    for (const items of lotsEchoues) {
      expect(items.length, 'a failing chunk is a populated bounded batch').toBeGreaterThan(0)
      expect(clesFaitsLot(items).length).toBeGreaterThan(0)
      for (const cle of clesFaitsLot(items)) {
        expect(clesTerritoireAttendues,
          'the failure phases only read plan territory facts items').toContain(cle)
      }
    }

    // AEDAR succeeded independently: its production evidence stays visible
    // and usable while the semantic facts acquisition has failed.
    expect(wrapper.find('.aedar-state').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
    // No retired placeholder body section and no fabricated retained fact
    // appear while the facts are unavailable.
    expect(wrapper.text()).not.toContain('Résumé')
    expect(wrapper.text()).not.toContain('Profils d’accès par mode')
    expect(wrapper.text()).not.toContain('Services essentiels')
    expect(wrapper.find('.mobilite-raccordement-curve__point--territory').exists()).toBe(false)

    // The retained semantic-facts failure stays visible and retryable even
    // without a mobilityFocal — distinct from the comparison error.
    const factsAlert = wrapper.findAll('.etat-erreur')
      .find((alert) => alert.text().includes('Les indicateurs de ce thème ne sont pas disponibles.'))
    expect(factsAlert, 'a scoped semantic-facts alert must be visible').toBeDefined()
    expect(factsAlert!.text()).not.toContain('comparaisons')

    const aedarReadsBeforeRetry = aedarReads().length
    const requetesAvantReessai = requests.length
    mobiliteFactsFailing = false
    await factsAlert!.find('button').trigger('click')
    await flushPromises()

    // Retry phase. The admitted request plan is exact and deduplicated: across
    // every Mobilité facts batch of this phase, each catalogue-derived plan
    // item appears once and nothing outside the plan is read. A duplicated
    // admitted facts request — or a wrongly re-run acquisition generation —
    // would double an item and fail here, whatever the chunk boundaries.
    expect(mobiliteFactsBatches.served).toBeGreaterThan(0)
    expect(mobiliteFactsBatches.failed,
      'the retry must not run another failing acquisition pass').toBe(failedBeforeRetry)
    const lotsAdmis = requests.slice(requetesAvantReessai).filter(lotFaitsMobilite)
    expect(lotsAdmis.length).toBeGreaterThan(0)
    const compteurAdmis = new Map<string, number>()
    for (const items of lotsAdmis) {
      for (const cle of clesFaitsLot(items)) {
        compteurAdmis.set(cle, (compteurAdmis.get(cle) ?? 0) + 1)
      }
    }
    expect([...compteurAdmis.keys()].sort(),
      'the retry reads exactly the catalogue plan — no foreign item, none missing').toEqual(clesAttendues)
    for (const cle of clesAttendues) {
      expect(compteurAdmis.get(cle),
        `each admitted facts item must be requested exactly once (dedup): ${cle}`).toBe(1)
    }

    // The retry genuinely re-reads and admits the retained native facts…
    expect(wrapper.text()).not.toContain('Les indicateurs de ce thème ne sont pas disponibles.')
    expect(wrapper.find('.mobilite-section--reseaux .mobilite-comparison-bars').exists()).toBe(true)
    // …without forcing an AEDAR reread and with AEDAR still rendered.
    expect(aedarReads()).toHaveLength(aedarReadsBeforeRetry)
    expect(wrapper.find('.aedar-state').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
    wrapper.unmount()
  }, 20_000)

  it('keeps summary and TYPEQU detail failures independent and retries only the failed stream on the mounted route', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let failFocalSummary = true
    const summaryFetch = nativeSemanticFetch(requests, {
      failSummary: (items) => {
        const focal = items.some((item) => item.resource === 'aedar_territory_summary' && item.target.id === '22001')
        if (!focal || !failFocalSummary) return false
        failFocalSummary = false
        return true
      },
    })
    vi.stubGlobal('fetch', summaryFetch)
    const mounted = await monter('/territoire/commune/22001?theme=mobilite', chargerReferenceReelle)
    const summaryAlert = mounted.wrapper.findAll('.aedar-state')
      .find((alert) => alert.text().includes('Les données AEDAR ne sont pas disponibles.'))
    expect(summaryAlert).toBeDefined()
    const unavailableOverview = mounted.wrapper.get('[data-section="aedar-car-overview"]')
    expect(unavailableOverview.findAll('.cahier-figure-scalar-value').map((node) => node.text())).toEqual(['—', '—'])
    expect(mounted.wrapper.find('[data-section="aedar-access"] .aedar-time-ramp').exists()).toBe(false)
    expect(mounted.wrapper.find('[data-section="aedar-equipment-profile"] .aedar-waffle-grid').exists()).toBe(true)
    const detailReadsBeforeSummaryRetry = requests.flat().filter((item) =>
      item.resource === 'aedar_territorial_aggregate' && item.intent.kind === 'facts').length
    const summaryReadsBeforeRetry = requests.flat().filter((item) => item.resource === 'aedar_territory_summary').length

    await summaryAlert!.find('button').trigger('click')
    await flushPromises()
    expect(mounted.wrapper.text()).not.toContain('Les données AEDAR ne sont pas disponibles.')
    const overviewAfterSummaryRetry = mounted.wrapper.get('[data-section="aedar-car-overview"]')
    expect(overviewAfterSummaryRetry.findAll('.cahier-figure-scalar-value').map((node) => node.text())).toEqual(['5', '11'])
    expect(requests.flat().filter((item) => item.resource === 'aedar_territorial_aggregate' && item.intent.kind === 'facts'))
      .toHaveLength(detailReadsBeforeSummaryRetry)
    expect(requests.flat().filter((item) => item.resource === 'aedar_territory_summary').length)
      .toBeGreaterThan(summaryReadsBeforeRetry)
    mounted.wrapper.unmount()

    const detailRequests: Array<Array<Record<string, any>>> = []
    let failFocalDetail = true
    vi.stubGlobal('fetch', nativeSemanticFetch(detailRequests, {
      failTypedDetail: (items) => {
        const focal = items.some((item) => item.resource === 'aedar_territorial_aggregate'
          && item.intent.kind === 'facts' && item.target.id === '22001')
        if (!focal || !failFocalDetail) return false
        failFocalDetail = false
        return true
      },
    }))
    const detailMounted = await monter('/territoire/commune/22001?theme=mobilite', chargerReferenceReelle)
    const detailAlert = detailMounted.wrapper.findAll('.aedar-state')
      .find((alert) => alert.text().includes('Les détails AEDAR ne sont pas disponibles.'))
    expect(detailAlert).toBeDefined()
    expect(detailMounted.wrapper.get('[data-section="aedar-car-overview"] .cahier-figure-scalar-value').text()).toBe('5')
    expect(detailMounted.wrapper.find('[data-section="aedar-equipment-profile"] .aedar-waffle-grid').exists()).toBe(false)
    const summaryReadsBeforeDetailRetry = detailRequests.flat().filter((item) => item.resource === 'aedar_territory_summary').length
    const detailReadsBeforeRetry = detailRequests.flat().filter((item) =>
      item.resource === 'aedar_territorial_aggregate' && item.intent.kind === 'facts').length

    await detailAlert!.find('button').trigger('click')
    await flushPromises()
    expect(detailMounted.wrapper.text()).not.toContain('Les détails AEDAR ne sont pas disponibles.')
    expect(detailMounted.wrapper.find('[data-section="aedar-equipment-profile"] .aedar-waffle-grid').exists()).toBe(true)
    expect(detailRequests.flat().filter((item) => item.resource === 'aedar_territory_summary'))
      .toHaveLength(summaryReadsBeforeDetailRetry)
    expect(detailRequests.flat().filter((item) => item.resource === 'aedar_territorial_aggregate' && item.intent.kind === 'facts').length)
      .toBeGreaterThan(detailReadsBeforeRetry)
    detailMounted.wrapper.unmount()
  }, 20_000)

  it('re-probes a typed AEDAR publication absence from the real retry alert', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let absent = true
    vi.stubGlobal('fetch', nativeSemanticFetch(requests, {
      unavailableTypedDetail: (items) => {
        const focal = items.some((item) => item.resource === 'aedar_territorial_aggregate'
          && item.intent.kind === 'facts' && item.target.id === '22001')
        if (!focal || !absent) return false
        absent = false
        return true
      },
    }))
    const mounted = await monter('/territoire/commune/22001?theme=mobilite', chargerReferenceReelle)
    const alert = mounted.wrapper.findAll('.aedar-state')
      .find((node) => node.text().includes('Les détails AEDAR ne sont pas disponibles.'))
    expect(alert).toBeDefined()
    const detailReadsBefore = requests.flat().filter((item) =>
      item.resource === 'aedar_territorial_aggregate' && item.intent.kind === 'facts').length
    expect(detailReadsBefore).toBeGreaterThan(0)

    // A typed absence is a settled item state; the retry alert is the explicit
    // re-probe and must issue a fresh semantic read.
    await alert!.find('button').trigger('click')
    await flushPromises()
    expect(mounted.wrapper.text()).not.toContain('Les détails AEDAR ne sont pas disponibles.')
    expect(mounted.wrapper.find('[data-section="aedar-equipment-profile"] .aedar-waffle-grid').exists()).toBe(true)
    expect(requests.flat().filter((item) =>
      item.resource === 'aedar_territorial_aggregate' && item.intent.kind === 'facts').length)
      .toBeGreaterThan(detailReadsBefore)
    mounted.wrapper.unmount()
  })

  it('keeps summary clocks, singleton rank, focal reset, and the EPCI → density → EPCI → density → custom sequence coherent', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let comparisonClock = 'stale-summary-clock'
    let summaryContentVersion = 'aedar-summary-fixture-v1'
    let aedarContentVersion = 'aedar_territorial_aggregate-fixture-publication-v1'
    let referenceContentVersion = 'semantic-reference-fixture-v1'
    let comparisonAedarClock = aedarContentVersion
    let comparisonReferenceClock = referenceContentVersion
    const fetchApi = nativeSemanticFetch(requests, {
      summaryContentVersion: () => summaryContentVersion,
      aedarContentVersion: () => aedarContentVersion,
      referenceContentVersion: () => referenceContentVersion,
      comparisonSummaryClock: () => comparisonClock,
      comparisonAedarClock: () => comparisonAedarClock,
      comparisonReferenceClock: () => comparisonReferenceClock,
    })
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite&comparaison=epci', chargerReferenceReelle)
    await flushPromises()

    const overview = () => wrapper.get('[data-section="aedar-car-overview"]')
    expect(overview().findAll('.cahier-figure-scalar-value').map((node) => node.text())).toEqual(['5', '11'])
    expect(overview().find('.cahier-comparison-value__warning').exists()).toBe(true)
    // A stale comparison clock fails closed without dropping the independently valid EPCI summary line.
    expect(overview().find('.cahier-comparison-value').text()).toContain('Groupe comparé : 2,5')
    comparisonClock = 'aedar-summary-fixture-v1'
    await overview().get('.aedar-comparison-retry').trigger('click')
    await flushPromises()
    expect(overview().find('.cahier-comparison-value__warning').exists()).toBe(false)
    expect(overview().findAll('.cahier-comparison-value').map((node) => node.text())).toEqual([
      'Groupe comparé : 13', 'Groupe comparé : 29',
    ])

    // The repeated EPCI and density transitions are intentional: they exercise watcher cleanup,
    // comparison-cache identity, and direct-reference cache reuse on the real page.
    await router.replace({ query: { theme: 'mobilite', comparaison: 'densite' } })
    await flushPromises()
    expect(overview().find('.cahier-comparison-value__warning').exists()).toBe(false)
    expect(overview().findAll('.cahier-comparison-value').map((node) => node.text())).toEqual([
      'Groupe comparé : 17', 'Groupe comparé : 31',
    ])
    await router.replace({ query: { theme: 'mobilite', comparaison: 'epci' } })
    await flushPromises()
    expect(overview().findAll('.cahier-comparison-value').map((node) => node.text())).toEqual([
      'Groupe comparé : 13', 'Groupe comparé : 29',
    ])
    await router.replace({ query: { theme: 'mobilite', comparaison: 'densite' } })
    await flushPromises()
    expect(overview().findAll('.cahier-comparison-value').map((node) => node.text())).toEqual([
      'Groupe comparé : 17', 'Groupe comparé : 31',
    ])

    // A one-territory custom group keeps the served focal value but rank is honestly null.
    await router.replace({ query: { theme: 'mobilite', comparaison: 'commune:22001' } })
    await flushPromises()
    expect(overview().find('.cahier-figure-scalar-value').text()).toBe('5')
    expect(overview().findAll('.cahier-comparison-value').map((node) => node.text())).toEqual([
      'Groupe comparé : 5', 'Groupe comparé : 11',
    ])
    expect(overview().find('.cahier-rank').exists()).toBe(false)
    expect(overview().find('.cahier-figure-scalar').attributes('aria-label')).not.toContain('Rang')

    await router.replace({ query: { theme: 'mobilite', comparaison: 'bretagne' } })
    await flushPromises()
    expect(overview().findAll('.cahier-comparison-value').map((node) => node.text())).toEqual([
      'Groupe comparé : 19', 'Groupe comparé : 37',
    ])
    expect(requests.flat().some((item) => item.resource === 'aedar_territory_summary'
      && item.target.type === 'region' && item.target.id === '53')).toBe(true)

    const comparisonsBeforeReset = requests.flat().filter((item) =>
      item.resource === 'aedar_territorial_aggregate' && item.intent.kind !== 'facts').length
    await router.replace({ query: { theme: 'mobilite', comparaison: '' } })
    await flushPromises()
    expect(overview().findAll('.cahier-figure-scalar-value').map((node) => node.text())).toEqual(['5', '11'])
    expect(overview().find('.cahier-comparison-value').exists()).toBe(false)
    expect(requests.flat().filter((item) => item.resource === 'aedar_territorial_aggregate' && item.intent.kind !== 'facts'))
      .toHaveLength(comparisonsBeforeReset)

    // Moving the focal route invalidates the previous focal summary/comparison presentation.
    await router.replace({ path: '/territoire/commune/22002', query: { theme: 'mobilite', comparaison: '' } })
    await flushPromises()
    expect(wrapper.get('[data-section="aedar-car-overview"] .cahier-figure-scalar-value').text()).toBe('3,5')
    expect(wrapper.get('[data-section="aedar-car-overview"] .cahier-figure-scalar-value').text()).not.toBe('5')
    expect(wrapper.find('.cahier-comparison-value').exists()).toBe(false)
    expect(requests.flat().some((item) => item.resource === 'aedar_territory_summary'
      && item.target.type === 'commune' && item.target.id === '22002')).toBe(true)

    // A new theme acquisition refreshes both summary endpoints without direct
    // cache manipulation. All three producer clocks move; old comparison
    // evidence remains incompatible until its own retry acquires matching clocks.
    const comparisonReadsBeforeClockRefresh = requests.flat().filter((item) =>
      item.resource === 'aedar_territorial_aggregate' && item.intent.kind !== 'facts'
      && !(item.coordinates?.typequ?.length)).length
    summaryContentVersion = 'aedar-summary-fixture-v2'
    aedarContentVersion = 'aedar_territorial_aggregate-fixture-publication-v2'
    referenceContentVersion = 'semantic-reference-fixture-v2'
    const refreshedEpci = cibleReference('22002').epci
    if (!refreshedEpci) throw new Error('Expected a reference EPCI for 22002')
    const focalSummariesBeforeRefresh = requests.flat().filter((item) => item.resource === 'aedar_territory_summary'
      && item.target.type === 'commune' && item.target.id === '22002').length
    const referenceSummariesBeforeRefresh = requests.flat().filter((item) => item.resource === 'aedar_territory_summary'
      && item.target.type === 'epci' && item.target.id === refreshedEpci).length
    await router.replace({ query: { theme: 'economie', comparaison: '' } })
    await flushPromises()
    await router.replace({ query: { theme: 'mobilite', comparaison: 'epci' } })
    await flushPromises()
    expect(requests.flat().filter((item) => item.resource === 'aedar_territory_summary'
      && item.target.type === 'commune' && item.target.id === '22002').length).toBeGreaterThan(focalSummariesBeforeRefresh)
    expect(requests.flat().filter((item) => item.resource === 'aedar_territory_summary'
      && item.target.type === 'epci' && item.target.id === refreshedEpci).length).toBeGreaterThan(referenceSummariesBeforeRefresh)
    expect(overview().find('.cahier-comparison-value__warning').exists()).toBe(true)
    expect(requests.flat().filter((item) => item.resource === 'aedar_territorial_aggregate'
      && item.intent.kind !== 'facts' && !(item.coordinates?.typequ?.length)).length)
      .toBeGreaterThan(comparisonReadsBeforeClockRefresh)
    comparisonClock = 'aedar-summary-fixture-v2'
    comparisonAedarClock = aedarContentVersion
    comparisonReferenceClock = referenceContentVersion
    await overview().get('.aedar-comparison-retry').trigger('click')
    await flushPromises()
    expect(overview().find('.cahier-comparison-value__warning').exists()).toBe(false)
    expect(overview().findAll('.cahier-comparison-value').map((node) => node.text())).toEqual([
      'Groupe comparé : 13', 'Groupe comparé : 29',
    ])

    const aedarItems = requests.flat().filter((item) =>
      item.resource === 'aedar_territorial_aggregate' || item.resource === 'aedar_territory_summary')
    const epciSummaryReads = aedarItems.filter((item) => item.resource === 'aedar_territory_summary'
      && item.target.type === 'epci' && item.target.id === cibleReference('22001').epci)
    expect(epciSummaryReads.length).toBeGreaterThan(1)
    expect(aedarItems.filter((item) => item.resource === 'aedar_territorial_aggregate'
      && item.intent.kind === 'facts').every((item) => item.target.type === 'commune')).toBe(true)
    const contexts = aedarItems.filter((item) => item.resource === 'aedar_territorial_aggregate'
      && item.intent.kind !== 'facts' && !(item.coordinates?.typequ?.length)).map((item) => item.intent.kind === 'fixed_comparison'
      ? item.intent.context : item.intent.kind)
    const contextTransitions = contexts.filter((context, index) => context !== contexts[index - 1])
    // Comparison evidence remains deduplicated by publication identity while
    // summary reads are refreshed at each new active-page acquisition.
    expect(contextTransitions).toEqual(['epci', 'density_class', 'selected_comparison', 'bretagne', 'epci'])
    const singleton = aedarItems.find((item) => item.resource === 'aedar_territorial_aggregate'
      && item.intent.kind === 'selected_comparison' && item.intent.members.length === 1
      && !(item.coordinates?.typequ?.length))
    expect(singleton?.intent.members).toEqual([{ type: 'commune', id: '22001' }])
    expect(fetchBloque).not.toHaveBeenCalled()
    wrapper.unmount()
  }, 20_000)

  it.skipIf(!process.env.LUSK_AEDAR_BRIDGE_ARTIFACT)(
    'replays guarded R publisher API responses through the mounted production route, with typed detail failing independently',
    async () => {
      const artifactPath = resolve(process.env.LUSK_AEDAR_BRIDGE_ARTIFACT!)
      const repositoryRoot = resolve(process.cwd(), '..')
      const artifactRelativePath = relative(repositoryRoot, artifactPath)
      expect(artifactRelativePath.startsWith('..') || isAbsolute(artifactRelativePath)).toBe(true)

      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, any>
      expect(artifact.contract).toBe('lusk-aedar-mounted-api-replay-v1')
      expect(artifact.evidence).toContain('fixture replay, not production benchmarking')
      expect(JSON.stringify(artifact)).not.toContain('postgresql://')
      expect(JSON.stringify(artifact)).not.toContain('lusk_it_contract')

      const focale = artifact.summaryResponses['commune/22001'].results[0].data
      const reference = artifact.summaryResponses['epci/200000001'].results[0].data
      const reading = (data: Record<string, any>, measure: string) =>
        data.readings.find((candidate: Record<string, any>) => candidate.measure === measure)
      expect(reading(focale, 'meanVolume').value).toBe(1.25)
      expect(reading(reference, 'meanVolume').value).toBe(2.5)

      const fixedResults = artifact.fixedComparisonResponse.results as Array<Record<string, any>>
      const fixedMeanVolume = fixedResults.find((result) => result.data.comparison.measure === 'meanVolume')?.data.comparison
      expect(fixedMeanVolume).toMatchObject({ group_value: 2.5, rank: 1, rank_size: 2, rank_ties: 1 })
      const typedArtifactFact = artifact.typedFactResponse.results[0].data.facts[0]
      expect(typedArtifactFact.measures).toEqual({ count_15_car_mean: 1.25 })

      const requests: Array<Array<Record<string, any>>> = []
      const fallback = nativeSemanticFetch(requests)
      const comparisonsByMeasure = new Map(fixedResults.map((result) => [
        result.data.comparison.measure, result.data,
      ]))
      let failMountedTypedReads = true
      const bridgeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== '/api/resources/read-batch') return fallback(input, init)
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        if (items.every((item) => item.resource === 'aedar_territory_summary')) {
          requests.push(items)
          const target = items[0]!.target
          const captured = artifact.summaryResponses[`${target.type}/${target.id}`]
          if (!captured) throw new Error(`Missing guarded summary response for ${target.type}/${target.id}`)
          return new Response(JSON.stringify(captured), { status: 200 })
        }
        if (items.every((item) => item.resource === 'aedar_territorial_aggregate'
          && item.intent?.kind === 'fixed_comparison' && item.intent?.context === 'epci'
          && !(item.coordinates?.typequ?.length))) {
          requests.push(items)
          const results = items.map((item) => {
            const measure = item.coordinates.measure[0]
            const data = comparisonsByMeasure.get(measure)
            if (!data) throw new Error(`Missing guarded fixed-comparison response for ${measure}`)
            return { id: item.id, resource: item.resource, status: 'available', data }
          })
          return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results }), { status: 200 })
        }
        if (items.some((item) => item.resource === 'aedar_territorial_aggregate'
          && item.intent?.kind === 'facts')) {
          requests.push(items)
          if (failMountedTypedReads) return new Response('', { status: 503 })
          const item = items[0]!
          if (items.length === 1 && item.target.type === 'commune' && item.target.id === '22001'
            && item.coordinates?.typequ?.join(',') === 'A135'
            && item.fields?.join(',') === 'measures.count_15_car_mean') {
            const captured = artifact.typedFactResponse
            return new Response(JSON.stringify({ ...captured, results: captured.results.map((result: Record<string, any>) => ({
              ...result, id: item.id, resource: item.resource, status: 'available',
            })) }), { status: 200 })
          }
          throw new Error('Unexpected AEDAR typed read in guarded bridge replay')
        }
        return fallback(input, init)
      })
      vi.stubGlobal('fetch', bridgeFetch)

      const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&comparaison=epci', chargerReferenceFixture)
      await flushPromises()
      const overview = wrapper.get('[data-section="aedar-car-overview"]')
      expect(overview.findAll('.cahier-figure-scalar-value').map((node) => node.text())).toEqual(['0', '1,3'])
      expect(overview.text()).toContain('Groupe comparé : 2,5')
      expect(wrapper.text()).toContain('Les détails AEDAR ne sont pas disponibles.')
      expect(requests.flat().some((item) => item.resource === 'aedar_territory_summary'
        && item.target.type === 'commune' && item.target.id === '22001')).toBe(true)
      expect(requests.flat().some((item) => item.resource === 'aedar_territorial_aggregate'
        && item.intent.kind === 'fixed_comparison' && item.intent.context === 'epci')).toBe(true)
      expect(requests.flat().some((item) => item.resource === 'aedar_territorial_aggregate'
        && item.intent.kind === 'facts')).toBe(true)
      wrapper.unmount()

      // The same production client also validates the captured typed public API
      // body when detail reads are available; the mounted route's 503 above is
      // independent of and does not erase its accepted summary.
      failMountedTypedReads = false
      const typed = await fetchAedarAggregates('commune', '22001', {
        typequ: ['A135'], measures: ['count_15_car_mean'],
      })
      expect(typed).toMatchObject({ status: 'ready', facts: [{ typequ: 'A135', measures: { count_15_car_mean: 1.25 } }] })
    },
  )

  it('déclare la comparaison Mobilité nommée non résoluble indisponible, sans requête ni réessai sans effet', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    // L’identité nommée de la commune est absente du référentiel : la sélection
    // est nommée mais non résoluble, ce n’est pas une panne d’acquisition.
    const referenceSansEpci = referenceReelle.map((territory) =>
      territory.type === 'commune' && territory.territoire === '22001'
        ? { ...territory, epci: '999999' }
        : territory)
    const { wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&comparaison=epci#figure-offre-transports-commun',
      async () => referenceSansEpci)
    await flushPromises()
    await flushPromises()

    expect(requests.flat().some((item) => item.intent.kind === 'selected_comparison')).toBe(false)
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    const cue = wrapper.get('.mobilite-raccordement-curve__cue .comparison-unavailable-cue__trigger')
    expect(cue.attributes('aria-label')).toContain('Comparaison non disponible')
    await cue.trigger('focus')
    expect(wrapper.get('[role="tooltip"]').text()).toContain('identité du groupe comparé')
    expect(wrapper.get('.mobilite-raccordement-curve__state').text()).toContain('Aucun groupe comparé')
    expect(wrapper.find('.mobilite-raccordement-curve__retry').exists()).toBe(false)
    const curve = wrapper.get('.mobilite-raccordement-curve')
    expect(curve.find('.cahier-figure-legend-comparison-error').exists()).toBe(false)
    expect(curve.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('garde les comparaisons scalaires prêtes quand seul le nuage demandé manque, puis le rétablit depuis le réessai de la section', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let cloudBroken = false
    const fixtureFetch = nativeSemanticFetch(requests)
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/api/resources/read-batch') return fixtureFetch(input, init)
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      const cloudItem = items.find((item) => item.resource === 'demographie_selected_reading' &&
        item.target?.kind === 'territory_cohort')
      // La seule lecture de nuage est mutilée une fois ; les autres lectures
      // restent saines et indépendantes.
      if (!cloudItem || cloudBroken) return fixtureFetch(input, init)
      const response = await fixtureFetch(input, init)
      cloudBroken = true
      // La lecture de cohorte répond, mais sans le contrat de nuage demandé :
      // les comparaisons scalaires restent servies et valides.
      const body = await response.json() as { results: Array<Record<string, any>> }
      for (const result of body.results) delete (result.data as Record<string, unknown>).cohort
      return new Response(JSON.stringify(body), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=demographie&comparaison=epci',
      chargerReferenceReelle)
    await flushPromises()

    const selectedBatches = () => requests.filter((items) =>
      items.some((item) => item.resource === 'densite' && item.intent.kind === 'selected_comparison'))
    const densiteFacts = () => requests.flat().filter((item) =>
      item.resource === 'densite' && item.intent.kind === 'facts' && item.target?.kind === 'territory')
    const onglet = () => wrapper.findComponent(OngletTheme)
    const cloudStories = () =>
      ((onglet().props('payload') as Payload).histoires as Array<{ nuageDemographieApi?: boolean }>)
        .filter((histoire) => histoire.nuageDemographieApi === true)

    // Les valeurs et rangs comparés sont servis par leur propre lecture.
    const densiteBatch = selectedBatches()[0]
    expect(densiteBatch).toBeDefined()
    const served = await nativeBatchResponse(densiteBatch!, nativeFicheReadFixture).json() as {
      results: Array<{ resource: string; data: Record<string, any> }> }
    const densiteResult = served.results.find((result) => result.resource === 'densite')!.data.result
    const densiteComparison = wrapper.get('[data-clef="densite"] .figure-indicateur-comparaison')
    expect(densiteComparison.text()).toContain(
      `${formaterValeur({ value: densiteResult.median, unit: densiteResult.unit })} ${densiteResult.unit}`)
    expect(densiteComparison.find('.puce-rang').exists()).toBe(true)
    expect(wrapper.find('.comparison-unavailable-note').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(cloudStories()).toHaveLength(0)

    // Le nuage demandé manque : avertissement local, un seul réessai de section.
    const cloudCue = wrapper.get('.cloud-read-warning .comparison-unavailable-cue__trigger')
    expect(cloudCue.attributes('aria-label')).toContain('Nuage du groupe comparé indisponible')
    await cloudCue.trigger('focus')
    expect(wrapper.get('[role="tooltip"]').text()).toContain('Nuage du groupe comparé indisponible')
    expect(wrapper.find('.comparison-section-retry').exists()).toBe(true)
    expect(selectedBatches()).toHaveLength(1)
    const densiteFactsBefore = densiteFacts().length

    const requestsBeforeRetry = requests.length
    await wrapper.get('.comparison-section-retry').trigger('click')
    await flushPromises()

    // Le réessai ré-acquiert la SEULE comparaison propriétaire : un lot de
    // comparaisons (pas un POST par figure) + sa lecture auxiliaire, sans focal.
    const retryBatches = requests.slice(requestsBeforeRetry).filter((items) =>
      items.some((item) => item.intent.kind === 'selected_comparison') ||
      items.some((item) => item.resource === 'demographie_selected_reading' &&
        item.target?.kind === 'territory_cohort'))
    expect(retryBatches).toHaveLength(2)
    expect(retryBatches[0]!.filter((item) => item.intent.kind === 'selected_comparison')).toHaveLength(4)
    expect(retryBatches.flat().some((item) =>
      item.target?.kind === 'territory' && item.intent.kind === 'facts')).toBe(false)

    expect(densiteFacts()).toHaveLength(densiteFactsBefore)
    expect(wrapper.find('.cloud-read-warning').exists()).toBe(false)
    expect(wrapper.find('.comparison-section-retry').exists()).toBe(false)
    expect(cloudStories().length).toBeGreaterThan(0)
    expect(wrapper.get('[data-clef="densite"] .figure-indicateur-comparaison').text()).toBe(densiteComparison.text())
    wrapper.unmount()
  })

})

describe('TerritoireView — #860 (ruling 2026-11-03) : le bouton « Comparaison » dans le page-heading collant du Cahier', () => {
  it('nomme le membre refusé par le producteur, ferme le résumé du groupe et conserve les faits focaux (#861)', async () => {
    const servir = nativeSemanticFetch()
    let refuser = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources/read-batch' && refuser) {
        const { items } = JSON.parse(String(init?.body))
        if (items.some((item: any) => item.intent.kind === 'selected_comparison')) {
          return new Response(JSON.stringify({ detail: 'Selected comparison member commune/22002 has no published value' }), { status: 422 })
        }
      }
      return servir(input, init)
    }))
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&comparaison=#figure-offre-transports-commun', chargerReferenceReelle)
    await flushPromises()
    expect(wrapper.find('[data-series="territory"]').exists()).toBe(true)
    refuser = true
    await router.push('/territoire/commune/22001?theme=mobilite&comparaison=commune:22001,commune:22002#figure-offre-transports-commun')
    await flushPromises()
    const comparisonWarning = wrapper.get('.mobilite-raccordement-curve__legend .cahier-figure-legend-comparison-error')
    await comparisonWarning.trigger('focus')
    expect(wrapper.find('[role="tooltip"]').text()).toContain(cibleReference('22002').nom)
    expect(wrapper.find('[data-series="territory"]').exists()).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)
    refuser = false
    await wrapper.get('.mobilite-raccordement-curve__retry').trigger('click')
    await flushPromises()
    expect(wrapper.find('.mobilite-raccordement-curve__legend .cahier-figure-legend-comparison-error').exists()).toBe(false)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(true)
    wrapper.unmount()
  }, 20_000)
  it('construit au même niveau, acquiert les membres visibles et recharge le lien partagé sans réinsérer le focal (#861)', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&comparaison=', chargerReferenceReelle)
    await flushPromises()
    await wrapper.get('.page-heading [aria-label="Construire un groupe de comparaison"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('')
    await wrapper.get('.constructeur-comparaison input[type="search"]').setValue('22002')
    await wrapper.get(`[aria-label="Ajouter ${cibleReference('22002').nom}"]`).trigger('click')
    await flushPromises()
    await wrapper.get('.constructeur-comparaison input[type="search"]').setValue('')
    await flushPromises()
    await wrapper.get(`[aria-label="Retirer ${cibleReference('22001').nom}"]`).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('commune:22002')
    expect(requests.flat().filter((item) => item.intent.kind === 'selected_comparison').at(-1)!.intent.members)
      .toEqual([{ type: 'commune', id: '22002' }])
    const lien = router.currentRoute.value.fullPath
    wrapper.unmount()
    const reload = await monter(lien, chargerReferenceReelle)
    await flushPromises()
    expect(reload.router.currentRoute.value.query.comparaison).toBe('commune:22002')
    await reload.wrapper.get('.page-heading [aria-label="Construire un groupe de comparaison"]').trigger('click')
    expect(reload.wrapper.get('.membres-comparaison').text()).toContain(cibleReference('22002').nom)
    expect(reload.wrapper.find(`[aria-label="Retirer ${cibleReference('22001').nom}"]`).exists()).toBe(false)
    reload.wrapper.unmount()
  }, 20_000)
  it('assied le bouton dans le page-heading collant, à gauche du titre thème·territoire, avec la portée par défaut niveau-natif', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', chargerReferenceReelle)
    await flushPromises()

    // plus de contrôle dans le chrome d'onglets
    expect(wrapper.find('.fiche-barre-collante').exists()).toBe(false)
    const heading = wrapper.get('.page-layout--sticky .page-heading')
    const bouton = heading.get('.bouton-comparaison__declencheur')
    expect(wrapper.get('.cahier--indexed-sections .page-layout--sticky .page-heading .bouton-comparaison__declencheur').element)
      .toBe(bouton.element)
    const porteeDefaut = contextesReference('22001').epci!.scope.label
    // face laconique « Comparaison » ; la portée ride dans le nom accessible
    expect(bouton.find('.bouton-comparaison__texte').text()).toBe('Comparaison')
    expect(bouton.attributes('aria-label')).toBe(`Comparaison : ${porteeDefaut}`)
    expect(bouton.attributes('aria-haspopup')).toBe('menu')
    expect(heading.find('[aria-label="Construire un groupe de comparaison"]').exists()).toBe(true)
    // aligné à droite, immédiatement à gauche du titre « thème · territoire »
    const contexte = heading.get('.page-heading-context')
    expect(contexte.element.firstElementChild).toBe(wrapper.find('.page-heading-comparaison-controls').element)
    expect(wrapper.find('.page-heading-comparaison-controls').element.firstElementChild)
      .toBe(wrapper.find('.bouton-comparaison').element)
    expect(contexte.get('.page-heading-theme').text()).toBe('Mobilité')

    // Le défaut niveau-natif (EPCI de la commune) a déjà été acquis en
    // selected_comparison avec la cohorte communale de l'EPCI — jamais la densité.
    const selectedItems = requests.flat().filter((item) => item.intent.kind === 'selected_comparison')
    expect(selectedItems.length).toBeGreaterThan(0)
    const epciTyped = referenceReelle
      .filter((t) => t.type === 'commune' && t.epci === cibleReference('22001').epci)
      .map((t) => ({ type: 'commune' as const, id: t.territoire }))
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(selectedItems[0]!.intent.members).toEqual(epciTyped)
    wrapper.unmount()
  })

  it('utilise un seul modal idempotent depuis Personnalisé ou l’icône, avec fermeture en un clic', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite', chargerReferenceReelle)
    await flushPromises()
    await wrapper.get('.page-heading .bouton-comparaison__declencheur').trigger('click')
    const menuTrigger = wrapper.get('.page-heading .bouton-comparaison__declencheur').element as HTMLButtonElement
    const focusMenuTrigger = vi.spyOn(menuTrigger, 'focus')
    await wrapper.findAll('[role="menuitemradio"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBeUndefined()
    expect(wrapper.findAll('.constructeur-comparaison')).toHaveLength(1)
    expect(wrapper.get('.constructeur-comparaison dialog[aria-modal="true"]').text()).toContain('Construire un groupe de comparaison')
    expect(wrapper.get('.constructeur-comparaison input[type="search"]').attributes('aria-label')).toBe('Rechercher un territoire')
    expect(wrapper.findAll('dialog[open]').filter((dialog) => dialog.text().includes('Construire un groupe'))).toHaveLength(1)
    await wrapper.get('.constructeur-comparaison dialog[open] .cahier-dialog__close').trigger('click')
    await flushPromises()
    expect(wrapper.find('.constructeur-comparaison dialog[open]').exists()).toBe(false)
    expect(focusMenuTrigger).toHaveBeenCalledOnce()

    const iconTriggers = wrapper.findAll('.page-heading-builder-trigger')
    expect(iconTriggers.length).toBeGreaterThan(1)
    const focusIconTrigger = vi.spyOn(iconTriggers[1]!.element as HTMLButtonElement, 'focus')
    await iconTriggers[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.constructeur-comparaison dialog[open]')).toHaveLength(1)
    expect(iconTriggers[0]!.attributes('aria-expanded')).toBe('true')
    // Simulate another visible header's open request while the modal is already open.
    await iconTriggers[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.constructeur-comparaison dialog[open]')).toHaveLength(1)
    await wrapper.get('.constructeur-comparaison dialog[open] .cahier-dialog__close').trigger('click')
    await flushPromises()
    expect(wrapper.find('.constructeur-comparaison dialog[open]').exists()).toBe(false)
    expect(iconTriggers[1]!.attributes('aria-expanded')).toBe('false')
    expect(focusIconTrigger).toHaveBeenCalledOnce()
    wrapper.unmount()
  }, 20_000)

  it('le menu des presets (sans « Par défaut ») pilote l’URL et la passe d’acquisition par thème actif', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite', chargerReferenceReelle)
    await flushPromises()

    const bouton = wrapper.get('.page-heading .bouton-comparaison__declencheur')
    await bouton.trigger('click')
    const entrees = wrapper.findAll('[role="menuitemradio"]')
    const labels = entrees.map((e) => e.find('.bouton-comparaison__option-label').text())
    expect(labels).toEqual([
      'EPCI', 'Bretagne', 'Densité INSEE', 'Personnalisé', 'Aucune comparaison',
    ])
    expect(entrees.slice(0, 3).map((entry) => entry.get('.bouton-comparaison__option-scope').text())).toEqual([
      contextesReference('22001').epci!.scope.label,
      contextesReference('22001').bretagne!.scope.label,
      contextesReference('22001').densite!.scope.label,
    ])
    expect(wrapper.text()).not.toContain('Par défaut')
    // param absent → le preset niveau-natif (epci) est coché
    expect(entrees.map((e) => e.attributes('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false'])

    // Choisir le preset Bretagne écrit ?comparaison=bretagne et lance une
    // passe selected_comparison avec toutes les communes bretonnes.
    const bretagneTyped = referenceReelle.filter((t) => t.type === 'commune')
      .map((t) => ({ type: 'commune' as const, id: t.territoire }))
      .sort((a, b) => a.id.localeCompare(b.id))
    // La passe selected_comparison peut être découpée en plusieurs lots bornés
    // (≤12 lectures) — tous portent les mêmes membres tapés.
    const selectedBatchesWith = (members: unknown) => requests
      .filter((batch) => batch.some((item) => item.intent.kind === 'selected_comparison' &&
        JSON.stringify(item.intent.members) === JSON.stringify(members)))
    await entrees[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('bretagne')
    expect(selectedBatchesWith(bretagneTyped).length).toBeGreaterThan(0)

    // La sélection vide explicite écrit ?comparaison= et part avec [].
    await wrapper.get('.page-heading .bouton-comparaison__declencheur').trigger('click')
    await wrapper.findAll('[role="menuitemradio"]')[4]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('')
    expect(selectedBatchesWith([]).length).toBeGreaterThan(0)
    expect(wrapper.get('.page-heading .bouton-comparaison__declencheur').attributes('aria-label'))
      .toBe('Comparaison : Aucune comparaison')

    // Choisir le preset niveau-natif écrit le preset explicite dans l'URL.
    await wrapper.get('.page-heading .bouton-comparaison__declencheur').trigger('click')
    await wrapper.findAll('[role="menuitemradio"]')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('epci')
    wrapper.unmount()
  // Integration de fiche montée : trois changements de portée acquièrent
  // successivement Bretagne, la sélection vide puis l'EPCI via l'API sémantique.
  // Le travail est borné et les assertions couvrent aussi les requêtes; le budget
  // explicite est cohérent avec les tests d'intégration voisins (20 s).
  }, 20_000)

  it('une URL de membres tapés résout et acquiert la sélection telle quelle et rend les références Mobilité (#981)', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    const membres = 'commune:22001,commune:22002'
    const { router, wrapper } = await monter(
      `/territoire/commune/22001?theme=mobilite&comparaison=${membres}`, chargerReferenceReelle)
    await flushPromises()

    expect(router.currentRoute.value.query.comparaison).toBe(membres)
    const typedItems = requests.flat().filter((item) => item.intent.kind === 'selected_comparison')
    expect(typedItems.length).toBeGreaterThan(0)
    expect(typedItems[0]!.intent.members).toEqual([
      { type: 'commune', id: '22001' },
      { type: 'commune', id: '22002' },
    ])
    expect(wrapper.get('.page-heading .bouton-comparaison__declencheur').attributes('aria-label'))
      .toBe('Comparaison : 2 communes')
    // #981 — la réponse sélectionnée reste acquise : les figures Mobilité
    // rendent leur référence et nomment la portée custom dans le nom accessible,
    // elles ne la remplacent pas par « Groupe comparé : Indisponible ».
    const networks = wrapper.get('.mobilite-section--reseaux')
    expect(networks.findAll('.mobilite-comparison-bars__comparison').length).toBeGreaterThan(0)
    expect(networks.get('.cahier-figure-legend-item[aria-label^="Groupe comparé"]').attributes('aria-label'))
      .toContain('2 communes sélectionnées')
    expect(networks.get('svg[role="img"]').attributes('aria-label')).not.toContain('Groupe comparé : Indisponible')
    const parking = wrapper.get('.mobilite-section--stationnement-ravitaillement')
    expect(parking.find('.cahier-comparison-value__reference').exists()).toBe(true)
    wrapper.unmount()
  })

  it('garde le rang servi d’un groupe tapé à travers preset → custom → autre custom → vide, y compris face à une réponse tardive (#981)', async () => {
    const territoryId = '22001'
    const legacy = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const sourceId = legacy.sources[0]!
    const vintageId = lireMetadataSnapshot('programmes').source_records?.[sourceId]?.vintages?.[0]?.id
    const descriptorVersion = 'programmes-series-descriptor-v1'
    const publicationVersion = 'programmes-api-facts-sentinel-v1'
    const requests: Array<Array<Record<string, any>>> = []
    let releaseTardive!: () => void
    const tardive = new Promise<void>((resolve) => { releaseTardive = resolve })
    let tardiveRetenue = false

    const memos = (item: Record<string, any>) =>
      ((item.intent as { members?: Array<{ type: string; id: string }> }).members ?? [])
        .map((member) => ({ territory_type: member.type, territory_id: member.id }))

    const comparisonData = (item: Record<string, any>) => {
      const selection = memos(item)
      const cle = selection.map((member) => member.territory_id).join(',')
      // Le premier groupe tapé de 2 communes est retenu : sa réponse arrive
      // après le passage au groupe de 3 communes.
      const served = cle === '22001,22002'
        ? { median: 999, rank: 1, rank_size: 2 }
        : cle === '22001,22002,22003'
          // Un membre du groupe n'est pas mesuré : le rang servi porte
          // l'éligibilité (2), jamais le compte de sélection (3).
          ? { median: 111, rank: 2, rank_size: 2 }
          : selection.length
            ? { median: 555, rank: 1, rank_size: selection.length }
            : { median: null, rank: null, rank_size: null }
      return { resource: legacy.resource_id, target: item.target,
        contract: 'indicator-comparison-v1', complete_theme: false,
        indicator_id: legacy.indicator_id, shape: 'series', content_version: publicationVersion,
        reference_content_version: 'programmes-reference-v1', selection,
        scope: { kind: 'explicit_selection', member_count: selection.length },
        result: { indicator_id: legacy.indicator_id, source_facet: '2024', unit: legacy.unit,
          direction: legacy.direction, descriptor_version: descriptorVersion,
          status: served.median === null ? 'unavailable' : 'available',
          selected_member_count: selection.length, eligible_count: served.rank_size ?? 0,
          missing_count: selection.length - (served.rank_size ?? 0),
          median: served.median, rank: served.rank, rank_size: served.rank_size } }
    }

    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') {
        return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: [legacy] }))
      }
      if (url !== '/api/resources/read-batch') throw new Error(`Unexpected request: ${url}`)
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      requests.push(items)
      const retenue = items.some((item) => item.intent?.kind === 'selected_comparison' &&
        memos(item).map((member) => member.territory_id).join(',') === '22001,22002')
      if (retenue && !tardiveRetenue) { tardiveRetenue = true; await tardive }
      return nativeBatchResponse(items, (item) => {
        if (item.intent.kind !== 'facts') return comparisonData(item)
        return { resource: legacy.resource_id, target: item.target,
          publication_id: publicationVersion,
          territory: { id: territoryId, type: 'commune', name: cibleReference(territoryId).nom },
          indicator_id: legacy.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
          label: legacy.label, unit: legacy.unit, direction: legacy.direction,
          descriptor_version: descriptorVersion, comparison_point: '2024',
          points: [{ axis: '2024', status: 'measured', observation_period: '2024', value: 987,
            source_id: sourceId, vintage_id: vintageId, source_version: 'api-facts-clock-v1',
            source_reference_date: null, source_publication_date: '2026-08-05' }],
          availability: 'observed' }
      })
    })
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter(`/territoire/commune/${territoryId}?theme=programmes&comparaison=epci`,
      chargerReferenceReelle)
    await flushPromises()

    const comparaisonApi = () => {
      const payload = wrapper.findComponent(BlocProgrammes).props('payload') as Payload
      return payload.indicateurs.find((row) => row.territoire === territoryId &&
        row.key === 'subventions_annuelles' && row.dimension === '2024')?.comparaisonApi
    }

    // Preset : la portée publiée du preset reste nommée telle quelle.
    expect(comparaisonApi()).toMatchObject({
      portee: contextesReference(territoryId).epci!.scope.label,
      reference: { kind: 'median', value: 555 },
    })

    // Groupe tapé de 2 communes : sa réponse est retenue (réponse tardive).
    await router.replace({ query: { theme: 'programmes', comparaison: 'commune:22001,commune:22002' } })
    await flushPromises()
    expect(comparaisonApi()).toBeUndefined()

    // Autre groupe tapé de 3 communes : sa propre portée et son rang servi.
    await router.replace({ query: {
      theme: 'programmes', comparaison: 'commune:22001,commune:22002,commune:22003' } })
    await flushPromises()
    expect(comparaisonApi()).toMatchObject({
      portee: '3 communes sélectionnées', rang: 2, taille: 2,
      reference: { kind: 'median', value: 111 },
    })

    // La réponse du premier groupe arrive trop tard : elle ne remplace rien.
    releaseTardive()
    await flushPromises()
    expect(comparaisonApi()).toMatchObject({
      portee: '3 communes sélectionnées', rang: 2, taille: 2,
      reference: { kind: 'median', value: 111 },
    })

    // Sélection vidée : aucune référence, jamais un repli Bretagne.
    await router.replace({ query: { theme: 'programmes', comparaison: '' } })
    await flushPromises()
    expect(comparaisonApi()).toBeUndefined()
    expect(wrapper.find('.figure-indicateur-comparaison [role="img"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="alert"]').map((alert) => alert.text())).toEqual([])
    wrapper.unmount()
  }, 20_000)

  it('nomme la portée custom dans le nom accessible de la puce d’un thème générique (#981)', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    const { wrapper } = await monter(
      '/territoire/commune/22001?theme=demographie&comparaison=commune:22001,commune:22002', chargerReferenceReelle)
    await flushPromises()

    const comparison = wrapper.get('[data-clef="densite"] .figure-indicateur-comparaison [role="img"]')
    expect(comparison.attributes('aria-label')).toContain('Groupe comparé')
    expect(comparison.attributes('aria-label')).toContain('2 communes sélectionnées')
    // Le libellé visible reste « Groupe comparé » ; la portée résolue ne vit
    // que dans le nom accessible.
    expect(comparison.text()).toContain('Groupe comparé')
    expect(comparison.text()).not.toContain('communes sélectionnées')
    expect(wrapper.find('[data-clef="densite"] .puce-rang').exists()).toBe(true)
    expect(wrapper.find('.comparison-warning').exists()).toBe(false)
    expect(requests.flat().some((item) => item.resource === 'densite' &&
      item.intent.kind === 'selected_comparison')).toBe(true)
    wrapper.unmount()
  })

  it('la fiche Région n’a aucun contrôle de comparaison', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    const { router, wrapper } = await monter('/territoire/region/53?theme=mobilite&comparaison=bretagne',
      chargerReferenceReelle)
    await flushPromises()

    expect(wrapper.find('.bouton-comparaison').exists()).toBe(false)
    // Le paramètre est retiré : la Région n'a pas de comparaison.
    expect(router.currentRoute.value.query.comparaison).toBeUndefined()
    wrapper.unmount()
  })
})

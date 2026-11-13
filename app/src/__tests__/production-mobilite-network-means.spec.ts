import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { contexteMembresSelectionnes } from '@/fiche/comparisonContext'
import { applyThemeComparisonApiFacts, mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { MobiliteNetworksEvidence, ThemeContent } from '@/fiche/content/themeContent'
import type { ThemeMetadata } from '@/payload/types'
import { ThemeAcquisitionCache, acquireThemeComparison, acquireThemeFacts } from '@/payload/themeAcquisition'
import type { ThemeFactsDemand, ThemeSelectionMember } from '@/payload/themeAcquisition'
import { histoiresMobiliteFixture, metadonneesThemesFixtures, territoiresFixture,
  vintagesFixture } from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { routes } from '@/router'
import { nativeCatalogueResponse, nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'
import liveNetworks from './fixtures/rennes-network-live.json'

/**
 * #997 — the production acquisition→decoder→resolver→mounted chart slice for
 * the owner-approved equal-weight commune means. The transport is the real
 * producer catalogue and the real semantic client; only the published mean
 * values/identities are a fixture, never a live API claim.
 */

const publicMetadata = JSON.parse(readFileSync(
  join(process.cwd(), '..', 'public', 'data', 'theme_mobilite.json'), 'utf8',
)) as ThemeMetadata

const payload: Payload = {
  territoires: territoiresFixture.some((territory) => territory.territoire === '35238')
    ? territoiresFixture
    : [...territoiresFixture, { territoire: '35238', type: 'commune', nom: 'Rennes',
      departement: '35', epci: null }],
  indicateurs: [],
  histoires: histoiresMobiliteFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

const catalogue = nativeResources('mobilite')
const NETWORK = new Set(['reseaux_par_habitant', 'reseaux', 'offre_cyclable'])
const NETWORK_CAPTURE: Readonly<Record<string, Readonly<Record<string, number | string>>>> = {
  reseaux_par_habitant: liveNetworks.reseauxParHabitant,
  reseaux: liveNetworks.reseaux,
  offre_cyclable: liveNetworks.offreCyclable,
}

/** The published Rennes capture is the coherent focal partition the chart draws. */
function applyCoherentNetworkCapture(item: Record<string, any>, data: Record<string, any>) {
  const values = NETWORK_CAPTURE[item.resource]
  if (!values || !Array.isArray(data.observations)) return data
  for (const observation of data.observations) {
    const value = values[observation.detail]
    if (typeof value === 'number') observation.value = value
  }
  return data
}

const MEAN_VALUES: Readonly<Record<string, number>> = {
  t_km_1000: 10, b_km_1000: 8, c_km_1000: 20,
  t_longueur: 14, b_longueur: 12, c_longueur: 30,
  protege_km_1000: 5, partage_km_1000: 3,
  protege_longueur: 8, partage_longueur: 4,
}

interface MeanPatch {
  mean?: number
  eligibleMembers?: readonly string[]
  status?: 'available' | 'unavailable'
}

function meanData(
  item: Record<string, any>,
  data: Record<string, any>,
  selectionIds: readonly string[],
  patch: MeanPatch = {},
): Record<string, any> {
  const detail = data.result.source_facet?.detail as string
  const status = patch.status ?? (selectionIds.length ? 'available' : 'unavailable')
  const eligible = status === 'available' ? (patch.eligibleMembers ?? selectionIds) : []
  const focalInSelection = selectionIds.includes(item.target.id)
  const rankable = status === 'available' && focalInSelection && eligible.length >= 2
  const result: Record<string, any> = {
    ...data.result,
    statistic: 'mean',
    status,
    reason: status === 'available' ? null : 'no_selected_comparable_values',
    mean: status === 'available' ? (patch.mean ?? MEAN_VALUES[detail] ?? 0) : null,
    eligible_members: [...eligible].sort(),
    eligible_count: eligible.length,
    missing_count: selectionIds.length - eligible.length,
    selected_member_count: selectionIds.length,
    focal_in_selection: focalInSelection,
    rank: rankable ? 1 : null,
    rank_size: rankable ? eligible.length : null,
    rank_ties: rankable ? 1 : null,
  }
  delete result.median
  return { ...data, result }
}

function meanFetch(
  selectionIds: readonly string[],
  options: {
    override?: (item: Record<string, any>, data: Record<string, any>) => Record<string, any> | null
  } = {},
) {
  const requests: Array<Record<string, any>> = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url !== '/api/resources/read-batch') return new Response('', { status: 404 })
    const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
    requests.push(...items)
    const results = items.map((item) => {
      const resource = catalogue.find((candidate) => candidate.resource_id === item.resource)
      if (!resource) throw new Error(`Unknown fixture resource ${item.resource}`)
      let data = applyCoherentNetworkCapture(item, nativeReadFixture(item, resource))
      if (item.intent.kind === 'selected_comparison' && item.intent.statistic === 'mean' &&
          NETWORK.has(item.resource)) {
        data = options.override?.(item, data) ?? meanData(item, data, selectionIds)
      }
      return { id: item.id, resource: item.resource, status: 'available', data }
    })
    return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results }), { status: 200 })
  })
  return { fetcher, requests }
}

function networkEvidence(facts: ReturnType<typeof applyThemeComparisonApiFacts>): MobiliteNetworksEvidence {
  const content: ThemeContent = resolveMobiliteThemeContent(facts, publicMetadata)
  const section = content.units.find((unit) => unit.key === 'partage-de-lespace-public')!
    .sections.find((candidate) => candidate.key === 'reseaux')!
  if (section.evidence?.kind !== 'mobilite-networks') throw new Error('Réseaux evidence expected')
  return section.evidence
}

function bikeOf(evidence: MobiliteNetworksEvidence) {
  return evidence.figure.categories.find((category) => category.key === 'bike')!
}

async function acquiredFacts(selection: readonly ThemeSelectionMember[]) {
  const acquired = await acquireThemeFacts('commune', '35238', 'mobilite')
  const comparison = await acquireThemeComparison('commune', '35238', 'mobilite', selection)
  const context = contexteMembresSelectionnes(selection)!
  return applyThemeComparisonApiFacts(
    mobilityFactsFromThemeApi(payload, '35238', acquired), comparison, context, selection)
}

function cacheFor() {
  return new ThemeAcquisitionCache(
    (theme, key, demand?: ThemeFactsDemand) => acquireThemeFacts(key!.type, key!.id, theme, demand),
    (selection, theme, key, coherence, indicators, fresh) =>
      acquireThemeComparison(key!.type, key!.id, theme, selection, coherence, indicators, fresh),
  )
}

async function mountNetworks(facts: ReturnType<typeof applyThemeComparisonApiFacts>) {
  const content = resolveMobiliteThemeContent(facts, publicMetadata)
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(VarianteCahierLibre, {
    props: {
      content,
      pagination: cahierPaginationFor(payload, content, true),
      presentation: 'plain',
      layoutVariant: 'indexed-sections',
      showAllUnits: true,
      nativeComparisonStatus: 'ready',
    },
    global: { plugins: [router] },
  })
  await router.isReady()
  await flushPromises()
  return wrapper
}

afterEach(() => vi.unstubAllGlobals())

describe('Mobilité page 2 — compared protected/shared means (#997)', () => {
  const selection = [
    { territory_type: 'commune' as const, territory_id: '35238' },
    { territory_type: 'commune' as const, territory_id: '35240' },
  ]

  it('requests means only for the network details and renders the served split beside the focal stack', async () => {
    const { fetcher, requests } = meanFetch(selection.map((member) => member.territory_id))
    vi.stubGlobal('fetch', fetcher)
    const facts = await acquiredFacts(selection)
    const evidence = networkEvidence(facts)
    const bike = bikeOf(evidence)

    expect(bike.comparisonSplit).toBe(true)
    expect(bike.comparisonSplitNote).toBeUndefined()
    expect(bike.value.fact.comparison?.reference).toMatchObject({
      kind: 'mean', value: 8, eligibleMembers: ['35238', '35240'],
    })
    expect(bike.segments.map((segment) => segment.value.fact.comparison?.reference?.value)).toEqual([5, 3])
    expect(bike.segments.map((segment) => segment.rawValue?.fact.comparison?.reference?.value)).toEqual([8, 4])
    expect(bike.value.fact.comparison?.scope.label).toBe('2 communes sélectionnées')

    const meanRequests = requests.filter((item) => item.intent.kind === 'selected_comparison' &&
      item.intent.statistic === 'mean')
    expect(meanRequests).toHaveLength(10)
    expect(new Set(meanRequests.map((item) => item.resource))).toEqual(NETWORK)
    expect(requests.filter((item) => item.intent.kind === 'selected_comparison' &&
      item.intent.statistic === undefined && NETWORK.has(item.resource))).toHaveLength(0)
    expect(requests.filter((item) => item.intent.kind === 'selected_comparison' &&
      item.intent.statistic === 'mean' && !NETWORK.has(item.resource))).toHaveLength(0)

    const wrapper = await mountNetworks(facts)
    const figure = wrapper.get('.mobilite-section--reseaux .mobilite-comparison-bars')
    const group = figure.get('g[data-comparison="bike"]')
    expect(group.attributes('data-comparison-split')).toBe('true')
    expect(group.findAll('rect[data-comparison-segment]')).toHaveLength(2)
    expect(figure.get('svg[role="img"]').attributes('aria-label'))
      .toContain('Moyenne des 2 communes sélectionnées')
    wrapper.unmount()
  })

  it('refuses equal eligible counts that name different communes', async () => {
    const selectionThree = [
      { territory_type: 'commune' as const, territory_id: '35238' },
      { territory_type: 'commune' as const, territory_id: '35240' },
      { territory_type: 'commune' as const, territory_id: '35001' },
    ]
    const { fetcher } = meanFetch(selectionThree.map((member) => member.territory_id), {
      override: (item, data) => {
        const detail = data.result.source_facet?.detail as string
        const partage = detail === 'partage_km_1000' || detail === 'partage_longueur'
        return meanData(item, data, selectionThree.map((member) => member.territory_id),
          { eligibleMembers: partage ? ['35238', '35001'] : ['35238', '35240'] })
      },
    })
    vi.stubGlobal('fetch', fetcher)
    const facts = await acquiredFacts(selectionThree)
    const bike = bikeOf(networkEvidence(facts))
    expect(bike.comparisonSplit).toBeUndefined()
    expect(bike.comparisonSplitNote).toContain('ne portent pas les mêmes communes')
    const wrapper = await mountNetworks(facts)
    expect(wrapper.find('g[data-comparison="bike"]').exists()).toBe(false)
    expect(wrapper.findAll('rect[data-comparison-segment]')).toHaveLength(0)
    expect(wrapper.text()).toContain('ne portent pas les mêmes communes')
    wrapper.unmount()
  })

  it('keeps an unavailable segment mean honest instead of drawing a shrunken stack', async () => {
    const { fetcher } = meanFetch(selection.map((member) => member.territory_id), {
      override: (item, data) => {
        const detail = data.result.source_facet?.detail as string
        return detail === 'partage_km_1000'
          ? meanData(item, data, selection.map((member) => member.territory_id), { status: 'unavailable' })
          : meanData(item, data, selection.map((member) => member.territory_id))
      },
    })
    vi.stubGlobal('fetch', fetcher)
    const facts = await acquiredFacts(selection)
    const bike = bikeOf(networkEvidence(facts))
    expect(bike.comparisonSplit).toBeUndefined()
    expect(bike.comparisonSplitNote).toContain('une moyenne servie est incomplète')
    expect(bike.segments[1]!.value.fact.comparison).toBeNull()
    expect(bike.value.fact.comparison?.reference?.value).toBe(8)
    const wrapper = await mountNetworks(facts)
    expect(wrapper.find('g[data-comparison="bike"]').exists()).toBe(false)
    expect(wrapper.find('rect[data-comparison="bike"]').exists()).toBe(true)
    expect(wrapper.findAll('rect[data-comparison-segment]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('keeps a measured zero as a valid compared partition', async () => {
    const ids = selection.map((member) => member.territory_id)
    const { fetcher } = meanFetch(ids, {
      override: (item, data) => meanData(item, data, ids, { mean: 0 }),
    })
    vi.stubGlobal('fetch', fetcher)
    const facts = await acquiredFacts(selection)
    const bike = bikeOf(networkEvidence(facts))
    expect(bike.comparisonSplit).toBe(true)
    expect(bike.value.fact.comparison?.reference?.value).toBe(0)
    const wrapper = await mountNetworks(facts)
    const group = wrapper.get('g[data-comparison="bike"]')
    expect(group.findAll('rect[data-comparison-segment]').map((segment) =>
      Number(segment.attributes('height')))).toEqual([0, 0])
    wrapper.unmount()
  })

  it('fails closed when the API answers a mean request with a median', async () => {
    const { fetcher } = meanFetch(selection.map((member) => member.territory_id), {
      override: (_item, data) => {
        const result = { ...data.result, statistic: 'median', status: 'available', reason: null,
          median: 5, rank: 1, rank_size: 2, rank_ties: 1 }
        delete result.mean
        delete result.eligible_members
        return { ...data, result }
      },
    })
    vi.stubGlobal('fetch', fetcher)
    const cache = cacheFor()
    await cache.get('commune', '35238', 'mobilite', { selection: null, auxiliary: false })
    await expect(cache.select('commune', '35238', 'mobilite', selection))
      .rejects.toThrow(/moyenne demandée/u)
  })

  it('keeps an EPCI member group on its declared median', async () => {
    const { fetcher, requests } = meanFetch(['200027027'])
    vi.stubGlobal('fetch', fetcher)
    await acquireThemeComparison('epci', '200027027', 'mobilite',
      [{ territory_type: 'epci', territory_id: '200027027' }])
    expect(requests.filter((item) => item.intent.kind === 'selected_comparison' &&
      item.intent.statistic === 'mean')).toHaveLength(0)
  })

  it('keeps an explicitly empty group empty and never falls back to Bretagne', async () => {
    const { fetcher, requests } = meanFetch([])
    vi.stubGlobal('fetch', fetcher)
    const acquired = await acquireThemeFacts('commune', '35238', 'mobilite')
    const comparison = await acquireThemeComparison('commune', '35238', 'mobilite', [])
    const facts = applyThemeComparisonApiFacts(
      mobilityFactsFromThemeApi(payload, '35238', acquired), comparison, undefined, [])
    const bike = bikeOf(networkEvidence(facts))
    expect(requests.filter((item) => item.intent.kind === 'selected_comparison' &&
      item.intent.statistic === 'mean').every((item) => item.intent.members.length === 0)).toBe(true)
    expect(comparison.selection).toEqual([])
    expect(comparison.comparison_reads?.every((read) => {
      const scope = read.data.scope as Record<string, unknown>
      return scope.kind === 'explicit_selection' && scope.member_count === 0
    })).toBe(true)
    expect(bike.value.fact.comparison).toBeNull()
    expect(bike.comparisonSplit).toBeUndefined()
    expect(bike.comparisonSplitNote).toContain('la moyenne du total cyclable n’est pas servie')
  })

  it('keeps the focal outside a peer group without inventing a rank', async () => {
    const peers = [
      { territory_type: 'commune' as const, territory_id: '35240' },
      { territory_type: 'commune' as const, territory_id: '35001' },
    ]
    const { fetcher } = meanFetch(peers.map((member) => member.territory_id))
    vi.stubGlobal('fetch', fetcher)
    const facts = await acquiredFacts(peers)
    const bike = bikeOf(networkEvidence(facts))
    expect(bike.value.fact.comparison?.rank).toBeNull()
    expect(bike.value.fact.comparison?.reference?.eligibleMembers).toEqual(['35001', '35240'])
    expect(bike.comparisonSplit).toBe(true)
    const wrapper = await mountNetworks(facts)
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).not.toContain('rang')
    wrapper.unmount()
  })

  it('rejects a mean comparison from another reference generation', async () => {
    const { fetcher } = meanFetch(selection.map((member) => member.territory_id), {
      override: (item, data) => item.resource === 'offre_cyclable'
        ? { ...meanData(item, data, selection.map((member) => member.territory_id)),
          reference_content_version: 'stale-reference' }
        : meanData(item, data, selection.map((member) => member.territory_id)),
    })
    vi.stubGlobal('fetch', fetcher)
    const cache = cacheFor()
    await cache.get('commune', '35238', 'mobilite', { selection: null, auxiliary: false })
    await expect(cache.select('commune', '35238', 'mobilite', selection))
      .rejects.toThrow(/publication tokens|incompatibles/u)
  })
})

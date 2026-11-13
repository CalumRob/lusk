import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TerritoireView from '@/views/TerritoireView.vue'
import { chargerMetadonneesTheme, THEME_METADATA_CHARGER_KEY } from '@/payload/themeCatalogue'
import { routes } from '@/router'
import { nativeBatchResponse, nativeCatalogueResponse, nativePublicationFamily,
  nativeReadFixture } from './helpers/semanticApiFixtures'
import { carInlineLegend } from './fixtures/aedar-car-inline-legend'
import { AEDAR_AGGREGATE_READING_KEYS } from '@/fiche/content/aedarTimeRampFacts'
import { AEDAR_TYPEQU_REGISTRY } from '@/fiche/content/aedarTypequRegistry'

/**
 * #986 — one cold navigation, every request counted, no owner exempt.
 *
 * The fixture transport is the same producer catalogue the API serves, so the
 * item inventory is derived, not invented. Ordering/counts here are
 * fixture-relative; they are NOT live API latency.
 */

function lireDonnee(relatif: string): string {
  return readFileSync(resolve(process.cwd(), '..', 'public', 'data', relatif), 'utf8')
}

interface Call {
  index: number
  url: string
  method: string
  items: Array<Record<string, any>>
}

interface TransportOptions {
  /** Per-item typed publication absence (never a whole-request 503). */
  gate?: (item: Record<string, any>) => boolean
  /** Hold one read until the returned promise settles (a pending acquisition). */
  hold?: (call: Call) => Promise<void> | undefined
}

/** Minimal valid producer summary envelope (the shared fixture has none). */
function summaryFixture(item: Record<string, any>) {
  const target = item.target
  return {
    resource: item.resource,
    target,
    territory: { territory_type: target.type, territory_id: target.id },
    summary_content_version: 'aedar-summary-fixture-v1',
    aedar_content_version: 'aedar_territorial_aggregate-fixture-publication-v1',
    reference_content_version: 'semantic-reference-fixture-v1',
    readings: AEDAR_AGGREGATE_READING_KEYS.map((measure) => ({
      measure, value: 3.5, status: 'available', n_typequ: AEDAR_TYPEQU_REGISTRY.length,
      n_addresses: 100, n_observed: 90, coverage_status: 'covered', statistic: 'direct',
      source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
      licence: 'ODbL', attribution: 'AEDAR', reference_date: '2026-01-01', publication_date: '2026-09-30',
    })),
  }
}

function createTransport(options: TransportOptions = {}) {
  const calls: Call[] = []
  let active = 0
  let maxActive = 0
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as { items?: Array<Record<string, any>> } : {}
    const call: Call = { index: calls.length, url, method: init?.method ?? 'GET', items: body.items ?? [] }
    calls.push(call)
    if (url === '/data/territoires.json') return new Response(lireDonnee('territoires.json'), { status: 200 })
    if (url.startsWith('/data/theme_') && url.endsWith('.json')) {
      return new Response(lireDonnee(url.slice('/data/'.length)), { status: 200 })
    }
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url === '/api/resources/read-batch') {
      active += 1
      maxActive = Math.max(maxActive, active)
      try {
        await options.hold?.(call)
        const response = await nativeBatchResponse(call.items, (item, resource) =>
          nativeReadFixture(item, resource, { syntheticProfileComparisons: true }))
        if (!options.gate) return response
        const wire = await response.clone().json() as { results: Array<Record<string, any>> }
        return new Response(JSON.stringify({ ...wire, results: wire.results.map((result, index) =>
          options.gate!({ ...call.items[index], ...result })
          ? { id: result.id, resource: result.resource, status: 'publication_unavailable',
            reason: 'publication_absent', family: nativePublicationFamily(result.resource) }
          : result) }), { status: 200 })
      } finally {
        active -= 1
      }
    }
    return new Response('', { status: 404 })
  })
  return { transport, calls, maxActive: () => maxActive }
}

const PAGE_TWO = ['reseaux', 'reseaux_par_habitant', 'surface_reseaux_routiers',
  'places_stationnement_velo_1000', 'places_stationnement_voiture_1000', 'stationnement_velo_par_voiture',
  'offre_cyclable', 'voitures_menage', 'bornes_recharge', 'bornes_ev_par_station_service',
  'bornes_recharge_1000', 'stations_service', 'stations_service_1000']
const PAGE_THREE = ['offre_tc', 'raccordement_tc', 'raccordement_courbe', 'raccordement_reference']

const isPost = (call: Call) => call.method === 'POST'
const posts = (calls: Call[]) => calls.filter(isPost)
const items = (calls: Call[]) => posts(calls).flatMap((call) => call.items)
const postsTouching = (calls: Call[], resources: readonly string[]) =>
  posts(calls).filter((call) => call.items.some((item) => resources.includes(item.resource)))
const isAedar = (item: Record<string, any>) => String(item.resource).startsWith('aedar_')

/** The shared client's exact semantic item identity (resource, target, intent, coordinates, fields). */
function itemKey(item: Record<string, any>): string {
  return JSON.stringify([item.resource, item.target, item.intent, item.coordinates ?? null,
    item.fields ? [...item.fields].sort() : null])
}

/**
 * #986 — no item is read twice, and a coordinate partition projected with more
 * than the semantic 32-field item limit is split into DISJOINT field chunks (the
 * API's per-item field bound), never re-read with an overlapping projection.
 */
function expectNoDuplicateOrOverlappingItem(allItems: Array<Record<string, any>>): void {
  const keys = allItems.map(itemKey)
  expect(new Set(keys).size, `duplicate semantic items: ${JSON.stringify(
    keys.filter((key, index) => keys.indexOf(key) !== index).slice(0, 5))}`).toBe(keys.length)

  const projections = new Map<string, Set<string>>()
  for (const item of allItems) {
    const coordinateKey = JSON.stringify([item.resource, item.target, item.intent, item.coordinates ?? null])
    const fields = item.fields ?? []
    expect(fields.length).toBeLessThanOrEqual(32)
    const seen = projections.get(coordinateKey) ?? new Set<string>()
    for (const field of fields) {
      expect(seen.has(field), `field ${field} re-read for ${coordinateKey.slice(0, 80)}`).toBe(false)
      seen.add(field)
    }
    projections.set(coordinateKey, seen)
  }
}

/**
 * #986 — a fetch stub never sees an <img> download. The DOM proof reads the
 * image sources actually present: no AEDAR map asset may exist while the page-1
 * chapter is not requested, and the expected one must appear once it is.
 */
function aedarImageSources(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('img[src]')
    .map((image) => image.attributes('src') ?? '')
    .filter((src) => src.includes('/maps/aedar/'))
}

function expectOnlyRequestedChapter(beforeUseful: Array<Record<string, any>>): void {
  const foreign = beforeUseful.filter((item) =>
    !PAGE_TWO.includes(item.resource))
  expect(foreign.map((item) => `${item.resource}/${item.intent.kind}`)).toEqual([])
}

async function monterFiche(chemin: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(TerritoireView, {
    global: { plugins: [router], provide: { [THEME_METADATA_CHARGER_KEY]: chargerMetadonneesTheme } },
  })
  return { router, wrapper }
}

/** Let an owner's in-flight read batches finish: its item count is stable across turns. */
async function settleOwner(calls: Call[], predicate: (item: Record<string, any>) => boolean): Promise<void> {
  let last = -1
  let stable = 0
  for (let tick = 0; tick < 800 && stable < 40; tick += 1) {
    await nextTick()
    if (tick % 8 === 0) await flushPromises()
    const count = items(calls).filter(predicate).length
    if (count === last) stable += 1
    else { stable = 0; last = count }
  }
}

/** Poll the DOM per microtask turn so "when did the chapter become useful" is observable. */
async function attendreChapitreUtile(wrapper: ReturnType<typeof mount>, calls: Call[],
  selector: string): Promise<{ callsAtUseful: number; postsAtUseful: number; itemsAtUseful: number }> {
  for (let tick = 0; tick < 400; tick += 1) {
    await nextTick()
    if (wrapper.find(selector).exists()) {
      return { callsAtUseful: calls.length, postsAtUseful: posts(calls).length,
        itemsAtUseful: items(calls).length }
    }
  }
  throw new Error(`Chapitre non rendu : ${selector}`)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Mobilite page 2 — critical demand and request budget', () => {
  it('issues ZERO AEDAR/page-3/unrelated request before page 2 is useful, then only its own 33 items', async () => {
    const { transport, calls, maxActive } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite#figure-partage-de-lespace-public')

    const useful = await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    const beforeUsefulCalls = calls.slice(0, useful.callsAtUseful)
    expectOnlyRequestedChapter(beforeUsefulCalls.filter(isPost).flatMap((call) => call.items))

    await flushPromises()

    // The requested chapter: 13 focal facts + the 20 displayed comparison
    // points, packed [11, 12, 10] — the mathematical floor for 33 items.
    const pageTwo = postsTouching(calls, PAGE_TWO)
    expect(pageTwo).toHaveLength(3)
    const pageTwoItems = pageTwo.flatMap((call) => call.items)
    expect(pageTwoItems).toHaveLength(33)
    expect(pageTwoItems.filter((item) => item.intent.kind === 'facts')).toHaveLength(13)
    expect(pageTwoItems.filter((item) => item.intent.kind === 'selected_comparison')).toHaveLength(20)
    expect(pageTwo.map((call) => call.items.length)).toEqual([11, 12, 10])
    // The producer's nested default is never fetched then discarded.
    expect(pageTwoItems.some((item) => item.intent.kind === 'fixed_comparison')).toBe(false)

    // No page-3 chapter and no AEDAR read is speculatively acquired on this
    // navigation: both belong to chapters the reader did not request.
    expect(postsTouching(calls, PAGE_THREE)).toHaveLength(0)
    expect(posts(calls).flatMap((call) => call.items).filter(isAedar)).toEqual([])
    // The pending page-1 car map must not download its image either (a fetch
    // stub cannot observe <img>, so the DOM is asserted directly).
    expect(aedarImageSources(wrapper)).toEqual([])
    // The page-1 asset reads are gated with the page-1 chapter too.
    expect(calls.filter((call) => call.url.startsWith('https://images.'))).toEqual([])

    // Unrelated themes are IDLE: zero before the requested chapter is useful,
    // then at most five coalesced batches, facts only.
    const idleThemes = posts(calls).filter((call) => call.items.every((item) =>
      !PAGE_TWO.includes(item.resource)))
    expect(idleThemes.length).toBeLessThanOrEqual(5)
    for (const call of idleThemes) {
      expect(call.index).toBeGreaterThan(pageTwo[2]!.index)
      expect(call.items.length).toBeLessThanOrEqual(12)
      expect(call.items.every((item) => item.intent.kind === 'facts')).toBe(true)
    }

    // Every owner, counted with the same exact identity: no item is read twice
    // and no projection overlaps.
    expectNoDuplicateOrOverlappingItem(items(calls))
    expect(maxActive()).toBeLessThanOrEqual(2)

    // Startup overhead counted explicitly, apart from the semantic budget.
    const gets = calls.filter((call) => !isPost(call))
    expect(gets.filter((call) => call.url === '/data/territoires.json')).toHaveLength(1)
    expect(gets.filter((call) => call.url === '/api/resources')).toHaveLength(1)
    expect(gets.filter((call) => call.url === '/data/theme_mobilite.json')).toHaveLength(1)
    expect(gets.filter((call) => call.url.startsWith('https://images.'))).toHaveLength(0)
    expect(gets.filter((call) => !['/data/territoires.json', '/api/resources', '/data/theme_mobilite.json']
      .includes(call.url)).map((call) => call.url)).toEqual([])

    // Not a loading shell: the figure carries its served values and references.
    const figure = wrapper.get('.mobilite-section--reseaux .mobilite-comparison-bars')
    expect(figure.findAll('.mobilite-comparison-bars__comparison')).toHaveLength(3)
    expect(figure.get('svg[role="img"]').attributes('aria-label')).toContain('km / 1 000 hab.')
    wrapper.unmount()
  }, 60000)

  it('reads each header selection once — custom, then cleared default — without re-reading facts', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche(
      '/territoire/commune/35238?theme=mobilite&comparaison=commune:35238,commune:35240#figure-partage-de-lespace-public')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()

    const selected = items(calls).filter((item) => item.intent.kind === 'selected_comparison')
    expect(selected.length).toBeGreaterThan(0)
    expect(selected.every((item) => JSON.stringify(item.intent.members) ===
      JSON.stringify([{ type: 'commune', id: '35238' }, { type: 'commune', id: '35240' }]))).toBe(true)
    expect(items(calls).some((item) => item.intent.kind === 'fixed_comparison')).toBe(false)

    const pageTwoFacts = (entries: Array<Record<string, any>>) => entries
      .filter((item) => item.intent.kind === 'facts' && PAGE_TWO.includes(item.resource))
    const factsBefore = pageTwoFacts(items(calls)).length
    const afterCustom = posts(calls).length

    // No `comparaison` parameter asks for the producer default once:
    // comparisons only, scoped to the chapter's own resources.
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-partage-de-lespace-public' })
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()
    const cleared = posts(calls).slice(afterCustom).flatMap((call) => call.items)
      .filter((item) => PAGE_TWO.includes(item.resource) && item.intent.kind !== 'facts')
    expect(cleared).toHaveLength(20)
    expect(new Set(cleared.map((item) => JSON.stringify(item.intent))).size).toBe(1)
    const factsAfter = pageTwoFacts(items(calls)).length
    expect(factsAfter).toBe(factsBefore)
    wrapper.unmount()
  }, 60000)

  it('reads the page-3 chapter only when it is requested: one batch, 7 items, no page-2 re-read', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite#figure-partage-de-lespace-public')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()
    expect(postsTouching(calls, PAGE_THREE)).toHaveLength(0)
    const pageTwoFactsBefore = items(calls)
      .filter((item) => item.intent.kind === 'facts' && PAGE_TWO.includes(item.resource)).length

    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-offre-transports-commun' })
    await flushPromises()
    await flushPromises()

    const pageThree = postsTouching(calls, PAGE_THREE)
    expect(pageThree).toHaveLength(1)
    expect(pageThree[0]!.items).toHaveLength(7)
    expect(new Set(pageThree[0]!.items.map((item) => item.resource))).toEqual(new Set(PAGE_THREE))
    const pageTwoFactsAfter = items(calls)
      .filter((item) => item.intent.kind === 'facts' && PAGE_TWO.includes(item.resource)).length
    expect(pageTwoFactsAfter).toBe(pageTwoFactsBefore)
    expectNoDuplicateOrOverlappingItem(items(calls))
    wrapper.unmount()
  }, 60000)

  it('keeps the page-1 landing AEDAR critical and reads its aggregate projections without overlap', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()
    await flushPromises()

    const aedarItems = items(calls).filter(isAedar)
    expect(aedarItems.length).toBeGreaterThan(0)
    const facts = aedarItems.filter((item) => item.intent.kind === 'facts')
    expect(facts.length).toBeGreaterThan(0)
    // Every 235 TYPEQU identity is requested, as page 1's prompt requires.
    const covered = new Set(facts.flatMap((item) => item.coordinates?.typequ ?? []))
    expect(covered.size).toBe(235)

    // The full-owner proof: no exact duplicate, and the >32-field projections of
    // one coordinate partition are DISJOINT chunks, never an overlapping re-read.
    expectNoDuplicateOrOverlappingItem(items(calls))

    // The page-2 numeric chapter still lands as its own 33-item demand.
    const pageTwo = postsTouching(calls, PAGE_TWO)
    expect(pageTwo).toHaveLength(3)
    expect(pageTwo.flatMap((call) => call.items)).toHaveLength(33)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)
    wrapper.unmount()
  }, 60000)

  it('launches AEDAR only when page 1 is actually requested, on navigation and back', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite#figure-partage-de-lespace-public')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()
    expect(items(calls).filter(isAedar)).toEqual([])

    // Navigating to the page-1 chapter starts its own demand.
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-acces-aux-services' })
    await flushPromises()
    await flushPromises()
    await settleOwner(calls, isAedar)
    const aedarAfterPageOne = items(calls).filter(isAedar)
    expect(aedarAfterPageOne.length).toBeGreaterThan(0)
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
    // The requested chapter loads its expected car map (plus its own hydrated
    // loss maps), all for the requested territory.
    const pageOneImages = aedarImageSources(wrapper)
    expect(pageOneImages.filter((src) => src.endsWith('/35238-car-inline.webp'))).toHaveLength(1)
    expect(pageOneImages.every((src) => src.includes('/35238-'))).toBe(true)

    // Back to page 2: the settled page-1 demand is not re-read.
    const beforeBack = posts(calls).length
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-partage-de-lespace-public' })
    await flushPromises()
    expect(posts(calls).slice(beforeBack).flatMap((call) => call.items).filter(isAedar)).toEqual([])
    // Back on page 2 the page-1 chapter is inactive again: no AEDAR image source
    // is rendered, and no page-1 API request was issued (asserted above). The
    // admitted page-1 data stays in memory and re-renders on the next page-1 visit.
    expect(aedarImageSources(wrapper)).toEqual([])
    expect(wrapper.find('.mobilite-section--reseaux .mobilite-comparison-bars').exists()).toBe(true)
    wrapper.unmount()
  }, 60000)

  it('marks the requested page-3 comparison as its own error and retries only that comparison', async () => {
    let pageThreeComparisonAbsent = true
    const pageThreeComparables = new Set(['offre_tc', 'raccordement_courbe', 'raccordement_tc'])
    const { transport, calls } = createTransport({
      gate: (item) => pageThreeComparisonAbsent && item.intent.kind === 'selected_comparison' &&
        pageThreeComparables.has(item.resource),
    })
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite#figure-partage-de-lespace-public')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()

    // Page 2 is ready; its comparison is not an error.
    expect(wrapper.find('.mobilite-raccordement-curve__retry').exists()).toBe(false)
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-offre-transports-commun' })
    await flushPromises()
    await flushPromises()

    const chapterReads = () => posts(calls).filter((call) => call.items.some((item) =>
      pageThreeComparables.has(item.resource) && item.intent.kind === 'selected_comparison'))
    expect(chapterReads()).toHaveLength(1)
    // The requested chapter's absent comparison is ITS error: the curve exposes
    // its retry even though page 2's comparison reads are cached and ready.
    expect(wrapper.find('.mobilite-raccordement-curve__retry').exists()).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)

    pageThreeComparisonAbsent = false
    const beforeRetry = posts(calls).length
    const factsBefore = items(calls).filter((item) => item.intent.kind === 'facts').length
    await wrapper.get('.mobilite-raccordement-curve__retry').trigger('click')
    await flushPromises()
    await flushPromises()

    const retried = posts(calls).slice(beforeRetry).flatMap((call) => call.items)
    expect(retried.filter((item) => item.intent.kind === 'selected_comparison')).toHaveLength(3)
    expect(retried.some((item) => item.intent.kind === 'facts')).toBe(false)
    expect(items(calls).filter((item) => item.intent.kind === 'facts')).toHaveLength(factsBefore)
    expect(wrapper.find('.mobilite-raccordement-curve__retry').exists()).toBe(false)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(true)
    wrapper.unmount()
  }, 60000)

  it('serves a healthy chapter after an earlier absent one, and keeps the earlier absence retryable', async () => {
    const { transport, calls } = createTransport({
      // Page 2's whole demanded comparison scope is absent; page 3 is healthy.
      gate: (item) => item.intent.kind !== 'facts' && PAGE_TWO.includes(item.resource),
    })
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche(
      '/territoire/commune/35238?theme=mobilite#figure-partage-de-lespace-public')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()
    await flushPromises()

    // Page 2's own comparison demand is absent: honest retry, never a ready page.
    expect(wrapper.find('.mobilite-comparison-retry').exists()).toBe(true)
    expect(wrapper.find('.mobilite-comparison-bars__comparison').exists()).toBe(false)

    // Page 3 is healthy even though page 2's failure is cached for the same
    // selection: its own demand owns the ready state.
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-offre-transports-commun' })
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('.mobilite-raccordement-curve__retry').exists()).toBe(false)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(true)

    // Back on page 2 the absence is still ITS error: the retry stays available
    // instead of being erased by the healthy sibling chapter.
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-partage-de-lespace-public' })
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('.mobilite-comparison-retry').exists()).toBe(true)
    expect(wrapper.find('.mobilite-comparison-bars__comparison').exists()).toBe(false)
    wrapper.unmount()
  }, 60000)

  it('completes the requested chapter when a hash jump happens during the initial read', async () => {
    let release: (() => void) | undefined
    let held = false
    const { transport, calls } = createTransport({
      hold: (call) => {
        if (held) return undefined
        if (!call.items.some((item) => PAGE_TWO.includes(item.resource) && item.intent.kind === 'facts')) return undefined
        held = true
        return new Promise<void>((resolve) => { release = resolve })
      },
    })
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite#figure-partage-de-lespace-public')
    await flushPromises()
    expect(held).toBe(true)

    // Jump to page 3 while page 2's read is still pending.
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-offre-transports-commun' })
    await flushPromises()
    release!()
    await flushPromises()
    await flushPromises()

    const pageThreeReads = postsTouching(calls, PAGE_THREE)
    expect(pageThreeReads).toHaveLength(1)
    expect(pageThreeReads[0]!.items).toHaveLength(7)
    // The pending page-2 read is not re-issued: each fact item stays requested once.
    const pageTwoFacts = items(calls).filter((item) => item.intent.kind === 'facts' && PAGE_TWO.includes(item.resource))
    expect(pageTwoFacts).toHaveLength(13)
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__retry').exists()).toBe(false)

    // Rapid back then territory change: no stale page-3 read for the old territory.
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-partage-de-lespace-public' })
    await flushPromises()
    const beforeTerritory = posts(calls).length
    await router.push('/territoire/commune/22001?theme=mobilite#figure-partage-de-lespace-public')
    await flushPromises()
    expect(posts(calls).slice(beforeTerritory).flatMap((call) => call.items)
      .some((item) => PAGE_THREE.includes(item.resource) && item.target?.id === '35238')).toBe(false)
    expect(wrapper.find('h1').text()).toBe('Allineuc')
    wrapper.unmount()
  }, 60000)

  it('falls back to the planner chapter for an unknown anchor, without launching AEDAR', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite#figure-sources')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()

    expect(items(calls).filter(isAedar)).toEqual([])
    expect(calls.filter((call) => call.url.startsWith('https://images.'))).toEqual([])
    expect(aedarImageSources(wrapper)).toEqual([])
    // The fallback chapter is the one the numeric planner actually reads.
    expect(postsTouching(calls, PAGE_TWO)).toHaveLength(3)
    wrapper.unmount()
  }, 60000)

  it('reuses settled AEDAR reads when returning to page 1, and keeps the 235 universe', async () => {
    const { transport, calls } = createTransport()
    const legendRequests: string[] = []
    const summaryRequests: string[] = []
    const fetchWithFixtures = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('-car-inline.json')) {
        legendRequests.push(url)
        return new Response(JSON.stringify(carInlineLegend({ type: 'region', code: '53', name: 'Bretagne' })),
          { status: 200 })
      }
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        if (items.length && items.every((item) => item.resource === 'aedar_territory_summary')) {
          summaryRequests.push(url)
          return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
            results: items.map((item) => ({ id: item.id, resource: item.resource,
              status: 'available', data: summaryFixture(item) })) }), { status: 200 })
        }
      }
      return transport(input, init)
    })
    vi.stubGlobal('fetch', fetchWithFixtures)
    // A region page 1: AEDAR summary/aggregates and its legend are requested,
    // and there is no comparison control that would add an unrelated read.
    const { router, wrapper } = await monterFiche('/territoire/region/53?theme=mobilite')
    // Page 1 is useful when its AEDAR evidence renders.
    await attendreChapitreUtile(wrapper, calls, '[data-section="aedar-car-overview"]')
    await settleOwner(calls, isAedar)
    await flushPromises()

    const aedarPosts = () => items(calls).filter(isAedar).length
    const aedarSummaryPosts = () => summaryRequests.length
    const legendReads = () => legendRequests.length
    const aedarBefore = aedarPosts()
    const summaryBefore = aedarSummaryPosts()
    const legendsBefore = legendReads()
    expect(aedarBefore).toBeGreaterThan(0)
    expect(summaryBefore).toBe(1)
    expect(legendsBefore).toBe(1)
    const legendLabel = wrapper.get('.aedar-car-map-legend').attributes('aria-label')
    expect(legendLabel).toContain('235')

    await router.push({ path: '/territoire/region/53', query: { theme: 'mobilite' },
      hash: '#figure-partage-de-lespace-public' })
    await flushPromises()
    expect(aedarImageSources(wrapper)).toEqual([])

    await router.push({ path: '/territoire/region/53', query: { theme: 'mobilite' },
      hash: '#figure-acces-aux-services' })
    await flushPromises()
    await settleOwner(calls, isAedar)
    // A cached revisit of the same valid territory observes nothing again.
    expect(aedarPosts()).toBe(aedarBefore)
    expect(aedarSummaryPosts()).toBe(summaryBefore)
    expect(legendReads()).toBe(legendsBefore)
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
    expect(wrapper.get('.aedar-car-map-legend').attributes('aria-label')).toBe(legendLabel)
    wrapper.unmount()
  }, 60000)

  it('re-reads the requested chapter on a territory change and drops the previous background', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite#figure-partage-de-lespace-public')
    await flushPromises()
    const before = posts(calls).length

    await router.push('/territoire/commune/22001?theme=mobilite#figure-partage-de-lespace-public')
    await flushPromises()

    const afterSwitch = posts(calls).slice(before)
    const newTerritory = afterSwitch.filter((call) => call.items.some((item) =>
      item.target?.id === '22001' && PAGE_TWO.includes(item.resource)))
    expect(newTerritory).toHaveLength(3)
    expect(newTerritory.flatMap((call) => call.items)).toHaveLength(33)
    // The previous territory's chapter is never re-read after the switch.
    expect(afterSwitch.some((call) => call.items.some((item) =>
      item.target?.id === '35238' && PAGE_TWO.includes(item.resource)))).toBe(false)
    expect(wrapper.find('h1').text()).toBe('Allineuc')
    wrapper.unmount()
  }, 60000)
})

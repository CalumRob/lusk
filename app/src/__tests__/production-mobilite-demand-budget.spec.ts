import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TerritoireView from '@/views/TerritoireView.vue'
import { chargerMetadonneesTheme, THEME_METADATA_CHARGER_KEY } from '@/payload/themeCatalogue'
import { routes } from '@/router'
import { nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture } from './helpers/semanticApiFixtures'

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

function createTransport() {
  const calls: Call[] = []
  let active = 0
  let maxActive = 0
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as { items?: Array<Record<string, any>> } : {}
    calls.push({ index: calls.length, url, method: init?.method ?? 'GET', items: body.items ?? [] })
    if (url === '/data/territoires.json') return new Response(lireDonnee('territoires.json'), { status: 200 })
    if (url.startsWith('/data/theme_') && url.endsWith('.json')) {
      return new Response(lireDonnee(url.slice('/data/'.length)), { status: 200 })
    }
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url === '/api/resources/read-batch') {
      active += 1
      maxActive = Math.max(maxActive, active)
      try {
        return await nativeBatchResponse(callItems(), (item, resource) =>
          nativeReadFixture(item, resource, { syntheticProfileComparisons: true }))
      } finally {
        active -= 1
      }
    }
    return new Response('', { status: 404 })

    function callItems() { return calls[calls.length - 1]!.items }
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

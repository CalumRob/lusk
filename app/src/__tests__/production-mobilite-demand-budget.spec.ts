import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TerritoireView from '@/views/TerritoireView.vue'
import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { chargerMetadonneesTheme, THEME_METADATA_CHARGER_KEY } from '@/payload/themeCatalogue'
import { semanticReadState } from '@/payload/semanticResourceClient'
import type { SemanticReadItem } from '@/payload/semanticResourceClient'
import { routes } from '@/router'
import { nativeBatchResponse, nativeCatalogueResponse, nativePublicationFamily,
  nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'
import { carInlineLegend } from './fixtures/aedar-car-inline-legend'
import { AEDAR_AGGREGATE_READING_KEYS, AEDAR_EXPLORER_DETAIL_MEASURE_KEYS } from '@/fiche/content/aedarTimeRampFacts'
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

/** The four published diversity-loss sidecars of one territory (CDN contract). */
const LOSS_MODES = ['walk', 'transit', 'bike_lts2', 'bike_lts4'] as const
function lossInlineLegend(mode: typeof LOSS_MODES[number], code = '53', name = 'Bretagne') {
  return {
    schema: 'lusk.aedar.inline-legend.v1',
    territory: { kind: 'region', code, name },
    mode,
    measure: 'equipment_loss',
    horizon_minutes: 15,
    image: { key: `maps/aedar/v1/${code}-${mode}-inline.webp`, sha256: 'a'.repeat(64), bytes: 36412 },
    scale: {
      type: 'equal-width', semantics: 'car-only-typequ', scope: 'territory-local-pooled-loss',
      minimum: 12, maximum: 92, boundaries: [12, 28, 44, 60, 76, 92],
      colours: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
      display_ticks: ['12', '28', '44,0', '60', '76', '92'],
      regional_reference: null, regional_reference_label: null,
    },
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
    // #997 — the network figure's 10 declared detail comparisons request the
    // owner-approved mean; the other 10 keep their declared median default.
    const clearedIntents = [...new Set(cleared.map((item) => JSON.stringify(item.intent)))]
    expect(clearedIntents).toHaveLength(2)
    expect(cleared.filter((item) => item.intent.statistic === 'mean')).toHaveLength(10)
    expect(new Set(cleared.filter((item) => item.intent.statistic === 'mean')
      .map((item) => item.resource))).toEqual(
      new Set(['reseaux_par_habitant', 'offre_cyclable', 'reseaux']))
    expect(cleared.filter((item) => item.intent.statistic === undefined)).toHaveLength(10)
    expect(new Set(clearedIntents.map((intent) => JSON.parse(intent).statistic)))
      .toEqual(new Set(['mean', undefined]))
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

  it('admits the visible page-3 chapter without a hash or Sommaire click', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()

    const pageThree = () => wrapper.get('[data-figure="figure-offre-transports-commun"]')
    expect(postsTouching(calls, PAGE_THREE)).toHaveLength(0)
    // Visible but not yet demanded is pending, never a factual absence.
    expect(pageThree().text()).not.toContain('Contenu indisponible pour ce territoire.')
    const pageTwoFacts = () => items(calls)
      .filter((item) => item.intent.kind === 'facts' && PAGE_TWO.includes(item.resource)).length
    const pageTwoFactsBefore = pageTwoFacts()

    // The existing visibility owner reports the page the reader actually sees.
    wrapper.findComponent(VarianteCahierLibre).vm.$emit('chapitre-visible', 'figure-offre-transports-commun')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-raccordement-curve__territory')
    await flushPromises()

    const pageThreeBatches = postsTouching(calls, PAGE_THREE)
    expect(pageThreeBatches).toHaveLength(1)
    expect(pageThreeBatches[0]!.items).toHaveLength(7)
    expect(new Set(pageThreeBatches[0]!.items.map((item) => item.resource))).toEqual(new Set(PAGE_THREE))
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)
    expect(pageThree().text()).not.toContain('Contenu indisponible pour ce territoire.')
    expect(pageTwoFacts()).toBe(pageTwoFactsBefore)
    expectNoDuplicateOrOverlappingItem(items(calls))
    wrapper.unmount()
  }, 60000)

  it('keeps page-2 and page-1 data when scrolling back under a page-3 hash', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
    await flushPromises()
    const cahier = wrapper.findComponent(VarianteCahierLibre)

    // Explicit page-3 navigation; its target becomes visible.
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-offre-transports-commun' })
    cahier.vm.$emit('chapitre-visible', 'figure-offre-transports-commun')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-raccordement-curve__territory')
    const pageThreeBatches = postsTouching(calls, PAGE_THREE).length
    expect(pageThreeBatches).toBe(1)
    const pageTwoFacts = () => items(calls)
      .filter((item) => item.intent.kind === 'facts' && PAGE_TWO.includes(item.resource)).length
    const pageTwoFactsBefore = pageTwoFacts()

    // The reader scrolls back to page 2 while the URL still says page 3.
    cahier.vm.$emit('chapitre-visible', 'figure-partage-de-lespace-public')
    await flushPromises()
    await flushPromises()
    expect(router.currentRoute.value.hash).toBe('#figure-offre-transports-commun')
    expect(wrapper.find('.mobilite-section--reseaux .mobilite-comparison-bars').exists()).toBe(true)
    expect(postsTouching(calls, PAGE_THREE)).toHaveLength(pageThreeBatches)
    expect(pageTwoFacts()).toBe(pageTwoFactsBefore)
    // The settled page-3 facts are retained by the page-2 entry.
    expect(wrapper.find('.mobilite-raccordement-curve__territory').exists()).toBe(true)

    // Back on page 1, AEDAR is the active chapter again; the hash is unchanged.
    cahier.vm.$emit('chapitre-visible', 'figure-lecture')
    await flushPromises()
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
    expect(router.currentRoute.value.hash).toBe('#figure-offre-transports-commun')
    expect(postsTouching(calls, PAGE_THREE)).toHaveLength(pageThreeBatches)
    // The chapter crossing must not duplicate the Mobility chapter identities;
    // AEDAR's own retry/comparison fixture path is covered by its dedicated test.
    expectNoDuplicateOrOverlappingItem(items(calls).filter((item) =>
      PAGE_TWO.includes(item.resource) || PAGE_THREE.includes(item.resource)))
    wrapper.unmount()
  }, 60000)

  it('does not let an intermediate page steal an explicit page-3 intent before it lands', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche(
      '/territoire/commune/35238?theme=mobilite#figure-offre-transports-commun')
    await attendreChapitreUtile(wrapper, calls, '[data-figure="figure-offre-transports-commun"]')
    const cahier = wrapper.findComponent(VarianteCahierLibre)

    // Mid-scroll page 2 becomes visible before the explicit target does.
    cahier.vm.$emit('chapitre-visible', 'figure-partage-de-lespace-public')
    await flushPromises()
    expect(postsTouching(calls, PAGE_TWO)).toHaveLength(0)

    cahier.vm.$emit('chapitre-visible', 'figure-offre-transports-commun')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-raccordement-curve__territory')
    expect(postsTouching(calls, PAGE_THREE)).toHaveLength(1)
    expect(postsTouching(calls, PAGE_TWO)).toHaveLength(0)
    wrapper.unmount()
  }, 60000)

  it('honours a user scroll back before an explicit page-3 target lands', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche(
      '/territoire/commune/35238?theme=mobilite#figure-offre-transports-commun')
    await attendreChapitreUtile(wrapper, calls, '[data-figure="figure-offre-transports-commun"]')
    const cahier = wrapper.findComponent(VarianteCahierLibre)

    // The user interrupts the explicit navigation before its target is read.
    cahier.vm.$emit('chapitre-visible', 'figure-partage-de-lespace-public')
    window.dispatchEvent(new Event('wheel'))
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')

    expect(postsTouching(calls, PAGE_TWO)).toHaveLength(3)
    expect(postsTouching(calls, PAGE_THREE).length).toBeLessThanOrEqual(1)
    expect(wrapper.find('.mobilite-section--reseaux .mobilite-comparison-bars').exists()).toBe(true)
    wrapper.unmount()
  }, 60000)

  it('admits the owning AEDAR chapter for all five cold section anchors', async () => {
    const ids = ['section-aedar-car-overview', 'section-aedar-diversity-loss',
      'section-aedar-access', 'section-aedar-equipment-profile', 'section-aedar-equipment-explorer']
    for (const id of ids) {
      const { transport, calls } = createTransport()
      vi.stubGlobal('fetch', transport)
      const { wrapper } = await monterFiche(
        `/territoire/commune/35238?theme=mobilite#${id}`)
      await settleOwner(calls, isAedar)
      await flushPromises()

      const core = new Set(items(calls)
        .filter((item) => item.resource === 'aedar_territorial_aggregate' && item.intent.kind === 'facts')
        .flatMap((item) => item.coordinates?.typequ ?? []))
      expect(core.size, id).toBe(AEDAR_TYPEQU_REGISTRY.length)
      expect(items(calls).filter(isAedar).length, id).toBeGreaterThan(0)
      // A valid inner section already names its owner: the unrelated page-2
      // numeric fallback must never be queued before admission.
      expect(postsTouching(calls, PAGE_TWO), id).toHaveLength(0)
      const overview = wrapper.get('[data-section="aedar-car-overview"]')
      expect(overview.findAll('.cahier-figure-scalar').length, id).toBeGreaterThan(0)
      expect(wrapper.find(`#${id}`).exists(), id).toBe(true)
      wrapper.unmount()
    }
  }, 120000)

  it('admits the owning page for a cold non-AEDAR section anchor, with its custom group', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche(
      '/territoire/commune/35238?theme=mobilite&comparaison=commune:35238,commune:35240#section-visiter-la-bretagne')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-raccordement-curve__territory')

    const pageThree = postsTouching(calls, PAGE_THREE)
    expect(pageThree).toHaveLength(1)
    expect(pageThree[0]!.items).toHaveLength(7)
    expect(postsTouching(calls, PAGE_TWO)).toHaveLength(0)
    expect(items(calls).filter(isAedar)).toEqual([])
    expect(wrapper.find('#section-visiter-la-bretagne').exists()).toBe(true)
    const selected = items(calls).filter((item) => item.resource === 'raccordement_courbe' &&
      item.intent.kind === 'selected_comparison')
    expect(selected.some((item) => item.intent.members?.some(
      (member: { id: string }) => member.id === '35240'))).toBe(true)
    wrapper.unmount()
  }, 60000)

  it('keeps the unknown-fragment numeric fallback without activating AEDAR', async () => {
    const { transport, calls } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite#section-unknown')
    await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')

    expect(postsTouching(calls, PAGE_TWO)).toHaveLength(3)
    expect(postsTouching(calls, PAGE_THREE)).toHaveLength(0)
    expect(items(calls).filter(isAedar)).toEqual([])
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
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
    const chapterFacts = items(calls).filter((item) => item.intent.kind === 'facts' &&
      PAGE_THREE.includes(item.resource))
    expect(chapterFacts).toHaveLength(4)
    await wrapper.get('.mobilite-raccordement-curve__retry').trigger('click')
    await flushPromises()
    await flushPromises()

    // EXACTLY ONE retry batch, carrying only the page-3 comparables — never a
    // second POST and never another chapter's resource.
    const retryBatches = posts(calls).slice(beforeRetry)
    expect(retryBatches).toHaveLength(1)
    expect(retryBatches[0]!.items.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect(retryBatches[0]!.items.map((item) => item.resource).sort())
      .toEqual([...pageThreeComparables].sort())
    expect(items(calls).filter((item) => item.intent.kind === 'facts')).toHaveLength(factsBefore)
    // The retry released only comparison reads: every admitted page-3 fact key is
    // still settled in the semantic transport.
    expect(chapterFacts.every((item) => semanticReadState(item as SemanticReadItem) === 'available')).toBe(true)
    expect(wrapper.find('.mobilite-raccordement-curve__retry').exists()).toBe(false)
    expect(wrapper.find('.mobilite-raccordement-curve__comparison').exists()).toBe(true)

    // A later chapter demand never silently re-probes the retried chapter's facts.
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-partage-de-lespace-public' })
    await flushPromises()
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-offre-transports-commun' })
    await flushPromises()
    await flushPromises()
    expect(items(calls).filter((item) => item.intent.kind === 'facts' &&
      PAGE_THREE.includes(item.resource))).toHaveLength(chapterFacts.length)
    expect(items(calls).filter((item) => item.intent.kind === 'facts')).toHaveLength(factsBefore)
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
    const lossLegendRequests: string[] = []
    const summaryRequests: string[] = []
    const fetchWithFixtures = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('-car-inline.json')) {
        legendRequests.push(url)
        return new Response(JSON.stringify(carInlineLegend({ type: 'region', code: '53', name: 'Bretagne' })),
          { status: 200 })
      }
      const lossMode = LOSS_MODES.find((candidate) => url.endsWith(`-${candidate}-inline.json`))
      if (lossMode) {
        lossLegendRequests.push(url)
        return new Response(JSON.stringify(lossInlineLegend(lossMode)), { status: 200 })
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
    // All four diversity-loss sidecars settle with the page-1 legend.
    await vi.waitFor(() => expect(lossLegendRequests).toHaveLength(LOSS_MODES.length))
    await flushPromises()

    const aedarPosts = () => items(calls).filter(isAedar).length
    const aedarSummaryPosts = () => summaryRequests.length
    const legendReads = () => legendRequests.length
    const aedarBefore = aedarPosts()
    const summaryBefore = aedarSummaryPosts()
    const legendsBefore = legendReads()
    const lossLegendsBefore = lossLegendRequests.length
    expect(aedarBefore).toBeGreaterThan(0)
    expect(summaryBefore).toBe(1)
    expect(legendsBefore).toBe(1)
    expect(lossLegendsBefore).toBe(LOSS_MODES.length)
    const legendLabel = wrapper.get('.aedar-car-map-legend').attributes('aria-label')
    expect(legendLabel).toContain('235')

    await router.push({ path: '/territoire/region/53', query: { theme: 'mobilite' },
      hash: '#figure-partage-de-lespace-public' })
    await flushPromises()
    expect(aedarImageSources(wrapper)).toEqual([])
    // Leaving the chapter fetches nothing: the settled legends stay in memory.
    expect(lossLegendRequests).toHaveLength(lossLegendsBefore)

    await router.push({ path: '/territoire/region/53', query: { theme: 'mobilite' },
      hash: '#figure-acces-aux-services' })
    await flushPromises()
    await settleOwner(calls, isAedar)
    // A cached revisit of the same valid territory observes nothing again: car
    // legend AND all four loss legends are reused, never refetched.
    expect(aedarPosts()).toBe(aedarBefore)
    expect(aedarSummaryPosts()).toBe(summaryBefore)
    expect(legendReads()).toBe(legendsBefore)
    expect(lossLegendRequests).toHaveLength(lossLegendsBefore)
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

/**
 * #1002 — the live audit measured 36 identical fixed-EPCI comparison items read
 * twice and 20 page-1 detail batches still starting after the reader left page 1.
 * This harness runs the actual route and the actual semantic client.
 */
const AEDAR_CLOCKS = {
  summary: 'aedar-summary-fixture-v1',
  // The facts, the summary and every comparison describe one publication.
  aedar: nativeReadFixture({ resource: 'aedar_territorial_aggregate',
    target: { kind: 'territory', type: 'commune', id: '35238' }, intent: { kind: 'facts' },
    coordinates: { typequ: [] } },
  nativeResources().find((resource) => resource.resource_id === 'aedar_territorial_aggregate')!).content_version,
  reference: 'semantic-reference-fixture-v1',
}
const AEDAR_SOURCE = {
  source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
  licence: 'ODbL', attribution: 'AEDAR', reference_date: '2026-01-01', publication_date: '2026-09-30',
}
const isAggregateComparison = (item: Record<string, any>) =>
  item.resource === 'aedar_territorial_aggregate' && item.intent?.kind !== 'facts' &&
  (item.coordinates?.typequ?.length ?? 0) === 0
const isCellComparison = (item: Record<string, any>) =>
  item.resource === 'aedar_territorial_aggregate' && item.intent?.kind !== 'facts' &&
  (item.coordinates?.typequ?.length ?? 0) > 0
const isAedarAggregateFact = (item: Record<string, any>) =>
  item.resource === 'aedar_territorial_aggregate' && item.intent?.kind === 'facts'
/** Every AEDAR page-1 read: core/detail projections AND every comparison shape. */
const isAedarDemand = (item: Record<string, any>) =>
  isAggregateComparison(item) || isCellComparison(item) || isAedarAggregateFact(item)
const aggregateComparisons = (entries: Array<Record<string, any>>) => entries.filter(isAggregateComparison)
const cellComparisons = (entries: Array<Record<string, any>>) => entries.filter(isCellComparison)
const aggregateComparisonPosts = (list: Call[]) =>
  posts(list).filter((call) => aggregateComparisons(call.items).length > 0)
const cellComparisonPosts = (list: Call[]) =>
  posts(list).filter((call) => cellComparisons(call.items).length > 0)
/** POSTs carrying any AEDAR page-1 demand (facts, detail projections, cells). */
const aedarDemandPosts = (list: Call[]) => posts(list).filter((call) => call.items.some(isAedarDemand))

function aedarSummaryEnvelope(item: Record<string, any>) {
  return {
    resource: item.resource, target: item.target,
    territory: { territory_type: item.target.type, territory_id: item.target.id },
    summary_content_version: AEDAR_CLOCKS.summary,
    aedar_content_version: AEDAR_CLOCKS.aedar,
    reference_content_version: AEDAR_CLOCKS.reference,
    readings: AEDAR_AGGREGATE_READING_KEYS.map((measure) => ({
      measure, value: 3.5, status: 'available', n_typequ: AEDAR_TYPEQU_REGISTRY.length,
      n_addresses: 100, n_observed: 90, coverage_status: 'covered', statistic: 'direct', ...AEDAR_SOURCE,
    })),
  }
}

function aedarComparisonEnvelope(item: Record<string, any>) {
  const measures = (item.coordinates?.measure ?? []) as string[]
  const typequ = (item.coordinates?.typequ ?? [])[0] ?? null
  const rows = measures.map((measure) => ({
    typequ, measure, comparison_context: item.intent.context, statistic: 'direct',
    group_value: 3.5, group_n_addresses: 100, group_n_observed: 90, group_coverage_status: 'covered',
    rank: 1, rank_size: 43, rank_ties: 1, direction: 'high', ...AEDAR_SOURCE,
  }))
  return {
    resource: item.resource, target: item.target,
    content_version: 'aedar-comparison-fixture-v1',
    summary_content_version: AEDAR_CLOCKS.summary,
    aedar_content_version: AEDAR_CLOCKS.aedar,
    reference_content_version: AEDAR_CLOCKS.reference,
    comparison: rows[0],
  }
}

/** The published AEDAR summary, comparison and facts of one territory. */
function createAedarTransport(options: {
  /** Hold every AEDAR comparison read (a queued, off-screen demand). */
  holdComparison?: () => Promise<void>
  /** Hold only the per-TYPEQU cell comparisons (the explorer's page-1 read). */
  holdCellsOnly?: boolean
  /** Serve one typed publication absence (never a fabricated value). */
  absent?: (item: Record<string, any>) => boolean
} = {}) {
  const calls: Call[] = []
  const resources = new Map(nativeResources().map((resource) => [resource.resource_id, resource]))
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
      if (!call.items.some((item) => String(item.resource).startsWith('aedar_'))) {
        return nativeBatchResponse(call.items, (item, resource) =>
          nativeReadFixture(item, resource, { syntheticProfileComparisons: true }))
      }
      if (call.items.some(options.holdCellsOnly ? isCellComparison : isAggregateComparison)) {
        await options.holdComparison?.()
      }
      const results = call.items.map((item) => {
        if (options.absent?.(item)) {
          return { id: item.id, resource: item.resource, status: 'publication_unavailable',
            reason: 'publication_absent', family: 'aedar' }
        }
        const data = item.resource === 'aedar_territory_summary' ? aedarSummaryEnvelope(item)
          : item.intent?.kind !== 'facts' ? aedarComparisonEnvelope(item)
            : nativeReadFixture(item, resources.get(item.resource)!)
        return { id: item.id, resource: item.resource, status: 'available', data }
      })
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results }), { status: 200 })
    }
    return new Response('', { status: 404 })
  })
  return { transport, calls }
}

describe('Mobilite page 1 — comparaisons AEDAR coalescées et différées (#1002)', () => {
  it('ne relance pas les comparaisons réglées et n’en démarre pas hors écran', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const { transport, calls } = createAedarTransport({ holdComparison: () => held })
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite')

    // The one 40-item comparison demand reaches the bounded scheduler: two
    // active reads, the remaining batches only queued.
    await vi.waitFor(() => expect(aggregateComparisonPosts(calls)).toHaveLength(2), { timeout: 15000 })
    expect(aggregateComparisons(items(calls))).toHaveLength(24)

    // The reader leaves page 1 while the rest is still queued. Both active
    // slots are held, so the count is stable across the demand change.
    const beforeLeaving = aedarDemandPosts(calls).length
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-partage-de-lespace-public' })
    await flushPromises()
    expect(aedarDemandPosts(calls).length).toBe(beforeLeaving)
    release()
    await settleOwner(calls, (item) => String(item.resource).startsWith('aedar_'))
    await flushPromises()

    // No NEW page-1 demand batch of ANY shape (core/detail/cells/aggregates)
    // started after the demand change; only the batches already in flight settle.
    expect(aedarDemandPosts(calls).length).toBe(beforeLeaving)
    expect(aggregateComparisonPosts(calls)).toHaveLength(2)
    // The requested chapter is not starved: its own 33 items still land.
    const pageTwo = postsTouching(calls, PAGE_TWO)
    expect(pageTwo).toHaveLength(3)
    expect(pageTwo.flatMap((call) => call.items)).toHaveLength(33)

    // Returning to page 1 resumes the genuinely missing items only, once.
    const beforeReturn = posts(calls).length
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-acces-aux-services' })
    await flushPromises()
    await settleOwner(calls, (item) => String(item.resource).startsWith('aedar_'))
    await flushPromises()
    const resumed = aggregateComparisons(posts(calls).slice(beforeReturn).flatMap((call) => call.items))
    expect(resumed).toHaveLength(16)
    // Every semantic item is read exactly once across the whole visit.
    expect(aggregateComparisons(items(calls))).toHaveLength(40)
    expectNoDuplicateOrOverlappingItem(items(calls))

    // The demanded page-1 evidence is complete again: the 235 TYPEQU universe
    // and the served comparison rank, never a partial or fabricated value.
    const covered = new Set(items(calls).filter((item) => item.intent.kind === 'facts' && isAedar(item))
      .flatMap((item) => item.coordinates?.typequ ?? []))
    expect(covered.size).toBe(235)
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
    expect(wrapper.find('.aedar-comparison-retry').exists()).toBe(false)
    wrapper.unmount()
  }, 60000)

  it('ne démarre ni les cellules ni le détail de l’explorateur hors du chapitre AEDAR', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    // The explorer's 240 per-TYPEQU cell comparisons (20 bounded batches) and its
    // detail read are page-1 evidence: hold the cells so most stay queued.
    const { transport, calls } = createAedarTransport({
      holdComparison: () => held,
      holdCellsOnly: true,
    })
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite')

    // The explorer is mounted and its cell comparison reached the scheduler.
    await vi.waitFor(() => expect(cellComparisonPosts(calls)).toHaveLength(2), { timeout: 20000 })
    const intendedMeasures = [...AEDAR_EXPLORER_DETAIL_MEASURE_KEYS, ...[5, 10, 15, 20].flatMap((horizon) =>
      ['car', 'bike_lts2', 'bike_lts4', 'transit', 'walk'].map((mode) => `count_${horizon}_${mode}_mean`))]
    expect(intendedMeasures).toHaveLength(240)
    expect(cellComparisons(items(calls))).toHaveLength(24)
    expect(cellComparisons(items(calls)).every((item) => item.coordinates.typequ.length === 1 &&
      item.coordinates.measure.length === 1)).toBe(true)

    const beforeLeaving = aedarDemandPosts(calls).length
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-partage-de-lespace-public' })
    await flushPromises()
    expect(aedarDemandPosts(calls).length).toBe(beforeLeaving)
    release()
    await settleOwner(calls, (item) => String(item.resource).startsWith('aedar_'))
    await flushPromises()

    // No queued explorer cell/detail batch started after the demand change.
    expect(aedarDemandPosts(calls).length).toBe(beforeLeaving)
    expect(cellComparisonPosts(calls)).toHaveLength(2)
    // The requested chapter is not starved by page-1 work.
    const pageTwo = postsTouching(calls, PAGE_TWO)
    expect(pageTwo).toHaveLength(3)
    expect(pageTwo.flatMap((call) => call.items)).toHaveLength(33)

    // Returning resumes the missing cells once; settled cells are not re-read.
    const beforeReturn = posts(calls).length
    await router.push({ path: '/territoire/commune/35238', query: { theme: 'mobilite' },
      hash: '#figure-acces-aux-services' })
    await flushPromises()
    await settleOwner(calls, (item) => String(item.resource).startsWith('aedar_'))
    await flushPromises()
    const resumed = cellComparisons(posts(calls).slice(beforeReturn).flatMap((call) => call.items))
    expect(resumed).toHaveLength(216)
    expect(cellComparisons(items(calls))).toHaveLength(240)
    expect(new Set(cellComparisons(items(calls)).map((item) => item.coordinates.measure[0])).size).toBe(240)
    expect(new Set(cellComparisons(items(calls)).flatMap((item) => item.coordinates.measure))).toEqual(new Set(intendedMeasures))
    expectNoDuplicateOrOverlappingItem(items(calls))

    // The demanded page-1 evidence is complete again: 235 TYPEQU universe, the
    // served rank, and the explorer's detail values.
    const covered = new Set(items(calls).filter((item) => item.intent.kind === 'facts' && isAedar(item))
      .flatMap((item) => item.coordinates?.typequ ?? []))
    expect(covered.size).toBe(235)
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
    expect(wrapper.html()).toContain('/43')
    expect(wrapper.find('.aedar-equipment-explorer-retry').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Chargement des valeurs pour ce type d’équipement')
    wrapper.unmount()
  }, 60000)

  it('écarte une comparaison AEDAR tardive après un changement de territoire', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const { transport, calls } = createAedarTransport({ holdComparison: () => held })
    vi.stubGlobal('fetch', transport)
    const { router, wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite')
    await vi.waitFor(() => expect(aggregateComparisonPosts(calls)).toHaveLength(2), { timeout: 15000 })

    const before = posts(calls).length
    await router.push('/territoire/commune/22001?theme=mobilite')
    await flushPromises()
    release()
    await settleOwner(calls, (item) => String(item.resource).startsWith('aedar_'))
    await flushPromises()

    const after = posts(calls).slice(before).flatMap((call) => call.items)
    expect(after.some((item) => isAggregateComparison(item) && item.target?.id === '35238')).toBe(false)
    expect(wrapper.find('h1').text()).toBe('Allineuc')
    wrapper.unmount()
  }, 60000)

  it('garde une comparaison AEDAR absente visible et réessayable', async () => {
    let absent = true
    const { transport, calls } = createAedarTransport({ absent: (item) => absent && isAggregateComparison(item) })
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite')
    await attendreChapitreUtile(wrapper, calls, '[data-section="aedar-car-overview"]')
    await flushPromises()
    await flushPromises()
    // A typed absence is honest: the retry stays visible, no ready comparison.
    expect(wrapper.find('.aedar-comparison-retry').exists()).toBe(true)

    absent = false
    const before = posts(calls).length
    await wrapper.get('.aedar-comparison-retry').trigger('click')
    await flushPromises()
    await flushPromises()
    // An explicit retry is honestly fresh: the whole demanded comparison re-reads.
    expect(aggregateComparisons(posts(calls).slice(before).flatMap((call) => call.items))).toHaveLength(40)
    expect(wrapper.find('.aedar-comparison-retry').exists()).toBe(false)
    wrapper.unmount()
  }, 60000)
})

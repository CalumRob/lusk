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
 * #986 — one cold navigation, every request counted.
 *
 * The fixture transport is the same producer catalogue the API serves, so the
 * item inventory is derived, not invented. Timings here are fixture-relative
 * (ordering and request counts); they are NOT the live API latency, which the
 * PR reports separately.
 */

function lireDonnee(relatif: string): string {
  return readFileSync(resolve(process.cwd(), '..', 'public', 'data', relatif), 'utf8')
}

interface Call {
  index: number
  url: string
  method: string
  items: Array<Record<string, any>>
  activeAtStart: number
}

function createTransport(options: { delay?: (call: Call) => number } = {}) {
  const calls: Call[] = []
  let active = 0
  let maxActive = 0
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as { items?: Array<Record<string, any>> } : {}
    const call: Call = { index: calls.length, url, method: init?.method ?? 'GET', items: body.items ?? [], activeAtStart: active }
    calls.push(call)
    if (url === '/data/territoires.json') return new Response(lireDonnee('territoires.json'), { status: 200 })
    if (url.startsWith('/data/theme_') && url.endsWith('.json')) {
      return new Response(lireDonnee(url.slice('/data/'.length)), { status: 200 })
    }
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url === '/api/resources/read-batch') {
      active += 1
      maxActive = Math.max(maxActive, active)
      const wait = options.delay?.(call) ?? 0
      try {
        if (wait) await new Promise((done) => setTimeout(done, wait))
        return await nativeBatchResponse(call.items,
          (item, resource) => nativeReadFixture(item, resource, { syntheticProfileComparisons: true }))
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

const posts = (calls: Call[]) => calls.filter((call) => call.method === 'POST')

function postsTouching(calls: Call[], resources: readonly string[]): Call[] {
  return posts(calls).filter((call) => call.items.some((item) => resources.includes(item.resource)))
}

function itemKey(item: Record<string, any>): string {
  return JSON.stringify([item.resource, item.target, item.intent, item.coordinates ?? null])
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
  selector: string): Promise<{ postsAtUseful: number; itemsAtUseful: number; tick: number }> {
  for (let tick = 0; tick < 400; tick += 1) {
    await nextTick()
    if (wrapper.find(selector).exists()) {
      return { postsAtUseful: posts(calls).length,
        itemsAtUseful: posts(calls).flatMap((call) => call.items).length, tick }
    }
  }
  throw new Error(`Chapitre non rendu : ${selector}`)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Mobilite page 2 — critical demand and request budget', () => {
  it('reads the 33 displayed items in 3 batches, then the deferred chapter and idle themes', async () => {
    const { transport, calls, maxActive } = createTransport()
    vi.stubGlobal('fetch', transport)
    const { wrapper } = await monterFiche('/territoire/commune/35238?theme=mobilite#figure-partage-de-lespace-public')

    const useful = await attendreChapitreUtile(wrapper, calls, '.mobilite-section--reseaux .mobilite-comparison-bars')
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
    // The producer's nested default is never fetched then discarded, and no
    // page-3 resource rides along with the critical demand.
    expect(pageTwoItems.some((item) => item.intent.kind === 'fixed_comparison')).toBe(false)
    expect(pageTwoItems.some((item) => PAGE_THREE.includes(item.resource))).toBe(false)

    // The deferred sibling chapter is one later batch: 4 resources, 7 items.
    const pageThree = postsTouching(calls, PAGE_THREE)
    expect(pageThree).toHaveLength(1)
    expect(pageThree[0]!.items).toHaveLength(7)
    expect(new Set(pageThree[0]!.items.map((item) => item.resource))).toEqual(new Set(PAGE_THREE))
    expect(pageThree[0]!.index).toBeGreaterThan(pageTwo[2]!.index)

    // Unrelated themes are IDLE: zero before the requested chapter is useful,
    // then at most five coalesced batches, facts only.
    const idleThemes = posts(calls).filter((call) => call.items.every((item) =>
      !PAGE_TWO.includes(item.resource) && !PAGE_THREE.includes(item.resource) &&
      item.resource !== 'aedar_territorial_aggregate' && item.resource !== 'aedar_territory_summary'))
    expect(idleThemes.length).toBeLessThanOrEqual(5)
    for (const call of idleThemes) {
      expect(call.index).toBeGreaterThan(pageTwo[2]!.index)
      expect(call.items.length).toBeLessThanOrEqual(12)
      expect(call.items.every((item) => item.intent.kind === 'facts')).toBe(true)
    }

    // No duplicate identical semantic item in the page flow. AEDAR's own
    // aggregate re-reads are counted separately and reported as a residual.
    const semanticItems = posts(calls).flatMap((call) => call.items)
      .filter((item) => item.resource !== 'aedar_territorial_aggregate' &&
        item.resource !== 'aedar_territory_summary')
    const semanticKeys = semanticItems.map(itemKey)
    expect(new Set(semanticKeys).size).toBe(semanticKeys.length)
    // The shared client never exceeds two active semantic reads.
    expect(maxActive()).toBeLessThanOrEqual(2)

    // Explicit startup overhead, counted apart from the semantic budget.
    expect(calls.filter((call) => call.url === '/api/resources')).toHaveLength(1)
    expect(calls.filter((call) => call.url === '/data/territoires.json')).toHaveLength(1)

    // Page 2 is useful before AEDAR's explorer detail and the background have
    // finished: the requested chapter never waits for a sibling surface.
    expect(useful.postsAtUseful).toBeLessThan(posts(calls).length)
    // Page 2 is dispatched before AEDAR's explorer-comparison flood: the
    // requested chapter never queues behind a sibling surface's detail work.
    const aedarExplorer = posts(calls).find((call) => call.items.some((item) =>
      item.resource === 'aedar_territorial_aggregate' && item.intent.kind === 'fixed_comparison'))
    expect(aedarExplorer).toBeDefined()
    expect(pageTwo[2]!.index).toBeLessThan(aedarExplorer!.index)

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

    const selected = posts(calls).flatMap((call) => call.items)
      .filter((item) => item.intent.kind === 'selected_comparison')
    expect(selected.length).toBeGreaterThan(0)
    expect(selected.every((item) => JSON.stringify(item.intent.members) ===
      JSON.stringify([{ type: 'commune', id: '35238' }, { type: 'commune', id: '35240' }]))).toBe(true)
    expect(posts(calls).flatMap((call) => call.items)
      .some((item) => item.intent.kind === 'fixed_comparison')).toBe(false)

    const pageTwoFacts = (items: Array<Record<string, any>>) => items
      .filter((item) => item.intent.kind === 'facts' && PAGE_TWO.includes(item.resource))
    const factsBefore = pageTwoFacts(posts(calls).flatMap((call) => call.items)).length
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
    // One intent for the whole chapter: whatever the header now resolves to
    // (a preset group or the producer default), it is read once, together.
    expect(new Set(cleared.map((item) => JSON.stringify(item.intent))).size).toBe(1)
    const factsAfter = pageTwoFacts(posts(calls).flatMap((call) => call.items)).length
    expect(factsAfter).toBe(factsBefore)
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

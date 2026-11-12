import { afterEach, describe, expect, it, vi } from 'vitest'

import { chapitreDemande } from '@/fiche/content/demandInventory'
import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import { SEMANTIC_MAX_BATCH_ITEMS } from '@/payload/semanticResourceClient'
import { ThemeAcquisitionCache, acquireThemeComparison, acquireThemeFacts } from '@/payload/themeAcquisition'
import type { ThemeFactsDemand } from '@/payload/themeAcquisition'
import {
  nativeCatalogueResponse,
  nativePublicationFamily,
  nativeReadFixture,
  nativeResources,
} from './helpers/semanticApiFixtures'

/**
 * #986 — the requested chapter's demand is read once. The comparison the active
 * header actually displays travels with its focal facts; the producer's fixed
 * default is never read and discarded; a deferred chapter is one later batch.
 */

const catalogue = nativeResources('mobilite')
const declarations = catalogue as unknown as SemanticResourceDeclaration[]

function chapter(indicators: string): string[] {
  const found = chapitreDemande('mobilite', indicators, declarations)
  if (!found) throw new Error(`Chapter ${indicators} missing`)
  return [...found.indicators]
}

const PAGE_TWO = chapter('partage-de-lespace-public')
const PAGE_THREE = chapter('offre-transports-commun')

const SELECTION = [
  { territory_type: 'commune' as const, territory_id: '35238' },
  { territory_type: 'commune' as const, territory_id: '35240' },
]

interface LoggedPost { items: Array<Record<string, any>> }
const posts: LoggedPost[] = []

function fixtureFetch(isGated?: (item: Record<string, any>) => boolean) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url !== '/api/resources/read-batch') return new Response('', { status: 404 })
    const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
    posts.push({ items })
    const results = items.map((item) => {
      const resource = catalogue.find((candidate) => candidate.resource_id === item.resource)
      if (!resource) throw new Error(`Unknown fixture resource ${item.resource}`)
      if (isGated?.(item)) {
        return { id: item.id, resource: item.resource, status: 'publication_unavailable',
          reason: 'publication_absent', family: nativePublicationFamily(item.resource) }
      }
      return { id: item.id, resource: item.resource, status: 'available',
        data: nativeReadFixture(item, resource) }
    })
    return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results }), { status: 200 })
  })
}

function cacheFor() {
  return new ThemeAcquisitionCache(
    (theme, key, demand?: ThemeFactsDemand) => acquireThemeFacts(key!.type, key!.id, theme, demand),
    (selection, theme, key, coherence, indicators) =>
      acquireThemeComparison(key!.type, key!.id, theme, selection, coherence, indicators),
  )
}

function demandPostCount(): number {
  return posts.filter((post) => post.items.some((item) => item.resource !== 'aedar_territorial_aggregate')).length
}

afterEach(() => {
  posts.length = 0
  vi.unstubAllGlobals()
})

describe('theme demand — Mobilite page 2 critical chapter', () => {
  it('reads facts and the displayed comparison in one demand, without the discarded fixed default', async () => {
    vi.stubGlobal('fetch', fixtureFetch())
    const cache = cacheFor()
    const acquired = await cache.get('commune', '35238', 'mobilite', {
      indicators: PAGE_TWO, selection: SELECTION, auxiliary: false,
    })

    const items = posts.flatMap((post) => post.items)
    expect(items).toHaveLength(33)
    expect(items.filter((item) => item.intent.kind === 'facts')).toHaveLength(13)
    expect(items.filter((item) => item.intent.kind === 'selected_comparison')).toHaveLength(20)
    // The producer's nested default is never fetched when the header displays a
    // selection: no discarded fixed default, no page-3 resource, no named ref.
    expect(items.some((item) => item.intent.kind === 'fixed_comparison')).toBe(false)
    expect(items.some((item) => PAGE_THREE.includes(item.resource))).toBe(false)
    expect(new Set(items.map((item) => JSON.stringify(item))).size).toBe(33)
    expect(posts.map((post) => post.items.length)).toEqual([11, 12, 10])
    expect(posts.every((post) => post.items.length <= SEMANTIC_MAX_BATCH_ITEMS)).toBe(true)

    // The selected comparison is bound to the focal facts in the same read set,
    // and its selection is the one the header asked for.
    expect(acquired.focal.demand_comparison?.selection).toEqual(SELECTION)
    expect(acquired.focal.demand_comparison?.comparison_reads).toHaveLength(20)
    expect(acquired.focal.default_comparison?.comparison_reads).toEqual([])
    expect(acquired.comparisons.has(JSON.stringify(SELECTION))).toBe(true)
    expect(acquired.comparisons.has('omitted')).toBe(false)
  })

  it('serves the active header comparison from the facts acquisition, then reads the cleared default once', async () => {
    vi.stubGlobal('fetch', fixtureFetch())
    const cache = cacheFor()
    const acquired = await cache.get('commune', '35238', 'mobilite', {
      indicators: PAGE_TWO, selection: SELECTION, auxiliary: false,
    })
    expect(acquired.comparisons.has(JSON.stringify(SELECTION))).toBe(true)
    const afterFacts = posts.length

    const selected = await cache.select('commune', '35238', 'mobilite', SELECTION)
    expect(posts.length).toBe(afterFacts)
    expect(selected.comparisons.get(JSON.stringify(SELECTION))?.comparison_reads).toHaveLength(20)

    // Clearing the header asks for the producer default exactly once, scoped to
    // the chapter's own resources, and never re-reads the focal facts.
    await cache.select('commune', '35238', 'mobilite', undefined)
    const cleared = posts.slice(afterFacts).flatMap((post) => post.items)
    expect(cleared).toHaveLength(20)
    expect(cleared.every((item) => item.intent.kind === 'fixed_comparison')).toBe(true)
    expect(cleared.every((item) => PAGE_TWO.includes(item.resource))).toBe(true)
  })

  it('reads the page-3 chapter only when it is the requested chapter: one batch, never merged speculatively', async () => {
    vi.stubGlobal('fetch', fixtureFetch())
    const cache = cacheFor()
    await cache.get('commune', '35238', 'mobilite', {
      indicators: PAGE_TWO, selection: SELECTION, auxiliary: false,
    })
    expect(posts.flatMap((post) => post.items).some((item) => PAGE_THREE.includes(item.resource))).toBe(false)

    const asked = await cache.get('commune', '35238', 'mobilite', {
      indicators: PAGE_THREE, selection: SELECTION,
    })
    const pageThreeItems = posts.flatMap((post) => post.items)
      .filter((item) => PAGE_THREE.includes(item.resource))
    expect(pageThreeItems).toHaveLength(7)
    expect(posts.filter((post) => post.items.some((item) => PAGE_THREE.includes(item.resource)))).toHaveLength(1)
    expect(asked.focal.resource_reads).toHaveLength(16)
    expect(asked.focal.named_reference_reads?.map((read) => read.resource)).toEqual(['raccordement_reference'])
    expect(asked.comparisons.get(JSON.stringify(SELECTION))?.comparison_reads).toHaveLength(23)
    // One acquisition identity: no item was read twice across the two demands.
    const keys = posts.flatMap((post) => post.items.map((item) => JSON.stringify(item)))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps healthy focal facts when one demanded comparison publication is absent, with no retry fan-out', async () => {
    vi.stubGlobal('fetch', fixtureFetch((item) =>
      item.resource === 'bornes_recharge_1000' && item.intent.kind === 'selected_comparison'))
    const cache = cacheFor()
    const acquired = await cache.get('commune', '35238', 'mobilite', {
      indicators: PAGE_TWO, selection: SELECTION, auxiliary: false,
    })
    const before = demandPostCount()
    expect(acquired.focal.resource_reads).toHaveLength(13)
    expect(acquired.focal.resource_failures).toContainEqual(expect.objectContaining({
      resource: 'bornes_recharge_1000', state: 'publication_unavailable', family: 'scalar',
    }))
    expect(acquired.focal.comparison_error).not.toBe(true)
    // The absent publication is settled: the next acquisition of the same
    // demand re-probes nothing until an explicit invalidation.
    await cache.select('commune', '35238', 'mobilite', SELECTION)
    expect(demandPostCount()).toBe(before)
  })

  it('reads no comparison at all when the demand defers the header context', async () => {
    vi.stubGlobal('fetch', fixtureFetch())
    const cache = cacheFor()
    const acquired = await cache.get('commune', '35238', 'mobilite', {
      indicators: PAGE_TWO, selection: null, auxiliary: false,
    })
    const items = posts.flatMap((post) => post.items)
    expect(items).toHaveLength(13)
    expect(items.every((item) => item.intent.kind === 'facts')).toBe(true)
    expect(acquired.focal.demand_comparison).toBeUndefined()
    expect(acquired.focal.default_comparison).toBeUndefined()
    expect(acquired.comparisons.size).toBe(0)
  })
})

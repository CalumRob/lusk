import { describe, expect, it, vi } from 'vitest'
import { acquireThemeComparison, acquireThemeFacts, semanticPublicationsCompatible, ThemeAcquisitionCache,
  themeAcquisitionEnabled } from '../payload/themeAcquisition'
import type { ThemeSelectionMember } from '../payload/themeAcquisition'
import { THEMES_ACQUISITION_API } from '../payload/themeAcquisition'
import { THEMES_CANONIQUES } from '../payload/types'

describe('theme acquisition cache', () => {
  it('registers every canonical theme for lazy acquisition', () => {
    expect([...THEMES_ACQUISITION_API].sort()).toEqual([...THEMES_CANONIQUES].sort())
  })
  it('defaults the migrated path ON — the incumbent path is the explicit opt-out', () => {
    // Le chemin migré est le DÉFAUT du produit ; l'incumbent statique ne
    // survit que comme opt-out explicite (VITE_THEME_ACQUISITION_API='0').
    expect(themeAcquisitionEnabled({})).toBe(true)
    expect(themeAcquisitionEnabled({ VITE_THEME_ACQUISITION_API: '1' })).toBe(true)
    expect(themeAcquisitionEnabled({ VITE_THEME_ACQUISITION_API: '0' })).toBe(false)
  })
  it('posts typed selections and preserves omitted versus explicitly empty selection', async () => {
    const catalogue = [{ resource_id: 'part_passoires', theme_id: 'habitat', indicator_id: 'part_passoires',
      label: 'Part des passoires', unit: '%', direction: 'low', allowed_levels: ['commune'], sources: ['dpe'],
      shapes: ['scalar'], target_kinds: ['territory'], fields: ['value', 'status'],
      intents: ['facts', 'fixed_comparison', 'selected_comparison'] }]
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') {
        return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: catalogue }))
      }
      if (String(url) === '/api/resources/read-batch') {
        const request = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(request)
        const results = request.items.map((item) => ({
          id: item.id,
          resource: item.resource,
          data: item.intent.kind === 'facts'
            ? { resource: item.resource, target: item.target, content_version: 'facts-v1',
              reference_content_version: 'territories-v1', value: 0.17, status: 'measured' }
            : { resource: item.resource, target: item.target, contract: 'indicator-comparison-v1',
              indicator_id: item.resource, shape: 'scalar', content_version: 'facts-v1',
              reference_content_version: 'territories-v1', selection: item.intent.kind === 'selected_comparison'
                ? item.intent.members.map(({ type, id }: { type: string; id: string }) => ({ territory_type: type, territory_id: id })) : null,
              result: { indicator_id: item.resource, status: 'unavailable', reason: 'not_comparable',
                direction: 'low', unit: '%', selected_member_count: 0, eligible_count: 0,
                missing_count: 0, rank: null, rank_size: null } },
        })).reverse()
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results }))
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    })
    vi.stubGlobal('fetch', fetcher)
    try {
      const facts = await acquireThemeFacts('commune', '22001', 'habitat')
      await acquireThemeComparison('commune', '22001', 'habitat', [])
      await acquireThemeComparison('commune', '22001', 'habitat', [
        { territory_type: 'epci', territory_id: '200000001' },
        { territory_type: 'commune', territory_id: '22001' },
      ])
      expect(facts.resource_reads).toEqual([expect.objectContaining({ resource: 'part_passoires',
        data: expect.objectContaining({ value: 0.17, target: { kind: 'territory', type: 'commune', id: '22001' } }) })])
      expect(facts.default_comparison).toMatchObject({ theme_id: 'habitat' })
      expect(requests).toHaveLength(3)
      expect(requests[0]!.items.map(({ intent }) => intent.kind)).toEqual(['facts', 'fixed_comparison'])
      expect(requests[1]!.items[0]!.intent).toEqual({ kind: 'selected_comparison', members: [] })
      expect(requests[2]!.items[0]!.intent).toEqual({ kind: 'selected_comparison', members: [
        { type: 'epci', id: '200000001' }, { type: 'commune', id: '22001' },
      ] })
      expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
        '/api/resources', '/api/resources/read-batch', '/api/resources/read-batch', '/api/resources/read-batch',
      ])
    } finally { vi.unstubAllGlobals() }
  })
  it('discovers theme resources from the complete catalogue and keeps every semantic batch within twelve items', async () => {
    vi.resetModules()
    const { acquireThemeFacts } = await import('../payload/themeAcquisition')
    const resources = Array.from({ length: 38 }, (_, index) => ({
      resource_id: index === 0 ? 'aedar_territorial_aggregate' : `resource_${index}`,
      theme_id: index === 0 ? '' : index <= 13 ? 'habitat' : 'mobilite',
      indicator_id: index === 0 ? 'aedar_territorial_aggregate' : `resource_${index}`,
      label: `Resource ${index}`, unit: '', direction: 'none', allowed_levels: ['commune'], sources: [],
      shapes: ['scalar'], target_kinds: ['territory'], fields: ['value', 'status'], intents: ['facts'],
    }))
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') return new Response(JSON.stringify({
        contract: 'semantic-resource-catalogue-v1', resources,
      }))
      if (String(url) === '/api/resources/read-batch') {
        const request = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(request)
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: request.items.map((item) => ({
          id: item.id, resource: item.resource, data: { resource: item.resource, target: item.target,
            content_version: 'v1', reference_content_version: 'territories-v1', value: 1, status: 'measured' },
        })) }))
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    }))

    try {
      const acquired = await acquireThemeFacts('commune', '22001', 'habitat')
      expect(acquired.resource_reads?.map((read) => read.resource)).toEqual(
        resources.slice(1, 14).map((resource) => resource.resource_id))
      expect(requests.map(({ items }) => items.length)).toEqual([12, 1])
      expect(requests.flatMap(({ items }) => items).every((item) =>
        item.target.kind === 'territory' && item.target.id === '22001' && item.intent.kind === 'facts')).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })

  it('discards a failed paired batch and recovers focal facts with a separate facts-only read', async () => {
    vi.resetModules()
    const { acquireThemeFacts } = await import('../payload/themeAcquisition')
    const resource = { resource_id: 'part_passoires', theme_id: 'habitat', indicator_id: 'part_passoires',
      label: 'Part des passoires', unit: '%', direction: 'low', allowed_levels: ['commune'], sources: ['dpe'],
      shapes: ['scalar'], target_kinds: ['territory'], fields: ['value', 'status'],
      intents: ['facts', 'fixed_comparison'] }
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') return new Response(JSON.stringify({
        contract: 'semantic-resource-catalogue-v1', resources: [resource],
      }))
      if (String(url) === '/api/resources/read-batch') {
        const request = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(request)
        if (requests.length === 1) return new Response('atomic batch rejected', { status: 503 })
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: request.items.map((item) => ({
          id: item.id, resource: item.resource, data: { resource: item.resource, target: item.target,
            content_version: 'facts-v2', reference_content_version: 'territories-v2', value: 0.2, status: 'measured' },
        })) }))
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    })
    vi.stubGlobal('fetch', fetcher)

    try {
      const acquired = await acquireThemeFacts('commune', '22001', 'habitat')
      expect(requests).toHaveLength(2)
      expect(requests[0]!.items.map(({ intent }) => intent.kind)).toEqual(['facts', 'fixed_comparison'])
      expect(requests[1]!.items.map(({ intent }) => intent.kind)).toEqual(['facts'])
      expect(acquired.resource_reads?.[0]?.data.value).toBe(0.2)
      expect(acquired.comparison_error).toBe(true)
      expect(acquired.default_comparison).toBeUndefined()
    } finally { vi.unstubAllGlobals() }
  })

  it('loads only requested themes and caches by territory, theme, and comparison context', async () => {
    const acquire = vi.fn(async (theme: string) => ({ theme, focal: 42, tokens: {} }))
    const cache = new ThemeAcquisitionCache(acquire)
    await cache.get('commune', '22001', 'programmes')
    await cache.get('commune', '22001', 'programmes')
    await cache.get('commune', '22001', 'habitat')
    await cache.get('epci', '22001', 'programmes')
    expect(acquire.mock.calls.map(([theme]) => theme)).toEqual(['programmes', 'habitat', 'programmes'])
  })

  it('deduplicates concurrent facts requests and evicts a rejected in-flight request for retry', async () => {
    let resolve!: (value: { theme_id: string }) => void
    const deferred = new Promise<{ theme_id: string }>((yes) => { resolve = yes })
    const acquire = vi.fn().mockReturnValueOnce(deferred).mockResolvedValueOnce({ theme_id: 'mobilite', attempt: 2 })
    const cache = new ThemeAcquisitionCache(acquire)
    const first = cache.get('commune', '22001', 'mobilite')
    const concurrent = cache.get('commune', '22001', 'mobilite')
    expect(acquire).toHaveBeenCalledTimes(1)
    resolve({ theme_id: 'mobilite' })
    expect((await first).focal).toEqual((await concurrent).focal)

    const failing = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ theme_id: 'mobilite' })
    const retryCache = new ThemeAcquisitionCache(failing)
    await expect(retryCache.get('commune', '22001', 'mobilite')).rejects.toThrow('offline')
    expect((await retryCache.get('commune', '22001', 'mobilite')).focal.theme_id).toBe('mobilite')
    expect(failing).toHaveBeenCalledTimes(2)
  })

  it('does not cache an invalidated in-flight response and starts a fresh generation', async () => {
    let resolveOld!: (value: { generation: string }) => void
    const oldRequest = new Promise<{ generation: string }>((yes) => { resolveOld = yes })
    const acquire = vi.fn().mockReturnValueOnce(oldRequest).mockResolvedValueOnce({ generation: 'new' })
    const cache = new ThemeAcquisitionCache(acquire)
    const stale = cache.get('commune', '22001', 'mobilite')
    cache.invalidate('commune', '22001', 'mobilite')
    expect((await cache.get('commune', '22001', 'mobilite')).focal.generation).toBe('new')
    resolveOld({ generation: 'old' })
    await expect(stale).rejects.toThrow(/stale/i)
    expect((await cache.get('commune', '22001', 'mobilite')).focal.generation).toBe('new')
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it('merges a comparison-only response while retaining focal facts and distinguishing empty from default', async () => {
    const facts = vi.fn(async () => ({ content_version: 'v1', reference_content_version: 'r1', focal: { value: 17 } }))
    const comparison = vi.fn(async (selection: readonly ThemeSelectionMember[] | undefined) => ({
      content_version: 'v1', reference_content_version: 'r1', selection: selection ?? 'default', values: [selection?.length ?? 99],
    }))
    const cache = new ThemeAcquisitionCache(facts, comparison)
    const initial = await cache.get('commune', '22001', 'habitat')
    const empty = await cache.select('commune', '22001', 'habitat', [])
    expect(empty.focal).toEqual(initial.focal)
    expect(empty.comparisons.get('[]')?.selection).toEqual([])
    await cache.select('commune', '22001', 'habitat', undefined)
    await cache.select('commune', '22001', 'habitat', [])
    expect(facts).toHaveBeenCalledTimes(1)
    expect(comparison.mock.calls.map(([selection]) => selection)).toEqual([[], undefined])
  })

  it('deduplicates concurrent reads for the same comparison selection', async () => {
    let resolveComparison!: (value: { content_version: string; reference_content_version: string; selection: readonly ThemeSelectionMember[] }) => void
    const comparisonResponse = new Promise<{ content_version: string; reference_content_version: string; selection: readonly ThemeSelectionMember[] }>((resolve) => {
      resolveComparison = resolve
    })
    const facts = vi.fn(async () => ({ content_version: 'v1', reference_content_version: 'r1', focal: { value: 42 } }))
    const comparison = vi.fn(() => comparisonResponse)
    const cache = new ThemeAcquisitionCache(facts, comparison)
    const selection = [{ territory_type: 'epci' as const, territory_id: '200000001' }]

    const first = cache.select('commune', '22001', 'habitat', selection)
    const concurrent = cache.select('commune', '22001', 'habitat', selection)
    await vi.waitFor(() => expect(comparison).toHaveBeenCalled())
    expect(comparison).toHaveBeenCalledTimes(1)
    resolveComparison({ content_version: 'v1', reference_content_version: 'r1', selection })
    const [firstResult, concurrentResult] = await Promise.all([first, concurrent])
    expect(firstResult.focal).toEqual(concurrentResult.focal)
    expect(firstResult.comparisons.get(JSON.stringify(selection))).toEqual(
      concurrentResult.comparisons.get(JSON.stringify(selection)))
  })

  it('fails closed on token mismatch and allows retry', async () => {
    const comparison = vi.fn().mockResolvedValueOnce({ reference_content_version: 'stale', content_version: 'v1' })
      .mockResolvedValueOnce({ reference_content_version: 'r1', content_version: 'v1', results: [] })
    const cache = new ThemeAcquisitionCache(async () => ({ reference_content_version: 'r1', content_version: 'v1', focal: 1 }), comparison)
    await cache.get('commune', '22001', 'milieux')
    await expect(cache.select('commune', '22001', 'milieux', [])).rejects.toThrow(/publication/i)
    expect((await cache.select('commune', '22001', 'milieux', [])).focal.focal).toBe(1)
  })

  it('requires each native comparison to match its own focal publication and territory-reference token', () => {
    const facts = { resource_reads: [{ resource: 'densite', data: {
      content_version: 'scalar-v1', reference_content_version: 'territories-v1',
    } }] }
    const comparison = { comparison_reads: [{ resource: 'densite', data: {
      content_version: 'scalar-v1', reference_content_version: 'territories-v1',
    } }] }
    expect(semanticPublicationsCompatible(facts, comparison)).toBe(true)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'densite', data: {
      content_version: 'scalar-v1', reference_content_version: 'territories-v2',
    } }] })).toBe(false)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'densite', data: {
      content_version: 'scalar-v1',
    } }] })).toBe(false)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'structure_age', data: {
      content_version: 'scalar-v1', reference_content_version: 'territories-v1',
    } }] })).toBe(false)
  })
})

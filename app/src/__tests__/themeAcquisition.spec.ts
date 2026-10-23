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
  it('posts default, empty, singleton, and mixed typed selections without conflating their scopes', async () => {
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
              reference_content_version: 'territories-v1', descriptor_version: 'scalar-descriptor-v1', value: 0.17, status: 'measured' }
            : { resource: item.resource, target: item.target, contract: 'indicator-comparison-v1',
              indicator_id: item.resource, shape: 'scalar', content_version: 'facts-v1',
              reference_content_version: 'territories-v1', selection: item.intent.kind === 'selected_comparison'
                ? item.intent.members.map(({ type, id }: { type: string; id: string }) => ({ territory_type: type, territory_id: id })) : null,
              result: { indicator_id: item.resource, descriptor_version: 'scalar-descriptor-v1', status: 'unavailable', reason: 'not_comparable',
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
        { territory_type: 'commune', territory_id: '22001' },
      ])
      await acquireThemeComparison('commune', '22001', 'habitat', [
        { territory_type: 'epci', territory_id: '200000001' },
        { territory_type: 'commune', territory_id: '22001' },
      ])
      expect(facts.resource_reads).toEqual([expect.objectContaining({ resource: 'part_passoires',
        data: expect.objectContaining({ value: 0.17, target: { kind: 'territory', type: 'commune', id: '22001' } }) })])
      expect(facts.default_comparison).toMatchObject({ theme_id: 'habitat' })
      expect(requests).toHaveLength(4)
      expect(requests[0]!.items.map(({ intent }) => intent.kind)).toEqual(['facts', 'fixed_comparison'])
      expect(requests[1]!.items[0]!.intent).toEqual({ kind: 'selected_comparison', members: [] })
      expect(requests[2]!.items[0]!.intent).toEqual({ kind: 'selected_comparison', members: [
        { type: 'commune', id: '22001' },
      ] })
      expect(requests[3]!.items[0]!.intent).toEqual({ kind: 'selected_comparison', members: [
        { type: 'epci', id: '200000001' }, { type: 'commune', id: '22001' },
      ] })
      expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
        '/api/resources', '/api/resources/read-batch', '/api/resources/read-batch',
        '/api/resources/read-batch', '/api/resources/read-batch',
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

  it('reads typed-reading cohorts and producer-named references without inventing territory targets', async () => {
    vi.resetModules()
    const { acquireThemeFacts } = await import('../payload/themeAcquisition')
    const resources = [
      { resource_id: 'demographie_selected_reading', theme_id: 'demographie', indicator_id: 'demographie_selected_reading',
        label: 'Reading', unit: '', direction: 'none', allowed_levels: ['commune'], sources: ['serie_historique'],
        shapes: ['typed_reading'], target_kinds: ['territory', 'territory_cohort'], fields: ['groupe', 'status'], intents: ['facts'] },
      { resource_id: 'raccordement_reference', theme_id: 'mobilite', indicator_id: 'raccordement_reference',
        label: 'Curve reference', unit: '%', direction: 'high', allowed_levels: ['commune'], sources: ['gtfs'],
        shapes: ['named_reference'], target_kinds: ['named_reference'], target_ids: ['bretagne_all_assessed_communes_mean'],
        fields: ['value'], intents: ['facts'] },
    ]
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
            content_version: 'v1', reference_content_version: 'reference-v1',
            ...(item.target.kind === 'territory' ? { facts: [{ groupe: 'producer-group', status: 'measured' }] } : {}),
            ...(item.target.kind === 'territory_cohort' ? { cohort: { territory_type: 'commune',
              department_id: null, epci_id: null, member_count: 1, members: [{ id: '22001', type: 'commune', name: 'Focal' }],
              reference_content_version: 'reference-v1' }, territories: [{ territory: { id: '22001', type: 'commune', name: 'Focal' },
              facts: [{ groupe: 'producer-group', status: 'measured' }] }] } : {}),
            ...(item.target.kind === 'named_reference' ? { reference: { id: item.target.id, label: 'Bretagne reference',
              role: 'analytical_reference', statistic: 'mean' }, axis_values: ['t0010'], points: [
              { axis: 't0010', status: 'measured', value: 2, provenance: [{ source_id: 'gtfs', vintage_id: 'v1',
                source_name: 'GTFS', version: 'v1', reference_date: null, publication_date: null }] },
            ] } : {}),
          },
        })) }))
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    }))
    try {
      const acquired = await acquireThemeFacts('commune', '22001', 'demographie')
      expect(acquired.cohort_reads?.[0]?.data.target).toEqual({ kind: 'territory_cohort', type: 'commune' })
      expect(requests.flatMap(({ items }) => items).map((item) => item.target.kind)).toEqual(['territory', 'territory_cohort'])

      const mobility = await acquireThemeFacts('commune', '22001', 'mobilite')
      const named = mobility.named_reference_reads?.[0]
      expect(named?.data).toMatchObject({ resource: 'raccordement_reference',
        target: { kind: 'named_reference', id: 'bretagne_all_assessed_communes_mean' },
        reference: { id: 'bretagne_all_assessed_communes_mean', role: 'analytical_reference' } })
      expect(requests.flatMap(({ items }) => items).some((item) => item.resource === 'raccordement_reference' &&
        item.target.kind === 'territory')).toBe(false)
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

  it('invalidates only the requested comparison while retaining focal facts and sibling selections', async () => {
    const facts = vi.fn(async () => ({ content_version: 'v1', reference_content_version: 'r1', focal: { value: 17 } }))
    let sequence = 0
    const comparison = vi.fn(async (selection: readonly ThemeSelectionMember[] | undefined) => ({
      content_version: 'v1', reference_content_version: 'r1', selection: selection ?? 'default', sequence: ++sequence,
    }))
    const cache = new ThemeAcquisitionCache(facts, comparison)
    const initial = await cache.get('commune', '22001', 'habitat')
    const empty = await cache.select('commune', '22001', 'habitat', [])
    const defaultGroup = await cache.select('commune', '22001', 'habitat', undefined)

    cache.invalidateComparison('commune', '22001', 'habitat', [])
    const retried = await cache.select('commune', '22001', 'habitat', [])

    expect(facts).toHaveBeenCalledTimes(1)
    expect(comparison.mock.calls.map(([selection]) => selection)).toEqual([[], undefined, []])
    expect(retried.focal).toBe(initial.focal)
    expect(retried.comparisons.get('[]')?.sequence).toBe(3)
    expect(retried.comparisons.get('omitted')?.sequence).toBe(defaultGroup.comparisons.get('omitted')?.sequence)
    expect(empty.comparisons.get('[]')?.sequence).toBe(1)
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

  it('retries a failed auxiliary comparison without reacquiring focal facts', async () => {
    const facts = vi.fn(async () => ({ theme_id: 'milieux' as const, resource_reads: [], cohort_error: true,
      default_comparison: { theme_id: 'milieux' as const, comparison_reads: [] } }))
    const comparisons = vi.fn(async () => ({ theme_id: 'milieux' as const, comparison_reads: [], cohort_reads: [] }))
    const cache = new ThemeAcquisitionCache(facts, comparisons)
    const initial = await cache.get('commune', '22001', 'milieux')
    expect(initial.comparisons.get('omitted')?.cohort_error).toBe(true)
    const retried = await cache.select('commune', '22001', 'milieux', undefined)
    expect(comparisons).toHaveBeenCalledTimes(1)
    expect(facts).toHaveBeenCalledTimes(1)
    expect(retried.focal).toBe(initial.focal)
    expect(retried.comparisons.get('omitted')?.cohort_error).not.toBe(true)
  })

  it('requires each native comparison to match its own focal publication and territory-reference token', () => {
    const facts = { resource_reads: [{ resource: 'densite', shapes: ['scalar'], data: {
      content_version: 'scalar-v1', reference_content_version: 'territories-v1', descriptor_version: 'scalar-descriptor-v1',
    } }] }
    const comparison = { comparison_reads: [{ resource: 'densite', data: {
      content_version: 'scalar-v1', reference_content_version: 'territories-v1',
      result: { status: 'available', descriptor_version: 'scalar-descriptor-v1' },
    } }] }
    expect(semanticPublicationsCompatible(facts, comparison)).toBe(true)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'densite', data: {
      content_version: 'scalar-v1', reference_content_version: 'territories-v2',
    } }] })).toBe(false)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'densite', data: {
      content_version: 'scalar-v1',
    } }] })).toBe(false)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'densite', data: {
      content_version: 'scalar-v1', reference_content_version: 'territories-v1',
      result: { status: 'available', descriptor_version: 'stale-scalar-descriptor' },
    } }] })).toBe(false)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'structure_age', data: {
      content_version: 'scalar-v1', reference_content_version: 'territories-v1',
    } }] })).toBe(false)
  })

  it('binds dual-shape scalar comparisons to the scalar facet and keeps annual tokens independent', async () => {
    const target = { kind: 'territory', type: 'commune', id: '22001' }
    const scalarDescriptor = { indicator_id: 'prix_m2', unit: '€/m²', descriptor_version: 'scalar-desc-v1' }
    const scope = { kind: 'density_class', territory_type: 'commune', density_class_code: 'D1', member_count: 2 }
    const focalRead = { resource: 'prix_m2', shapes: ['scalar', 'ordered_series'], data: {
      resource: 'prix_m2', target, content_version: 'series-v1', reference_content_version: 'series-ref-v1',
      descriptor_version: 'series-desc-v1', points: [{ axis: '2025', value: 230 }],
      scalar_facet: { shape: 'scalar', source_facet: 'prix_m2', content_version: 'scalar-v1',
        reference_content_version: 'scalar-ref-v1', descriptor_version: 'scalar-desc-v1',
        descriptor: scalarDescriptor, observation: { territory_id: '22001', territory_type: 'commune',
          status: 'measured', value: 700, sources: [] } },
    } }
    const comparisonRead = (facetPatch: Record<string, unknown> = {}) => ({ resource: 'prix_m2',
      data: { resource: 'prix_m2', target, contract: 'indicator-comparison-v1', indicator_id: 'prix_m2',
        shape: 'ordered_series', content_version: 'series-v1', reference_content_version: 'series-ref-v1',
        selection: null, scope, result: { indicator_id: 'prix_m2', source_facet: '2025',
          descriptor_version: 'series-desc-v1', status: 'available', rank: 2, rank_size: 2 },
        scalar_facet: { shape: 'scalar', source_facet: 'prix_m2', content_version: 'scalar-v1',
          reference_content_version: 'scalar-ref-v1', descriptor_version: 'scalar-desc-v1',
          descriptor: scalarDescriptor, selection: null, scope,
          comparison_content_version: 'scalar-comparison-v1',
          result: { indicator_id: 'prix_m2', source_facet: 'prix_m2',
            descriptor_version: 'scalar-desc-v1', status: 'available', rank: 1, rank_size: 2 },
          ...facetPatch },
      } })
    const facts = { resource_reads: [focalRead] }
    const valid = { comparison_reads: [comparisonRead()] }
    expect(semanticPublicationsCompatible(facts, valid)).toBe(true)

    const corruptions = [
      { content_version: 'stale-scalar-v0' },
      { reference_content_version: 'stale-scalar-reference' },
      { descriptor_version: 'stale-scalar-descriptor' },
      { comparison_content_version: '' },
      { source_facet: 'annual-2025' },
      { descriptor: { ...scalarDescriptor, indicator_id: 'other-indicator' } },
      { result: { indicator_id: 'other-indicator', source_facet: 'other-indicator',
        descriptor_version: 'scalar-desc-v1', status: 'available', rank: 1, rank_size: 2 } },
      { scope: { ...scope, density_class_code: 'D2' } },
      { selection: [{ territory_type: 'commune', territory_id: '35238' }] },
    ]
    for (const corruption of corruptions) {
      expect(semanticPublicationsCompatible(facts, { comparison_reads: [comparisonRead(corruption)] })).toBe(false)
    }
    const noFacet = structuredClone(valid)
    delete (noFacet.comparison_reads[0]!.data as Record<string, unknown>).scalar_facet
    expect(semanticPublicationsCompatible(facts, noFacet)).toBe(false)

    const stale = comparisonRead({ reference_content_version: 'stale-scalar-reference' })
    const compare = vi.fn().mockResolvedValueOnce({ comparison_reads: [stale] })
      .mockResolvedValueOnce(valid)
    const cache = new ThemeAcquisitionCache(async () => facts, compare)
    const acquired = await cache.get('commune', '22001', 'habitat')
    await expect(cache.select('commune', '22001', 'habitat', undefined)).rejects.toThrow(/publication/i)
    expect((await cache.get('commune', '22001', 'habitat')).focal).toBe(acquired.focal)
    const retried = await cache.select('commune', '22001', 'habitat', undefined)
    expect(compare).toHaveBeenCalledTimes(2)
    expect(retried.focal).toBe(acquired.focal)
    expect(retried.comparisons.get('omitted')).toEqual(valid)
  })

  it.each(['ordered_series', 'period_detail'])('rejects %s descriptor drift even when publication tokens match', (shape) => {
    const facts = { resource_reads: [{ resource: 'resource', shapes: [shape], data: {
      content_version: 'publication-v1', reference_content_version: 'reference-v1', descriptor_version: 'descriptor-v1',
    } }] }
    const comparison = (descriptorVersion?: string) => ({ comparison_reads: [{ resource: 'resource', data: {
      content_version: 'publication-v1', reference_content_version: 'reference-v1',
      result: { descriptor_version: descriptorVersion },
    } }] })
    expect(semanticPublicationsCompatible(facts, comparison('descriptor-v1'))).toBe(true)
    expect(semanticPublicationsCompatible(facts, comparison('descriptor-v2'))).toBe(false)
    expect(semanticPublicationsCompatible(facts, comparison())).toBe(false)
  })

  it('requires declared profile comparison dependencies to be present and match exactly', () => {
    const facts = { resource_reads: [{ resource: 'distribution_dpe', shapes: ['declared_profile'], data: {
      content_version: 'profile-v1', reference_content_version: 'territories-v1',
      descriptor: { descriptor_version: 'profile-descriptor-v1', comparison_scalar: 'part_passoires',
        required_scalar_version: 'scalar-v3' },
    } }] }
    const comparison = (scalarVersion?: string) => ({ comparison_reads: [{ resource: 'distribution_dpe', data: {
      content_version: 'profile-v1', reference_content_version: 'territories-v1',
      scalar_content_version: scalarVersion,
      result: { profile_descriptor_version: 'profile-descriptor-v1', required_scalar_version: 'scalar-v3' },
    } }] })
    expect(semanticPublicationsCompatible(facts, comparison('scalar-v3'))).toBe(true)
    expect(semanticPublicationsCompatible(facts, comparison())).toBe(false)
    expect(semanticPublicationsCompatible(facts, comparison('scalar-v2'))).toBe(false)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'distribution_dpe', data: {
      content_version: 'profile-v1', reference_content_version: 'territories-v1',
      scalar_content_version: 'scalar-v3',
      result: { profile_descriptor_version: 'profile-descriptor-v1' },
    } }] })).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  acquireThemeComparison,
  acquireThemeFacts,
  cleSelectionComparaison,
  semanticPublicationsCompatible,
  ThemeAcquisitionCache,
} from '../payload/themeAcquisition'
import type { ThemeKey, ThemeResponse } from '../payload/themeAcquisition'
import type { ThemeSelectionMember } from '../payload/themeAcquisition'
import { THEMES_ACQUISITION_API } from '../payload/themeAcquisition'
import { THEMES_CANONIQUES } from '../payload/types'
import { semanticComparisonForTheme, validerReponseComparaisonTheme } from '../payload/themeFactsAdapter'
import {
  nativeBatchResponse,
  nativeCatalogueResponse,
  nativeReadFixture,
  nativeResources,
} from './helpers/semanticApiFixtures'

describe('theme acquisition cache', () => {
  it('admits the pooled scalar comparison for a dual-shape Habitat resource', async () => {
    const catalogue = await nativeCatalogueResponse().json()
    catalogue.resources = catalogue.resources.filter((resource: { theme_id: string }) => resource.theme_id === 'habitat')
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources') return new Response(JSON.stringify(catalogue), { status: 200 })
      if (String(input) === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body))
        return nativeBatchResponse(items, (item, resource) => nativeReadFixture(item, resource,
          { syntheticProfileComparisons: true }))
      }
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetcher)
    try {
      const acquired = await acquireThemeFacts('commune', '22001', 'habitat')
      const priceComparison = acquired.default_comparison?.comparison_reads.find((read) =>
        read.resource === 'prix_m2')?.data as Record<string, any> | undefined
      const projected = semanticComparisonForTheme(acquired.default_comparison, undefined,
        acquired.resource_reads, { type: 'commune', id: '22001' })

      expect(acquired.comparison_error).toBeUndefined()
      expect(acquired.comparison_failure).toBeUndefined()
      expect(priceComparison?.scalar_facet?.result?.status).toBe('available')
      expect(priceComparison?.scalar_facet?.comparison_content_version).toBe('prix_m2-fixture-comparison-v1')
      expect(Array.isArray(projected?.results)).toBe(true)
      const projectedResults: unknown[] = Array.isArray(projected?.results) ? projected.results : []
      const priceResult = projectedResults.find((result) => typeof result === 'object' && result !== null &&
        'indicator_id' in result && result.indicator_id === 'prix_m2')
      expect(priceResult).toBeDefined()
      if (typeof priceResult !== 'object' || priceResult === null || !('rank' in priceResult)) {
        throw new Error('The pooled scalar comparison projection must expose its native rank')
      }
      expect(priceResult.rank).toBeTypeOf('number')
    } finally { vi.unstubAllGlobals() }
  })

  it('rejects a wrong typed native profile selection before caching, so retry fetches again', async () => {
    const catalogue = await nativeCatalogueResponse().json()
    catalogue.resources = catalogue.resources.filter((resource: { resource_id: string }) =>
      resource.resource_id === 'mix_logements')
    let wrongSelection = true
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources') return new Response(JSON.stringify(catalogue), { status: 200 })
      if (String(input) === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body))
        return nativeBatchResponse(items, (item, resource) => {
          const data = nativeReadFixture(item, resource)
          if (wrongSelection && item.intent?.kind === 'selected_comparison' && data) {
            return { ...data, selection: [{ territory_type: 'commune', territory_id: 'wrong-member' }] }
          }
          return data
        })
      }
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetcher)
    const facts = vi.fn((theme: ThemeKey, key?: { type: string; id: string }) =>
      acquireThemeFacts(key!.type, key!.id, theme))
    const comparisons = vi.fn((selection: readonly ThemeSelectionMember[] | undefined, theme: ThemeKey,
      key?: { type: string; id: string }) => acquireThemeComparison(key!.type, key!.id, theme, selection))
    const cache = new ThemeAcquisitionCache(facts, comparisons)
    const selection = [{ territory_type: 'commune' as const, territory_id: '22002' }]

    await cache.get('commune', '22001', 'habitat')
    const firstAttempt = await cache.select('commune', '22001', 'habitat', selection)
      .then(() => 'resolved', () => 'rejected')
    wrongSelection = false
    await cache.select('commune', '22001', 'habitat', selection)

    expect.soft(firstAttempt).toBe('rejected')
    expect(comparisons).toHaveBeenCalledTimes(2)
    expect(facts).toHaveBeenCalledTimes(1)
  })

  it('registers every canonical theme for acquisition — the only runtime since #868', () => {
    // #868 : plus de drapeau VITE_THEME_ACQUISITION_API — l'acquisition API est
    // le seul mode ; le registre doit rester complet contre THEMES_CANONIQUES.
    expect([...THEMES_ACQUISITION_API].sort()).toEqual([...THEMES_CANONIQUES].sort())
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
  it.each([
    {
      label: 'an EPCI plus one of its communes',
      selection: [
        { territory_type: 'epci' as const, territory_id: 'synthetic-epci-1' },
        { territory_type: 'commune' as const, territory_id: 'synthetic-commune-1' },
      ],
      resolvedCount: 3,
    },
    {
      label: 'a department plus one of its communes',
      selection: [
        { territory_type: 'departement' as const, territory_id: 'synthetic-department-22' },
        { territory_type: 'commune' as const, territory_id: 'synthetic-commune-1' },
      ],
      resolvedCount: 4,
    },
  ])('keeps the API-resolved unique commune count for $label', async ({ selection, resolvedCount }) => {
    // Producer-shaped synthetic read: these two requested identities resolve
    // to a known three/four-commune set after ancestor overlap is deduplicated.
    // The count is intentionally independent of selection.length; this is not
    // a claim of publication parity.
    const catalogue = [{ resource_id: 'part_passoires', theme_id: 'habitat', indicator_id: 'part_passoires',
      label: 'Part des passoires', unit: '%', direction: 'low', allowed_levels: ['commune'], sources: ['dpe'],
      shapes: ['scalar'], target_kinds: ['territory'], fields: ['value', 'status'],
      intents: ['selected_comparison'] }]
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') {
        return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: catalogue }))
      }
      if (String(url) === '/api/resources/read-batch') {
        const request = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: request.items.map((item) => ({
          id: item.id, resource: item.resource, data: {
            resource: item.resource, target: item.target, contract: 'indicator-comparison-v1',
            indicator_id: item.resource, shape: 'scalar', content_version: 'synthetic-publication-v1',
            reference_content_version: 'synthetic-territories-v1',
            selection: item.intent.members.map(({ type, id }: { type: string; id: string }) =>
              ({ territory_type: type, territory_id: id })),
            scope: { kind: 'explicit_selection', member_count: resolvedCount },
            result: { indicator_id: item.resource, source_facet: item.resource, status: 'available', direction: 'low',
              selected_member_count: resolvedCount, eligible_count: resolvedCount, missing_count: 0,
              rank: 2, rank_size: resolvedCount },
          },
        })) }))
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    })
    vi.stubGlobal('fetch', fetcher)
    try {
      const acquired = await acquireThemeComparison('commune', 'synthetic-focal', 'habitat', selection)
      const target = { type: 'commune' as const, id: 'synthetic-focal' }
      validerReponseComparaisonTheme('habitat', acquired, selection, target)
      const projected = semanticComparisonForTheme(acquired, undefined, undefined, target)

      expect(projected).toMatchObject({ scope: { kind: 'explicit_selection', member_count: resolvedCount },
        results: [{ indicator_id: 'part_passoires', rank: 2, rank_size: resolvedCount }] })
      expect((acquired.comparison_reads?.[0]?.data as Record<string, any>)?.selection).toEqual(selection.map((member) => ({
        territory_type: member.territory_type, territory_id: member.territory_id,
      })))
    } finally { vi.unstubAllGlobals() }
  })
  it.each(['target', 'owned_content_version', 'result.indicator_id'] as const)(
    'rejects a regional series comparison with a changed %s binding and retries without replacing focal facts',
    async (binding) => {
      const declaration = nativeResources('mobilite').find((candidate) =>
        candidate.resource_id === 'raccordement_courbe')!
      const resource = declaration.resource_id
      const target = { kind: 'territory', type: 'region', id: '53' }
      const focalData = nativeReadFixture({ target, intent: { kind: 'facts' } }, declaration)
      const comparisonData = () => nativeReadFixture({ target,
        intent: { kind: 'fixed_comparison', context: 'default' } }, declaration)
      const focal = { theme_id: 'mobilite' as const, resource_reads: [{ resource,
        shapes: declaration.shapes, data: focalData }] }
      const comparison = (patch: Record<string, unknown> = {}) => {
        const data = comparisonData()
        Object.assign(data.result, patch)
        return { theme_id: 'mobilite' as const, comparison_reads: [{ resource,
          shapes: declaration.shapes, data }] }
      }
      const invalid = structuredClone(comparison())
      const invalidData = invalid.comparison_reads[0]!.data as Record<string, any>
      if (binding === 'target') invalidData.target.id = '54'
      if (binding === 'owned_content_version') invalidData.result.owned_content_version = 'stale-series-v0'
      if (binding === 'result.indicator_id') invalidData.result.indicator_id = 'other-series'
      let attempts = 0
      const acquire = vi.fn(async () => attempts++ === 0 ? invalid : comparison())
      const cache = new ThemeAcquisitionCache(async () => focal, acquire)
      const first = await cache.get('region', '53', 'mobilite')

      await expect(cache.select('region', '53', 'mobilite', undefined)).rejects.toThrow(/publication/i)
      expect((await cache.get('region', '53', 'mobilite')).focal).toBe(first.focal)
      const retried = await cache.select('region', '53', 'mobilite', undefined)

      expect(acquire).toHaveBeenCalledTimes(2)
      expect(retried.focal).toBe(first.focal)
      expect(retried.comparisons.get('omitted')).toBeDefined()
    },
  )
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

  it('keeps a legacy focal series and its default comparison in one API snapshot when chunking', async () => {
    const legacy = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    expect(legacy.intents).toContain('fixed_comparison')
    const leading = Array.from({ length: 11 }, (_, index) => ({
      resource_id: `padding_${index}`, theme_id: 'programmes', indicator_id: `padding_${index}`,
      label: `Padding ${index}`, unit: '', direction: 'none', allowed_levels: ['commune'], sources: [],
      shapes: ['scalar'], target_kinds: ['territory'], fields: ['value', 'status'], intents: ['facts'],
    }))
    const resources = [...leading, legacy]
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') return new Response(JSON.stringify({
        contract: 'semantic-resource-catalogue-v1', resources,
      }))
      if (String(url) === '/api/resources/read-batch') {
        const request = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(request)
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: request.items.map((item) => {
          const shared = { resource: item.resource, target: item.target }
          if (item.resource !== legacy.resource_id) return { id: item.id, resource: item.resource,
            data: { ...shared, content_version: 'padding-v1', reference_content_version: 'reference-v1' } }
          const focal = { ...shared, publication_id: 'legacy-series-v1',
            territory: { id: item.target.id, type: item.target.type, name: 'Focal' },
            indicator_id: legacy.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
            label: legacy.label, unit: legacy.unit, direction: 'none',
            descriptor_version: 'legacy-series-descriptor-v1', comparison_point: null, points: [],
            availability: 'incomplete' }
          const comparison = { ...shared, contract: 'indicator-comparison-v1', complete_theme: false,
            indicator_id: legacy.indicator_id, shape: 'series', content_version: 'legacy-series-v1',
            reference_content_version: 'reference-v1', selection: null,
            scope: { kind: 'density_class', territory_type: 'commune', density_class_code: 'D1', member_count: 2 },
            result: { indicator_id: legacy.indicator_id, label: legacy.label, facet: null,
              source_facet: null, unit: legacy.unit, direction: 'none',
              descriptor_version: 'legacy-series-descriptor-v1', status: 'unavailable',
              reason: 'unsupported_comparison_contract', selected_member_count: 2, eligible_count: 0,
              median: null, rank: null, comparison_sources: [] } }
          return { id: item.id, resource: item.resource,
            data: item.intent.kind === 'facts' ? focal : comparison }
        }) }))
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    }))
    try {
      const acquired = await acquireThemeFacts('commune', '22001', 'programmes')
      const seriesBatch = requests.find(({ items }) => items.some((item) => item.resource === legacy.resource_id))!
      expect(seriesBatch.items.filter((item) => item.resource === legacy.resource_id).map((item) => item.intent.kind))
        .toEqual(['facts', 'fixed_comparison'])
      expect(requests.map(({ items }) => items.length)).toEqual([11, 2])
      expect(acquired.default_comparison?.comparison_reads[0]?.resource).toBe(legacy.resource_id)
      expect(acquired.comparison_error).toBeUndefined()
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

  it('binds comparison-only retries to a native legacy series after facts-only recovery', async () => {
    const legacy = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    const target = { kind: 'territory', type: 'commune', id: 'cohort-c1' }
    const focal = (requestTarget: Record<string, any>) => ({ resource: legacy.resource_id,
      target: requestTarget, publication_id: 'legacy-series-v1',
      territory: { id: requestTarget.id, type: requestTarget.type, name: 'Cohort one' },
      indicator_id: legacy.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
      label: legacy.label, unit: legacy.unit, direction: legacy.direction,
      descriptor_version: 'legacy-series-descriptor-v1', comparison_point: null,
      points: [{ axis: '2024', observation_period: '2025', value: 10, status: 'measured',
        source_id: 'cohort-source', vintage_id: 'cohort-v1', source_version: '2026',
        source_reference_date: '2026-01-01', source_publication_date: '2026-01-02' }],
      availability: 'incomplete' })
    let comparisonPatch: (data: Record<string, any>) => void = () => {}
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') return new Response(JSON.stringify({
        contract: 'semantic-resource-catalogue-v1', resources: [legacy],
      }))
      if (String(url) === '/api/resources/read-batch') {
        const request = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(request)
        if (requests.length === 1) return new Response('paired snapshot unavailable', { status: 503 })
        const results = request.items.map((item) => {
          const data = item.intent.kind === 'facts' ? focal(item.target) : {
            resource: legacy.resource_id, target: item.target, contract: 'indicator-comparison-v1',
            complete_theme: false, indicator_id: legacy.indicator_id, shape: 'series',
            content_version: 'legacy-series-v1', reference_content_version: 'legacy-reference-v1',
            selection: item.intent.kind === 'selected_comparison'
              ? item.intent.members.map(({ type, id }: { type: string; id: string }) =>
                ({ territory_type: type, territory_id: id })) : null,
            scope: item.intent.kind === 'selected_comparison'
              ? { kind: 'explicit_selection', member_count: item.intent.members.length }
              : { kind: 'density_class', territory_type: 'commune', density_class_code: 'D1', member_count: 2 },
            result: { indicator_id: legacy.indicator_id, label: legacy.label, facet: null,
              source_facet: null, unit: legacy.unit, direction: legacy.direction,
              descriptor_version: 'legacy-series-descriptor-v1', status: 'unavailable',
              reason: 'unsupported_comparison_contract',
              selected_member_count: item.intent.kind === 'selected_comparison' ? item.intent.members.length : 2,
              eligible_count: 0,
              missing_count: item.intent.kind === 'selected_comparison' ? item.intent.members.length : 2,
              median: null, rank: null, comparison_sources: [] },
          }
          if (item.intent.kind !== 'facts') comparisonPatch(data)
          return { id: item.id, resource: item.resource, data }
        })
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results }))
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const cache = new ThemeAcquisitionCache(
      (_theme, key) => acquireThemeFacts(key!.type, key!.id, _theme),
      (selection, theme, key) => acquireThemeComparison(key!.type, key!.id, theme, selection),
    )
    try {
      const recovered = await cache.get('commune', target.id, 'programmes')
      expect(requests.map(({ items }) => items.map((item) => item.intent.kind)))
        .toEqual([['facts', 'fixed_comparison'], ['facts']])
      expect(recovered.focal.comparison_error).toBe(true)
      expect(recovered.focal.resource_reads?.[0]?.data).not.toHaveProperty('dataset_id')
      expect(recovered.focal.resource_reads?.[0]?.data).not.toHaveProperty('theme_id')
      expect(recovered.focal.resource_reads?.[0]?.data).not.toHaveProperty('axis_values')
      expect(recovered.focal.resource_reads?.[0]?.data).not.toHaveProperty('reference_content_version')
      expect(recovered.focal.resource_reads?.[0]?.data.points).toMatchObject([
        { axis: '2024', value: 10, source_id: 'cohort-source', vintage_id: 'cohort-v1',
          source_version: '2026', source_reference_date: '2026-01-01', source_publication_date: '2026-01-02' },
      ])

      comparisonPatch = (data) => { data.content_version = 'stale-series-v0' }
      await expect(cache.select('commune', target.id, 'programmes', undefined)).rejects.toThrow(/publication/i)
      expect((await cache.get('commune', target.id, 'programmes')).comparisons.has('omitted')).toBe(false)

      comparisonPatch = () => {}
      const defaultRetry = await cache.select('commune', target.id, 'programmes', undefined)
      const defaultComparison = defaultRetry.comparisons.get('omitted')
      expect(defaultComparison?.comparison_reads?.[0]?.data.reference_content_version).toBe('legacy-reference-v1')
      expect(defaultRetry.focal).toBe(recovered.focal)
      expect(requests[3]!.items.map((item) => item.intent.kind)).toEqual(['fixed_comparison'])

      const cases: Array<{ name: string; patch: (data: Record<string, any>) => void }> = [
        { name: 'publication', patch: (data) => { data.content_version = 'stale-series-v0' } },
        { name: 'descriptor', patch: (data) => { data.result.descriptor_version = 'stale-descriptor-v0' } },
        { name: 'target', patch: (data) => { data.target.id = 'another-cohort' } },
        { name: 'identity', patch: (data) => { data.indicator_id = 'another-series' } },
        { name: 'reference', patch: (data) => { data.reference_content_version = 'stale-reference-v0' } },
        { name: 'selection', patch: (data) => { data.selection[0]!.territory_id = 'wrong-member' } },
        { name: 'scope', patch: (data) => { data.scope = null } },
      ]
      for (const [index, item] of cases.entries()) {
        const selection = [{ territory_type: 'commune' as const, territory_id: `cohort-c${index + 2}` }]
        const selectionKey = cleSelectionComparaison(selection)
        comparisonPatch = item.patch
        await expect(cache.select('commune', target.id, 'programmes', selection), item.name)
          .rejects.toThrow()
        expect((await cache.get('commune', target.id, 'programmes')).comparisons.has(selectionKey), item.name)
          .toBe(false)

        comparisonPatch = () => {}
        const retried = await cache.select('commune', target.id, 'programmes', selection)
        expect(retried.focal).toBe(recovered.focal)
        expect(retried.comparisons.has(selectionKey), item.name).toBe(true)
      }
      expect(fetcher.mock.calls.filter(([url]) => String(url) === '/api/resources/read-batch')).toHaveLength(18)
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

  it('does not register a legacy comparison after its cached focal generation is invalidated', async () => {
    const declaration = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const target = { kind: 'territory', type: 'commune', id: 'cohort-c1' }
    const selection = [{ territory_type: 'commune' as const, territory_id: 'cohort-c2' }]
    const focal = (publication: string): ThemeResponse => ({
      theme_id: 'programmes',
      resource_reads: [{ resource: declaration.resource_id, shapes: declaration.shapes, declaration,
        data: { resource: declaration.resource_id, target, publication_id: publication,
          territory: { id: target.id, type: target.type, name: 'Cohort one' },
          indicator_id: declaration.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
          label: declaration.label, unit: declaration.unit, direction: declaration.direction,
          descriptor_version: 'legacy-series-descriptor-v1', comparison_point: null,
          points: [], availability: 'no_record' } }],
    } as unknown as ThemeResponse)
    const comparison = (publication: string, reference: string): ThemeResponse => ({
      theme_id: 'programmes', selection,
      comparison_reads: [{ resource: declaration.resource_id, shapes: declaration.shapes, declaration,
        data: { resource: declaration.resource_id, target, contract: 'indicator-comparison-v1',
          complete_theme: false, indicator_id: declaration.indicator_id, shape: 'series',
          content_version: publication, reference_content_version: reference,
          selection: [{ territory_type: 'commune', territory_id: 'cohort-c2' }],
          scope: { kind: 'explicit_selection', member_count: 1 },
          result: { indicator_id: declaration.indicator_id, label: declaration.label, facet: null,
            source_facet: null, unit: declaration.unit, direction: declaration.direction,
            descriptor_version: 'legacy-series-descriptor-v1', status: 'unavailable',
            reason: 'unsupported_comparison_contract', selected_member_count: 1,
            eligible_count: 0, missing_count: 1, median: null, rank: null, comparison_sources: [] } },
      }],
    } as unknown as ThemeResponse)
    let factsCount = 0
    const acquireFacts = vi.fn(async () => focal(factsCount++ === 0 ? 'legacy-publication-v1' : 'legacy-publication-v2'))
    const acquireComparison = vi.fn(async () => factsCount === 1
      ? comparison('legacy-publication-v1', 'legacy-reference-v1')
      : comparison('legacy-publication-v2', 'legacy-reference-v2'))
    const cache = new ThemeAcquisitionCache(acquireFacts, acquireComparison)

    await cache.get('commune', target.id, 'programmes')
    const staleSelection = cache.select('commune', target.id, 'programmes', selection)
    const staleOutcome = expect(staleSelection).rejects.toThrow(/stale/i)
    cache.invalidate('commune', target.id, 'programmes')
    await staleOutcome

    expect(acquireComparison).not.toHaveBeenCalled()
    const fresh = await cache.get('commune', target.id, 'programmes')
    expect(fresh.focal.resource_reads?.[0]?.data.publication_id).toBe('legacy-publication-v2')
    const selected = await cache.select('commune', target.id, 'programmes', selection)
    expect(acquireComparison).toHaveBeenCalledTimes(1)
    expect(selected.focal).toBe(fresh.focal)
    expect(selected.comparisons.get(cleSelectionComparaison(selection))?.comparison_reads?.[0]?.data)
      .toMatchObject({ content_version: 'legacy-publication-v2', reference_content_version: 'legacy-reference-v2' })
  })

  it('does not let an invalidated legacy response poison a replacement entry or its reference anchor', async () => {
    const declaration = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const target = { kind: 'territory', type: 'commune', id: 'cohort-c1' }
    const selection = [{ territory_type: 'commune' as const, territory_id: 'cohort-c2' }]
    const selectionKey = cleSelectionComparaison(selection)
    const focal = (publication: string): ThemeResponse => ({
      theme_id: 'programmes',
      resource_reads: [{ resource: declaration.resource_id, shapes: declaration.shapes, declaration,
        data: { resource: declaration.resource_id, target, publication_id: publication,
          territory: { id: target.id, type: target.type, name: 'Cohort one' },
          indicator_id: declaration.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
          label: declaration.label, unit: declaration.unit, direction: declaration.direction,
          descriptor_version: 'legacy-series-descriptor-v1', comparison_point: null,
          points: [], availability: 'no_record' } }],
    } as unknown as ThemeResponse)
    const comparison = (publication: string, reference: string): ThemeResponse => ({
      theme_id: 'programmes', selection,
      comparison_reads: [{ resource: declaration.resource_id, shapes: declaration.shapes, declaration,
        data: { resource: declaration.resource_id, target, contract: 'indicator-comparison-v1',
          complete_theme: false, indicator_id: declaration.indicator_id, shape: 'series',
          content_version: publication, reference_content_version: reference,
          selection: [{ territory_type: 'commune', territory_id: 'cohort-c2' }],
          scope: { kind: 'explicit_selection', member_count: 1 },
          result: { indicator_id: declaration.indicator_id, label: declaration.label, facet: null,
            source_facet: null, unit: declaration.unit, direction: declaration.direction,
            descriptor_version: 'legacy-series-descriptor-v1', status: 'unavailable',
            reason: 'unsupported_comparison_contract', selected_member_count: 1,
            eligible_count: 0, missing_count: 1, median: null, rank: null, comparison_sources: [] } },
      }],
    } as unknown as ThemeResponse)
    let factsCount = 0
    let resolveOld!: (value: ThemeResponse) => void
    let resolveCurrent!: (value: ThemeResponse) => void
    let signalOldStarted!: () => void
    let signalCurrentStarted!: () => void
    const oldStarted = new Promise<void>((resolve) => { signalOldStarted = resolve })
    const currentStarted = new Promise<void>((resolve) => { signalCurrentStarted = resolve })
    const oldResponse = new Promise<ThemeResponse>((resolve) => { resolveOld = resolve })
    const currentResponse = new Promise<ThemeResponse>((resolve) => { resolveCurrent = resolve })
    let comparisonCount = 0
    const cache = new ThemeAcquisitionCache(
      async () => focal(factsCount++ === 0 ? 'legacy-publication-v1' : 'legacy-publication-v2'),
      () => {
        if (comparisonCount++ === 0) {
          signalOldStarted()
          return oldResponse
        }
        signalCurrentStarted()
        return currentResponse
      },
    )

    await cache.get('commune', target.id, 'programmes')
    const staleSelection = cache.select('commune', target.id, 'programmes', selection)
    const staleOutcome = expect(staleSelection).rejects.toThrow(/stale/i)
    await oldStarted

    cache.invalidate('commune', target.id, 'programmes')
    const fresh = await cache.get('commune', target.id, 'programmes')
    expect(fresh.focal.resource_reads?.[0]?.data.publication_id).toBe('legacy-publication-v2')
    const currentSelection = cache.select('commune', target.id, 'programmes', selection)
    await currentStarted

    resolveOld(comparison('legacy-publication-v1', 'legacy-reference-v1'))
    await staleOutcome
    expect((await cache.get('commune', target.id, 'programmes')).focal).toBe(fresh.focal)
    expect((await cache.get('commune', target.id, 'programmes')).comparisons.has(selectionKey)).toBe(false)

    resolveCurrent(comparison('legacy-publication-v2', 'legacy-reference-v2'))
    const selected = await currentSelection
    expect(selected.focal).toBe(fresh.focal)
    expect(selected.comparisons.get(selectionKey)?.comparison_reads?.[0]?.data)
      .toMatchObject({ content_version: 'legacy-publication-v2', reference_content_version: 'legacy-reference-v2' })
    expect(comparisonCount).toBe(2)
  })

  it('allows an uncached select to finish when only an unrelated theme is invalidated', async () => {
    const acquireFacts = vi.fn(async (theme: string) => ({ theme_id: theme,
      content_version: 'publication-v1', reference_content_version: 'reference-v1' }))
    const acquireComparison = vi.fn(async (_selection: readonly ThemeSelectionMember[] | undefined,
      theme: string) => ({ theme_id: theme,
      content_version: 'publication-v1', reference_content_version: 'reference-v1' }))
    const cache = new ThemeAcquisitionCache(acquireFacts, acquireComparison)

    const selected = cache.select('commune', '22001', 'programmes', undefined)
    cache.invalidate('commune', '22001', 'habitat')
    const result = await selected

    expect(acquireFacts).toHaveBeenCalledTimes(1)
    expect(acquireFacts).toHaveBeenCalledWith('programmes', { type: 'commune', id: '22001', theme: 'programmes' })
    expect(acquireComparison).toHaveBeenCalledTimes(1)
    expect(result.comparisons.get('omitted')?.theme_id).toBe('programmes')
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

  it('binds a matching focal/comparison pair to the target requested by the cache', () => {
    const target = { kind: 'territory', type: 'region', id: '54' }
    const facts = { resource_reads: [{ resource: 'regional_series', shapes: ['ordered_series'], data: {
      resource: 'regional_series', target, dataset_id: 'regional-series-dataset', theme_id: 'mobilite',
      axis_values: ['2024'],
      publication_id: 'series-v1', content_version: 'series-v1', reference_content_version: 'territories-v1',
      territory: { id: '54', type: 'region' }, indicator_id: 'regional_series', axis_kind: 'year', points: [],
      comparison_point: '2024', unit: 'units', direction: 'low', descriptor_version: 'series-descriptor-v1',
    } }] }
    const comparison = { comparison_reads: [{ resource: 'regional_series', shapes: ['ordered_series'], data: {
      resource: 'regional_series', target, contract: 'indicator-comparison-v1', complete_theme: false,
      shape: 'series', indicator_id: 'regional_series', theme_id: 'mobilite', content_version: 'series-v1',
      reference_content_version: 'territories-v1',
      result: { indicator_id: 'regional_series', source_facet: '2024', unit: 'units', direction: 'low',
        owned_content_version: 'series-v1', descriptor_version: 'series-descriptor-v1' },
    } }] }
    expect(semanticPublicationsCompatible(facts, comparison, { type: 'region', id: '54' })).toBe(true)
    expect(semanticPublicationsCompatible(facts, comparison, { type: 'region', id: '53' })).toBe(false)
    const wrongOwner = structuredClone(comparison)
    wrongOwner.comparison_reads[0]!.data.result.owned_content_version = 'another-series-v1'
    expect(semanticPublicationsCompatible(facts, wrongOwner, { type: 'region', id: '54' })).toBe(false)
    const missingOwner = structuredClone(comparison)
    delete (missingOwner.comparison_reads[0]!.data.result as Record<string, unknown>).owned_content_version
    expect(semanticPublicationsCompatible(facts, missingOwner, { type: 'region', id: '54' })).toBe(false)
    const ownerWithoutDatasetIdentity = structuredClone(facts)
    delete (ownerWithoutDatasetIdentity.resource_reads[0]!.data as Record<string, unknown>).dataset_id
    expect(semanticPublicationsCompatible(ownerWithoutDatasetIdentity, comparison,
      { type: 'region', id: '54' })).toBe(false)
    const ownerWithoutReference = structuredClone(facts)
    delete (ownerWithoutReference.resource_reads[0]!.data as Record<string, unknown>).reference_content_version
    expect(semanticPublicationsCompatible(ownerWithoutReference, comparison,
      { type: 'region', id: '54' })).toBe(false)
    const ownerWithoutTheme = structuredClone(facts)
    delete (ownerWithoutTheme.resource_reads[0]!.data as Record<string, unknown>).theme_id
    expect(semanticPublicationsCompatible(ownerWithoutTheme, comparison,
      { type: 'region', id: '54' })).toBe(false)
    const ownerWithoutAxes = structuredClone(facts)
    delete (ownerWithoutAxes.resource_reads[0]!.data as Record<string, unknown>).axis_values
    expect(semanticPublicationsCompatible(ownerWithoutAxes, comparison,
      { type: 'region', id: '54' })).toBe(false)
    const comparisonWithoutTheme = structuredClone(comparison)
    delete (comparisonWithoutTheme.comparison_reads[0]!.data as Record<string, unknown>).theme_id
    expect(semanticPublicationsCompatible(facts, comparisonWithoutTheme,
      { type: 'region', id: '54' })).toBe(false)
  })

  it('validates legacy series against its native envelope without weakening owned-series tokens', () => {
    const resource = nativeResources('programmes').find((candidate) =>
      candidate.resource_id === 'subventions_annuelles')!
    expect(resource.shapes).toContain('ordered_series')
    const target = { kind: 'territory', type: 'commune', id: 'cohort-c1' }
    // Native legacy shape from snapshot_reads._focal_series_snapshot and the
    // subventions_annuelles series_descriptor fixture in test_cohort_facts_http.py:
    // publication_id (not dataset_id), descriptor, axis points, no owner token.
    const focal = { resource: resource.resource_id, target, publication_id: 'cohort-legacy-series-v1',
      territory: { id: target.id, type: target.type, name: 'Cohort one' },
      indicator_id: resource.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
      label: resource.label, unit: resource.unit, direction: 'none',
      descriptor_version: 'cohort-legacy-series-desc-v1', comparison_point: null,
      points: [{ axis: '2024', status: 'measured', observation_period: '2025', value: 10 }],
      availability: 'incomplete' }
    const focalRead = { resource: resource.resource_id, shapes: resource.shapes, data: focal }
    const comparisonRead = (referenceVersion = 'cohort-reference-v1', selection: Array<{ type: string; id: string }> | null = null,
      patch: Record<string, unknown> = {}) => ({ resource: resource.resource_id,
      shapes: resource.shapes, data: { resource: resource.resource_id, target,
        contract: 'indicator-comparison-v1', complete_theme: false,
        indicator_id: resource.indicator_id, shape: 'series', content_version: 'cohort-legacy-series-v1',
        reference_content_version: referenceVersion,
        selection: selection?.map(({ type, id }) => ({ territory_type: type, territory_id: id })) ?? null,
        scope: selection ? { kind: 'explicit_selection', member_count: 1 } : {
          kind: 'density_class', territory_type: 'commune', density_class_code: 'D1', member_count: 2 },
        result: { indicator_id: resource.indicator_id, label: resource.label, facet: null, source_facet: null,
          unit: resource.unit, direction: 'none', descriptor_version: 'cohort-legacy-series-desc-v1',
          status: 'unavailable', reason: 'unsupported_comparison_contract',
          selected_member_count: selection ? 1 : 2, eligible_count: 0, median: null, rank: null,
          comparison_sources: [] }, ...patch } })
    const defaultComparison = { comparison_reads: [comparisonRead()] }
    const facts = { resource_reads: [focalRead], default_comparison: defaultComparison }
    expect(semanticPublicationsCompatible(facts, defaultComparison, target)).toBe(true)

    const selected = (referenceVersion = 'cohort-reference-v1') => ({ comparison_reads: [comparisonRead(
      referenceVersion, [{ type: 'commune', id: 'cohort-c2' }])] })
    expect(semanticPublicationsCompatible(facts, selected(), target)).toBe(true)
    expect(semanticPublicationsCompatible(facts, selected('stale-reference-v0'), target)).toBe(false)
    const wrongPublication = selected()
    wrongPublication.comparison_reads[0]!.data.content_version = 'stale-series-v0'
    expect(semanticPublicationsCompatible(facts, wrongPublication, target)).toBe(false)
    const wrongIdentity = selected()
    wrongIdentity.comparison_reads[0]!.data.indicator_id = 'another-series'
    expect(semanticPublicationsCompatible(facts, wrongIdentity, target)).toBe(false)
    expect(semanticPublicationsCompatible(facts, selected(''), target)).toBe(false)
    const falseOwned = selected()
    const falseOwnedResult = falseOwned.comparison_reads[0]!.data.result as Record<string, unknown>
    falseOwnedResult.owned_content_version = 'cohort-legacy-series-v1'
    expect(semanticPublicationsCompatible(facts, falseOwned, target)).toBe(false)
  })

  it('does not downgrade an owned series when owner and reference tokens are stripped together', async () => {
    const declaration = nativeResources('mobilite').find((resource) =>
      resource.resource_id === 'raccordement_courbe')!
    const target = { kind: 'territory', type: 'region', id: '53' }
    const selection = [{ territory_type: 'region' as const, territory_id: '53' }]
    const focalData = nativeReadFixture({ target, intent: { kind: 'facts' } }, declaration)
    // The native owned reader omits a focal content_version; it carries
    // publication_id, dataset_id, theme_id, axis_values and the reference token.
    delete focalData.content_version
    const defaultData = nativeReadFixture({ target, intent: { kind: 'fixed_comparison', context: 'default' } }, declaration)
    const selectedData = nativeReadFixture({ target,
      intent: { kind: 'selected_comparison', members: [{ type: 'region', id: '53' }] } }, declaration)
    const defaultComparison = { theme_id: 'mobilite' as const,
      comparison_reads: [{ resource: declaration.resource_id, shapes: declaration.shapes, data: defaultData }] }
    const downgradedFacts = { theme_id: 'mobilite' as const,
      resource_reads: [{ resource: declaration.resource_id, shapes: declaration.shapes, declaration,
        data: structuredClone(focalData) }], default_comparison: defaultComparison }
    const downgraded = downgradedFacts.resource_reads[0]!.data as Record<string, any>
    delete downgraded.dataset_id
    delete downgraded.reference_content_version
    const malformedComparison = structuredClone(selectedData)
    delete malformedComparison.result.owned_content_version
    const cache = new ThemeAcquisitionCache(async () => downgradedFacts as unknown as ThemeResponse, async () => ({
      theme_id: 'mobilite' as const,
      selection,
      comparison_reads: [{ resource: declaration.resource_id, shapes: declaration.shapes,
        declaration, data: malformedComparison }],
    } as unknown as ThemeResponse))

    const initial = await cache.get('region', '53', 'mobilite')
    expect(initial.comparisons.has('omitted')).toBe(true)
    await expect(cache.select('region', '53', 'mobilite', selection)).rejects.toThrow(/publication/i)
    expect((await cache.get('region', '53', 'mobilite')).comparisons.size).toBe(1)
  })

  it('binds concurrent legacy reference bootstraps to one territory and one selection snapshot', async () => {
    const declaration = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const target = (id: string) => ({ kind: 'territory', type: 'commune', id })
    const facts = (id: string): ThemeResponse => ({ theme_id: 'programmes' as const, resource_reads: [{
      resource: declaration.resource_id, shapes: declaration.shapes, declaration,
      data: { resource: declaration.resource_id, target: target(id), publication_id: 'legacy-series-v1',
        territory: { id, type: 'commune', name: 'Fixture' }, indicator_id: declaration.indicator_id,
        axis_kind: 'year', completeness: 'may_be_missing', label: declaration.label, unit: declaration.unit,
        direction: declaration.direction, descriptor_version: 'legacy-series-descriptor-v1',
        comparison_point: null, points: [], availability: 'no_record' },
    }] } as unknown as ThemeResponse)
    const response = (id: string, selection: readonly ThemeSelectionMember[], reference: string): ThemeResponse => ({
      theme_id: 'programmes' as const, selection,
      comparison_reads: [{ resource: declaration.resource_id, shapes: declaration.shapes, declaration,
        data: { resource: declaration.resource_id, target: target(id), contract: 'indicator-comparison-v1',
          complete_theme: false, indicator_id: declaration.indicator_id, shape: 'series',
          content_version: 'legacy-series-v1', reference_content_version: reference,
          selection: selection.map(({ territory_type, territory_id }) => ({ territory_type, territory_id })),
          scope: { kind: 'explicit_selection', member_count: 1 },
          result: { indicator_id: declaration.indicator_id, label: declaration.label, facet: null,
            source_facet: null, unit: declaration.unit, direction: declaration.direction,
            descriptor_version: 'legacy-series-descriptor-v1', status: 'unavailable',
            reason: 'unsupported_comparison_contract', selected_member_count: 1,
            eligible_count: 0, missing_count: 1, median: null, rank: null, comparison_sources: [] } },
      }],
    } as unknown as ThemeResponse)
    const pending: Array<(value: ThemeResponse) => void> = []
    const cache = new ThemeAcquisitionCache(
      async (_theme, key) => facts(key!.id),
      () => new Promise((resolve) => pending.push(resolve)),
    )
    const firstSelection = [{ territory_type: 'commune' as const, territory_id: 'cohort-c2' }]
    const secondSelection = [{ territory_type: 'commune' as const, territory_id: 'cohort-c3' }]
    await cache.get('commune', 'cohort-c1', 'programmes')

    const first = cache.select('commune', 'cohort-c1', 'programmes', firstSelection)
    const competing = cache.select('commune', 'cohort-c1', 'programmes', secondSelection)
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[0]!(response('cohort-c1', firstSelection, 'legacy-reference-v1'))
    const firstResult = await first
    pending[1]!(response('cohort-c1', secondSelection, 'raced-reference-v2'))
    await expect(competing).rejects.toThrow(/publication/i)
    expect(firstResult.comparisons.has(cleSelectionComparaison(firstSelection))).toBe(true)
    expect((await cache.get('commune', 'cohort-c1', 'programmes')).comparisons
      .has(cleSelectionComparaison(secondSelection))).toBe(false)

    const retry = cache.select('commune', 'cohort-c1', 'programmes', secondSelection)
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    pending[2]!(response('cohort-c1', secondSelection, 'legacy-reference-v1'))
    expect((await retry).comparisons.has(cleSelectionComparaison(secondSelection))).toBe(true)

    await cache.get('commune', 'cohort-c4', 'programmes')
    const separateTerritory = cache.select('commune', 'cohort-c4', 'programmes', secondSelection)
    await vi.waitFor(() => expect(pending).toHaveLength(4))
    pending[3]!(response('cohort-c4', secondSelection, 'raced-reference-v2'))
    expect((await separateTerritory).comparisons.has(cleSelectionComparaison(secondSelection))).toBe(true)
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
           descriptor_version: 'series-desc-v1', status: 'available', rank: 2, rank_size: 2,
           owned_content_version: 'series-v1' },
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
      content_version: null, profile_content_version: 'profile-v1', reference_content_version: 'territories-v1',
      scalar_content_version: scalarVersion,
      result: { profile_descriptor_version: 'profile-descriptor-v1', required_scalar_version: 'scalar-v3' },
    } }] })
    expect(semanticPublicationsCompatible(facts, comparison('scalar-v3'))).toBe(true)
    expect(semanticPublicationsCompatible(facts, comparison())).toBe(false)
    expect(semanticPublicationsCompatible(facts, comparison('scalar-v2'))).toBe(false)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'distribution_dpe', data: {
      content_version: null, profile_content_version: 'profile-v1', reference_content_version: 'territories-v1',
      scalar_content_version: 'scalar-v3',
      result: { profile_descriptor_version: 'profile-descriptor-v1' },
    } }] })).toBe(false)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'distribution_dpe', data: {
      content_version: 'profile-v1', profile_content_version: 'profile-v1', reference_content_version: 'territories-v1',
      scalar_content_version: 'scalar-v3',
      result: { profile_descriptor_version: 'profile-descriptor-v1', required_scalar_version: 'scalar-v3' },
    } }] })).toBe(true)
    expect(semanticPublicationsCompatible(facts, { comparison_reads: [{ resource: 'distribution_dpe', data: {
      content_version: null, profile_content_version: 'stale-profile-v0', reference_content_version: 'territories-v1',
      scalar_content_version: 'scalar-v3',
      result: { profile_descriptor_version: 'profile-descriptor-v1', required_scalar_version: 'scalar-v3' },
    } }] })).toBe(false)
  })
})

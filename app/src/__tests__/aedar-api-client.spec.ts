import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAedarAggregates, fetchAedarTerritorySummary, invalidateAedarTerritorySummary, validateAedarResponse } from '@/fiche/content/aedarApiClient'
import { AEDAR_TYPEQU_REGISTRY } from '@/fiche/content/aedarTypequRegistry'
import { nativeCatalogueResponse, nativeResources } from './helpers/semanticApiFixtures'

const measureKeys = () => {
  const keys: string[] = []
  for (const duration of [5, 10, 15, 20]) for (const mode of ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car']) {
    for (const statistic of ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, i) => `decile${i + 1}`), 'mean']) {
      keys.push(`count_${duration}_${mode}_${statistic}`)
    }
  }
  return keys
}
const fact = (typequ: string) => ({
  territory_id: '22001', territory_type: 'commune', typequ, typequ_label: `Label ${typequ}`,
  identity: {}, n_addresses: 10, n_observed: 9, coverage_status: 'covered',
  measures: Object.fromEntries(measureKeys().map((key) => [key, null])), source_id: 'source', vintage_id: 'v1',
  source_url: 'https://example.test', licence: 'ODbL', attribution: 'Source attribution',
  reference_date: '2026-01-01', publication_date: '2026-09-30',
})
const response = (facts: unknown[], overrides: Record<string, unknown> = {}) => ({
  territory: { territory_type: 'commune', territory_id: '22001' }, content_version: 'v1',
  reference_content_version: 'v1', limit: 2, offset: 0, facts, ...overrides,
})
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => vi.unstubAllGlobals())

describe('AEDAR API client', () => {
  it('acquires all producer-declared territory summaries in one independent request with all publication clocks', async () => {
    const summaryResource = nativeResources().find((resource) => resource.resource_id === 'aedar_territory_summary')!
    const measures = Object.keys((summaryResource as any).measure_facets)
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') return nativeCatalogueResponse()
      const { items } = JSON.parse(String(init?.body))
      const item = items[0]
      const readings = measures.map((measure, index) => ({
        measure, value: index + 0.25, status: 'available', n_typequ: 235, n_addresses: 10,
        n_observed: 900, coverage_status: 'covered', statistic: 'direct',
        source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
        licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: '2026-09-30',
      }))
      return jsonResponse({ contract: 'semantic-read-batch-v1', results: [{ id: item.id, data: {
        resource: item.resource, target: item.target,
        territory: { territory_type: 'commune', territory_id: '22001' },
        summary_content_version: 'summary-v1', aedar_content_version: 'aedar-v1',
        reference_content_version: 'reference-v1', readings,
      } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAedarTerritorySummary('commune', '22001')

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected summary response')
    expect(result.summary.readings.map(({ measure }) => measure).sort()).toEqual([...measures].sort())
    expect(result.summary.readings.map(({ value }) => value)).toEqual(measures.map((_, index) => index + 0.25))
    expect(result.summary).toMatchObject({ summaryContentVersion: 'summary-v1', aedarContentVersion: 'aedar-v1',
      referenceContentVersion: 'reference-v1', territory: { territory_type: 'commune', territory_id: '22001' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const item = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)).items[0]
    expect(item).toEqual({ id: 'aedar-summary', resource: 'aedar_territory_summary',
      target: { kind: 'territory', type: 'commune', id: '22001' }, intent: { kind: 'facts' } })
    expect(item).not.toHaveProperty('coordinates')
  })

  it.each(['summary_content_version', 'aedar_content_version', 'reference_content_version'] as const)(
    'reacquires a territory summary at the next boundary when %s changes, without manual cache clearing', async (clock) => {
      const measures = Object.keys((nativeResources().find((resource) => resource.resource_id === 'aedar_territory_summary') as any).measure_facets)
      const versions = { summary_content_version: 'summary-v1', aedar_content_version: 'source-v1', reference_content_version: 'reference-v1' }
      const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url) === '/api/resources') return nativeCatalogueResponse()
        const { items } = JSON.parse(String(init?.body))
        const item = items[0]
        return jsonResponse({ contract: 'semantic-read-batch-v1', results: [{ id: item.id, data: {
          resource: item.resource, target: item.target,
          territory: { territory_type: 'commune', territory_id: 'clock-boundary' },
          ...versions,
          readings: measures.map((measure) => ({ measure, value: versions[clock] === `${clock}-v2` ? 2 : 1,
            status: 'available', n_typequ: 235, n_addresses: 10, n_observed: 900, coverage_status: 'covered',
            statistic: 'direct', source_id: 'aedar_bretagne', vintage_id: '2026-v1',
            source_url: 'https://example.test/aedar', licence: 'ODbL', attribution: 'AEDAR',
            reference_date: null, publication_date: '2026-09-30' })),
        } }] })
      })
      vi.stubGlobal('fetch', fetchMock)

      const first = await fetchAedarTerritorySummary('commune', 'clock-boundary')
      versions[clock] = `${clock}-v2`
      const second = await fetchAedarTerritorySummary('commune', 'clock-boundary')

      expect(first.status).toBe('ready')
      expect(second.status).toBe('ready')
      if (first.status !== 'ready' || second.status !== 'ready') throw new Error('Expected ready summaries')
      expect(second.summary).toMatchObject({
        summaryContentVersion: versions.summary_content_version,
        aedarContentVersion: versions.aedar_content_version,
        referenceContentVersion: versions.reference_content_version,
      })
      expect(second.summary.readings[0]?.value).toBe(2)
      expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/resources/read-batch')).toHaveLength(2)
    },
  )

  it('does not let an invalidated late summary response become the next acquisition result', async () => {
    const measures = Object.keys((nativeResources().find((resource) => resource.resource_id === 'aedar_territory_summary') as any).measure_facets)
    const pendingReads: Array<(response: Response) => void> = []
    let readCount = 0
    const responseFor = (item: any, version: string, value: number) => jsonResponse({
      contract: 'semantic-read-batch-v1', results: [{ id: item.id, data: {
        resource: item.resource, target: item.target,
        territory: { territory_type: 'commune', territory_id: 'late-write' },
        summary_content_version: version, aedar_content_version: version, reference_content_version: version,
        readings: measures.map((measure) => ({ measure, value, status: 'available', n_typequ: 235,
          n_addresses: 10, n_observed: 900, coverage_status: 'covered', statistic: 'direct',
          source_id: 'aedar_bretagne', vintage_id: version, source_url: 'https://example.test/aedar',
          licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: '2026-09-30' })),
      } }] })
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(url) === '/api/resources') return Promise.resolve(nativeCatalogueResponse())
      const item = JSON.parse(String(init?.body)).items[0]
      readCount++
      if (readCount <= 2) return new Promise((resolve) => pendingReads.push(resolve))
      return Promise.resolve(responseFor(item, 'summary-v3', 3))
    })
    vi.stubGlobal('fetch', fetchMock)

    const oldRequest = fetchAedarTerritorySummary('commune', 'late-write')
    await vi.waitFor(() => expect(pendingReads).toHaveLength(1))
    invalidateAedarTerritorySummary('commune', 'late-write')
    const currentRequest = fetchAedarTerritorySummary('commune', 'late-write')
    await vi.waitFor(() => expect(pendingReads).toHaveLength(2))

    pendingReads[1]!(responseFor(JSON.parse(String(fetchMock.mock.calls[2]![1]?.body)).items[0], 'summary-v2', 2))
    const current = await currentRequest
    pendingReads[0]!(responseFor(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)).items[0], 'summary-v1', 1))
    await oldRequest
    const next = await fetchAedarTerritorySummary('commune', 'late-write')

    expect(current).toMatchObject({ status: 'ready', summary: { summaryContentVersion: 'summary-v2' } })
    expect(next).toMatchObject({ status: 'ready', summary: { summaryContentVersion: 'summary-v3' } })
    expect(readCount).toBe(3)
  })

  it('rejects incomplete, stale-clock, and inconsistent-provenance summaries and retries independently', async () => {
    const measures = Object.keys((nativeResources().find((resource) => resource.resource_id === 'aedar_territory_summary') as any).measure_facets)
    let scenario: 'incomplete' | 'missing-source-clock' | 'inconsistent-provenance' | 'ok' = 'incomplete'
    let retryNetworkFailure = true
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') return nativeCatalogueResponse()
      const { items } = JSON.parse(String(init?.body))
      if (retryNetworkFailure) { retryNetworkFailure = false; return new Response('', { status: 503 }) }
      const readings = measures.map((measure) => ({ measure, value: 1, status: 'available', n_typequ: 235,
        n_addresses: 10, n_observed: 900, coverage_status: 'covered', statistic: 'direct',
        source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
        licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: '2026-09-30' }))
      if (scenario === 'incomplete') readings.pop()
      if (scenario === 'inconsistent-provenance') readings[1]!.vintage_id = 'other'
      return jsonResponse({ contract: 'semantic-read-batch-v1', results: [{ id: items[0].id, data: {
        resource: items[0].resource, target: items[0].target,
        territory: { territory_type: 'commune', territory_id: '22001' },
        summary_content_version: 'summary-v1', aedar_content_version: scenario === 'missing-source-clock' ? '' : 'aedar-v1',
        reference_content_version: 'reference-v1', readings,
      } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchAedarTerritorySummary('commune', '22001')).toMatchObject({ status: 'error', error: { code: 'publication-unavailable' } })
    expect(await fetchAedarTerritorySummary('commune', '22001')).toMatchObject({ status: 'error', error: { code: 'invalid-response' } })
    scenario = 'missing-source-clock'
    expect(await fetchAedarTerritorySummary('commune', '22001')).toMatchObject({ status: 'error' })
    scenario = 'inconsistent-provenance'
    expect(await fetchAedarTerritorySummary('commune', '22001')).toMatchObject({ status: 'error' })
    scenario = 'ok'
    expect((await fetchAedarTerritorySummary('commune', '22001')).status).toBe('ready')
    const callsBeforeRetry = fetchMock.mock.calls.length
    invalidateAedarTerritorySummary('commune', '22001')
    expect((await fetchAedarTerritorySummary('commune', '22001')).status).toBe('ready')
    expect(fetchMock.mock.calls.length).toBe(callsBeforeRetry + 1)
  })

  it('retains a valid covered zero and rejects impossible support', async () => {
    const measures = Object.keys((nativeResources().find((resource) => resource.resource_id === 'aedar_territory_summary') as any).measure_facets)
    let invalidSupport = false
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') return nativeCatalogueResponse()
      const { items } = JSON.parse(String(init?.body))
      const readings = measures.map((measure) => ({ measure, value: 0, status: 'available', n_typequ: 235,
        n_addresses: 10, n_observed: invalidSupport ? 2351 : 0, coverage_status: 'covered', statistic: 'direct',
        source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
        licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: '2026-09-30' }))
      return jsonResponse({ contract: 'semantic-read-batch-v1', results: [{ id: items[0].id, data: {
        resource: items[0].resource, target: items[0].target,
        territory: { territory_type: 'commune', territory_id: '22001' }, summary_content_version: 'summary-v1',
        aedar_content_version: 'aedar-v1', reference_content_version: 'reference-v1', readings,
      } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const zero = await fetchAedarTerritorySummary('commune', '22001')
    expect(zero.status === 'ready' && zero.summary.readings.every((reading) => reading.value === 0)).toBe(true)
    invalidateAedarTerritorySummary('commune', '22001')
    invalidSupport = true
    expect(await fetchAedarTerritorySummary('commune', '22001')).toMatchObject({ status: 'error', error: { code: 'invalid-response' } })
  })

  it('accepts unavailable readings before available readings when their shared support is consistent', async () => {
    const measures = Object.keys((nativeResources().find((resource) => resource.resource_id === 'aedar_territory_summary') as any).measure_facets)
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/resources') return nativeCatalogueResponse()
      const { items } = JSON.parse(String(init?.body))
      const readings = measures.map((measure, index) => ({ measure,
        value: index === 0 ? null : 1,
        status: index === 0 ? 'unavailable' : 'available',
        n_typequ: index === 0 ? null : 235,
        n_addresses: 2, n_observed: 235, coverage_status: 'covered', statistic: 'direct',
        source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
        licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: '2026-09-30',
      }))
      return jsonResponse({ contract: 'semantic-read-batch-v1', results: [{ id: items[0].id, data: {
        resource: items[0].resource, target: items[0].target,
        territory: { territory_type: 'commune', territory_id: '22001' },
        summary_content_version: 'summary-v1', aedar_content_version: 'aedar-v1',
        reference_content_version: 'reference-v1', readings,
      } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAedarTerritorySummary('commune', '22001')

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected a valid mixed-availability summary')
    expect(result.summary.readings[0]).toMatchObject({ status: 'unavailable', n_typequ: null })
    expect(result.summary.readings[1]).toMatchObject({ status: 'available', n_typequ: 235 })
  })

  it('reads selected equipment through the semantic resource API, not the retired GET route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      contract: 'semantic-read-batch-v1',
      results: [{ id: 'aedar-0', data: {
        resource: 'aedar_territorial_aggregate',
        target: { kind: 'territory', type: 'commune', id: '22001' },
        ...response([fact('B207')], { limit: 100 }),
      } }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAedarAggregates('commune', '22001', { typequ: ['B207'] })

    expect(result).toMatchObject({ status: 'ready', facts: [{ typequ: 'B207' }] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/resources/read-batch')
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(init.body)).toEqual({ items: [{
      id: 'aedar-0', resource: 'aedar_territorial_aggregate',
      target: { kind: 'territory', type: 'commune', id: '22001' },
      intent: { kind: 'facts' }, coordinates: { typequ: ['B207'] },
    }] })
  })

  it('projects only selected measure columns and validates exactly that projection', async () => {
    const measures = ['count_15_car_share', 'count_15_car_mean']
    const projectedFact = { ...fact('B207'), measures: Object.fromEntries(measures.map((key) => [key, null])) }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      contract: 'semantic-read-batch-v1',
      results: [{ id: 'aedar-0', data: { resource: 'aedar_territorial_aggregate',
        target: { kind: 'territory', type: 'commune', id: '22001' }, ...response([projectedFact], { limit: 100 }) } }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchAedarAggregates('commune', '22001', { typequ: ['B207'], measures })
    expect(result).toMatchObject({ status: 'ready' })
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.items[0]).toMatchObject({ coordinates: { typequ: ['B207'] }, fields: measures.map((key) => `measures.${key}`) })
  })

  it('splits projections at the semantic 32-field limit and merges only compatible responses', async () => {
    const measures = measureKeys().slice(0, 40)
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const item = JSON.parse(init.body as string).items[0]
      const selected = item.fields.map((field: string) => field.slice('measures.'.length))
      const source = fact('B207')
      const projected = { ...source, measures: Object.fromEntries(selected.map((key: string) => [key, source.measures[key]])) }
      return Promise.resolve(jsonResponse({ contract: 'semantic-read-batch-v1', results: [{ id: item.id, data: {
        resource: item.resource, target: item.target, ...response([projected], { limit: 100 }),
      } }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchAedarAggregates('commune', '22001', { typequ: ['B207'], measures })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(Object.keys(result.facts[0]!.measures)).toHaveLength(40)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).items[0].fields.length)).toEqual([32, 8])
  })

  it.each(['typequ_label', 'identity', 'n_addresses', 'n_observed', 'coverage_status', 'source_id', 'vintage_id',
    'source_url', 'licence', 'attribution', 'reference_date', 'publication_date'] as const)(
    'rejects projected chunks with incompatible producer %s metadata', async (key) => {
      const measures = measureKeys().slice(0, 40)
      const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const item = JSON.parse(init.body as string).items[0]
        const selected = item.fields.map((field: string) => field.slice('measures.'.length))
        const source = { ...fact('B207'), territory_id: item.target.id }
        const dataFact: Record<string, unknown> = { ...source,
          measures: Object.fromEntries(selected.map((measure: string) => [measure, source.measures[measure]])) }
        if (item.fields.length === 8) {
          if (key === 'identity') dataFact.identity = { changed: 'value' }
          else if (key === 'n_addresses' || key === 'n_observed') dataFact[key] = 11
          else if (key === 'coverage_status') dataFact[key] = 'partial'
          else if (key.endsWith('_date')) dataFact[key] = '2025-01-01'
          else dataFact[key] = `changed-${key}`
        }
        return Promise.resolve(jsonResponse({ contract: 'semantic-read-batch-v1', results: [{ id: item.id, data: {
          resource: item.resource, target: item.target, ...response([dataFact], {
            limit: 100, territory: { territory_type: 'commune', territory_id: item.target.id },
          }),
        } }] }))
      })
      vi.stubGlobal('fetch', fetchMock)
      expect(await fetchAedarAggregates('commune', `metadata-${key}`, { typequ: ['B207'], measures }))
        .toMatchObject({ status: 'error', error: { code: 'invalid-response' } })
    })

  it('keeps expected publication versions in local cache identity and rejects a read from another version', async () => {
    const measures = ['count_15_car_min']
    const source = { ...fact('B207'), territory_id: 'expected-version', measures: { count_15_car_min: 1 } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      contract: 'semantic-read-batch-v1',
      results: [{ id: 'aedar-0', data: { resource: 'aedar_territorial_aggregate',
        target: { kind: 'territory', type: 'commune', id: 'expected-version' },
        ...response([source], { limit: 100, territory: { territory_type: 'commune', territory_id: 'expected-version' } }) } }],
    })))
    expect(await fetchAedarAggregates('commune', 'expected-version', {
      typequ: ['B207'], measures, expectedContentVersion: 'v2', expectedReferenceContentVersion: 'r2',
    })).toMatchObject({ status: 'error', error: { code: 'invalid-response' } })
  })

  it('reuses successful reads for the same territory and TYPEQU selection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      contract: 'semantic-read-batch-v1',
      results: [{ id: 'aedar-0', data: {
        resource: 'aedar_territorial_aggregate',
        target: { kind: 'territory', type: 'commune', id: 'cache-id' },
        ...response([{ ...fact('B207'), territory_id: 'cache-id' }], {
          territory: { territory_type: 'commune', territory_id: 'cache-id' }, limit: 100,
        }),
      } }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchAedarAggregates('commune', 'cache-id', { typequ: ['B207'] })
    const second = await fetchAedarAggregates('commune', 'cache-id', { typequ: ['B207'] })

    expect(first).toMatchObject({ status: 'ready' })
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the complete 235-type universe in bounded items on one semantic batch snapshot', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const { items } = JSON.parse(init.body as string)
      return Promise.resolve(jsonResponse({ contract: 'semantic-read-batch-v1', results: items.map((item: {
        id: string; coordinates: { typequ: string[] }
      }) => ({ id: item.id, data: {
        resource: 'aedar_territorial_aggregate',
        target: { kind: 'territory', type: 'commune', id: '22001' },
        ...response(item.coordinates.typequ.map(fact), { limit: 100 }),
      } })).reverse() }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchAedarAggregates('commune', '22001')
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.facts).toHaveLength(235)
      expect(new Set(result.facts.map((item) => item.typequ))).toEqual(new Set(AEDAR_TYPEQU_REGISTRY.map(({ code }) => code)))
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/resources/read-batch')
    const { items } = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(items.map((item: { coordinates: { typequ: string[] } }) => item.coordinates.typequ.length)).toEqual([100, 100, 35])
  })

  it('rejects a response for another territory', () => {
    expect(() => validateAedarResponse(response([], { territory: { territory_type: 'epci', territory_id: '22001' } }),
      { territory_type: 'commune', territory_id: '22001' })).toThrow()
  })

  it.each(['content_version', 'reference_content_version'] as const)(
    'fails closed when TYPEQU partitions disagree on %s', async (versionKey) => {
      const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const { items } = JSON.parse(init.body as string)
        return Promise.resolve(jsonResponse({ contract: 'semantic-read-batch-v1', results: items.map((item: {
          id: string; coordinates: { typequ: string[] }
        }, index: number) => ({ id: item.id, data: {
          resource: 'aedar_territorial_aggregate', target: { kind: 'territory', type: 'commune', id: 'version-id' },
          ...response(item.coordinates.typequ.map(fact), {
            limit: 100,
            territory: { territory_type: 'commune', territory_id: 'version-id' },
            ...(index === 1 ? { [versionKey]: 'new-publication' } : {}),
          }),
        } })) }))
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await fetchAedarAggregates('commune', 'version-id')

      expect(result).toMatchObject({ status: 'error', error: { code: 'invalid-response' } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

  it.each(['missing', 'extra'] as const)('rejects %s measure keys', (change) => {
    const measures = { ...fact('A').measures }
    if (change === 'missing') delete measures[measureKeys()[0]!]
    else measures.extra = null
    expect(() => validateAedarResponse(response([{ ...fact('A'), measures }]),
      { territory_type: 'commune', territory_id: '22001' })).toThrow()
  })

  it('accepts distinct content and reference content versions', () => {
    // The API returns content_version (AEDAR table's own version) and
    // reference_content_version (territory_reference table's version) — they differ by design.
    expect(() => validateAedarResponse(response([], { reference_content_version: 'v2' }),
      { territory_type: 'commune', territory_id: '22001' })).not.toThrow()
  })

  it.each(['content_version', 'reference_content_version'] as const)('rejects empty %s', (field) => {
    expect(() => validateAedarResponse(response([], { [field]: '' }),
      { territory_type: 'commune', territory_id: '22001' })).toThrow()
  })

  it.each([[404, 'unknown-territory'], [503, 'publication-unavailable']] as const)(
    'returns an honest error for HTTP %i', async (status, code) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))
      const result = await fetchAedarAggregates('commune', `http-${status}`)
      expect(result).toMatchObject({ status: 'error', error: { code } })
    })

  it('returns a retryable network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await fetchAedarAggregates('commune', 'network-error')).toMatchObject({
      status: 'error', error: { code: 'network' },
    })
  })

  it('does not cache failed reads, so a retry can recover', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({
        contract: 'semantic-read-batch-v1',
        results: [{ id: 'aedar-0', data: {
          resource: 'aedar_territorial_aggregate',
          target: { kind: 'territory', type: 'commune', id: 'retry-id' },
          ...response([{ ...fact('B207'), territory_id: 'retry-id' }], {
            territory: { territory_type: 'commune', territory_id: 'retry-id' }, limit: 100,
          }),
        } }],
      }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchAedarAggregates('commune', 'retry-id', { typequ: ['B207'] }))
      .toMatchObject({ status: 'error', error: { code: 'publication-unavailable' } })
    expect(await fetchAedarAggregates('commune', 'retry-id', { typequ: ['B207'] })).toMatchObject({ status: 'ready' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAedarAggregates, validateAedarResponse } from '@/fiche/content/aedarApiClient'
import { AEDAR_TYPEQU_REGISTRY } from '@/fiche/content/aedarTypequRegistry'

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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAedarAggregates, validateAedarResponse } from '@/fiche/content/aedarApiClient'

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
  identity: {}, n_addresses: 10, n_observed: 9, coverage_status: 'complete',
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
  it('accumulates multiple pages and stops at a short page', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(response([fact('A'), fact('B')])))
      .mockResolvedValueOnce(jsonResponse(response([fact('C')], { offset: 2 })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchAedarAggregates('commune', '22001', { limit: 2 })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.facts.map((item) => item.typequ)).toEqual(['A', 'B', 'C'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/aedar/territories/commune/22001/aggregates?limit=2&offset=0',
      '/api/aedar/territories/commune/22001/aggregates?limit=2&offset=2',
    ])
  })

  it('rejects a response for another territory', () => {
    expect(() => validateAedarResponse(response([], { territory: { territory_type: 'epci', territory_id: '22001' } }),
      { territory_type: 'commune', territory_id: '22001' })).toThrow()
  })

  it.each(['missing', 'extra'] as const)('rejects %s measure keys', (change) => {
    const measures = { ...fact('A').measures }
    if (change === 'missing') delete measures[measureKeys()[0]!]
    else measures.extra = null
    expect(() => validateAedarResponse(response([{ ...fact('A'), measures }]),
      { territory_type: 'commune', territory_id: '22001' })).toThrow()
  })

  it('rejects mismatched content versions', () => {
    expect(() => validateAedarResponse(response([], { reference_content_version: 'v2' }),
      { territory_type: 'commune', territory_id: '22001' })).toThrow()
  })

  it.each([[404, 'unknown-territory'], [503, 'publication-unavailable']] as const)(
    'returns an honest error for HTTP %i', async (status, code) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))
      const result = await fetchAedarAggregates('commune', '22001')
      expect(result).toMatchObject({ status: 'error', error: { code } })
    })

  it('returns a retryable network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await fetchAedarAggregates('commune', '22001')).toMatchObject({
      status: 'error', error: { code: 'network' },
    })
  })
})

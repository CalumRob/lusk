import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSemanticBatch } from '@/payload/semanticResourceClient'

afterEach(() => vi.unstubAllGlobals())
const item = { resource: 'densite', target: { kind: 'territory' as const, type: 'commune' as const, id: '22001' }, intent: { kind: 'facts' as const }, fields: ['value'] }
const result = (id = 'semantic-0', value = 42, resource = 'densite') => ({ id, data: { resource, target: item.target, status: 'measured', value } })

describe('semantic resource reader', () => {
  it('uses the bounded semantic batch contract and correlates results independently of response order', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: [result('semantic-1', 9, 'taille_menages'), result()] })))
    const batch = [item, { ...item, resource: 'taille_menages' }]
    const rows = await readSemanticBatch(batch, fetcher)
    expect(fetcher.mock.calls[0]![0]).toBe('/api/resources/read-batch')
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).items).toMatchObject([
      { id: 'semantic-0', resource: 'densite', fields: ['value'] }, { id: 'semantic-1', resource: 'taille_menages' },
    ])
    expect(rows.map((row) => row.resource)).toEqual(['densite', 'taille_menages'])
    expect(rows[0]?.value).toBe(42)
    expect(rows[1]?.value).toBe(9)
  })

  it('deduplicates concurrent requests and retries failures without caching them', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: [result()] })))
    const [a, b] = await Promise.all([readSemanticBatch([item], fetcher), readSemanticBatch([item], fetcher)])
    expect(a).toBe(b)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid correlation and never caches unsuccessful reads', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: [result('wrong')] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: [result()] })))
    await expect(readSemanticBatch([item], fetcher)).rejects.toThrow(/correlation/i)
    expect((await readSemanticBatch([item], fetcher))[0]?.value).toBe(42)
  })
})

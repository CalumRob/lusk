import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireRessourcesBatch } from '../payload/semanticResourceClient'
import type { SemanticReadItem } from '../payload/semanticResourceClient'

afterEach(() => vi.unstubAllGlobals())

describe('semantic read batches', () => {
  it('pairs repeated resources by unique item identity, regardless of response order', async () => {
    const facts: SemanticReadItem = {
      resource: 'densite',
      target: { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null },
      intent: { kind: 'facts' },
    }
    const comparison: SemanticReadItem = {
      resource: 'densite',
      target: { kind: 'territory', type: 'commune', id: '22001' },
      fields: ['rank', 'rank_size'],
      intent: { kind: 'fixed_comparison', context: 'default' },
    }
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { items: Array<SemanticReadItem & { id: string }> }
      expect(new Set(request.items.map((item) => item.id)).size).toBe(2)
      expect(request.items.map((item) => item.resource)).toEqual(['densite', 'densite'])
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: [
        { id: request.items[1]!.id, resource: 'densite', data: { resource: 'densite', target: comparison.target, reading: 'rank' } },
        { id: request.items[0]!.id, resource: 'densite', data: { resource: 'densite', target: facts.target, reading: 'facts' } },
      ] }))
    })
    vi.stubGlobal('fetch', fetcher)

    await expect(lireRessourcesBatch([facts, comparison])).resolves.toEqual([
      expect.objectContaining({ reading: 'facts' }),
      expect.objectContaining({ reading: 'rank' }),
    ])
  })

  it('rejects a batch item whose echoed target does not match its request', async () => {
    const item: SemanticReadItem = {
      resource: 'densite', target: { kind: 'territory', type: 'commune', id: '22001' },
      intent: { kind: 'fixed_comparison', context: 'default' },
    }
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { items: Array<SemanticReadItem & { id: string }> }
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: [{
        id: request.items[0]!.id, resource: 'densite',
        data: { resource: 'densite', target: { ...item.target, id: '22002' } },
      }] }))
    }))

    await expect(lireRessourcesBatch([item])).rejects.toThrow('cible')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { chargerCatalogueRessources, lireRessourcesBatch } from '../payload/semanticResourceClient'
import type { SemanticReadItem } from '../payload/semanticResourceClient'

afterEach(() => vi.unstubAllGlobals())

describe('semantic read batches', () => {
  it('accepts native producer discovery with an unthemed AEDAR resource beside a scalar', async () => {
    const catalogue = { contract: 'semantic-resource-catalogue-v1', resources: [
      { resource_id: 'aedar_territorial_aggregate', theme_id: '', indicator_id: 'aedar_territorial_aggregate',
        label: 'AEDAR territorial aggregates', unit: '', direction: 'none',
        allowed_levels: ['commune', 'epci', 'departement', 'region'], sources: [],
        shapes: ['aedar_source_grain'], axes: ['typequ', 'measure', 'context'], axis_values: [],
        target_kinds: ['territory'], target_ids: [], dynamic_axes: [], fields: ['group_value', 'value'],
        intents: ['facts', 'fixed_comparison'], resource_kind: 'aedar_source_grain',
        context_values: ['density_class', 'epci', 'bretagne', 'same_level'], evidence: [] },
      { resource_id: 'densite', theme_id: 'demographie', indicator_id: 'densite', label: 'Densité', unit: 'hab/km²',
        direction: 'high', allowed_levels: ['commune'], sources: ['serie_historique'], shapes: ['scalar'],
        axes: [], axis_values: [], target_kinds: ['territory', 'territory_cohort'], target_ids: [], dynamic_axes: [],
        fields: ['value', 'support_count', 'denominator_count'],
        intents: ['facts', 'fixed_comparison', 'selected_comparison'], resource_kind: 'scalar',
        context_values: [], evidence: [] },
    ] }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(catalogue)))
    vi.stubGlobal('fetch', fetcher)

    await expect(chargerCatalogueRessources()).resolves.toEqual(catalogue.resources)
    expect(fetcher).toHaveBeenCalledWith('/api/resources')
  })

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

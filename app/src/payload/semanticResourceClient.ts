/** Typed transport for the producer-derived semantic resource contract. */
export type SemanticTarget = { kind: 'territory'; type: 'commune' | 'epci' | 'departement' | 'region'; id: string }
export type SemanticIntent = { kind: 'facts' } | { kind: 'fixed_comparison'; context: string } |
  { kind: 'selected_comparison'; members: Array<{ type: SemanticTarget['type']; id: string }> }
export interface SemanticReadItem {
  resource: string
  target: SemanticTarget
  intent: SemanticIntent
  coordinates?: Record<string, string[]>
  fields?: string[]
}
export interface SemanticResult { resource: string; target: SemanticTarget; [key: string]: unknown }
export type SemanticFetch = (items: readonly SemanticReadItem[]) => Promise<SemanticResult[]>

const caches = new WeakMap<typeof fetch, { pending: Map<string, Promise<SemanticResult[]>>; values: Map<string, SemanticResult[]> }>()
function cacheFor(fetcher: typeof fetch) {
  let cache = caches.get(fetcher)
  if (!cache) { cache = { pending: new Map(), values: new Map() }; caches.set(fetcher, cache) }
  return cache
}

/** Clear successful semantic reads so a publication mismatch can be retried against a fresh snapshot. */
export function invalidateSemanticReadCache(fetcher: typeof fetch = globalThis.fetch): void {
  const cache = caches.get(fetcher)
  cache?.values.clear()
}

/** Correlates by request id (not response order), validates identity, deduplicates and caches success only. */
export async function readSemanticBatch(items: readonly SemanticReadItem[], fetcher: typeof fetch = globalThis.fetch): Promise<SemanticResult[]> {
  if (!items.length || items.length > 12) throw new Error('Semantic batch must contain 1 to 12 items')
  const key = JSON.stringify(items)
  const cache = cacheFor(fetcher)
  if (cache.values.has(key)) return cache.values.get(key)!
  const pending = cache.pending.get(key)
  if (pending) return pending
  const request = (async () => {
    const response = await fetcher('/api/resources/read-batch', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((item, index) => ({ id: `semantic-${index}`, ...item })) }) })
    if (!response.ok) throw new Error(`Semantic resource read failed (HTTP ${response.status})`)
    const body: unknown = await response.json()
    if (!isRecord(body) || body.contract !== 'semantic-read-batch-v1' || !Array.isArray(body.results) || body.results.length !== items.length) {
      throw new Error('Incompatible semantic resource batch response')
    }
    const byId = new Map<string, unknown>()
    for (const result of body.results) {
      if (!isRecord(result) || typeof result.id !== 'string' || byId.has(result.id) || !/^semantic-\d+$/.test(result.id)) {
        throw new Error('Invalid semantic resource result correlation')
      }
      byId.set(result.id, result.data)
    }
    const mapped = items.map((item, index) => {
      const data = byId.get(`semantic-${index}`)
      if (!isRecord(data) || data.resource !== item.resource || !isRecord(data.target) ||
          data.target.kind !== 'territory' || data.target.type !== item.target.type || data.target.id !== item.target.id) {
        throw new Error('Semantic resource result identity mismatch')
      }
      return data as SemanticResult
    })
    cache.values.set(key, mapped)
    while (cache.values.size > 16) cache.values.delete(cache.values.keys().next().value!)
    return mapped
  })()
  cache.pending.set(key, request)
  try { return await request } finally { if (cache.pending.get(key) === request) cache.pending.delete(key) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

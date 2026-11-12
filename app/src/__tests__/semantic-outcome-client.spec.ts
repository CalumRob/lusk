import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  groupSemanticItems,
  invalidateSemanticReads,
  invalidateSemanticReadsForTarget,
  lireRessourcesBatch,
  parseSemanticBatchOutcomes,
  readSemanticOutcomes,
  semanticItemKey,
  semanticReadState,
  SemanticMemberError,
  SemanticPublicationUnavailableError,
  SemanticReadSupersededError,
} from '../payload/semanticResourceClient'
import type { SemanticReadItem } from '../payload/semanticResourceClient'
import { PayloadError } from '../payload/validate'

const item = (resource: string, overrides: Partial<SemanticReadItem> = {}): SemanticReadItem => ({
  resource,
  target: { kind: 'territory', type: 'commune', id: '22001' },
  intent: { kind: 'facts' },
  ...overrides,
})

type WireItem = SemanticReadItem & { id: string }

const bodyOf = (call: unknown[]): { contract: string; items: WireItem[] } =>
  JSON.parse(String((call[1] as RequestInit).body)) as { contract: string; items: WireItem[] }

const availableWire = (entry: WireItem, version = 'v1', value = 1) => ({
  id: entry.id,
  resource: entry.resource,
  status: 'available' as const,
  data: { resource: entry.resource, target: entry.target, content_version: version,
    reference_content_version: 'ref-v1', value },
})

const unavailableWire = (entry: WireItem, family = 'scalar') => ({
  id: entry.id,
  resource: entry.resource,
  status: 'publication_unavailable' as const,
  reason: 'publication_absent' as const,
  family,
})

const respond = (make: (entry: WireItem, index: number) => unknown) =>
  vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { items: WireItem[] }
    return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
      results: body.items.map((entry, index) => make(entry, index)) }))
  })

beforeEach(() => { vi.restoreAllMocks() })

describe('shared semantic outcome client', () => {
  it('posts one v2 request and returns one correlated outcome per item, in request order', async () => {
    const fetcher = respond((entry) => entry.resource === 'structure_age'
      ? unavailableWire(entry, 'profile') : availableWire(entry))
    const outcomes = await readSemanticOutcomes([item('densite'), item('structure_age')], { fetcher })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetcher.mock.calls[0]!).contract).toBe('semantic-read-batch-v2')
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['available', 'publication_unavailable'])
    expect(outcomes[0]).toMatchObject({ resource: 'densite', status: 'available' })
    expect(outcomes[1]).toMatchObject({ resource: 'structure_age', status: 'publication_unavailable',
      reason: 'publication_absent', family: 'profile' })
    if (outcomes[1]!.status !== 'publication_unavailable') throw new Error('expected unavailable')
    expect('data' in outcomes[1]).toBe(false)
  })

  it('offers the unchanged data payload only for available items', async () => {
    const fetcher = respond((entry) => availableWire(entry, 'pub-1', 42))
    const [outcome] = await readSemanticOutcomes([item('densite')], { fetcher })
    if (outcome!.status !== 'available') throw new Error('expected available')
    expect(outcome.data).toEqual({ resource: 'densite', target: item('densite').target,
      content_version: 'pub-1', reference_content_version: 'ref-v1', value: 42 })
  })

  it('rejects a v1 envelope instead of falling back to the bridge contract', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      contract: 'semantic-read-batch-v1',
      results: [{ id: 'semantic-0-densite', data: { resource: 'densite',
        target: { kind: 'territory', type: 'commune', id: '22001' } } }],
    })))
    await expect(readSemanticOutcomes([item('densite')], { fetcher })).rejects.toMatchObject({
      kind: 'validation', file: '/api/resources/read-batch',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps a typed HTTP 503 a whole-request failure, never a publication outcome', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 }))
    const failure = await readSemanticOutcomes([item('densite')], { fetcher }).catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(PayloadError)
    expect((failure as PayloadError).status).toBe(503)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps a named member 404/422 typed and hard', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      detail: 'selected comparison member commune/35238 is unknown',
    }), { status: 422 }))
    const failure = await readSemanticOutcomes([item('densite')], { fetcher }).catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(SemanticMemberError)
    expect(failure).toMatchObject({ status: 422, member: { type: 'commune', id: '35238' } })
  })
})

describe('strict v2 outcome parsing', () => {
  const requests: SemanticReadItem[] = [item('densite'), item('structure_age')]
  const envelope = (results: unknown[]) => ({ contract: 'semantic-read-batch-v2', results })
  const availableResult = (request: SemanticReadItem, id: string) => ({
    id, resource: request.resource, status: 'available',
    data: { resource: request.resource, target: request.target, content_version: 'v1' },
  })
  const unavailableResult = (request: SemanticReadItem, id: string) => ({
    id, resource: request.resource, status: 'publication_unavailable',
    reason: 'publication_absent', family: 'profile',
  })
  const both = () => [
    availableResult(requests[0]!, 'semantic-0-densite'),
    unavailableResult(requests[1]!, 'semantic-1-structure_age'),
  ]

  const rejects = (raw: unknown, message: RegExp) =>
    expect(() => parseSemanticBatchOutcomes(raw, requests)).toThrow(message)

  it('accepts exactly one outcome per item with an exact ordered identity', () => {
    const parsed = parseSemanticBatchOutcomes(envelope(both()), requests)
    expect(parsed.map((outcome) => outcome.resource)).toEqual(['densite', 'structure_age'])
  })

  it('rejects a missing, extra or reordered result', () => {
    rejects(envelope(both().slice(0, 1)), /incompatible/)
    rejects(envelope([...both(), both()[0]]), /incompatible/)
    rejects(envelope([both()[1], both()[0]]), /corrélation/)
  })

  it('rejects a duplicated or foreign result identity', () => {
    const [first, second] = both()
    rejects(envelope([first, { ...second, resource: 'rzfe' }]), /corrélation/)
    rejects(envelope([{ ...first, id: 'someone-else' }, second]), /corrélation/)
  })

  it('rejects a resource or target that does not echo the request', () => {
    const [first, second] = both()
    const availableFirst = first as unknown as { data: Record<string, unknown> }
    rejects(envelope([{ ...first, resource: 'autre' }, second]), /corrélation/)
    rejects(envelope([{ ...first, data: { ...availableFirst.data,
      target: { kind: 'territory', type: 'commune', id: '99999' } } }, second]), /cible/)
    rejects(envelope([{ ...first, data: { ...availableFirst.data,
      target: { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null } } }, second]), /cible/)
  })

  it('rejects an unknown status, family or reason', () => {
    const [first, second] = both()
    rejects(envelope([{ ...first, status: 'missing' }, second]), /état inconnu/)
    rejects(envelope([first, { ...second, family: 'mystery' }]), /hors contrat/)
    rejects(envelope([first, { ...second, reason: 'retry_later' }]), /hors contrat/)
  })

  it('rejects data or an invented version on an unavailable outcome', () => {
    const [first, second] = both()
    rejects(envelope([first, { ...second, data: { value: 0 } }]), /invente/)
    rejects(envelope([first, { ...second, content_version: 'v1' }]), /invente/)
    rejects(envelope([first, { ...second, reference_content_version: 'r1' }]), /invente/)
    rejects(envelope([first, { ...second, descriptor_version: 'd1' }]), /invente/)
    rejects(envelope([first, { ...second, version: 'v1' }]), /invente/)
  })

  it('rejects a publication state carried by an available outcome', () => {
    const [first, second] = both()
    rejects(envelope([{ ...first, reason: 'publication_absent' }, second]), /état de publication/)
    rejects(envelope([{ ...first, family: 'scalar' }, second]), /état de publication/)
  })
})

describe('semantic item identity and grouping', () => {
  it('distinguishes intent, selection, coordinates, fields and role variants', () => {
    const base = item('densite')
    const keys = new Set([
      semanticItemKey(base),
      semanticItemKey({ ...base, intent: { kind: 'fixed_comparison', context: 'default' } }),
      semanticItemKey({ ...base, intent: { kind: 'selected_comparison',
        members: [{ type: 'commune', id: '35238' }] } }),
      semanticItemKey({ ...base, intent: { kind: 'selected_comparison',
        members: [{ type: 'commune', id: '35239' }] } }),
      semanticItemKey({ ...base, coordinates: { detail: ['ancien'] } }),
      semanticItemKey({ ...base, coordinates: { detail: ['recent'] } }),
      semanticItemKey({ ...base, fields: ['value'] }),
      semanticItemKey({ ...base, fields: ['value', 'status'] }),
      semanticItemKey({ ...base, target: { kind: 'territory', type: 'epci', id: '22001' } }),
    ])
    expect(keys.size).toBe(9)
    // Field projection order is not semantic; the same set is one read.
    expect(semanticItemKey({ ...base, fields: ['status', 'value'] }))
      .toBe(semanticItemKey({ ...base, fields: ['value', 'status'] }))
  })

  it('keeps resource groups together within the twelve-item budget', () => {
    const items = [...Array.from({ length: 13 }, (_, index) => item(`r${index % 5}x`)),
      ...Array.from({ length: 3 }, (_, index) => item('densite', {
        coordinates: { detail: [`d${index}`] } }))]
    const batches = groupSemanticItems(items)
    expect(batches.every((batch) => batch.length <= 12)).toBe(true)
    expect(batches.flat()).toHaveLength(items.length)
    expect(new Set(batches.flat().map(semanticItemKey)))
      .toEqual(new Set(items.map(semanticItemKey)))
  })

  it('splits one intent over many coordinate partitions instead of failing', () => {
    const oversized = Array.from({ length: 13 }, (_, index) =>
      item('densite', { coordinates: { detail: [`d${index}`] } }))
    const batches = groupSemanticItems(oversized)
    expect(batches.map((batch) => batch.length)).toEqual([12, 1])
    expect(batches.flat().map(semanticItemKey)).toEqual(oversized.map(semanticItemKey))
  })

  it('fails loudly when one atomic facts+comparison group exceeds the budget', () => {
    const oversized = [
      item('densite'),
      ...Array.from({ length: 12 }, (_, index) => item('densite', {
        intent: { kind: 'fixed_comparison', context: 'default' },
        coordinates: { detail: [`d${index}`] },
      })),
    ]
    expect(() => groupSemanticItems(oversized)).toThrow(/indivisible/)
  })
})

describe('coalescing, cache and explicit retry', () => {
  it('coalesces identical in-flight items into one read for both callers', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { items: WireItem[] }
      await gate
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
        results: body.items.map((entry) => availableWire(entry)) }))
    })
    const first = readSemanticOutcomes([item('densite')], { fetcher })
    const second = readSemanticOutcomes([item('densite')], { fetcher })
    expect(semanticReadState(item('densite'), { fetcher })).toBe('pending')
    expect(fetcher).toHaveBeenCalledTimes(1)
    release()
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual(b)
    expect(semanticReadState(item('densite'), { fetcher })).toBe('available')
  })

  it('never merges semantically different reads of the same resource', async () => {
    const sent: string[] = []
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { items: WireItem[] }
      sent.push(...body.items.map((entry) => JSON.stringify(entry)))
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
        results: body.items.map((entry) => availableWire(entry)) }))
    })
    const outcomes = await readSemanticOutcomes([
      item('densite'),
      item('densite', { fields: ['value'] }),
      item('densite', { coordinates: { detail: ['ancien'] } }),
      item('densite', { intent: { kind: 'fixed_comparison', context: 'default' } }),
      item('densite', { target: { kind: 'territory', type: 'epci', id: '22001' } }),
    ], { fetcher })
    expect(outcomes).toHaveLength(5)
    expect(new Set(sent).size).toBe(5)
  })

  it('serves a repeated item from the per-item cache without another HTTP read', async () => {
    const fetcher = respond((entry) => availableWire(entry))
    await readSemanticOutcomes([item('densite')], { fetcher })
    await readSemanticOutcomes([item('densite')], { fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('re-probes an explicitly invalidated item, including a settled absence', async () => {
    let published = false
    const fetcher = respond((entry) => published ? availableWire(entry) : unavailableWire(entry))
    const [first] = await readSemanticOutcomes([item('densite')], { fetcher })
    expect(first!.status).toBe('publication_unavailable')
    published = true
    // A second read without an explicit retry replays the settled absence.
    const [cached] = await readSemanticOutcomes([item('densite')], { fetcher })
    expect(cached!.status).toBe('publication_unavailable')
    expect(fetcher).toHaveBeenCalledTimes(1)
    invalidateSemanticReadsForTarget('commune', '22001', undefined, { fetcher })
    const [retried] = await readSemanticOutcomes([item('densite')], { fetcher })
    expect(retried!.status).toBe('available')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('never applies a late reply whose generation was invalidated', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let call = 0
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      call += 1
      const body = JSON.parse(String(init?.body)) as { items: WireItem[] }
      if (call === 1) {
        await firstGate
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
          results: body.items.map((entry) => availableWire(entry, 'stale')) }))
      }
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
        results: body.items.map((entry) => availableWire(entry, 'fresh')) }))
    })
    const inFlight = readSemanticOutcomes([item('densite')], { fetcher })
    invalidateSemanticReads(undefined, { fetcher })
    releaseFirst()
    await expect(inFlight).rejects.toBeInstanceOf(SemanticReadSupersededError)
    const [outcome] = await readSemanticOutcomes([item('densite')], { fetcher })
    if (outcome!.status !== 'available') throw new Error('expected available')
    expect(outcome.data.content_version).toBe('fresh')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('lets one caller cancel without invalidating the shared data another caller needs', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { items: WireItem[] }
      await gate
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
        results: body.items.map((entry) => availableWire(entry)) }))
    })
    const controller = new AbortController()
    const cancelled = readSemanticOutcomes([item('densite')], { fetcher, signal: controller.signal })
    const kept = readSemanticOutcomes([item('densite')], { fetcher })
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ kind: 'fetch' })
    release()
    const [outcomes] = await Promise.all([kept])
    expect(outcomes[0]!.status).toBe('available')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('exposes unrequested, error and unavailable states explicitly', async () => {
    const failing = vi.fn(async () => new Response('', { status: 422 }))
    expect(semanticReadState(item('densite'), { fetcher: failing })).toBe('unrequested')
    await readSemanticOutcomes([item('densite')], { fetcher: failing }).catch(() => undefined)
    expect(semanticReadState(item('densite'), { fetcher: failing })).toBe('error')

    const absent = respond((entry) => unavailableWire(entry))
    await readSemanticOutcomes([item('densite')], { fetcher: absent })
    expect(semanticReadState(item('densite'), { fetcher: absent })).toBe('unavailable')
  })
})

describe('shared semantic scheduler', () => {
  it('never runs more than two semantic HTTP reads at once across independent calls', async () => {
    const pending: Array<{ items: WireItem[]; settle(): void }> = []
    let active = 0
    let maxActive = 0
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { items: WireItem[] }
      active += 1
      maxActive = Math.max(maxActive, active)
      return new Promise<Response>((resolve) => pending.push({
        items: body.items,
        settle: () => {
          active -= 1
          resolve(new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
            results: body.items.map((entry) => availableWire(entry)) })))
        },
      }))
    })
    const resources = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => item(`${prefix}${index}`))
    const first = readSemanticOutcomes(resources('a', 20), { fetcher })
    const second = readSemanticOutcomes(resources('b', 20), { fetcher })
    await Promise.resolve()
    expect(pending).toHaveLength(2)
    expect(maxActive).toBe(2)
    let drained = 0
    while (drained < 4) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(drained))
      pending[drained]!.settle()
      drained += 1
      await Promise.resolve()
      expect(active).toBeLessThanOrEqual(2)
    }
    const [a, b] = await Promise.all([first, second])
    expect(a.map((outcome) => outcome.resource)).toEqual(resources('a', 20).map((entry) => entry.resource))
    expect(b.map((outcome) => outcome.resource)).toEqual(resources('b', 20).map((entry) => entry.resource))
    expect(maxActive).toBe(2)
    expect(pending).toHaveLength(4)
  })

  it('preserves request order when batches answer out of order', async () => {
    const pending: Array<{ items: WireItem[]; settle(): void }> = []
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { items: WireItem[] }
      return new Promise<Response>((resolve) => pending.push({
        items: body.items,
        settle: () => resolve(new Response(JSON.stringify({ contract: 'semantic-read-batch-v2',
          results: body.items.map((entry) => availableWire(entry, `wave-${entry.resource}`)) }))),
      }))
    })
    const requests = [...Array.from({ length: 13 }, (_, index) => item(`r${index}`))]
    const acquisition = readSemanticOutcomes(requests, { fetcher })
    await Promise.resolve()
    expect(pending).toHaveLength(2)
    const [first, second] = pending
    second!.settle()
    await Promise.resolve()
    first!.settle()
    const outcomes = await acquisition
    expect(outcomes.map((outcome) => outcome.resource)).toEqual(requests.map((entry) => entry.resource))
    expect(outcomes.map((outcome) => outcome.status === 'available'
      ? outcome.data.content_version : null)).toEqual(requests.map((entry) => `wave-${entry.resource}`))
  })
})

describe('compatibility payload adapter', () => {
  it('returns unchanged data for available items and a typed failure otherwise', async () => {
    const fetcher = respond((entry) => availableWire(entry, 'v9'))
    const [data] = await lireRessourcesBatch([item('densite')], { fetcher })
    expect(data).toEqual(expect.objectContaining({ resource: 'densite', content_version: 'v9' }))

    const absent = respond((entry) => unavailableWire(entry, 'ordered_series'))
    const failure = await lireRessourcesBatch([item('prix_m2')], { fetcher: absent })
      .catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(SemanticPublicationUnavailableError)
    expect(failure).toMatchObject({ outcome: { resource: 'prix_m2', family: 'ordered_series',
      reason: 'publication_absent' } })
  })
})

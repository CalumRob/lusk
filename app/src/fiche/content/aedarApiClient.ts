import { AEDAR_TYPEQU_REGISTRY } from './aedarTypequRegistry'

export type AedarTerritoryType = 'commune' | 'epci' | 'departement' | 'region'

export interface AedarTerritoryIdentity {
  territory_type: AedarTerritoryType
  territory_id: string
}

export interface AedarFact {
  territory_id: string
  territory_type: AedarTerritoryType
  typequ: string
  typequ_label: string
  identity: Record<string, string | null>
  n_addresses: number
  n_observed: number
  coverage_status: string
  measures: Record<string, number | null>
  source_id: string
  vintage_id: string
  source_url: string
  licence: string
  attribution: string
  reference_date: string | null
  publication_date: string | null
}

export interface AedarApiResponse {
  territory: AedarTerritoryIdentity
  content_version: string
  reference_content_version: string
  limit: number
  offset: number
  facts: AedarFact[]
}

export interface AedarProvenance {
  contentVersion: string
  sources: Array<Pick<AedarFact, 'source_id' | 'vintage_id' | 'source_url' | 'licence' | 'attribution' | 'reference_date' | 'publication_date'>>
}

export type AedarFetchResult =
  | { status: 'ready'; facts: AedarFact[]; contentVersion: string; referenceContentVersion: string; provenance: AedarProvenance }
  | { status: 'error'; error: { code: 'unknown-territory' | 'publication-unavailable' | 'network' | 'invalid-response'; message: string } }

export interface AedarFetchOptions {
  typequ?: string[]
  measures?: string[]
  /** Local cache/compatibility guard; not an API request field. */
  expectedContentVersion?: string
  expectedReferenceContentVersion?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const territoryTypes = new Set<AedarTerritoryType>(['commune', 'epci', 'departement', 'region'])

function expectedMeasureKeys(): Set<string> {
  const result = new Set<string>()
  for (const duration of [5, 10, 15, 20]) {
    for (const mode of ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car']) {
      for (const statistic of ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, index) => `decile${index + 1}`), 'mean']) {
        result.add(`count_${duration}_${mode}_${statistic}`)
      }
    }
  }
  return result
}
const measureKeys = expectedMeasureKeys()

function invalid(): never { throw new Error('Réponse AEDAR invalide') }

/** Validate one page against the requested territory and the complete published measure schema. */
export function validateAedarResponse(response: unknown, expectedTerritory: AedarTerritoryIdentity, selectedMeasures?: readonly string[]): AedarApiResponse {
  if (!isRecord(response) || !isRecord(response.territory) || !Array.isArray(response.facts) ||
      !isText(response.content_version) || !response.content_version.trim() ||
      !isText(response.reference_content_version) || !response.reference_content_version.trim() ||
      response.territory.territory_type !== expectedTerritory.territory_type ||
      response.territory.territory_id !== expectedTerritory.territory_id ||
      !Number.isInteger(response.limit) || (response.limit as number) < 1 || (response.limit as number) > 100 ||
      !Number.isInteger(response.offset) || (response.offset as number) < 0 || (response.offset as number) > 10000 ||
      response.facts.length > (response.limit as number)) invalid()

  for (const value of response.facts) {
    if (!isRecord(value) || value.territory_id !== expectedTerritory.territory_id ||
        value.territory_type !== expectedTerritory.territory_type || !isText(value.typequ) || !value.typequ ||
        !isText(value.typequ_label) || !isRecord(value.identity) ||
        Object.values(value.identity).some((item) => item !== null && !isText(item)) ||
        !Number.isInteger(value.n_addresses) || (value.n_addresses as number) < 0 ||
        !Number.isInteger(value.n_observed) || (value.n_observed as number) < 0 ||
        !isText(value.coverage_status) || !isRecord(value.measures) ||
        Object.keys(value.measures).length !== (selectedMeasures ?? [...measureKeys]).length ||
        Object.keys(value.measures).some((key) => !(selectedMeasures ?? [...measureKeys]).includes(key) || !measureKeys.has(key)) ||
        Object.values(value.measures).some((item) => item !== null && (typeof item !== 'number' || !Number.isFinite(item))) ||
        !isText(value.source_id) || !isText(value.vintage_id) || !isText(value.source_url) ||
        !isText(value.licence) || !isText(value.attribution) ||
        !(value.reference_date === null || isText(value.reference_date)) ||
        !(value.publication_date === null || isText(value.publication_date))) invalid()
  }
  return response as unknown as AedarApiResponse
}

function errorResult(code: Extract<AedarFetchResult, { status: 'error' }>['error']['code'], message: string): AedarFetchResult {
  return { status: 'error', error: { code, message } }
}

/** All non-measure producer-owned attributes must agree when field chunks are reassembled. */
function sameAedarFactMetadata(left: AedarFact, right: AedarFact): boolean {
  const scalarKeys = ['territory_id', 'territory_type', 'typequ', 'typequ_label', 'n_addresses', 'n_observed',
    'coverage_status', 'source_id', 'vintage_id', 'source_url', 'licence', 'attribution', 'reference_date',
    'publication_date'] as const
  return scalarKeys.every((key) => left[key] === right[key])
    && JSON.stringify(Object.entries(left.identity).sort(([a], [b]) => a.localeCompare(b)))
      === JSON.stringify(Object.entries(right.identity).sort(([a], [b]) => a.localeCompare(b)))
}

const MAX_CACHED_READS = 8
interface AedarReadCache {
  successful: Map<string, Extract<AedarFetchResult, { status: 'ready' }>>
  pending: Map<string, Promise<AedarFetchResult>>
}
const cachesByFetch = new WeakMap<typeof fetch, AedarReadCache>()

function cacheFor(fetcher: typeof fetch): AedarReadCache {
  let cache = cachesByFetch.get(fetcher)
  if (!cache) {
    cache = { successful: new Map(), pending: new Map() }
    cachesByFetch.set(fetcher, cache)
  }
  return cache
}

/** Read explicit TYPEQU partitions through the semantic API; never accept a truncated universe. */
export async function fetchAedarAggregates(
  territoryType: AedarTerritoryType,
  territoryId: string,
  options: AedarFetchOptions = {},
): Promise<AedarFetchResult> {
  if (options.measures && options.measures.length > 32) {
    const chunks = Array.from({ length: Math.ceil(options.measures.length / 32) }, (_, index) =>
      options.measures!.slice(index * 32, (index + 1) * 32))
    const parts = await Promise.all(chunks.map((measures) => fetchAedarAggregates(territoryType, territoryId,
      { ...options, measures })))
    const failed = parts.find((part) => part.status === 'error')
    if (failed?.status === 'error') return failed
    const ready = parts as Extract<AedarFetchResult, { status: 'ready' }>[]
    const first = ready[0]
    if (!first || ready.some((part) => part.contentVersion !== first.contentVersion
      || part.referenceContentVersion !== first.referenceContentVersion)) {
      return errorResult('invalid-response', 'Publications AEDAR incompatibles entre projections')
    }
    const facts = new Map<string, AedarFact>()
    for (const part of ready) for (const fact of part.facts) {
      const key = fact.typequ
      const prior = facts.get(key)
      if (prior && !sameAedarFactMetadata(prior, fact)) {
        return errorResult('invalid-response', 'Métadonnées AEDAR incompatibles entre projections')
      }
      facts.set(key, { ...prior, ...fact, measures: { ...prior?.measures, ...fact.measures } })
    }
    return { ...first, facts: [...facts.values()] }
  }
  const cacheKey = JSON.stringify([territoryType, territoryId, options.typequ ?? null, options.measures ?? null,
    options.expectedContentVersion ?? null, options.expectedReferenceContentVersion ?? null])
  const fetcher = globalThis.fetch
  const cache = cacheFor(fetcher)
  const cached = cache.successful.get(cacheKey)
  if (cached) {
    cache.successful.delete(cacheKey)
    cache.successful.set(cacheKey, cached)
    return Promise.resolve(cached)
  }
  const pending = cache.pending.get(cacheKey)
  if (pending) return pending

  const request = readAedarAggregates(fetcher, territoryType, territoryId, options)
  cache.pending.set(cacheKey, request)
  try {
    const result = await request
    if (result.status === 'ready') {
      cache.successful.set(cacheKey, result)
      while (cache.successful.size > MAX_CACHED_READS) {
        const oldest = cache.successful.keys().next().value
        if (oldest === undefined) break
        cache.successful.delete(oldest)
      }
    }
    return result
  } finally {
    if (cache.pending.get(cacheKey) === request) cache.pending.delete(cacheKey)
  }
}

async function readAedarAggregates(
  fetcher: typeof fetch,
  territoryType: AedarTerritoryType,
  territoryId: string,
  options: AedarFetchOptions,
): Promise<AedarFetchResult> {
  const limit = 100
  if (!territoryTypes.has(territoryType) || !territoryId ||
      (options.typequ !== undefined && (!options.typequ.length || options.typequ.some((code) => !code)
        || new Set(options.typequ).size !== options.typequ.length)) ||
      (options.measures !== undefined && (!options.measures.length || options.measures.some((key) => !measureKeys.has(key))
        || new Set(options.measures).size !== options.measures.length))) {
    return errorResult('invalid-response', 'Paramètres AEDAR invalides')
  }
  const expected = { territory_type: territoryType, territory_id: territoryId }
  const facts: AedarFact[] = []
  let contentVersion: string | undefined
  let referenceContentVersion: string | undefined
  const codes = options.typequ ?? AEDAR_TYPEQU_REGISTRY.map(({ code }) => code)
  const items = []
  for (let start = 0; start < codes.length; start += limit) {
    items.push({
      id: `aedar-${items.length}`, resource: 'aedar_territorial_aggregate',
      target: { kind: 'territory', type: territoryType, id: territoryId },
      intent: { kind: 'facts' }, coordinates: { typequ: codes.slice(start, start + limit) },
      ...(options.measures ? { fields: options.measures.map((key) => `measures.${key}`) } : {}),
    })
  }
  try {
    for (let start = 0; start < items.length; start += 12) {
      const batch = items.slice(start, start + 12)
      let response: Response
      try {
        response = await fetcher('/api/resources/read-batch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: batch }),
        })
      } catch {
        return errorResult('network', 'Impossible de joindre la publication AEDAR')
      }
      if (response.status === 404) return errorResult('unknown-territory', 'Territoire inconnu pour la publication AEDAR')
      if (response.status === 503) return errorResult('publication-unavailable', 'Publication AEDAR indisponible ou incompatible')
      if (!response.ok) return errorResult('invalid-response', `Réponse AEDAR inattendue (${response.status})`)
      let body: unknown
      try { body = await response.json() } catch {
        return errorResult('invalid-response', 'Réponse AEDAR illisible')
      }
      if (!isRecord(body) || body.contract !== 'semantic-read-batch-v1' || !Array.isArray(body.results)
        || body.results.length !== batch.length) invalid()
      const results = new Map<string, unknown>()
      for (const result of body.results) {
        if (!isRecord(result) || typeof result.id !== 'string' || results.has(result.id)
          || !batch.some((item) => item.id === result.id)) invalid()
        results.set(result.id, result.data)
      }
      for (const item of batch) {
        const data = results.get(item.id)
        if (!isRecord(data) || data.resource !== item.resource || !isRecord(data.target)
          || data.target.kind !== 'territory' || data.target.type !== territoryType || data.target.id !== territoryId) invalid()
        const page = validateAedarResponse(data, expected, options.measures)
        if (page.offset !== 0 || page.limit !== 100
          || (contentVersion !== undefined && contentVersion !== page.content_version)
          || (referenceContentVersion !== undefined && referenceContentVersion !== page.reference_content_version)) invalid()
        const returnedCodes = new Set(page.facts.map((fact) => fact.typequ))
        if (page.facts.length !== item.coordinates.typequ.length || returnedCodes.size !== page.facts.length
          || item.coordinates.typequ.some((code) => !returnedCodes.has(code))) invalid()
        contentVersion = page.content_version
        referenceContentVersion = page.reference_content_version
        facts.push(...page.facts)
      }
    }
  } catch {
    return errorResult('invalid-response', 'Réponse AEDAR invalide')
  }
  const sources = new Map<string, AedarProvenance['sources'][number]>()
  for (const fact of facts) sources.set(`${fact.source_id}\0${fact.vintage_id}`, {
    source_id: fact.source_id, vintage_id: fact.vintage_id, source_url: fact.source_url,
    licence: fact.licence, attribution: fact.attribution,
    reference_date: fact.reference_date, publication_date: fact.publication_date,
  })
  if ((options.expectedContentVersion !== undefined && options.expectedContentVersion !== contentVersion)
    || (options.expectedReferenceContentVersion !== undefined && options.expectedReferenceContentVersion !== referenceContentVersion)) {
    return errorResult('invalid-response', 'Publication AEDAR incompatible avec les faits déjà affichés')
  }
  return { status: 'ready', facts, contentVersion: contentVersion!, referenceContentVersion: referenceContentVersion!,
    provenance: { contentVersion: contentVersion!, sources: [...sources.values()] } }
}

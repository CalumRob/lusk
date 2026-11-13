import { AEDAR_TYPEQU_REGISTRY } from './aedarTypequRegistry'
import { producerCatalogue } from '@/payload/themeAcquisition'
import { invalidateSemanticItems, invalidateSemanticReadsForTarget, publicationFamilyForResource,
  readSemanticOutcomes } from '@/payload/semanticResourceClient'
import type { SemanticReadItem } from '@/payload/semanticResourceClient'
import { PayloadError } from '@/payload/validate'

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

export interface AedarTerritorySummaryReading extends Pick<AedarFact, 'source_id' | 'vintage_id' | 'source_url' | 'licence' | 'attribution' | 'reference_date' | 'publication_date'> {
  measure: string
  value: number | null
  status: 'available' | 'unavailable'
  n_typequ: number | null
  n_addresses: number | null
  n_observed: number | null
  coverage_status: string | null
  statistic: 'direct'
}

export interface AedarTerritorySummary {
  territory: AedarTerritoryIdentity
  summaryContentVersion: string
  aedarContentVersion: string
  referenceContentVersion: string
  readings: readonly AedarTerritorySummaryReading[]
  provenance: AedarProvenance
}

export type AedarSummaryFetchResult =
  | { status: 'ready'; summary: AedarTerritorySummary }
  | { status: 'error'; error: { code: 'unknown-territory' | 'publication-unavailable' | 'network' | 'invalid-response'; message: string } }

export interface AedarFetchOptions {
  typequ?: string[]
  measures?: string[]
  /** Local cache/compatibility guard; not an API request field. */
  expectedContentVersion?: string
  expectedReferenceContentVersion?: string
  /**
   * #1002 — caller-scoped demand lifetime. It never aborts the shared read, but
   * a queued batch nobody waits on any more is not started off-screen.
   */
  signal?: AbortSignal
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const territoryTypes = new Set<AedarTerritoryType>(['commune', 'epci', 'departement', 'region'])

type SummaryReadCache = {
  /** Only in-flight work is shared; every later acquisition observes API clocks again. */
  pending: Map<string, Promise<AedarSummaryFetchResult>>
}
const summaryCachesByFetch = new WeakMap<typeof fetch, SummaryReadCache>()

function summaryCacheFor(fetcher: typeof fetch): SummaryReadCache {
  let cache = summaryCachesByFetch.get(fetcher)
  if (!cache) { cache = { pending: new Map() }; summaryCachesByFetch.set(fetcher, cache) }
  return cache
}

/** Explicit retry: drop the summary in-flight entry and re-probe the shared item. */
export function invalidateAedarTerritorySummary(type: AedarTerritoryType, id: string): void {
  const cache = summaryCachesByFetch.get(globalThis.fetch)
  if (cache) {
    const key = JSON.stringify([type, id])
    cache.pending.delete(key)
  }
  // Bump the shared item generation so a late reply from the abandoned read
  // never becomes the next acquisition result.
  invalidateSemanticReadsForTarget(type, id)
}

/**
 * Acquire the registered producer summary as one independent read. The 40
 * identities come from the producer's aggregate facets, not from a browser
 * request list; omitting coordinates is the API's complete-summary contract.
 */
export async function fetchAedarTerritorySummary(
  territoryType: AedarTerritoryType,
  territoryId: string,
): Promise<AedarSummaryFetchResult> {
  if (!territoryTypes.has(territoryType) || !territoryId) {
    return summaryError('invalid-response', 'Paramètres AEDAR invalides')
  }
  const fetcher = globalThis.fetch
  const cache = summaryCacheFor(fetcher)
  const key = JSON.stringify([territoryType, territoryId])
  const pending = cache.pending.get(key)
  if (pending) return pending
  const request = readAedarTerritorySummary(fetcher, territoryType, territoryId)
  cache.pending.set(key, request)
  try {
    return await request
  } finally {
    if (cache.pending.get(key) === request) cache.pending.delete(key)
  }
}

function summaryError(code: Extract<AedarSummaryFetchResult, { status: 'error' }>['error']['code'], message: string): AedarSummaryFetchResult {
  return { status: 'error', error: { code, message } }
}

function validSummaryReading(value: unknown): value is AedarTerritorySummaryReading {
  if (!isRecord(value) || !isText(value.measure) || !value.measure.trim() ||
      (value.status !== 'available' && value.status !== 'unavailable') || value.statistic !== 'direct' ||
      !(value.value === null || (typeof value.value === 'number' && Number.isFinite(value.value))) ||
      !(value.n_typequ === null || (Number.isInteger(value.n_typequ) && (value.n_typequ as number) > 0)) ||
      !(value.n_addresses === null || (Number.isInteger(value.n_addresses) && (value.n_addresses as number) >= 0)) ||
      !(value.n_observed === null || (Number.isInteger(value.n_observed) && (value.n_observed as number) >= 0)) ||
      !(value.coverage_status === null || isText(value.coverage_status)) ||
      !isText(value.source_id) || !isText(value.vintage_id) || !isText(value.source_url) ||
      !isText(value.licence) || !isText(value.attribution) ||
      !(value.reference_date === null || isText(value.reference_date)) ||
      !(value.publication_date === null || isText(value.publication_date))) return false
  if (value.status === 'available') {
    const numericValue = value.value
    const nTypequ = value.n_typequ
    const nAddresses = value.n_addresses
    const nObserved = value.n_observed
    return typeof numericValue === 'number' && numericValue >= 0 &&
      typeof nTypequ === 'number' && typeof nAddresses === 'number' && nAddresses > 0 &&
      typeof nObserved === 'number' && nObserved <= nTypequ * nAddresses && value.coverage_status === 'covered'
  }
  return value.value === null && value.n_typequ === null &&
    (value.n_addresses === null || (typeof value.n_addresses === 'number' && value.n_addresses >= 0)) &&
    (value.n_observed === null || (typeof value.n_observed === 'number' && value.n_observed >= 0))
}

async function readAedarTerritorySummary(
  fetcher: typeof fetch,
  territoryType: AedarTerritoryType,
  territoryId: string,
): Promise<AedarSummaryFetchResult> {
  try {
    const declarations = await producerCatalogue()
    const summaryDeclaration = declarations.find((item) => item.resource_id === 'aedar_territory_summary')
    const measures = Object.keys(summaryDeclaration?.measure_facets ?? {})
    const measureSet = new Set(measures)
    if (!summaryDeclaration || !summaryDeclaration.intents.includes('facts') ||
        !summaryDeclaration.target_kinds.includes('territory') ||
        !summaryDeclaration.allowed_levels.includes(territoryType) ||
        !summaryDeclaration.measure_facets || !measures.length || measureSet.size !== measures.length ||
        measures.some((measure) => !summaryDeclaration.measure_facets?.[measure])) {
      return summaryError('invalid-response', 'Contrat de synthèse AEDAR indisponible')
    }
    const item: SemanticReadItem = { resource: summaryDeclaration.resource_id,
      target: { kind: 'territory', type: territoryType, id: territoryId }, intent: { kind: 'facts' } }
    const invalidSummary = (message: string) => {
      invalidateSemanticItems([item], { fetcher })
      return summaryError('invalid-response', message)
    }
    let outcome
    try {
      [outcome] = await readSemanticOutcomes([item], { fetcher, fresh: true,
        expectedFamilies: new Map([[summaryDeclaration.resource_id,
          publicationFamilyForResource(summaryDeclaration)]]) })
    } catch (error) {
      if (error instanceof PayloadError) {
        if (error.status === 404) return summaryError('unknown-territory', 'Territoire inconnu pour la synthèse AEDAR')
        if (error.status === 503) return summaryError('publication-unavailable', 'Synthèse AEDAR indisponible ou incompatible')
        if (error.kind === 'fetch' && error.status === undefined) {
          return summaryError('network', 'Impossible de joindre la synthèse AEDAR')
        }
      }
      return summaryError('invalid-response', 'Réponse de synthèse AEDAR invalide')
    }
    if (outcome.status === 'publication_unavailable') {
      return summaryError('publication-unavailable', 'Synthèse AEDAR indisponible ou incompatible')
    }
    const data = outcome.data
    if (data.resource !== item.resource || !isRecord(data.target) || data.target.kind !== 'territory' ||
        data.target.type !== territoryType || data.target.id !== territoryId || !isRecord(data.territory) ||
        data.territory.territory_type !== territoryType || data.territory.territory_id !== territoryId ||
        !isText(data.summary_content_version) || !data.summary_content_version.trim() ||
        !isText(data.aedar_content_version) || !data.aedar_content_version.trim() ||
        !isText(data.reference_content_version) || !data.reference_content_version.trim() ||
        !Array.isArray(data.readings) || data.readings.length !== measures.length) {
      return invalidSummary('Synthèse AEDAR incomplète ou liée à un autre territoire')
    }
    const readings = data.readings
    const returned = new Map<string, AedarTerritorySummaryReading>()
    for (const reading of readings) {
      if (!validSummaryReading(reading) || !measureSet.has(reading.measure) || returned.has(reading.measure)) {
        return invalidSummary('Lecture de synthèse AEDAR invalide')
      }
      returned.set(reading.measure, reading)
    }
    if (measures.some((measure) => !returned.has(measure))) {
      return invalidSummary('Synthèse AEDAR incomplète')
    }
    const normalized = measures.map((measure) => returned.get(measure)!)
    const first = normalized[0]!
    const firstAvailable = normalized.find((reading) => reading.status === 'available')
    const provenanceKeys = ['source_id', 'vintage_id', 'source_url', 'licence', 'attribution', 'reference_date', 'publication_date'] as const
    if (normalized.some((reading) => provenanceKeys.some((key) => reading[key] !== first[key]) ||
        reading.n_addresses !== first.n_addresses || reading.n_observed !== first.n_observed ||
        (reading.status === 'available' && reading.n_typequ !== firstAvailable?.n_typequ))) {
      return invalidSummary('Provenance ou support incohérent dans la synthèse AEDAR')
    }
    const provenanceSource = Object.fromEntries(provenanceKeys.map((key) => [key, first[key]])) as AedarProvenance['sources'][number]
    return { status: 'ready', summary: {
      territory: { territory_type: territoryType, territory_id: territoryId },
      summaryContentVersion: data.summary_content_version,
      aedarContentVersion: data.aedar_content_version,
      referenceContentVersion: data.reference_content_version,
      readings: normalized,
      provenance: { contentVersion: data.aedar_content_version, sources: [provenanceSource] },
    } }
  } catch {
    return summaryError('invalid-response', 'Réponse de synthèse AEDAR invalide')
  }
}

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
  const items: SemanticReadItem[] = []
  for (let start = 0; start < codes.length; start += limit) {
    items.push({
      resource: 'aedar_territorial_aggregate',
      target: { kind: 'territory', type: territoryType, id: territoryId },
      intent: { kind: 'facts' }, coordinates: { typequ: codes.slice(start, start + limit) },
      ...(options.measures ? { fields: options.measures.map((key) => `measures.${key}`) } : {}),
    })
  }
  try {
    for (let start = 0; start < items.length; start += 12) {
      const batch = items.slice(start, start + 12)
      let outcomes
      try {
        outcomes = await readSemanticOutcomes(batch, { fetcher, fresh: true,
          ...(options.signal ? { signal: options.signal } : {}),
          expectedFamilies: new Map([['aedar_territorial_aggregate', 'aedar']]),
          ...(options.expectedContentVersion !== undefined || options.expectedReferenceContentVersion !== undefined
            ? { coherence: JSON.stringify([options.expectedContentVersion ?? null,
              options.expectedReferenceContentVersion ?? null]) } : {}) })
      } catch (error) {
        if (error instanceof PayloadError) {
          if (error.status === 404) return errorResult('unknown-territory', 'Territoire inconnu pour la publication AEDAR')
          if (error.status === 503) return errorResult('publication-unavailable', 'Publication AEDAR indisponible ou incompatible')
          if (error.kind === 'fetch' && error.status === undefined) {
            return errorResult('network', 'Impossible de joindre la publication AEDAR')
          }
        }
        return errorResult('invalid-response', 'Réponse AEDAR invalide')
      }
      for (let position = 0; position < batch.length; position += 1) {
        const item = batch[position]!
        const outcome = outcomes[position]!
        if (outcome.status === 'publication_unavailable') {
          return errorResult('publication-unavailable', 'Publication AEDAR indisponible ou incompatible')
        }
        const data = outcome.data
        if (data.resource !== item.resource || !isRecord(data.target)
          || data.target.kind !== 'territory' || data.target.type !== territoryType || data.target.id !== territoryId) invalid()
        const page = validateAedarResponse(data, expected, options.measures)
        if (page.offset !== 0 || page.limit !== 100
          || (options.expectedContentVersion !== undefined && page.content_version !== options.expectedContentVersion)
          || (options.expectedReferenceContentVersion !== undefined &&
            page.reference_content_version !== options.expectedReferenceContentVersion)
          || (contentVersion !== undefined && contentVersion !== page.content_version)
          || (referenceContentVersion !== undefined && referenceContentVersion !== page.reference_content_version)) invalid()
        const returnedCodes = new Set(page.facts.map((fact) => fact.typequ))
        if (page.facts.length !== item.coordinates!.typequ!.length || returnedCodes.size !== page.facts.length
          || item.coordinates!.typequ!.some((code) => !returnedCodes.has(code))) invalid()
        contentVersion = page.content_version
        referenceContentVersion = page.reference_content_version
        facts.push(...page.facts)
      }
    }
  } catch {
    // A rejected aggregate page never settles: an explicit retry re-probes.
    invalidateSemanticItems(items, { fetcher })
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
    invalidateSemanticItems(items, { fetcher })
    return errorResult('invalid-response', 'Publication AEDAR incompatible avec les faits déjà affichés')
  }
  return { status: 'ready', facts, contentVersion: contentVersion!, referenceContentVersion: referenceContentVersion!,
    provenance: { contentVersion: contentVersion!, sources: [...sources.values()] } }
}

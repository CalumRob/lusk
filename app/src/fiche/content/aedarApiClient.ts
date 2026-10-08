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
  | { status: 'ready'; facts: AedarFact[]; contentVersion: string; provenance: AedarProvenance }
  | { status: 'error'; error: { code: 'unknown-territory' | 'publication-unavailable' | 'network' | 'invalid-response' | 'pagination-limit'; message: string } }

export interface AedarFetchOptions {
  limit?: number
  typequ?: string[]
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
export function validateAedarResponse(response: unknown, expectedTerritory: AedarTerritoryIdentity): AedarApiResponse {
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
        Object.keys(value.measures).length !== measureKeys.size ||
        Object.keys(value.measures).some((key) => !measureKeys.has(key)) ||
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

/** Read all AEDAR facts via bounded API pages. Fail closed: partial pages are never returned as ready. */
export async function fetchAedarAggregates(
  territoryType: AedarTerritoryType,
  territoryId: string,
  options: AedarFetchOptions = {},
): Promise<AedarFetchResult> {
  const limit = options.limit ?? 50
  if (!territoryTypes.has(territoryType) || !territoryId || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      (options.typequ !== undefined && (!options.typequ.length || options.typequ.length > 100 || options.typequ.some((code) => !code)))) {
    return errorResult('invalid-response', 'Paramètres AEDAR invalides')
  }
  const expected = { territory_type: territoryType, territory_id: territoryId }
  const facts: AedarFact[] = []
  let contentVersion: string | undefined
  let offset = 0
  try {
    while (true) {
      if (offset > 10000) return errorResult('pagination-limit', 'Limite de pagination AEDAR atteinte')
      const params = new URLSearchParams()
      if (options.typequ) params.set('typequ', options.typequ.join(','))
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      const url = `/api/aedar/territories/${encodeURIComponent(territoryType)}/${encodeURIComponent(territoryId)}/aggregates?${params}`
      let response: Response
      try { response = await fetch(url) } catch {
        return errorResult('network', 'Impossible de joindre la publication AEDAR')
      }
      if (response.status === 404) return errorResult('unknown-territory', 'Territoire inconnu pour la publication AEDAR')
      if (response.status === 503) return errorResult('publication-unavailable', 'Publication AEDAR indisponible ou incompatible')
      if (!response.ok) return errorResult('invalid-response', `Réponse AEDAR inattendue (${response.status})`)
      let body: unknown
      try { body = await response.json() } catch {
        return errorResult('invalid-response', 'Réponse AEDAR illisible')
      }
      let page: AedarApiResponse
      try { page = validateAedarResponse(body, expected) } catch {
        return errorResult('invalid-response', 'Réponse AEDAR invalide')
      }
      if (page.offset !== offset || page.limit !== limit || (contentVersion !== undefined && contentVersion !== page.content_version)) invalid()
      contentVersion = page.content_version
      facts.push(...page.facts)
      if (page.facts.length < limit) break
      offset += page.facts.length
      // The server accepts offsets through 10000 inclusive; don't issue an unbounded or invalid request.
      if (offset > 10000) return errorResult('pagination-limit', 'Limite de pagination AEDAR atteinte')
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
  return { status: 'ready', facts, contentVersion: contentVersion!, provenance: { contentVersion: contentVersion!, sources: [...sources.values()] } }
}

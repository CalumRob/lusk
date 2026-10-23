import type { TerritoireType } from './types'
import { PayloadError } from './validate'

export interface SemanticResourceDeclaration {
  resource_id: string
  theme_id: string
  indicator_id: string
  label: string
  unit: string
  direction: string
  allowed_levels: TerritoireType[]
  sources: string[]
  shapes: string[]
  target_kinds: string[]
  fields: string[]
  intents: string[]
}

export interface SemanticTerritoryTarget {
  kind: 'territory' | 'territory_cohort'
  type: TerritoireType
  id?: string
  department_id?: string | null
  epci_id?: string | null
}

export interface SemanticReadItem {
  resource: string
  target: SemanticTerritoryTarget
  coordinates?: Record<string, string[]>
  fields?: string[]
  intent: { kind: 'facts' } | { kind: 'fixed_comparison'; context: 'default' } |
    { kind: 'selected_comparison'; members: Array<{ type: TerritoireType; id: string }> }
}

type RecordValue = Record<string, unknown>

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

async function readJson(response: Response, path: string): Promise<unknown> {
  try { return await response.json() }
  catch { throw new PayloadError('validation', path, 'Réponse illisible de l’API sémantique.') }
}

/** Producer-derived discovery. Deliberately validates only the shared public descriptor seam. */
export async function chargerCatalogueRessources(): Promise<SemanticResourceDeclaration[]> {
  const path = '/api/resources'
  let response: Response
  try { response = await fetch(path) }
  catch (cause) { throw new PayloadError('fetch', path, `Catalogue sémantique indisponible : ${cause instanceof Error ? cause.message : String(cause)}`) }
  if (!response.ok) throw new PayloadError('fetch', path, `Catalogue sémantique indisponible (HTTP ${response.status}).`)
  const raw = await readJson(response, path)
  if (!isRecord(raw) || raw.contract !== 'semantic-resource-catalogue-v1' || !Array.isArray(raw.resources)) {
    throw new PayloadError('validation', path, 'Catalogue des ressources sémantiques incompatible.')
  }
  const seen = new Set<string>()
  const resources = raw.resources.map((candidate): SemanticResourceDeclaration => {
    if (!isRecord(candidate) || typeof candidate.resource_id !== 'string' || !candidate.resource_id ||
        typeof candidate.theme_id !== 'string' || !candidate.theme_id ||
        typeof candidate.indicator_id !== 'string' || !candidate.indicator_id ||
        typeof candidate.label !== 'string' || typeof candidate.unit !== 'string' ||
        typeof candidate.direction !== 'string' || !strings(candidate.allowed_levels) ||
        !strings(candidate.sources) || !strings(candidate.shapes) || !strings(candidate.target_kinds) ||
        !strings(candidate.fields) || !strings(candidate.intents) || seen.has(candidate.resource_id)) {
      throw new PayloadError('validation', path, 'Déclaration de ressource sémantique mal formée ou dupliquée.')
    }
    seen.add(candidate.resource_id)
    return candidate as unknown as SemanticResourceDeclaration
  })
  return resources
}

async function poster(path: string, body: RecordValue): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch (cause) {
    throw new PayloadError('fetch', path, `Lecture sémantique indisponible : ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!response.ok) throw new PayloadError('fetch', path, `Lecture sémantique indisponible (HTTP ${response.status}).`)
  return readJson(response, path)
}

/** A semantic read-batch retains request-local correlation and resource identity. */
export async function lireRessourcesBatch(items: SemanticReadItem[]): Promise<RecordValue[]> {
  const path = '/api/resources/read-batch'
  if (!items.length || items.length > 12) {
    throw new PayloadError('validation', path, 'Le lot sémantique doit contenir de 1 à 12 lectures.')
  }
  const requests = items.map((item, index) => ({ ...item, id: `scalar-${index}-${item.resource}` }))
  const raw = await poster(path, { items: requests })
  if (!isRecord(raw) || raw.contract !== 'semantic-read-batch-v1' || !Array.isArray(raw.results) || raw.results.length !== requests.length) {
    throw new PayloadError('validation', path, 'Réponse du lot sémantique incompatible.')
  }
  const byId = new Map<string, RecordValue>()
  for (const result of raw.results) {
    if (!isRecord(result) || typeof result.id !== 'string' || typeof result.resource !== 'string' || byId.has(result.id)) {
      throw new PayloadError('validation', path, 'Résultat de lot sémantique mal formé ou dupliqué.')
    }
    if (!isRecord(result.data)) throw new PayloadError('validation', path, 'Données de lot sémantique mal formées.')
    byId.set(result.id, result)
  }
  return requests.map((request) => {
    const result = byId.get(request.id)
    const data = result?.data
    if (!result || result.resource !== request.resource || !isRecord(data) || data.resource !== request.resource) {
      throw new PayloadError('validation', path, 'La corrélation ou l’identité d’une ressource du lot est incompatible.')
    }
    const target = data.target
    const expected = request.target
    const sameNullable = (actual: unknown, wanted: string | null | undefined) =>
      (actual === undefined || actual === null ? null : actual) === (wanted ?? null)
    if (!isRecord(target) || target.kind !== expected.kind || target.type !== expected.type ||
        (expected.kind === 'territory' && target.id !== expected.id) ||
        (expected.kind === 'territory_cohort' &&
          (!sameNullable(target.department_id, expected.department_id) || !sameNullable(target.epci_id, expected.epci_id)))) {
      throw new PayloadError('validation', path, 'La cible renvoyée par le lot sémantique ne correspond pas à la lecture demandée.')
    }
    return data
  })
}

/** Comparison reads share the same closed semantic item grammar. */
export async function lireRessource(item: SemanticReadItem): Promise<RecordValue> {
  const path = '/api/resources/read'
  const raw = await poster(path, item as unknown as RecordValue)
  if (!isRecord(raw) || raw.resource !== item.resource) {
    throw new PayloadError('validation', path, 'La lecture sémantique ne correspond pas à la ressource demandée.')
  }
  return raw
}

export type ThemeKey = 'programmes' | 'demographie' | 'habitat' | 'economie' | 'milieux' | 'mobilite'
import type { Theme } from './types'
import { readSemanticBatch } from './semanticResourceClient'
import type { SemanticReadItem } from './semanticResourceClient'
/** Every canonical theme is acquired (active priority, then background warm-up) unless an owner-owned flow handles it. */
export const THEMES_ACQUISITION_API: readonly Theme[] = ['programmes', 'demographie', 'habitat', 'economie', 'milieux', 'mobilite']
export type ThemeSelectionMember = { territory_type: 'commune' | 'epci' | 'departement' | 'region'; territory_id: string }

export interface PublicationTokens {
  reference_content_version?: unknown
  content_version?: unknown
  profile_content_version?: unknown
  reading_content_version?: unknown
  scalar_content_version?: unknown
  collection_content_versions?: unknown
  owned_series_content_versions?: unknown
  bpe_content_version?: unknown
  bpe_reference_content_version?: unknown
  service_publication_id?: unknown
  building_publication_id?: unknown
}

export interface ThemeResponse {
  tokens?: Record<string, unknown>
  [key: string]: unknown
}

export function normalizePublicationTokens(response: ThemeResponse): Record<string, unknown> {
  const fields = ['reference_content_version', 'content_version', 'scalar_content_version',
    'profile_content_version', 'reading_content_version', 'collection_content_versions',
    'bpe_content_version', 'bpe_reference_content_version', 'service_publication_id',
    'building_publication_id'] as const
  const normalized: Record<string, unknown> = {}
  for (const field of fields) if (field in response) normalized[field] = response[field]
  return normalized
}

/** La clé de cache d'une sélection : « omitted » (défaut déclaré) se distingue
 * toujours de la sélection explicitement vide `[]` (aucune comparaison). */
export function cleSelectionComparaison(selection: readonly ThemeSelectionMember[] | undefined): string {
  return selection === undefined ? 'omitted' : JSON.stringify(selection)
}

export interface AcquiredTheme<T extends ThemeResponse = ThemeResponse> {
  focal: T
  comparisons: Map<string, ThemeResponse>
}

type Key = { type: string; id: string; theme: ThemeKey }

/** Lazy per-theme cache. A comparison is independently acquired and can never replace focal facts. */
export class ThemeAcquisitionCache<T extends ThemeResponse = ThemeResponse> {
  private readonly entries = new Map<string, AcquiredTheme<T>>()
  private readonly pendingFacts = new Map<string, Promise<AcquiredTheme<T>>>()
  private readonly generations = new Map<string, number>()

  constructor(
    private readonly acquireFacts: (theme: ThemeKey, key?: Key) => Promise<T>,
    private readonly acquireComparison?: (selection: readonly ThemeSelectionMember[] | undefined, theme: ThemeKey, key?: Key) => Promise<ThemeResponse>,
  ) {}

  private key({ type, id, theme }: Key): string { return JSON.stringify([type, id, theme]) }

  async get(type: string, id: string, theme: ThemeKey): Promise<AcquiredTheme<T>> {
    const key = { type, id, theme }
    const cacheKey = this.key(key)
    const cached = this.entries.get(cacheKey)
    if (cached) return cached
    const pending = this.pendingFacts.get(cacheKey)
    if (pending) return pending
    const generation = this.generations.get(cacheKey) ?? 0
    const request = this.acquireFacts(theme, key).then((focal) => {
      if (generation !== (this.generations.get(cacheKey) ?? 0)) throw new Error('Stale theme acquisition response')
      const result = { focal, comparisons: new Map<string, ThemeResponse>() }
      this.entries.set(cacheKey, result)
      return result
    }).finally(() => {
      if (this.pendingFacts.get(cacheKey) === request) this.pendingFacts.delete(cacheKey)
    })
    this.pendingFacts.set(cacheKey, request)
    return request
  }

  async select(type: string, id: string, theme: ThemeKey, selection: readonly ThemeSelectionMember[] | undefined): Promise<AcquiredTheme<T>> {
    const key = { type, id, theme }
    const cacheKey = this.key(key)
    const focal = await this.get(type, id, theme)
    if (!this.acquireComparison) return focal
    const selectionKey = cleSelectionComparaison(selection)
    const existing = focal.comparisons.get(selectionKey)
    if (existing) return focal
    const generation = (this.generations.get(cacheKey) ?? 0) + 1
    this.generations.set(cacheKey, generation)
    const comparison = await this.acquireComparison(selection, theme, key)
    if (generation !== this.generations.get(cacheKey)) throw new Error('Stale theme comparison response')
    const actualTokens = normalizePublicationTokens(comparison)
    const focalTokens = normalizePublicationTokens(focal.focal)
    const compatible = 'reference_content_version' in actualTokens && 'reference_content_version' in focalTokens &&
      actualTokens.reference_content_version === focalTokens.reference_content_version &&
      ['content_version', 'profile_content_version', 'reading_content_version'].every((name) =>
        !(name in actualTokens && name in focalTokens) || actualTokens[name] === focalTokens[name])
    if (!compatible) {
      throw new Error('Theme publication tokens do not match; retry comparison')
    }
    const result = { ...focal, comparisons: new Map(focal.comparisons).set(selectionKey, comparison) }
    this.entries.set(cacheKey, result)
    return result
  }

  invalidate(type: string, id: string, theme?: ThemeKey): void {
    for (const key of [...this.entries.keys()]) {
      const identity = JSON.parse(key) as [string, string, ThemeKey]
      if (identity[0] === type && identity[1] === id && (!theme || identity[2] === theme)) this.entries.delete(key)
    }
    const themes: ThemeKey[] = theme ? [theme] : ['programmes', 'demographie', 'habitat', 'economie', 'milieux', 'mobilite']
    for (const selectedTheme of themes) {
      const key = this.key({ type, id, theme: selectedTheme })
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
      this.pendingFacts.delete(key)
    }
  }
}

/**
 * Le chemin d'acquisition API est le DÉFAUT du produit (#627, décision
 * propriétaire 2026-10-06) : l'incumbent statique ne survit que comme opt-out
 * explicite — `VITE_THEME_ACQUISITION_API='0'`. Couplage de déploiement : un
 * build par défaut attend que les routes POST de faits/thèmes soient servies
 * par l'API déployée (sinon la fiche échoue fermé, jamais de repli statique).
 */
export function themeAcquisitionEnabled(env: Record<string, unknown>): boolean {
  return env.VITE_THEME_ACQUISITION_API !== '0'
}

async function postThemeResponse(url: string, body: Record<string, unknown>, expectedTheme: ThemeKey): Promise<ThemeResponse> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Theme acquisition failed (HTTP ${response.status})`)
  const value: unknown = await response.json()
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      (value as Record<string, unknown>).theme_id !== expectedTheme) {
    throw new Error('Theme acquisition returned an incompatible response')
  }
  return value as ThemeResponse
}

export function acquireThemeFacts(type: string, id: string, theme: ThemeKey,
  selection?: readonly ThemeSelectionMember[]): Promise<ThemeResponse> {
  if (theme === 'demographie') return acquireDemographieFacts(type, id)
  const path = `/api/territories/${encodeURIComponent(type)}/${encodeURIComponent(id)}/themes/${theme}/facts`
  return postThemeResponse(path, { theme_id: theme, ...(selection === undefined ? {} : { selection }) }, theme)
}

/** Démographie reads its producer-declared indicator resources and typed reading
 * together on the semantic API's atomic snapshot. Resource names are supplied
 * by the published read-model metadata, not a parallel UI registry. */
export async function acquireDemographieFacts(type: string, id: string): Promise<ThemeResponse> {
  const [metadataResponse, catalogueResponse] = await Promise.all([
    fetch('/data/theme_demographie.json'), fetch('/api/resources'),
  ])
  if (!metadataResponse.ok || !catalogueResponse.ok) throw new Error('Démographie producer resource discovery unavailable')
  const [metadata, catalogue]: [unknown, unknown] = await Promise.all([metadataResponse.json(), catalogueResponse.json()])
  if (!isRecord(metadata) || !isRecord(metadata.indicator_pages) || !isRecord(catalogue) ||
      catalogue.contract !== 'semantic-resource-catalogue-v1' || !Array.isArray(catalogue.resources) ||
      !Array.isArray(metadata.subgroups)) throw new Error('Démographie resource metadata is incompatible')
  const target = { kind: 'territory' as const, type: type as SemanticReadItem['target']['type'], id }
  const declaredIndicators = Object.keys(metadata.indicator_pages)
  const readingResources = catalogue.resources.filter((resource): resource is Record<string, unknown> =>
    isRecord(resource) && resource.resource_kind === 'typed_reading' && resource.theme_id === 'demographie' &&
      typeof resource.resource_id === 'string' && Array.isArray(resource.fields) &&
      ['status', 'source_id', 'vintage_id'].every((field) => resource.fields.includes(field)))
  if (!declaredIndicators.length || readingResources.length !== 1) throw new Error('Démographie resource declarations are incomplete')
  const items: SemanticReadItem[] = [
    ...declaredIndicators.map((resource) => ({ resource, target, intent: { kind: 'facts' as const } })),
    ...readingResources.map((resource) => {
      const subgroup = metadata.subgroups.find((group: unknown) => isRecord(group) && isRecord(group.reading) &&
        isRecord(group.figure) && group.figure.indicator === 'evolution_1968')
      if (!isRecord(subgroup)) throw new Error('Démographie reading group is undeclared')
      return { resource: String(resource.resource_id), target, coordinates: { groupe: [String(subgroup.key)] },
        intent: { kind: 'facts' as const } }
    }),
  ]
  const values = await readSemanticBatch(items)
  return { contract: 'semantic-demographie-v1', theme_id: 'demographie', territory: { territory_id: id, territory_type: type },
    resource_results: values }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function acquireThemeComparison(type: string, id: string, theme: ThemeKey,
  selection?: readonly ThemeSelectionMember[]): Promise<ThemeResponse> {
  const path = `/api/territories/${encodeURIComponent(type)}/${encodeURIComponent(id)}/themes/${theme}/comparison`
  return postThemeResponse(path, { theme_id: theme, ...(selection === undefined ? {} : { selection }) }, theme)
}

export type ThemeKey = 'programmes' | 'demographie' | 'habitat' | 'economie' | 'milieux' | 'mobilite'
import type { Theme } from './types'
import { invalidateSemanticReadCache, readSemanticBatch } from './semanticResourceClient'
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
    const compatible = theme === 'demographie'
      ? demographieComparisonCompatible(focal.focal, comparison)
      : (() => {
      const actualTokens = normalizePublicationTokens(comparison)
      const focalTokens = normalizePublicationTokens(focal.focal)
      return 'reference_content_version' in actualTokens && 'reference_content_version' in focalTokens &&
      actualTokens.reference_content_version === focalTokens.reference_content_version &&
      ['content_version', 'profile_content_version', 'reading_content_version'].every((name) =>
        !(name in actualTokens && name in focalTokens) || actualTokens[name] === focalTokens[name])
      })()
    if (!compatible) {
      if (theme === 'demographie') invalidateSemanticReadCache()
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
  const plan = await demographieReadPlan()
  const target = { kind: 'territory' as const, type: type as SemanticReadItem['target']['type'], id }
  const items: SemanticReadItem[] = [
    ...plan.indicatorResources.map((resource) => ({ resource: resource.resource_id, target, intent: { kind: 'facts' as const } })),
    { resource: plan.reading.resource_id, target, coordinates: { groupe: [plan.reading.group] }, intent: { kind: 'facts' as const } },
    ...plan.indicatorResources.map((resource) => ({ resource: resource.resource_id, target,
      intent: { kind: 'fixed_comparison' as const, context: 'default' } })),
  ]
  const values = await readSemanticBatch(items)
  const factsCount = plan.indicatorResources.length + 1
  const facts = values.slice(0, factsCount)
  const defaultComparisons = values.slice(factsCount)
  if (!validerVersionsComparaisonDemographie(facts, defaultComparisons, plan.indicatorResources)) {
    invalidateSemanticReadCache()
    throw new Error('Démographie default comparison versions do not match their facts')
  }
  return { contract: 'semantic-demographie-v1', theme_id: 'demographie', territory: { territory_id: id, territory_type: type },
    reading_resource: plan.reading, resource_results: facts, default_comparisons: defaultComparisons }
}

export async function acquireDemographieComparison(type: string, id: string,
  selection: readonly ThemeSelectionMember[] | undefined): Promise<ThemeResponse> {
  if (selection === undefined) throw new Error('Default comparison is acquired with Démographie facts')
  const plan = await demographieReadPlan()
  const target = { kind: 'territory' as const, type: type as SemanticReadItem['target']['type'], id }
  const members = selection.map(({ territory_type, territory_id }) => ({ type: territory_type, id: territory_id }))
  const items = plan.indicatorResources.map((resource) => ({ resource: resource.resource_id, target,
    intent: { kind: 'selected_comparison' as const, members } }))
  const resourceResults = await readSemanticBatch(items)
  for (const comparison of resourceResults) {
    if (!isRecord(comparison) || !Array.isArray(comparison.selection) || comparison.selection.length !== members.length ||
        comparison.selection.some((member: unknown, index: number) => !isRecord(member) ||
          member.territory_type !== members[index]!.type || member.territory_id !== members[index]!.id)) {
      throw new Error('Semantic Démographie comparison did not echo the requested member scope')
    }
  }
  const reading_cloud = await acquireDemographieReadingCloudWithPlan(plan, members)
  const result: ThemeResponse = { contract: 'semantic-demographie-comparison-v1', theme_id: 'demographie',
    selection: isRecord(resourceResults[0]) ? resourceResults[0].selection : members, resource_results: resourceResults,
    reading_resource: plan.reading, reading_cloud }
  return result
}

/** Read only the declared typed reading facts for a scope already resolved by the territory model. */
export async function acquireDemographieReadingCloud(
  members: readonly ThemeSelectionMember[], focalResults?: unknown): Promise<ThemeResponse> {
  const plan = await demographieReadPlan()
  const typedMembers = members.map(({ territory_type, territory_id }) => ({ type: territory_type, id: territory_id }))
  const focalReading = Array.isArray(focalResults) ? focalResults.find((item) => isRecord(item) &&
    item.resource === plan.reading.resource_id) : null
  const cloud = await acquireDemographieReadingCloudWithPlan(plan, typedMembers)
  if (focalReading && isRecord(focalReading) && typeof focalReading.content_version === 'string' &&
      typeof cloud.content_version === 'string' && cloud.content_version !== focalReading.content_version) {
    invalidateSemanticReadCache()
    throw new Error(`Démographie reading cloud publication ${String(cloud.content_version)} does not match focal reading ${focalReading.content_version}`)
  }
  return { reading_resource: plan.reading, reading_cloud: cloud }
}

async function acquireDemographieReadingCloudWithPlan(plan: Awaited<ReturnType<typeof demographieReadPlan>>,
  members: ReadonlyArray<{ type: string; id: string }>) {
  const items = members.map((member) => ({ resource: plan.reading.resource_id,
    target: { kind: 'territory' as const, type: member.type as SemanticReadItem['target']['type'], id: member.id },
    coordinates: { groupe: [plan.reading.group] }, intent: { kind: 'facts' as const } }))
  const results: Record<string, any>[] = []
  for (let offset = 0; offset < items.length; offset += 12) {
    results.push(...await readSemanticBatch(items.slice(offset, offset + 12)) as Record<string, any>[])
  }
  if (results.some((item) => typeof item.content_version !== 'string' || !item.content_version)) {
    throw new Error('Démographie reading cloud publication version is absent')
  }
  const versions = new Set(results.map((item) => item.content_version).filter((version) => typeof version === 'string'))
  if (versions.size > 1) throw new Error('Démographie reading cloud spans incompatible resource versions')
  const points = results.flatMap((item) => {
    const fact = Array.isArray(item.facts) ? item.facts[0] : null
    if (!isRecord(fact)) return []
    return [{ territory: { territory_id: item.target.id, territory_type: item.target.type },
      status: fact.status, periode: fact.periode ?? null,
      taux_solde_naturel: fact.taux_solde_naturel ?? null,
      taux_solde_migratoire: fact.taux_solde_migratoire ?? null,
      classification: fact.classification ?? null, source_id: fact.source_id ?? null,
      vintage_id: fact.vintage_id ?? null }]
  })
  return { status: points.length ? 'available' : 'unavailable', content_version: versions.values().next().value ?? null,
    groupe: plan.reading.group,
    story_key: plan.reading.story_key, points }
}

async function demographieReadPlan() {
  const [metadataResponse, catalogueResponse] = await Promise.all([fetch('/data/theme_demographie.json'), fetch('/api/resources')])
  if (!metadataResponse.ok || !catalogueResponse.ok) throw new Error('Démographie producer resource discovery unavailable')
  const [metadata, catalogue]: [unknown, unknown] = await Promise.all([metadataResponse.json(), catalogueResponse.json()])
  if (!isRecord(metadata) || !isRecord(metadata.indicator_pages) || !Array.isArray(metadata.subgroups) ||
      !isRecord(catalogue) || catalogue.contract !== 'semantic-resource-catalogue-v1' || !Array.isArray(catalogue.resources)) {
    throw new Error('Démographie resource metadata is incompatible')
  }
  const resources = catalogue.resources.filter((value): value is Record<string, any> => isRecord(value) && value.theme_id === 'demographie')
  const indicatorResources = resources.filter((resource) => resource.resource_kind === 'indicator')
  if (indicatorResources.some((resource) => typeof resource.resource_id !== 'string' ||
      !Object.hasOwn(metadata.indicator_pages, resource.resource_id))) {
    throw new Error('Démographie API resources are missing published indicator metadata')
  }
  const pageIds = Object.keys(metadata.indicator_pages).sort()
  const resourceIds = indicatorResources.map((resource) => resource.resource_id as string).sort()
  if (pageIds.length !== resourceIds.length || pageIds.some((id, index) => id !== resourceIds[index])) {
    throw new Error('Démographie published indicator metadata does not match the API resource catalogue')
  }
  for (const found of indicatorResources) {
    if (!Array.isArray(found.intents) || !found.intents.includes('facts') ||
        !found.intents.includes('fixed_comparison') || !found.intents.includes('selected_comparison')) {
      throw new Error(`Démographie comparison capability is not declared for ${found.resource_id}`)
    }
  }
  const readings = resources.filter((resource) => resource.resource_kind === 'typed_reading' &&
    typeof resource.resource_id === 'string' && Array.isArray(resource.fields) &&
    ['status', 'source_id', 'vintage_id'].every((field) => resource.fields.includes(field)) &&
    Array.isArray(resource.sources) && resource.sources.length > 0 &&
    resource.sources.every((source: unknown) => typeof source === 'string' && source.length > 0))
  const readingGroups = metadata.subgroups.filter((value: unknown) => isRecord(value) && isRecord(value.reading))
  const group = readingGroups.length === 1 ? readingGroups[0] : null
  const storyKey = isRecord(group) && isRecord(group.reading) && typeof group.reading.story_key === 'string'
    ? group.reading.story_key : null
  if (!indicatorResources.length || readings.length !== 1 ||
      !isRecord(group) || typeof group.key !== 'string' || !storyKey) throw new Error('Démographie resource declarations are incomplete')
  return { indicatorResources, reading: { resource_id: readings[0]!.resource_id as string,
    sources: readings[0]!.sources as string[], group: group.key as string, story_key: storyKey } }
}

function demographieComparisonCompatible(focal: ThemeResponse, comparison: ThemeResponse): boolean {
  if (comparison.contract !== 'semantic-demographie-comparison-v1' || !Array.isArray(focal.resource_results) ||
      !Array.isArray(comparison.resource_results)) return false
  const declarations = (focal.resource_results as Record<string, any>[]).map((item) => ({
    resource_id: item.resource, shapes: item.descriptor ? ['declared_profile'] : ['scalar'],
  })).filter((item) => item.resource_id !== undefined &&
    !(focal.resource_results as Record<string, any>[]).find((fact) => fact.resource === item.resource_id)?.facts)
  const reading = (focal.resource_results as Record<string, any>[]).find((item) => Array.isArray(item.facts))
  const cloud = isRecord(comparison.reading_cloud) ? comparison.reading_cloud : null
  if (cloud?.content_version !== null && cloud?.content_version !== undefined &&
      cloud.content_version !== reading?.content_version) return false
  return validerVersionsComparaisonDemographie(focal.resource_results as Record<string, any>[],
    comparison.resource_results as Record<string, any>[], declarations)
}

function validerVersionsComparaisonDemographie(facts: Record<string, any>[], comparisons: Record<string, any>[],
  declarations: Record<string, any>[]): boolean {
  if (comparisons.length !== declarations.length) return false
  const factsByResource = new Map(facts.map((item) => [item.resource, item]))
  const declarationsByResource = new Map(declarations.map((item) => [item.resource_id, item]))
  const comparedResources = new Set<string>()
  for (const comparison of comparisons) {
    if (!isRecord(comparison)) return false
    const resource = comparison.resource
    if (typeof resource !== 'string' || comparedResources.has(resource)) return false
    comparedResources.add(resource)
    const fact = factsByResource.get(resource)
    const declaration = declarationsByResource.get(resource)
    if (!fact || !declaration || !isRecord(comparison.result)) return false
    const sameResourceVersion = declaration.shapes?.includes('declared_profile')
      ? comparison.profile_content_version === fact.content_version
      : comparison.content_version === fact.content_version
    if (!sameResourceVersion) return false
    if (fact?.reference_content_version && comparison.reference_content_version !== fact.reference_content_version) return false
    const dependency = comparison.result.source_facet_indicator_id
    if (typeof dependency === 'string') {
      const dependencyFact = factsByResource.get(dependency)
      if (!dependencyFact || comparison.scalar_content_version !== dependencyFact.content_version) return false
    }
    if (typeof comparison.reference_content_version !== 'string' || !comparison.reference_content_version) return false
  }
  return comparisons.length > 0
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function acquireThemeComparison(type: string, id: string, theme: ThemeKey,
  selection?: readonly ThemeSelectionMember[]): Promise<ThemeResponse> {
  if (theme === 'demographie') return acquireDemographieComparison(type, id, selection)
  const path = `/api/territories/${encodeURIComponent(type)}/${encodeURIComponent(id)}/themes/${theme}/comparison`
  return postThemeResponse(path, { theme_id: theme, ...(selection === undefined ? {} : { selection }) }, theme)
}

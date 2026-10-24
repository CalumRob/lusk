export type ThemeKey = 'programmes' | 'demographie' | 'habitat' | 'economie' | 'milieux' | 'mobilite'
import type { TerritoireType, Theme } from './types'
import { validerReponseComparaisonTheme } from './themeFactsAdapter'
import { chargerCatalogueRessources, lireRessourcesBatch } from './semanticResourceClient'
import type { SemanticReadItem, SemanticResourceDeclaration, SemanticTerritoryTarget } from './semanticResourceClient'
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
  resource_reads?: SemanticThemeRead[]
  default_comparison?: { theme_id?: ThemeKey; selection?: readonly ThemeSelectionMember[]; comparison_reads: SemanticThemeRead[] }
  comparison_reads?: SemanticThemeRead[]
  cohort_reads?: SemanticThemeRead[]
  named_reference_reads?: SemanticThemeRead[]
  comparison_error?: boolean
  cohort_error?: boolean
  named_reference_error?: boolean
  selection?: unknown
  [key: string]: unknown
}

export interface SemanticThemeRead {
  resource: string
  shapes?: string[]
  declaration?: SemanticResourceDeclaration
  data: Record<string, unknown>
}

export function normalizePublicationTokens(response: ThemeResponse): Record<string, unknown> {
  if (Array.isArray(response.resource_reads)) {
    return Object.fromEntries(response.resource_reads.map(({ resource, data }) => [resource, {
      content_version: data.content_version ?? data.publication_id,
      reference_content_version: data.reference_content_version,
      descriptor_version: data.descriptor_version,
      profile_content_version: data.profile_content_version,
      scalar_content_version: data.scalar_content_version,
      collection_content_version: data.collection_content_version,
    }]))
  }
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

type SemanticCompatibilityOptions = {
  legacyReferenceVersions?: ReadonlyMap<string, string>
  allowLegacyReferenceBootstrap?: boolean
}

const OWNED_SERIES_FACT_MARKERS = ['dataset_id', 'theme_id', 'axis_values', 'axis_numeric_values',
  'reference_content_version', 'published_at', 'observation_period_kind', 'comparison_contract',
  'scope_series', 'named_references', 'context'] as const
const OWNED_SERIES_COMPARISON_MARKERS = ['dataset_id', 'theme_id', 'axis_values', 'axis_numeric_values',
  'published_at', 'observation_period_kind', 'comparison_contract', 'scope_series', 'named_references', 'context'] as const

function hasOwnAny(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function isNativeLegacySeriesFocal(read: SemanticThemeRead): boolean {
  const data = read.data
  return read.shapes?.includes('ordered_series') === true && !hasOwnAny(data, OWNED_SERIES_FACT_MARKERS) &&
    typeof data.publication_id === 'string' && Boolean(data.publication_id) &&
    typeof data.axis_kind === 'string' && Boolean(data.axis_kind) &&
    typeof data.completeness === 'string' && Boolean(data.completeness) &&
    typeof data.label === 'string' && Boolean(data.label) && typeof data.unit === 'string' &&
    typeof data.direction === 'string' && Boolean(data.direction) &&
    typeof data.descriptor_version === 'string' && Boolean(data.descriptor_version) &&
    Object.prototype.hasOwnProperty.call(data, 'comparison_point') &&
    typeof data.availability === 'string' && Boolean(data.availability) && Array.isArray(data.points)
}

function legacySeriesReferenceVersions(facts: ThemeResponse, comparison: ThemeResponse): Map<string, string> {
  const focalByResource = new Map((facts.resource_reads ?? []).map((read) => [read.resource, read]))
  const references = new Map<string, string>()
  for (const read of comparison.comparison_reads ?? []) {
    const focal = focalByResource.get(read.resource)
    if (!focal || !isNativeLegacySeriesFocal(focal) || read.data.shape !== 'series') continue
    const result = read.data.result
    const ownedEvidence = hasOwnAny(read.data, OWNED_SERIES_COMPARISON_MARKERS) ||
      (typeof result === 'object' && result !== null && !Array.isArray(result) &&
       Object.prototype.hasOwnProperty.call(result, 'owned_content_version'))
    const reference = read.data.reference_content_version
    if (!ownedEvidence && typeof reference === 'string' && reference.length > 0) {
      references.set(read.resource, reference)
    }
  }
  return references
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
  private readonly pendingComparisons = new Map<string, Promise<ThemeResponse>>()
  private readonly generations = new Map<string, number>()
  private readonly comparisonGenerations = new Map<string, number>()
  private readonly legacyReferenceVersions = new Map<string, Map<string, string>>()

  constructor(
    private readonly acquireFacts: (theme: ThemeKey, key?: Key) => Promise<T>,
    private readonly acquireComparison?: (selection: readonly ThemeSelectionMember[] | undefined, theme: ThemeKey, key?: Key) => Promise<ThemeResponse>,
  ) {}

  private key({ type, id, theme }: Key): string { return JSON.stringify([type, id, theme]) }

  private assertCurrentFocal(cacheKey: string, generation: number, focal: AcquiredTheme<T>): void {
    if (generation !== (this.generations.get(cacheKey) ?? 0) ||
        this.entries.get(cacheKey)?.focal !== focal.focal) {
      throw new Error('Stale theme acquisition response')
    }
  }

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
      const comparisons = new Map<string, ThemeResponse>()
      if (focal.default_comparison) comparisons.set('omitted', {
        ...focal.default_comparison, cohort_reads: focal.cohort_reads,
        cohort_error: focal.cohort_error,
        named_reference_reads: focal.named_reference_reads,
      } as ThemeResponse)
      const result = { focal, comparisons }
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
    const focalGeneration = this.generations.get(cacheKey) ?? 0
    const focal = await this.get(type, id, theme)
    this.assertCurrentFocal(cacheKey, focalGeneration, focal)
    if (!this.acquireComparison) return focal
    const selectionKey = cleSelectionComparaison(selection)
    const existing = focal.comparisons.get(selectionKey)
    if (existing && !existing.cohort_error) return this.entries.get(cacheKey)!
    const pendingKey = JSON.stringify([cacheKey, selectionKey])
    const pending = this.pendingComparisons.get(pendingKey)
    if (pending) {
      await pending
      this.assertCurrentFocal(cacheKey, focalGeneration, focal)
      return this.entries.get(cacheKey)!
    }
    const generation = (this.comparisonGenerations.get(pendingKey) ?? 0) + 1
    this.comparisonGenerations.set(pendingKey, generation)
    const request = this.acquireComparison(selection, theme, key).then((comparison) => {
      if (generation !== this.comparisonGenerations.get(pendingKey)) throw new Error('Stale theme comparison response')
      this.assertCurrentFocal(cacheKey, focalGeneration, focal)
      const legacySeriesResponse = (focal.focal.resource_reads ?? []).some((read) =>
        isNativeLegacySeriesFocal(read) && comparison.comparison_reads?.some((candidate) =>
          candidate.resource === read.resource && candidate.data.shape === 'series'))
      if (legacySeriesResponse) {
        validerReponseComparaisonTheme(theme, comparison, selection, { type: type as TerritoireType, id })
      }
      const references = this.legacyReferenceVersions.get(cacheKey) ?? new Map<string, string>()
      const compatible = semanticPublicationsCompatible(focal.focal, comparison, { type, id }, {
        legacyReferenceVersions: references, allowLegacyReferenceBootstrap: true,
      })
      if (!compatible) throw new Error('Theme publication tokens do not match; retry comparison')
      // A successful comparison-only read can bootstrap the missing legacy
      // reference anchor after facts-only recovery. Re-read the binding map in
      // this synchronous commit section so concurrent selections cannot race
      // each other into establishing different references for one focal entry.
      const currentReferences = this.legacyReferenceVersions.get(cacheKey) ?? new Map<string, string>()
      const learnedReferences = legacySeriesReferenceVersions(focal.focal, comparison)
      for (const [resource, reference] of learnedReferences) {
        const current = currentReferences.get(resource)
        if (current !== undefined && current !== reference) {
          throw new Error('Theme publication tokens do not match; retry comparison')
        }
      }
      this.assertCurrentFocal(cacheKey, focalGeneration, focal)
      const current = this.entries.get(cacheKey)!
      if (learnedReferences.size) {
        const boundReferences = new Map(currentReferences)
        for (const [resource, reference] of learnedReferences) boundReferences.set(resource, reference)
        this.legacyReferenceVersions.set(cacheKey, boundReferences)
      }
      const result = { ...current, comparisons: new Map(current.comparisons).set(selectionKey, comparison) }
      this.entries.set(cacheKey, result)
      return comparison
    }).finally(() => {
      if (this.pendingComparisons.get(pendingKey) === request) this.pendingComparisons.delete(pendingKey)
    })
    this.pendingComparisons.set(pendingKey, request)
    await request
    this.assertCurrentFocal(cacheKey, focalGeneration, focal)
    return this.entries.get(cacheKey)!
  }

  /** Drop one aggregate without disturbing its already acquired focal facts or sibling selections. */
  invalidateComparison(type: string, id: string, theme: ThemeKey,
    selection: readonly ThemeSelectionMember[] | undefined): void {
    const cacheKey = this.key({ type, id, theme })
    const selectionKey = cleSelectionComparaison(selection)
    const pendingKey = JSON.stringify([cacheKey, selectionKey])
    const cached = this.entries.get(cacheKey)
    if (cached?.comparisons.has(selectionKey)) {
      const comparisons = new Map(cached.comparisons)
      comparisons.delete(selectionKey)
      this.entries.set(cacheKey, { ...cached, comparisons })
    }
    this.comparisonGenerations.set(pendingKey, (this.comparisonGenerations.get(pendingKey) ?? 0) + 1)
    this.pendingComparisons.delete(pendingKey)
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
      this.legacyReferenceVersions.delete(key)
    }
    for (const pendingKey of [...this.pendingComparisons.keys()]) {
      const [entryKey] = JSON.parse(pendingKey) as [string, string]
      const identity = JSON.parse(entryKey) as [string, string, ThemeKey]
      if (identity[0] === type && identity[1] === id && (!theme || identity[2] === theme)) {
        this.comparisonGenerations.set(pendingKey, (this.comparisonGenerations.get(pendingKey) ?? 0) + 1)
        this.pendingComparisons.delete(pendingKey)
      }
    }
  }
}

/**
 * Le chemin d'acquisition API est le DÉFAUT du produit (#627, décision
 * propriétaire 2026-10-06) : l'incumbent statique ne survit que comme opt-out
 * explicite — `VITE_THEME_ACQUISITION_API='0'`. Couplage de déploiement : un
 * build par défaut découvre les ressources productrices et les lit par lots
 * sémantiques bornés (sinon la fiche échoue fermé, jamais de repli statique).
 */
export function themeAcquisitionEnabled(env: Record<string, unknown>): boolean {
  return env.VITE_THEME_ACQUISITION_API !== '0'
}

let catalogueRequest: Promise<SemanticResourceDeclaration[]> | null = null
let catalogueFetcher: typeof fetch | null = null
function producerCatalogue(): Promise<SemanticResourceDeclaration[]> {
  // A browser has one stable fetch function for the page lifetime. Keeping its
  // identity with the cached discovery also avoids leaking one test's mocked
  // catalogue into another mounted test that installs a different fetcher.
  if (catalogueFetcher !== fetch) {
    catalogueFetcher = fetch
    catalogueRequest = null
  }
  if (!catalogueRequest) catalogueRequest = chargerCatalogueRessources().catch((error) => {
    catalogueRequest = null
    throw error
  })
  return catalogueRequest
}

function chunked<T>(items: T[], size = 12, keepTogether?: (left: T, right: T) => boolean): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length;) {
    let end = Math.min(index + size, items.length)
    if (end < items.length && keepTogether?.(items[end - 1]!, items[end]!)) end -= 1
    batches.push(items.slice(index, end))
    index = end
  }
  return batches
}

function sharesFocalDefaultComparison(left: SemanticReadItem, right: SemanticReadItem): boolean {
  return left.resource === right.resource && left.target.kind === 'territory' && right.target.kind === 'territory' &&
    left.target.type === right.target.type && left.target.id === right.target.id &&
    left.intent.kind === 'facts' && right.intent.kind === 'fixed_comparison' && right.intent.context === 'default'
}

function territoryItem(resource: string, type: string, id: string, intent: SemanticReadItem['intent']): SemanticReadItem {
  return { resource, target: { kind: 'territory', type: type as SemanticTerritoryTarget['type'], id }, intent }
}

function cohortItem(resource: string, type: string): SemanticReadItem {
  return { resource, target: { kind: 'territory_cohort', type: type as SemanticTerritoryTarget['type'] }, intent: { kind: 'facts' } }
}

function namedReferenceItem(resource: string, id: string): SemanticReadItem {
  return { resource, target: { kind: 'named_reference', id }, intent: { kind: 'facts' } }
}

function retainedThemeResources(catalogue: SemanticResourceDeclaration[], theme: ThemeKey, type: string) {
  return catalogue.filter((resource) => resource.theme_id === theme && resource.allowed_levels.includes(type as SemanticTerritoryTarget['type']))
}

async function readAll(items: SemanticReadItem[]): Promise<Array<{ resource: string; data: Record<string, unknown> }>> {
  const output: Array<{ resource: string; data: Record<string, unknown> }> = []
  for (const batch of chunked(items, 12, sharesFocalDefaultComparison)) {
    const data = await lireRessourcesBatch(batch)
    output.push(...batch.map((item, index) => ({ resource: item.resource, data: data[index]! })))
  }
  return output
}

function factAndDefaultComparisonItems(resources: SemanticResourceDeclaration[], type: string, id: string): SemanticReadItem[] {
  return resources.flatMap((resource) => {
    if (!resource.target_kinds.includes('territory') || !resource.intents.includes('facts')) return []
    const items = [territoryItem(resource.resource_id, type, id, { kind: 'facts' })]
    if (resource.intents.includes('fixed_comparison')) {
      items.push(territoryItem(resource.resource_id, type, id, { kind: 'fixed_comparison', context: 'default' }))
    }
    return items
  })
}

function factItems(resources: SemanticResourceDeclaration[], type: string, id: string): SemanticReadItem[] {
  return resources.filter((resource) => resource.target_kinds.includes('territory') && resource.intents.includes('facts'))
    .map((resource) => territoryItem(resource.resource_id, type, id, { kind: 'facts' }))
}

function typedCohortItems(resources: SemanticResourceDeclaration[], type: string): SemanticReadItem[] {
  return resources.filter((resource) => resource.shapes.includes('typed_reading') &&
    resource.allowed_levels.includes(type as SemanticTerritoryTarget['type']) &&
    resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts'))
    .map((resource) => cohortItem(resource.resource_id, type))
}

function namedReferenceItems(resources: SemanticResourceDeclaration[]): SemanticReadItem[] {
  return resources.filter((resource) => resource.shapes.includes('named_reference') &&
    resource.target_kinds.includes('named_reference') && resource.intents.includes('facts'))
    .flatMap((resource) => (resource.target_ids ?? []).map((id) => namedReferenceItem(resource.resource_id, id)))
}

async function readAuxiliary(resources: SemanticResourceDeclaration[], type: string, includeNamedReferences = true) {
  const cohorts = typedCohortItems(resources, type)
  const namedReferences = includeNamedReferences ? namedReferenceItems(resources) : []
  const [cohortResult, namedResult] = await Promise.allSettled([
    cohorts.length ? readAll(cohorts) : Promise.resolve([]),
    namedReferences.length ? readAll(namedReferences) : Promise.resolve([]),
  ])
  const wrap = (reads: Array<{ resource: string; data: Record<string, unknown> }>) => reads.map((read) => {
    const declaration = resources.find((resource) => resource.resource_id === read.resource)
    return { ...read, shapes: declaration?.shapes, declaration }
  })
  return {
    ...(cohortResult.status === 'fulfilled' ? { cohort_reads: wrap(cohortResult.value) } : { cohort_error: true }),
    ...(namedResult.status === 'fulfilled' ? { named_reference_reads: wrap(namedResult.value) } : { named_reference_error: true }),
  }
}

export function semanticPublicationsCompatible(facts: ThemeResponse, comparison: ThemeResponse,
  expectedTarget?: { type: string; id: string }, options: SemanticCompatibilityOptions = {}): boolean {
  const focalReads = facts.resource_reads
  const comparisonReads = comparison.comparison_reads
  if (!Array.isArray(focalReads) || !Array.isArray(comparisonReads)) {
    const actual = normalizePublicationTokens(comparison)
    const expected = normalizePublicationTokens(facts)
    return 'reference_content_version' in actual && 'reference_content_version' in expected &&
      actual.reference_content_version === expected.reference_content_version &&
      ['content_version', 'profile_content_version', 'reading_content_version'].every((name) =>
        !(name in actual && name in expected) || actual[name] === expected[name])
  }
  const focalByResource = new Map(focalReads.map((read) => [read.resource, read.data]))
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  const validDualScalarFacet = (focal: Record<string, unknown>, compared: Record<string, unknown>, resource: string): boolean => {
    const focalFacet = focal.scalar_facet
    const comparedFacet = compared.scalar_facet
    if (focalFacet === undefined || comparedFacet === undefined ||
        typeof focalFacet !== 'object' || focalFacet === null || Array.isArray(focalFacet) ||
        typeof comparedFacet !== 'object' || comparedFacet === null || Array.isArray(comparedFacet)) return false
    const scalar = focalFacet as Record<string, unknown>
    const scalarComparison = comparedFacet as Record<string, unknown>
    const focalDescriptor = scalar.descriptor
    const comparedDescriptor = scalarComparison.descriptor
    const result = scalarComparison.result
    const target = focal.target
    const comparedTarget = compared.target
    const observation = scalar.observation
    const scalarScope = scalarComparison.scope
    const comparedScope = compared.scope
    const scalarSelection = scalarComparison.selection
    const comparedSelection = compared.selection
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
    if (!isRecord(focalDescriptor) || !isRecord(comparedDescriptor) || !isRecord(result) ||
        !isRecord(target) || !isRecord(comparedTarget) || !isRecord(observation) ||
        !isRecord(scalarScope) || !isRecord(comparedScope) ||
        !(scalarSelection === null || Array.isArray(scalarSelection)) ||
        !(comparedSelection === null || Array.isArray(comparedSelection)) ||
        scalar.shape !== 'scalar' || scalar.source_facet !== resource ||
        scalarComparison.shape !== 'scalar' || scalarComparison.source_facet !== resource ||
        focalDescriptor.indicator_id !== resource || comparedDescriptor.indicator_id !== resource ||
        ![scalar.content_version, scalar.reference_content_version, scalar.descriptor_version,
          scalarComparison.content_version, scalarComparison.reference_content_version,
          scalarComparison.descriptor_version].every((value) => typeof value === 'string' && value.length > 0) ||
        focalDescriptor.descriptor_version !== scalar.descriptor_version ||
        comparedDescriptor.descriptor_version !== scalarComparison.descriptor_version ||
        scalarComparison.content_version !== scalar.content_version ||
        scalarComparison.reference_content_version !== scalar.reference_content_version ||
        scalarComparison.descriptor_version !== scalar.descriptor_version ||
        observation.territory_id !== target.id || observation.territory_type !== target.type ||
        target.kind !== 'territory' || comparedTarget.kind !== 'territory' ||
        comparedTarget.id !== target.id || comparedTarget.type !== target.type ||
        result.indicator_id !== resource || result.source_facet !== resource ||
        result.descriptor_version !== scalar.descriptor_version ||
        JSON.stringify(scalarScope) !== JSON.stringify(comparedScope) ||
        JSON.stringify(scalarSelection) !== JSON.stringify(comparedSelection)) return false
    if (scalarComparison.comparison_content_version !== undefined &&
        (typeof scalarComparison.comparison_content_version !== 'string' || !scalarComparison.comparison_content_version)) return false
    if (scalarSelection === null &&
        (typeof scalarComparison.comparison_content_version !== 'string' || !scalarComparison.comparison_content_version)) return false
    return true
  }
  const comparisonCompatible = comparisonReads.every(({ resource, data }) => {
    const focal = focalByResource.get(resource)
    if (!focal) return false
    const focalRead = focalReads.find((read) => read.resource === resource)
    const shapes = focalRead?.shapes ?? []
    const focalTarget = focal.target
    const comparedTarget = data.target
    if (expectedTarget || focalTarget !== undefined || comparedTarget !== undefined) {
      if (!isRecord(focalTarget) || !isRecord(comparedTarget) ||
          focalTarget.kind !== 'territory' || comparedTarget.kind !== 'territory' ||
          focalTarget.type !== comparedTarget.type || focalTarget.id !== comparedTarget.id ||
          (expectedTarget && (focalTarget.type !== expectedTarget.type || focalTarget.id !== expectedTarget.id))) {
        return false
      }
    }
    const comparisonResult = data.result
    if ((data.indicator_id !== undefined && data.indicator_id !== resource) ||
        (isRecord(comparisonResult) && comparisonResult.indicator_id !== undefined &&
         comparisonResult.indicator_id !== resource)) return false
    const nativeSeriesComparison = data.shape === 'series'
    const hasOwnedFocalEvidence = hasOwnAny(focal, OWNED_SERIES_FACT_MARKERS)
    const hasOwnedComparisonEvidence = hasOwnAny(data, OWNED_SERIES_COMPARISON_MARKERS) ||
      (isRecord(comparisonResult) && Object.prototype.hasOwnProperty.call(comparisonResult, 'owned_content_version'))
    const ownedSeries = nativeSeriesComparison && (hasOwnedFocalEvidence || hasOwnedComparisonEvidence)
    const legacySeries = nativeSeriesComparison && !ownedSeries
    if (nativeSeriesComparison) {
      const territory = focal.territory
      if (!shapes.includes('ordered_series') || !isRecord(comparisonResult) ||
          data.contract !== 'indicator-comparison-v1' || data.complete_theme !== false ||
          data.indicator_id !== resource || comparisonResult.indicator_id !== resource ||
          focal.resource !== resource || focal.indicator_id !== resource ||
          !isRecord(territory) || !isRecord(focalTarget) ||
          territory.id !== focalTarget.id || territory.type !== focalTarget.type ||
          typeof focal.descriptor_version !== 'string' || !focal.descriptor_version ||
          comparisonResult.descriptor_version !== focal.descriptor_version ||
          comparisonResult.source_facet !== focal.comparison_point ||
          comparisonResult.unit !== focal.unit || comparisonResult.direction !== focal.direction) return false
      if (ownedSeries) {
        if (typeof focal.dataset_id !== 'string' || !focal.dataset_id ||
            typeof focal.theme_id !== 'string' || !focal.theme_id ||
            (typeof focalRead?.declaration?.theme_id === 'string' &&
             focalRead.declaration.theme_id !== focal.theme_id) ||
            !Array.isArray(focal.axis_values) || focal.axis_values.some((axis) => typeof axis !== 'string' || !axis) ||
            typeof data.theme_id !== 'string' || data.theme_id !== focal.theme_id ||
            typeof focal.reference_content_version !== 'string' || !focal.reference_content_version ||
            comparisonResult.owned_content_version !== data.content_version) return false
      } else if (typeof focal.publication_id !== 'string' || !focal.publication_id ||
          Object.prototype.hasOwnProperty.call(focal, 'content_version') ||
          Object.prototype.hasOwnProperty.call(focal, 'reference_content_version') ||
          hasOwnedFocalEvidence || hasOwnedComparisonEvidence ||
          !Object.prototype.hasOwnProperty.call(focal, 'comparison_point') ||
          typeof focal.axis_kind !== 'string' || !focal.axis_kind ||
          typeof focal.completeness !== 'string' || !focal.completeness ||
          typeof focal.label !== 'string' || !focal.label || typeof focal.unit !== 'string' ||
          typeof focal.direction !== 'string' || !focal.direction ||
          typeof focal.availability !== 'string' || !focal.availability || !Array.isArray(focal.points) ||
          Object.prototype.hasOwnProperty.call(comparisonResult, 'owned_content_version')) return false
    }
    const focalVersion = focal.content_version ?? focal.publication_id
    const comparisonVersion = data.content_version ?? data.publication_id
    if (typeof focalVersion !== 'string' || !focalVersion || typeof comparisonVersion !== 'string' ||
        !comparisonVersion || focalVersion !== comparisonVersion) return false
    if (nativeSeriesComparison && (typeof data.content_version !== 'string' ||
        data.content_version !== focalVersion ||
        (typeof focal.content_version === 'string' && typeof focal.publication_id === 'string' &&
         focal.content_version !== focal.publication_id))) return false
    const hasFocalReferenceVersion = typeof focal.reference_content_version === 'string' &&
      focal.reference_content_version.length > 0
    if (hasFocalReferenceVersion) {
      if (focal.reference_content_version !== data.reference_content_version) return false
    } else if (legacySeries && !Object.prototype.hasOwnProperty.call(focal, 'reference_content_version')) {
      if (typeof data.reference_content_version !== 'string' || !data.reference_content_version) return false
      // The legacy series reader's focal envelope has no reference marker. Its
      // default comparison is read beside focal facts in one API snapshot;
      // later selected reads must retain that published reference token.
      const pairedDefault = facts.default_comparison
      const defaultRead = pairedDefault?.comparison_reads.find((read) => read.resource === resource)
      const defaultData = defaultRead?.data
      const sameSnapshotPair = comparison === pairedDefault || comparisonReads === pairedDefault?.comparison_reads
      if (!sameSnapshotPair) {
        if (defaultData) {
          if (typeof defaultData.reference_content_version !== 'string' ||
              !defaultData.reference_content_version ||
              data.reference_content_version !== defaultData.reference_content_version) return false
        } else {
          const boundReference = options.legacyReferenceVersions?.get(resource)
          if (boundReference !== undefined) {
            if (data.reference_content_version !== boundReference) return false
          } else if (!options.allowLegacyReferenceBootstrap) return false
        }
      }
    } else return false
    const focalDescriptor = focal.descriptor
    if (ownedSeries && (!isRecord(comparisonResult) || typeof data.content_version !== 'string' ||
        comparisonResult.owned_content_version !== data.content_version)) return false
    const dualScalarSeries = shapes.includes('scalar') && shapes.includes('ordered_series')
    if (dualScalarSeries && !validDualScalarFacet(focal, data, resource)) return false
    const profile = shapes.includes('declared_profile')
    if (shapes.includes('scalar') || shapes.includes('ordered_series') || shapes.includes('period_detail')) {
      if (typeof focal.descriptor_version !== 'string' || !focal.descriptor_version ||
          typeof comparisonResult !== 'object' || comparisonResult === null ||
          (comparisonResult as Record<string, unknown>).descriptor_version !== focal.descriptor_version) return false
    }
    if (profile) {
      if (typeof focalDescriptor !== 'object' || focalDescriptor === null ||
          typeof comparisonResult !== 'object' || comparisonResult === null) return false
      const descriptor = focalDescriptor as Record<string, unknown>
      const result = comparisonResult as Record<string, unknown>
      if (descriptor.comparison_scalar !== null && descriptor.comparison_scalar !== undefined) {
        const required = descriptor.required_scalar_version
        const resultRequired = result.required_scalar_version
        const comparisonScalarVersion = data.scalar_content_version
        if (typeof required !== 'string' || !required || resultRequired !== required ||
            comparisonScalarVersion !== required) return false
      } else if (result.required_scalar_version !== undefined && result.required_scalar_version !== null) {
        if (typeof descriptor.required_scalar_version !== 'string' ||
            result.required_scalar_version !== descriptor.required_scalar_version) return false
      }
      if (typeof result.profile_descriptor_version === 'string' &&
          result.profile_descriptor_version !== descriptor.descriptor_version) return false
      if (typeof result.profile_descriptor_version !== 'string' ||
          typeof descriptor.descriptor_version !== 'string' || !descriptor.descriptor_version) return false
    }
    return true
  })
  if (!comparisonCompatible) return false
  for (const read of comparison.cohort_reads ?? []) {
    const focal = focalByResource.get(read.resource)
    if (!focal || (focal.content_version ?? focal.publication_id) !==
        (read.data.content_version ?? read.data.publication_id) ||
        focal.reference_content_version !== read.data.reference_content_version) return false
  }
  for (const read of comparison.named_reference_reads ?? []) {
    const owner = typeof read.data.dataset_id === 'string'
      ? focalReads.find((candidate) => candidate.data.dataset_id === read.data.dataset_id)?.data
      : undefined
    const ownerVersion = owner?.content_version ?? owner?.publication_id
    const referenceVersion = read.data.publication_id ?? read.data.content_version
    if (!owner || typeof ownerVersion !== 'string' || !ownerVersion || ownerVersion !== referenceVersion ||
        owner.reference_content_version !== read.data.reference_content_version) return false
  }
  return true
}

export function acquireThemeFacts(type: string, id: string, theme: ThemeKey,
  _selection?: readonly ThemeSelectionMember[]): Promise<ThemeResponse> {
  return (async () => {
    const themeResources = (await producerCatalogue()).filter((resource) => resource.theme_id === theme)
    const resources = retainedThemeResources(themeResources, theme, type)
    const items = factAndDefaultComparisonItems(resources, type, id)
    if (!items.length) return { theme_id: theme, resource_reads: [],
      default_comparison: { theme_id: theme, comparison_reads: [] },
      ...(await readAuxiliary(themeResources, type)) }
    try {
      const paired = await readAll(items)
      const resourceReads = paired.filter((_, index) => items[index]!.intent.kind === 'facts')
        .map((read) => { const declaration = resources.find((resource) => resource.resource_id === read.resource)
          return { ...read, shapes: declaration?.shapes, declaration } })
      const comparisonReads = paired.filter((_, index) => items[index]!.intent.kind !== 'facts')
        .map((read) => { const declaration = resources.find((resource) => resource.resource_id === read.resource)
          return { ...read, shapes: declaration?.shapes, declaration } })
      const defaultComparison = { theme_id: theme, comparison_reads: comparisonReads }
      const result: ThemeResponse = { theme_id: theme, resource_reads: resourceReads, default_comparison: defaultComparison }
      if (!semanticPublicationsCompatible(result, defaultComparison, { type, id })) {
        throw new Error('Les publications sémantiques focales et comparées diffèrent')
      }
      return { ...result, ...(await readAuxiliary(themeResources, type)) }
    } catch (pairedFailure) {
      // A semantic batch is atomic. Never salvage a successful prefix: start a
      // new facts-only read set, which has its own snapshots and dependencies.
      const recovered = (await readAll(factItems(resources, type, id))).map((read) => ({ ...read,
        shapes: resources.find((resource) => resource.resource_id === read.resource)?.shapes,
        declaration: resources.find((resource) => resource.resource_id === read.resource) }))
      return { theme_id: theme, resource_reads: recovered, comparison_error: true,
        comparison_failure: pairedFailure instanceof Error ? pairedFailure.message : String(pairedFailure),
        ...(await readAuxiliary(themeResources, type)) }
    }
  })()
}

export function acquireThemeComparison(type: string, id: string, theme: ThemeKey,
  selection?: readonly ThemeSelectionMember[]): Promise<ThemeResponse> {
  return (async () => {
    const themeResources = (await producerCatalogue()).filter((resource) => resource.theme_id === theme)
    const resources = retainedThemeResources(themeResources, theme, type)
      .filter((resource) => resource.target_kinds.includes('territory') && resource.intents.includes(selection === undefined ? 'fixed_comparison' : 'selected_comparison'))
    const intent: SemanticReadItem['intent'] = selection === undefined
      ? { kind: 'fixed_comparison', context: 'default' }
      : { kind: 'selected_comparison', members: selection.map(({ territory_type, territory_id }) => ({ type: territory_type, id: territory_id })) }
    const items = resources.map((resource) => territoryItem(resource.resource_id, type, id, intent))
    const comparisons = await readAll(items)
    const auxiliary = await readAuxiliary(themeResources, type, false)
    const echoedSelection = comparisons.length ? comparisons[0]!.data.selection : undefined
    if (comparisons.some(({ data }) => JSON.stringify(data.selection ?? null) !== JSON.stringify(echoedSelection ?? null))) {
      throw new Error('Les comparaisons sémantiques ne reflètent pas la même sélection')
    }
    return { theme_id: theme, ...(selection === undefined ? {} : { selection }),
      comparison_reads: comparisons.map((read) => ({ ...read,
        shapes: resources.find((resource) => resource.resource_id === read.resource)?.shapes,
        declaration: resources.find((resource) => resource.resource_id === read.resource) })), ...auxiliary,
      ...(Array.isArray(echoedSelection) ? { selection: echoedSelection } : {}) }
  })()
}

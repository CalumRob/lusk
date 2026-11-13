export type ThemeKey = 'programmes' | 'demographie' | 'habitat' | 'economie' | 'milieux' | 'mobilite'
import type { TerritoireType, Theme } from './types'
import { validerReponseComparaisonTheme } from './themeFactsAdapter'
import { chargerCatalogueRessources, invalidateSemanticItems, invalidateSemanticReads,
  invalidateSemanticReadsForTarget, publicationFamilyForResource, readSemanticOutcomes } from './semanticResourceClient'
import type { SemanticPublicationFamily, SemanticPublicationReason, SemanticReadItem,
  SemanticReadOutcome, SemanticResourceDeclaration, SemanticTerritoryTarget } from './semanticResourceClient'
import { PayloadError } from './validate'
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

/** Explicit per-resource outcome so one unpublished resource never blanks a whole theme page. */
export interface ThemeResourceFailure {
  resource: string
  label: string | null
  stage: 'facts' | 'comparison'
  /** A settled publication absence, or a hard request/validation failure. */
  state: 'publication_unavailable' | 'error'
  family?: SemanticPublicationFamily
  reason?: SemanticPublicationReason
  message: string
}

export interface ThemeResponse {
  tokens?: Record<string, unknown>
  resource_reads?: SemanticThemeRead[]
  default_comparison?: { theme_id?: ThemeKey; selection?: readonly ThemeSelectionMember[]; comparison_reads: SemanticThemeRead[] }
  /**
   * #986 — the comparison the active header actually displays, read in the SAME
   * acquisition as the focal facts (one snapshot, one publication identity).
   * `default_comparison` stays the producer's declared default and is therefore
   * empty here: a custom/preset page must never fall back to the default scope.
   */
  demand_comparison?: { selection: readonly ThemeSelectionMember[]; comparison_reads: SemanticThemeRead[]
    /** Every declared comparison of this demand stayed unavailable: explicit retry only. */
    comparison_error?: boolean
    comparison_failure?: string }
  comparison_reads?: SemanticThemeRead[]
  cohort_reads?: SemanticThemeRead[]
  named_reference_reads?: SemanticThemeRead[]
  /** Resources whose declared publication failed while their bounded group stayed isolated. */
  resource_failures?: ThemeResourceFailure[]
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

/**
 * A hard acquisition-level incoherence. The error carries every semantic key
 * the failed acquisition asked for so the caller can fence the whole group,
 * not one resource at a time.
 */
export class ThemeAcquisitionCoherenceError extends PayloadError {
  constructor(message: string, readonly items: readonly SemanticReadItem[]) {
    super('validation', '/api/resources/read-batch', message)
    this.name = 'ThemeAcquisitionCoherenceError'
  }
}

interface DatasetGeneration {
  family: string
  owner: string
  version: string
}

const nonEmptyVersion = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

function dataOwner(data: Record<string, unknown>, resource: string): string {
  const dataset = nonEmptyVersion(data.dataset_id)
  if (dataset) return dataset
  const descriptor = data.descriptor
  if (typeof descriptor === 'object' && descriptor !== null && !Array.isArray(descriptor)) {
    const nested = nonEmptyVersion((descriptor as Record<string, unknown>).dataset_id)
    if (nested) return nested
  }
  return `resource:${resource}`
}

/**
 * One observed published-dataset marker per declared family. The public token
 * fields are the source of truth:
 * - every scalar resource shares the global `scalar_observation` clock;
 * - every declared profile shares the global `declared_profile` clock;
 * - owned series and typed readings are independent owners, keyed by their
 *   actual `dataset_id` (or resource when the producer exposes no dataset id);
 * - collections and named references are keyed by their owner resource.
 * A family clock that the contract requires but the response omits is a hard
 * failure: the reference clock is never used as a substitute.
 */
function datasetGeneration(read: SemanticThemeRead, declaration: SemanticResourceDeclaration): DatasetGeneration {
  const family = publicationFamilyForResource(declaration)
  const data = read.data
  const required = (version: unknown, field: string): string => {
    const value = nonEmptyVersion(version)
    if (value) return value
    throw new ThemeAcquisitionCoherenceError(
      `La lecture « ${read.resource} » ne publie pas la version ${field} exigée par son contrat.`, [])
  }
  if (family === 'scalar') {
    return { family: 'scalar_observation', owner: 'scalar_observation',
      version: required(data.content_version, 'content_version') }
  }
  if (family === 'profile') {
    const profile = nonEmptyVersion(data.profile_content_version)
    const content = nonEmptyVersion(data.content_version)
    if (profile && content && profile !== content) {
      throw new ThemeAcquisitionCoherenceError(
        `La lecture « ${read.resource} » publie deux versions de profil ambiguës.`, [])
    }
    const version = profile ?? content
    if (!version) {
      throw new ThemeAcquisitionCoherenceError(
        `La lecture « ${read.resource} » ne publie pas la version profile_content_version exigée par son contrat.`, [])
    }
    return { family: 'declared_profile', owner: 'declared_profile', version }
  }
  if (family === 'ordered_series') {
    const content = nonEmptyVersion(data.content_version)
    const publication = nonEmptyVersion(data.publication_id)
    if (content && publication && content !== publication) {
      throw new ThemeAcquisitionCoherenceError(
        `La lecture « ${read.resource} » publie deux versions de série ambiguës.`, [])
    }
    return { family: 'ordered_series', owner: dataOwner(data, read.resource),
      version: required(content ?? publication, 'content_version') }
  }
  if (family === 'typed_reading') {
    return { family: 'typed_reading', owner: dataOwner(data, read.resource),
      version: required(data.content_version, 'content_version') }
  }
  if (family === 'named_reference') {
    return { family: 'named_reference', owner: dataOwner(data, read.resource),
      version: required(data.publication_id ?? data.content_version, 'publication_id') }
  }
  if (family === 'collection') {
    return { family: 'collection', owner: dataOwner(data, read.resource),
      version: required(data.content_version ?? data.collection_content_version, 'content_version') }
  }
  if (family === 'aedar') {
    return { family: 'aedar', owner: 'aedar', version: required(data.content_version, 'content_version') }
  }
  // `shape` is not used to classify the family: the declaration is the closed
  // contract. This branch only keeps the exhaustiveness of the closed set.
  throw new ThemeAcquisitionCoherenceError(
    `La famille de publication de « ${read.resource} » est absente du contrat.`, [])
}

interface GenerationEntry {
  read: SemanticThemeRead
  item?: SemanticReadItem
}

/**
 * Validate one acquisition's available facts/auxiliary reads against their
 * dataset-family clocks and the global territory reference, and return the
 * exact publication vector used as the cache/coherence identity. Unavailable
 * outcomes carry no versions and are therefore never compared.
 */
function validateAcquisitionGenerations(entries: readonly GenerationEntry[],
  resources: readonly SemanticResourceDeclaration[],): string | undefined {
  const byResource = new Map(resources.map((resource) => [resource.resource_id, resource]))
  const versions = new Map<string, DatasetGeneration>()
  const references = new Set<string>()
  for (const entry of entries) {
    const declaration = entry.read.declaration ?? byResource.get(entry.read.resource)
    if (!declaration) {
      throw new ThemeAcquisitionCoherenceError(
        `La lecture « ${entry.read.resource} » n’a pas de déclaration producteur.`,
        entry.item ? [entry.item] : [])
    }
    const generation = datasetGeneration(entry.read, declaration)
    const key = `${generation.family}:${generation.owner}`
    const prior = versions.get(key)
    if (prior && prior.version !== generation.version) {
      throw new ThemeAcquisitionCoherenceError(
        `Les lectures sémantiques de cette acquisition mélangent plusieurs générations de publication (${key}).`,
        entries.flatMap(({ item }) => item ? [item] : []))
    }
    versions.set(key, generation)
    const reference = nonEmptyVersion(entry.read.data.reference_content_version)
    if (reference) references.add(reference)
  }
  if (references.size > 1) {
    throw new ThemeAcquisitionCoherenceError(
      'Les lectures sémantiques de cette acquisition ne partagent pas le même référentiel territorial.',
      entries.flatMap(({ item }) => item ? [item] : []))
  }
  if (!versions.size) return undefined
  const datasets = [...versions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, { family, owner, version }]) => ({ family, owner, key, version }))
  return `dataset-generation:${JSON.stringify({ datasets,
    reference: references.size === 1 ? [...references][0] : null })}`
}

/**
 * The admitted facts' observed dataset vector plus the global territory
 * reference is the acquisition identity comparison/auxiliary reads may reuse.
 * Different resources are different datasets; only the same family owner must
 * carry the same published version.
 */
function acquisitionCoherence(response: ThemeResponse): string | undefined {
  try {
    return validateAcquisitionGenerations(
      (response.resource_reads ?? []).map((read) => ({ read })), [])
  } catch {
    // A malformed/legacy response has no reusable identity; comparison and aux
    // reads then re-read over HTTP rather than binding to the reference alone.
    return undefined
  }
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

/** One theme's critical demand: the chapter the reader requested, not the whole register. */
export interface ThemeFactsDemand {
  /**
   * Producer indicator identities the requested chapter displays. Omitted means
   * every retained resource (the historical whole-theme read).
   */
  indicators?: readonly string[]
  /**
   * The comparison intent the active header displays:
   * - `undefined` — the producer's declared nested default;
   * - an explicit member list — the selected/preset group, read with the facts;
   * - `null` — no comparison now (a deferred chapter owns it).
   */
  selection?: readonly ThemeSelectionMember[] | null
  /**
   * Whether this demand owns the chapter's typed-cohort and named-reference
   * reads. A page that displays neither defers them with their chapter.
   */
  auxiliary?: boolean
  /** Background warming never competes with the reader's critical demand. */
  priority?: 'critical' | 'background'
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
  /**
   * #986 — the state of each requested chapter's own comparison demand. A chapter
   * whose comparison publication is absent is an explicit error for THAT demand,
   * even when another chapter's reads for the same selection are already cached.
   */
  demands?: Map<string, ComparisonDemandState>
}

/** One requested chapter's comparison demand: scope + settled outcome. */
export interface ComparisonDemandState {
  selection: readonly ThemeSelectionMember[] | undefined
  indicators: readonly string[]
  status: 'ready' | 'error'
  failure?: string
}

function comparisonDemandKey(selection: readonly ThemeSelectionMember[] | undefined,
  indicators: readonly string[]): string {
  return JSON.stringify([cleSelectionComparaison(selection), [...indicators].sort()])
}

/** The settled state of one requested chapter's comparison demand, if it was read. */
export function comparisonDemandState<T extends ThemeResponse>(entry: AcquiredTheme<T>,
  selection: readonly ThemeSelectionMember[] | undefined,
  indicators: readonly string[]): ComparisonDemandState | undefined {
  return entry.demands?.get(comparisonDemandKey(selection, indicators))
}

/**
 * #986 — the aggregate entry of one selection scope carries the LAST requested
 * chapter's comparison outcome. A healthy chapter clears an earlier chapter's
 * stale failure; that earlier chapter's own demand state keeps its error (and
 * therefore its retry) untouched.
 */
function withComparisonOutcome(entry: ThemeResponse, failure: string | undefined): ThemeResponse {
  const next: ThemeResponse = { ...entry }
  delete next.comparison_error
  delete next.comparison_failure
  return failure === undefined ? next : { ...next, comparison_error: true, comparison_failure: failure }
}

/** Exact duplicate comparison reads collapse; distinct declared detail points never do. */
function mergeComparisonReads(base: readonly SemanticThemeRead[] | undefined,
  added: readonly SemanticThemeRead[] | undefined): SemanticThemeRead[] {
  const merged = new Map<string, SemanticThemeRead>((base ?? [])
    .map((read) => [`${read.resource}\u0000${JSON.stringify(read.data)}`, read] as const))
  for (const read of added ?? []) merged.set(`${read.resource}\u0000${JSON.stringify(read.data)}`, read)
  return [...merged.values()]
}

function withDemandState<T extends ThemeResponse>(entry: AcquiredTheme<T>, selection: readonly ThemeSelectionMember[] | undefined,
  indicators: readonly string[], status: 'ready' | 'error', failure?: string): AcquiredTheme<T> {
  const demands = new Map(entry.demands ?? [])
  demands.set(comparisonDemandKey(selection, indicators), {
    selection, indicators: [...indicators], status,
    ...(failure === undefined ? {} : { failure }),
  })
  return { ...entry, demands }
}

type Key = { type: string; id: string; theme: ThemeKey }

/** Lazy per-theme cache. A comparison is independently acquired and can never replace focal facts. */
export class ThemeAcquisitionCache<T extends ThemeResponse = ThemeResponse> {
  private readonly entries = new Map<string, AcquiredTheme<T>>()
  private readonly pendingFacts = new Map<string, Promise<AcquiredTheme<T>>>()
  /** Identical demanded-chapter extensions in flight are shared, never doubled. */
  private readonly pendingExtensions = new Map<string, Promise<AcquiredTheme<T>>>()
  private readonly pendingComparisons = new Map<string, Promise<ThemeResponse>>()
  private readonly generations = new Map<string, number>()
  private readonly comparisonGenerations = new Map<string, number>()
  private readonly legacyReferenceVersions = new Map<string, Map<string, string>>()

  constructor(
    private readonly acquireFacts: (theme: ThemeKey, key?: Key, demand?: ThemeFactsDemand) => Promise<T>,
    private readonly acquireComparison?: (selection: readonly ThemeSelectionMember[] | undefined, theme: ThemeKey, key?: Key, coherence?: string, indicators?: readonly string[], fresh?: boolean) => Promise<ThemeResponse>,
  ) {}

  private key({ type, id, theme }: Key): string { return JSON.stringify([type, id, theme]) }

  private assertCurrentFocal(cacheKey: string, generation: number, focal: AcquiredTheme<T>): void {
    if (generation !== (this.generations.get(cacheKey) ?? 0) ||
        this.entries.get(cacheKey)?.focal !== focal.focal) {
      throw new Error('Stale theme acquisition response')
    }
  }

  /** Indicator identities already carried by a settled entry (facts, cohorts, named references). */
  private loadedIndicators(entry: AcquiredTheme<T>): Set<string> {
    const focal = entry.focal
    return new Set([
      ...(focal.resource_reads ?? []).map((read) => read.declaration?.indicator_id ?? read.resource),
      ...(focal.cohort_reads ?? []).map((read) => read.declaration?.indicator_id ?? read.resource),
      ...(focal.named_reference_reads ?? []).map((read) => read.declaration?.indicator_id ?? read.resource),
    ])
  }

  /**
   * #986 — a chapter the reader actually navigated to is added to the settled
   * entry: only its own items are read and merged, page 2 is never re-read. No
   * sibling chapter is ever acquired speculatively; this runs only for the
   * caller's demanded chapter.
   */
  private async extend(cacheKey: string, key: Key, current: AcquiredTheme<T>,
    demand: ThemeFactsDemand, readIndicators: readonly string[] | undefined): Promise<AcquiredTheme<T>> {
    const generation = this.generations.get(cacheKey) ?? 0
    const extra = await this.acquireFacts(key.theme, key, { ...demand, indicators: readIndicators })
    if (generation !== (this.generations.get(cacheKey) ?? 0)) throw new Error('Stale theme acquisition response')
    const latest = this.entries.get(cacheKey) ?? current
    this.assertCurrentFocal(cacheKey, generation, latest)
    const mergeReads = mergeComparisonReads
    const failures = new Map<string, ThemeResourceFailure>()
    for (const failure of [...(latest.focal.resource_failures ?? []), ...(extra.resource_failures ?? [])]) {
      failures.set(`${failure.resource}\u0000${failure.stage}`, failure)
    }
    const comparisons = new Map(latest.comparisons)
    const chapterFailure = extra.demand_comparison?.comparison_error
      ? (typeof extra.demand_comparison.comparison_failure === 'string'
        ? extra.demand_comparison.comparison_failure : 'Publication de comparaison indisponible')
      : undefined
    if (extra.demand_comparison) {
      const selectionKey = cleSelectionComparaison(extra.demand_comparison.selection)
      const prior = comparisons.get(selectionKey)
      const chapterFailures = (extra.resource_failures ?? []).filter((failure) => failure.stage === 'comparison')
      const priorFailures = (prior?.resource_failures ?? []) as ThemeResourceFailure[]
      comparisons.set(selectionKey, withComparisonOutcome({
        ...(prior ?? { theme_id: key.theme, selection: extra.demand_comparison.selection }),
        comparison_reads: mergeReads(prior?.comparison_reads, extra.demand_comparison.comparison_reads),
        ...(chapterFailures.length || priorFailures.length
          ? { resource_failures: [...priorFailures, ...chapterFailures] } : {}),
      } as ThemeResponse, chapterFailure))
    }
    const mergedComparisonReads = [...comparisons.values()].flatMap((entry) => entry.comparison_reads ?? [])
    const focal: T = {
      ...latest.focal,
      resource_reads: mergeReads(latest.focal.resource_reads, extra.resource_reads),
      named_reference_reads: mergeReads(latest.focal.named_reference_reads, extra.named_reference_reads),
      cohort_reads: mergeReads(latest.focal.cohort_reads, extra.cohort_reads),
      ...(failures.size ? { resource_failures: [...failures.values()] } : {}),
      comparison_error: mergedComparisonReads.length
        ? false : Boolean(latest.focal.comparison_error || extra.comparison_error),
    } as T
    const result: AcquiredTheme<T> = { ...latest, focal, comparisons }
    // The REQUESTED chapter's own comparison demand decides its ready/error
    // state, even when an earlier chapter's reads for the same selection are
    // already cached. A settled prior chapter stays reusable.
    const settled = extra.demand_comparison
      ? withDemandState(result, extra.demand_comparison.selection, demand.indicators ?? [],
        chapterFailure === undefined ? 'ready' : 'error', chapterFailure)
      : result
    this.entries.set(cacheKey, settled)
    return settled
  }

  /** Read the demanded chapter's missing indicators once, coalescing identical work. */
  private extendMissing(cacheKey: string, key: Key, current: AcquiredTheme<T>,
    demand: ThemeFactsDemand, missing: readonly string[]): Promise<AcquiredTheme<T>> {
    const extensionKey = JSON.stringify([cacheKey, [...missing].sort()])
    const running = this.pendingExtensions.get(extensionKey)
    if (running) return running
    const request = this.extend(cacheKey, key, current, demand, missing).finally(() => {
      if (this.pendingExtensions.get(extensionKey) === request) this.pendingExtensions.delete(extensionKey)
    })
    this.pendingExtensions.set(extensionKey, request)
    return request
  }

  async get(type: string, id: string, theme: ThemeKey,
    demand?: ThemeFactsDemand): Promise<AcquiredTheme<T>> {
    const key = { type, id, theme }
    const cacheKey = this.key(key)
    const cached = this.entries.get(cacheKey)
    if (cached) {
      const wanted = demand?.indicators
      const loaded = this.loadedIndicators(cached)
      const missing = wanted?.filter((indicator) => !loaded.has(indicator)) ?? []
      if (!missing.length) return cached
      return this.extendMissing(cacheKey, key, cached, demand!, missing)
    }
    const pending = this.pendingFacts.get(cacheKey)
    if (pending) {
      // Coalesce the compatible in-flight read, then make sure the chapter the
      // reader actually requested is complete: a hash jump during the initial
      // read must still acquire its own chapter, never commit the earlier one.
      const settled = await pending
      const wanted = demand?.indicators
      const missing = wanted?.filter((indicator) => !this.loadedIndicators(settled).has(indicator)) ?? []
      if (!missing.length) return settled
      return this.extendMissing(cacheKey, key, settled, demand!, missing)
    }
    const generation = this.generations.get(cacheKey) ?? 0
    const request = this.acquireFacts(theme, key, demand).then((focal) => {
      if (generation !== (this.generations.get(cacheKey) ?? 0)) throw new Error('Stale theme acquisition response')
      const comparisons = new Map<string, ThemeResponse>()
      const auxiliary = {
        cohort_reads: focal.cohort_reads, cohort_error: focal.cohort_error,
        named_reference_reads: focal.named_reference_reads,
      }
      if (focal.demand_comparison) {
        // The header's own selection was read with the focal facts. It is
        // stored under its selection key only: the producer default slot stays
        // empty so a custom/preset page can never render the default scope.
        const comparisonFailures = (focal.resource_failures ?? [])
          .filter((failure) => failure.stage === 'comparison')
        comparisons.set(cleSelectionComparaison(focal.demand_comparison.selection), {
          theme_id: theme, selection: focal.demand_comparison.selection,
          comparison_reads: focal.demand_comparison.comparison_reads,
          ...(comparisonFailures.length ? { resource_failures: comparisonFailures } : {}),
          ...(focal.demand_comparison.comparison_error
            ? { comparison_error: true, comparison_failure: focal.demand_comparison.comparison_failure } : {}),
          ...auxiliary,
        } as ThemeResponse)
      } else if (focal.default_comparison) comparisons.set('omitted', {
        ...focal.default_comparison, ...auxiliary,
      } as ThemeResponse)
      const result: AcquiredTheme<T> = { focal, comparisons }
      const settled = focal.demand_comparison
        ? withDemandState(result, focal.demand_comparison.selection, demand?.indicators ?? [],
          focal.demand_comparison.comparison_error ? 'error' : 'ready',
          focal.demand_comparison.comparison_failure)
        : result
      this.entries.set(cacheKey, settled)
      return settled
    }).finally(() => {
      if (this.pendingFacts.get(cacheKey) === request) this.pendingFacts.delete(cacheKey)
    })
    this.pendingFacts.set(cacheKey, request)
    return request
  }

  async select(type: string, id: string, theme: ThemeKey, selection: readonly ThemeSelectionMember[] | undefined,
    demand?: ThemeFactsDemand): Promise<AcquiredTheme<T>> {
    const key = { type, id, theme }
    const cacheKey = this.key(key)
    const focalGeneration = this.generations.get(cacheKey) ?? 0
    const focal = await this.get(type, id, theme)
    this.assertCurrentFocal(cacheKey, focalGeneration, focal)
    if (!this.acquireComparison) return focal
    const selectionKey = cleSelectionComparaison(selection)
    const existing = focal.comparisons.get(selectionKey)
    const demanded = demand?.indicators
    const settledDemand = demanded ? comparisonDemandState(focal, selection, demanded) : undefined
    if (settledDemand?.status === 'error') {
      throw new Error(typeof settledDemand.failure === 'string'
        ? settledDemand.failure : 'Publication de comparaison indisponible')
    }
    // A chapter that has not read its own comparison scope is not "ready" just
    // because an earlier chapter cached reads for the same selection.
    const demandedComplete = !demanded || settledDemand?.status === 'ready'
    if (existing && !existing.cohort_error && demandedComplete) {
      // The requested demand's own state already decided the outcome above; the
      // aggregate flag is authoritative only for an unscoped selection, so an
      // earlier chapter's stale failure can never fail a healthy chapter.
      if (!demanded && existing.comparison_error === true) {
        throw new Error(typeof existing.comparison_failure === 'string'
          ? existing.comparison_failure : 'Publication de comparaison indisponible')
      }
      return this.entries.get(cacheKey)!
    }
    const pendingKey = JSON.stringify([cacheKey, selectionKey])
    const pending = this.pendingComparisons.get(pendingKey)
    if (pending) {
      await pending
      this.assertCurrentFocal(cacheKey, focalGeneration, focal)
      return this.entries.get(cacheKey)!
    }
    const generation = (this.comparisonGenerations.get(pendingKey) ?? 0) + 1
    this.comparisonGenerations.set(pendingKey, generation)
    // A chapter-scoped acquisition reads only its own comparison evidence: a
    // theme-wide comparison pass would fetch related groups the focal entry does
    // not hold and then be (correctly) rejected as cross-resource incompatible.
    const focalIndicators = (focal.focal.resource_reads ?? [])
      .map((read) => read.declaration?.indicator_id ?? read.resource)
    const scoped = demand?.indicators ?? (focalIndicators.length ? focalIndicators : undefined)
    const request = this.acquireComparison(selection, theme, key, acquisitionCoherence(focal.focal), scoped).then((comparison) => {
      if (generation !== this.comparisonGenerations.get(pendingKey)) throw new Error('Stale theme comparison response')
      // A comparison-only response whose every declared comparison stayed
      // unavailable is an explicit retryable error, never a ready page.
      const failure = comparison.comparison_error === true
        ? (typeof comparison.comparison_failure === 'string'
          ? comparison.comparison_failure : 'Publication de comparaison indisponible')
        : undefined
      this.assertCurrentFocal(cacheKey, focalGeneration, focal)
      const legacySeriesResponse = (focal.focal.resource_reads ?? []).some((read) =>
        isNativeLegacySeriesFocal(read) && comparison.comparison_reads?.some((candidate) =>
          candidate.resource === read.resource && candidate.data.shape === 'series'))
      const hasNativeProfileFocal = (focal.focal.resource_reads ?? []).some((read) =>
        read.shapes?.includes('declared_profile') === true)
      const nativeComparisonShape = Array.isArray(comparison.comparison_reads) &&
        comparison.theme_id === theme
      if (nativeComparisonShape || hasNativeProfileFocal || legacySeriesResponse) {
        validerReponseComparaisonTheme(theme, comparison, selection, { type: type as TerritoireType, id })
      }
      if (nativeComparisonShape && selection !== undefined) {
        // The typed selection echo and its declared scope are one contract for
        // every theme, not only for legacy/profile resources.
        for (const read of comparison.comparison_reads!) {
          const scope = read.data.scope
          if (typeof scope !== 'object' || scope === null || Array.isArray(scope) ||
              (scope as Record<string, unknown>).kind !== 'explicit_selection' ||
              (scope as Record<string, unknown>).member_count !== selection.length) {
            throw new Error('La portée de la comparaison sélectionnée est incohérente')
          }
        }
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
      const entry = { ...current, comparisons: new Map(current.comparisons).set(selectionKey, comparison) }
      const result = withDemandState(entry, selection, demanded ?? scoped ?? [],
        failure === undefined ? 'ready' : 'error', failure)
      this.entries.set(cacheKey, result)
      if (failure !== undefined) throw new Error(failure)
      return comparison
    }).catch((error: unknown) => {
      // A rejected comparison is not a settled publication: release this
      // territory's acquisition generation so an explicit retry re-probes it.
      invalidateSemanticReadsForTarget(type, id)
      throw error
    }).finally(() => {
      if (this.pendingComparisons.get(pendingKey) === request) this.pendingComparisons.delete(pendingKey)
    })
    this.pendingComparisons.set(pendingKey, request)
    await request
    this.assertCurrentFocal(cacheKey, focalGeneration, focal)
    return this.entries.get(cacheKey)!
  }

  /**
   * #986 — explicit retry of the REQUESTED chapter's comparison only. It never
   * re-reads focal facts and never returns another chapter's settled reads: the
   * scoped comparison read is merged and the demand's own state updated.
   */
  async retryComparison(type: string, id: string, theme: ThemeKey,
    selection: readonly ThemeSelectionMember[] | undefined,
    indicators: readonly string[]): Promise<AcquiredTheme<T>> {
    const key = { type, id, theme }
    const cacheKey = this.key(key)
    const focalGeneration = this.generations.get(cacheKey) ?? 0
    const focal = await this.get(type, id, theme)
    this.assertCurrentFocal(cacheKey, focalGeneration, focal)
    if (!this.acquireComparison) return focal
    const comparison = await this.acquireComparison(selection, theme, key,
      acquisitionCoherence(focal.focal), indicators, true)
    this.assertCurrentFocal(cacheKey, focalGeneration, focal)
    const current = this.entries.get(cacheKey) ?? focal
    const selectionKey = cleSelectionComparaison(selection)
    const prior = current.comparisons.get(selectionKey)
    const priorFailures = (prior?.resource_failures ?? []) as ThemeResourceFailure[]
    const failure = comparison.comparison_error === true
      ? (typeof comparison.comparison_failure === 'string'
        ? comparison.comparison_failure : 'Publication de comparaison indisponible')
      : undefined
    const entry = {
      ...current,
      comparisons: new Map(current.comparisons).set(selectionKey, withComparisonOutcome({
        ...(prior ?? { theme_id: theme, selection }),
        comparison_reads: mergeComparisonReads(prior?.comparison_reads, comparison.comparison_reads),
        ...(priorFailures.length || (comparison.resource_failures ?? []).length
          ? { resource_failures: [...priorFailures, ...(comparison.resource_failures ?? [])] } : {}),
      } as ThemeResponse, failure)),
    }
    const result = withDemandState(entry, selection, indicators,
      failure === undefined ? 'ready' : 'error', failure)
    this.entries.set(cacheKey, result)
    return result
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
      const demands = new Map(cached.demands ?? [])
      for (const [demandId, state] of demands) {
        if (cleSelectionComparaison(state.selection) === selectionKey) demands.delete(demandId)
      }
      this.entries.set(cacheKey, { ...cached, comparisons, ...(demands.size ? { demands } : {}) })
    }
    this.comparisonGenerations.set(pendingKey, (this.comparisonGenerations.get(pendingKey) ?? 0) + 1)
    this.pendingComparisons.delete(pendingKey)
    // An explicit comparison retry re-probes the shared comparison items and
    // their same-level cohort evidence; admitted focal facts stay reusable.
    invalidateSemanticReads((item) => item.target.kind === 'territory'
      ? item.target.type === type && item.target.id === id && item.intent.kind !== 'facts'
      : item.target.kind === 'territory_cohort' && item.target.type === type)
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
    // An explicit retry also releases this territory's settled semantic item
    // outcomes (including a cached publication absence) so the next acquisition
    // re-probes the publication instead of replaying the absence forever.
    invalidateSemanticReadsForTarget(type, id)
  }
}

/**
 * #868 — l'acquisition API est le SEUL mode du produit : le runtime statique
 * (`VITE_THEME_ACQUISITION_API='0'`) est retiré avec ses branches. Un
 * build découvre les ressources productrices et les lit par lots sémantiques
 * bornés ; sinon la fiche échoue fermé, jamais de repli statique. Le retour
 * arrière est la release précédente / récupération manuelle.
 */
let catalogueRequest: Promise<SemanticResourceDeclaration[]> | null = null
let catalogueFetcher: typeof fetch | null = null
export function producerCatalogue(): Promise<SemanticResourceDeclaration[]> {
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

function territoryItem(resource: string, type: string, id: string, intent: SemanticReadItem['intent']): SemanticReadItem {
  return { resource, target: { kind: 'territory', type: type as SemanticTerritoryTarget['type'], id }, intent }
}

function cohortItem(resource: string, type: string,
  selection?: readonly ThemeSelectionMember[]): SemanticReadItem {
  const selectedParent = selection?.length === 1 ? selection[0] : undefined
  const parentFilter = type === 'commune' && selectedParent?.territory_type === 'epci'
    ? { epci_id: selectedParent.territory_id }
    : {}
  return { resource, target: { kind: 'territory_cohort', type: type as SemanticTerritoryTarget['type'],
    ...parentFilter }, intent: { kind: 'facts' } }
}

function namedReferenceItem(resource: string, id: string): SemanticReadItem {
  return { resource, target: { kind: 'named_reference', id }, intent: { kind: 'facts' } }
}

function retainedThemeResources(catalogue: SemanticResourceDeclaration[], theme: ThemeKey, type: string) {
  return catalogue.filter((resource) => resource.theme_id === theme && resource.allowed_levels.includes(type as SemanticTerritoryTarget['type']))
}

type AlignedRead = { resource: string; data: Record<string, unknown> }

/**
 * Read every requested item through the one shared acquisition seam. Each
 * requested item yields exactly one outcome: the unchanged data payload or an
 * explicit publication-unavailable state. Nothing re-reads a resource group and
 * no automatic discovery request follows an absence.
 *
 * `coherence` is the caller-owned publication identity: comparison/auxiliary
 * reads bind to the admitted focal facts' territory-reference clock, so an
 * identical item can be reused only within that same acquisition identity.
 */
async function readThemeOutcomes(
  items: SemanticReadItem[],
  resources: SemanticResourceDeclaration[],
  coherence?: string,
  priority?: 'critical' | 'background',
  fresh?: boolean,
): Promise<{ reads: Array<AlignedRead | null>; failures: ThemeResourceFailure[] }> {
  const expectedFamilies = new Map(resources.map((resource) =>
    [resource.resource_id, publicationFamilyForResource(resource)] as const))
  const outcomes = await readSemanticOutcomes(items, {
    ...(coherence === undefined ? {} : { coherence }), expectedFamilies,
    ...(priority === undefined ? {} : { priority }),
    ...(fresh ? { fresh: true } : {}),
  })
  const factEntries: GenerationEntry[] = []
  const reads: Array<AlignedRead | null> = new Array(items.length).fill(null)
  const failures: ThemeResourceFailure[] = []
  outcomes.forEach((outcome, index) => {
    const item = items[index]!
    if (outcome.status === 'available') {
      reads[index] = { resource: item.resource, data: outcome.data }
      if (item.intent.kind === 'facts') factEntries.push({ read: reads[index]!, item })
      return
    }
    failures.push(publicationFailure(resources, item.resource,
      item.intent.kind === 'facts' ? 'facts' : 'comparison', outcome))
  })
  // Facts and auxiliary facts from one acquisition share the global territory
  // reference clock, and each declared dataset family shares its own published
  // generation. A batch boundary must never assemble two generations into one
  // ready response. Unavailable outcomes carry no versions and are excluded.
  try {
    validateAcquisitionGenerations(factEntries, resources)
  } catch (error) {
    if (error instanceof ThemeAcquisitionCoherenceError) {
      // Fence the entire semantic key set of this read, including default
      // comparisons that were in the same request, so no higher cache commits.
      invalidateSemanticItems(items)
      throw new ThemeAcquisitionCoherenceError(error.message, items)
    }
    throw error
  }
  return { reads, failures }
}

function publicationFailure(
  resources: SemanticResourceDeclaration[],
  resource: string,
  stage: ThemeResourceFailure['stage'],
  outcome: Extract<SemanticReadOutcome, { status: 'publication_unavailable' }>,
): ThemeResourceFailure {
  const label = resources.find((declaration) => declaration.resource_id === resource)?.label ?? null
  return {
    resource,
    label,
    stage,
    state: 'publication_unavailable',
    family: outcome.family,
    reason: outcome.reason,
    message: `La publication de « ${label ?? resource} » n’est pas encore disponible.`,
  }
}

function resourceFailure(
  resources: SemanticResourceDeclaration[],
  resource: string,
  stage: ThemeResourceFailure['stage'],
  error: unknown,
): ThemeResourceFailure {
  return {
    resource,
    label: resources.find((declaration) => declaration.resource_id === resource)?.label ?? null,
    stage,
    state: 'error',
    message: error instanceof Error ? error.message : String(error),
  }
}

function uniqueFailures(failures: readonly ThemeResourceFailure[]): ThemeResourceFailure[] {
  const seen = new Set<string>()
  return failures.filter((failure) => {
    const key = `${failure.resource}\u0000${failure.stage}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Preserve every publication/descriptor/reference check per resource. A group
 * whose comparison cannot be bound to its focal facts is dropped and reported;
 * it is never rendered as a ready comparison.
 */
function filterCompatibleComparisons(
  items: SemanticReadItem[],
  reads: Array<AlignedRead | null>,
  resources: SemanticResourceDeclaration[],
  type: string,
  id: string,
): ThemeResourceFailure[] {
  const byResource = new Map<string, { factIndex: number | null; comparisonIndices: number[] }>()
  items.forEach((item, index) => {
    if (!reads[index]) return
    const entry = byResource.get(item.resource) ?? { factIndex: null, comparisonIndices: [] }
    if (item.intent.kind === 'facts') entry.factIndex = index
    else entry.comparisonIndices.push(index)
    byResource.set(item.resource, entry)
  })
  const failures: ThemeResourceFailure[] = []
  for (const [resource, entry] of byResource) {
    if (!entry.comparisonIndices.length) continue
    const factRead = entry.factIndex === null ? null : reads[entry.factIndex]
    const comparisonReads = entry.comparisonIndices.map((index) => reads[index]!)
    if (!factRead || comparisonReads.some((read) => !read)) {
      for (const index of entry.comparisonIndices) reads[index] = null
      failures.push(resourceFailure(resources, resource, 'comparison',
        new Error('Comparaison sémantique incomplète')))
      continue
    }
    const shapes = resources.find((resourceDeclaration) =>
      resourceDeclaration.resource_id === resource)?.shapes
    const subset: ThemeResponse = {
      resource_reads: [{ resource, shapes, data: factRead.data }],
      default_comparison: {
        comparison_reads: comparisonReads.map((read) => ({ resource, shapes, data: read!.data })),
      },
    }
    let compatible = false
    try {
      compatible = semanticPublicationsCompatible(subset, subset.default_comparison!, { type, id })
    } catch {
      compatible = false
    }
    if (!compatible) {
      for (const index of entry.comparisonIndices) reads[index] = null
      failures.push(resourceFailure(resources, resource, 'comparison',
        new Error('Publications sémantiques focales et comparées incompatibles')))
    }
  }
  return failures
}

function decorateRead(
  read: AlignedRead,
  resources: SemanticResourceDeclaration[],
): SemanticThemeRead {
  const declaration = resources.find((resource) => resource.resource_id === read.resource)
  return { ...read, shapes: declaration?.shapes, declaration }
}

/**
 * #954/#960 — the Mobilité page-2 tooltips need one served comparison per
 * declared point, not only the descriptor's published default. The expansion is
 * deliberately narrow: only these producer resources, and only the declared
 * points the figures actually display.
 */
const DECLARED_DETAIL_COMPARISON_RESOURCES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  mobilite: {
    reseaux_par_habitant: ['t_km_1000', 'b_km_1000', 'c_km_1000'],
    reseaux: ['t_longueur', 'b_longueur', 'c_longueur'],
    offre_cyclable: ['protege_longueur', 'partage_longueur', 'protege_km_1000', 'partage_km_1000'],
  },
}

function declaredDetailComparisonItems(
  resource: SemanticResourceDeclaration,
  type: string,
  id: string,
  intent: SemanticReadItem['intent'],
): SemanticReadItem[] {
  const requested = DECLARED_DETAIL_COMPARISON_RESOURCES[resource.theme_id]?.[resource.resource_id]
  if (!requested?.length) return []
  const declared = resource.axis_values?.find(([axis]) => axis === 'detail')?.[1] ?? []
  const details = requested.filter((detail) => declared.includes(detail))
  if (details.length < 2) return []
  return details.map((detail) => ({
    ...territoryItem(resource.resource_id, type, id, intent),
    coordinates: { detail: [detail] },
  }))
}

function factAndComparisonItems(resources: SemanticResourceDeclaration[], type: string, id: string,
  intent: SemanticReadItem['intent'] | null): SemanticReadItem[] {
  return resources.flatMap((resource) => {
    if (!resource.target_kinds.includes('territory') || !resource.intents.includes('facts')) return []
    const items = [territoryItem(resource.resource_id, type, id, { kind: 'facts' })]
    if (intent === null || !resource.intents.includes(intent.kind)) return items
    const detailItems = declaredDetailComparisonItems(resource, type, id, intent)
    items.push(...(detailItems.length
      ? detailItems
      : [territoryItem(resource.resource_id, type, id, intent)]))
    return items
  })
}

function typedCohortItems(resources: SemanticResourceDeclaration[], type: string,
  selection?: readonly ThemeSelectionMember[], indicators?: readonly string[]): SemanticReadItem[] {
  const wanted = indicators ? new Set(indicators) : null
  return resources.filter((resource) => resource.shapes.includes('typed_reading') &&
    (!wanted || wanted.has(resource.indicator_id)) &&
    resource.allowed_levels.includes(type as SemanticTerritoryTarget['type']) &&
    resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts'))
    .map((resource) => cohortItem(resource.resource_id, type, selection))
}

function namedReferenceItems(resources: SemanticResourceDeclaration[],
  indicators?: readonly string[]): SemanticReadItem[] {
  const wanted = indicators ? new Set(indicators) : null
  return resources.filter((resource) => resource.shapes.includes('named_reference') &&
    (!wanted || wanted.has(resource.indicator_id)) &&
    resource.target_kinds.includes('named_reference') && resource.intents.includes('facts'))
    .flatMap((resource) => (resource.target_ids ?? []).map((id) => namedReferenceItem(resource.resource_id, id)))
}

/**
 * Cohort, named-reference and other auxiliary reads share the same outcome
 * client. An unavailable auxiliary resource is recorded once and never turns a
 * healthy focal render into a failure; only a hard request error sets the
 * cohort/named-reference error flag used by the retry surfaces.
 */
async function readAuxiliary(resources: SemanticResourceDeclaration[], type: string,
  includeNamedReferences = true, selection?: readonly ThemeSelectionMember[],
  coherence?: string, indicators?: readonly string[], priority?: 'critical' | 'background',
): Promise<{ responses: Partial<ThemeResponse>; failures: ThemeResourceFailure[]
  reads: SemanticThemeRead[]; items: SemanticReadItem[] }> {
  const cohorts = typedCohortItems(resources, type, selection, indicators)
  const namedReferences = includeNamedReferences ? namedReferenceItems(resources, indicators) : []
  const allItems = [...cohorts, ...namedReferences]
  const [cohortResult, namedResult] = await Promise.allSettled([
    cohorts.length ? readThemeOutcomes(cohorts, resources, coherence, priority)
      : Promise.resolve({ reads: [], failures: [] }),
    namedReferences.length ? readThemeOutcomes(namedReferences, resources, coherence, priority)
      : Promise.resolve({ reads: [], failures: [] }),
  ])
  for (const result of [cohortResult, namedResult]) {
    if (result.status === 'rejected' && result.reason instanceof ThemeAcquisitionCoherenceError) {
      // One auxiliary subgroup already fenced itself; fence the whole
      // auxiliary key set so facts + aux are never partially committed.
      invalidateSemanticItems(allItems)
      throw new ThemeAcquisitionCoherenceError(result.reason.message, allItems)
    }
  }
  const present = (reads: Array<AlignedRead | null>) => reads
    .filter((read): read is AlignedRead => read !== null).map((read) => decorateRead(read, resources))
  const cohortReads = cohortResult.status === 'fulfilled' ? present(cohortResult.value.reads) : []
  const namedReads = namedResult.status === 'fulfilled' ? present(namedResult.value.reads) : []
  // The two auxiliary groups are one acquisition: their dataset-family clocks
  // and territory reference must agree with each other and with the focal facts.
  try {
    validateAcquisitionGenerations([
      ...cohortReads.map((read) => ({ read })),
      ...namedReads.map((read) => ({ read })),
    ], resources)
  } catch (error) {
    if (error instanceof ThemeAcquisitionCoherenceError) {
      invalidateSemanticItems(allItems)
      throw new ThemeAcquisitionCoherenceError(error.message, allItems)
    }
    throw error
  }
  return {
    reads: [...cohortReads, ...namedReads],
    items: allItems,
    responses: {
      ...(cohortResult.status === 'fulfilled' ? { cohort_reads: cohortReads } : { cohort_error: true }),
      ...(namedResult.status === 'fulfilled' ? { named_reference_reads: namedReads }
        : { named_reference_error: true }),
    },
    failures: [
      ...(cohortResult.status === 'fulfilled' ? cohortResult.value.failures : []),
      ...(namedResult.status === 'fulfilled' ? namedResult.value.failures : []),
    ],
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
    const profile = shapes.includes('declared_profile')
    if (profile) {
      // Native profile comparisons intentionally have no global content clock:
      // bind their independent profile/reference clocks to the acquired facts.
      // Some legacy-shaped transports may still include an unrelated global
      // token; validate its shape, but never use it as the dependency clock.
      if (!(data.content_version === null || (typeof data.content_version === 'string' && data.content_version.length > 0)) ||
          typeof focal.content_version !== 'string' || !focal.content_version ||
          data.profile_content_version !== focal.content_version ||
          data.reference_content_version !== focal.reference_content_version) return false
    } else {
      const focalVersion = focal.content_version ?? focal.publication_id
      const comparisonVersion = data.content_version ?? data.publication_id
      if (typeof focalVersion !== 'string' || !focalVersion || typeof comparisonVersion !== 'string' ||
          !comparisonVersion || focalVersion !== comparisonVersion) return false
      if (nativeSeriesComparison && (typeof data.content_version !== 'string' ||
          data.content_version !== focalVersion ||
          (typeof focal.content_version === 'string' && typeof focal.publication_id === 'string' &&
           focal.content_version !== focal.publication_id))) return false
    }
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

function failureResponse(failures: readonly ThemeResourceFailure[]): { resource_failures?: ThemeResourceFailure[] } {
  const unique = uniqueFailures(failures)
  return unique.length ? { resource_failures: unique } : {}
}

/**
 * One theme facts acquisition for every canonical theme. Each requested item is
 * a typed outcome: healthy resources stay rendered, a publication absence is an
 * explicit per-resource failure, and no discovery retry or facts-only re-read
 * follows it.
 *
 * #986 — `demand` narrows the read to the chapter the reader requested and to
 * the comparison the active header displays. Without a demand the acquisition
 * keeps its historical whole-theme shape (facts + declared default).
 */
export function acquireThemeFacts(type: string, id: string, theme: ThemeKey,
  demand: ThemeFactsDemand = {}): Promise<ThemeResponse> {
  return (async () => {
    const themeResources = (await producerCatalogue()).filter((resource) => resource.theme_id === theme)
    const retained = retainedThemeResources(themeResources, theme, type)
    const wanted = demand.indicators === undefined ? null : new Set(demand.indicators)
    const resources = wanted ? retained.filter((resource) => wanted.has(resource.indicator_id)) : retained
    const intent: SemanticReadItem['intent'] | null = demand.selection === null
      ? null
      : demand.selection === undefined
        ? { kind: 'fixed_comparison', context: 'default' }
        : { kind: 'selected_comparison',
          members: demand.selection.map(({ territory_type, territory_id }) => ({ type: territory_type, id: territory_id })) }
    const chapterScoped = demand.indicators !== undefined
    // A chapter demand owns its named references in the SAME read set: the
    // page-3 curve's reference is part of that chapter, not a separate probe.
    const chapterNamedReferences = chapterScoped && demand.auxiliary !== false
      ? namedReferenceItems(themeResources, demand.indicators)
      : []
    const items = [...factAndComparisonItems(resources, type, id, intent), ...chapterNamedReferences]
    if (!items.length) {
      const auxiliary = demand.auxiliary === false
        ? { responses: {}, failures: [], reads: [], items: [] }
        : await readAuxiliary(themeResources, type, true, undefined, undefined, demand.indicators, demand.priority)
      return { theme_id: theme, resource_reads: [],
        ...(demand.selection === null ? {} : {
          default_comparison: { theme_id: theme, comparison_reads: [] } }),
        ...auxiliary.responses, ...failureResponse(auxiliary.failures) }
    }
    // A chapter demand fuses the displayed comparison with its focal facts: one
    // read set, at most three batches for page 2. A hard request failure there
    // still lets the focal facts render (one bounded facts-only recovery), so an
    // unavailable comparison never blanks the requested page.
    const fused = chapterScoped
    let reads: Array<AlignedRead | null>
    let failures: ThemeResourceFailure[]
    try {
      ({ reads, failures } = await readThemeOutcomes(items, resources, undefined, demand.priority))
    } catch (error) {
      const hasComparisonItems = items.some((item) => item.intent.kind !== 'facts')
      if (!fused || !hasComparisonItems) throw error
      const factOnly = items.filter((item) => item.intent.kind === 'facts')
      const recovered = await readThemeOutcomes(factOnly, resources, undefined, demand.priority)
      reads = items.map((item) => item.intent.kind === 'facts'
        ? recovered.reads[factOnly.indexOf(item)] ?? null : null)
      failures = [...recovered.failures, ...items
        .filter((item) => item.intent.kind !== 'facts')
        .map((item) => resourceFailure(resources, item.resource, 'comparison', error))]
    }
    const compatibilityFailures = filterCompatibleComparisons(items, reads, resources, type, id)
    const allFailures: ThemeResourceFailure[] = [...failures, ...compatibilityFailures]
    const factReads = items
      .map((item, index) => item.intent.kind === 'facts' ? reads[index] : null)
      .filter((read): read is AlignedRead => read !== null)
      .map((read) => decorateRead(read, resources))
    const isNamedReference = (read: SemanticThemeRead): boolean =>
      read.declaration?.target_kinds.includes('named_reference') === true ||
      read.declaration?.shapes.includes('named_reference') === true
    const resourceReads = factReads.filter((read) => !isNamedReference(read))
    const namedReferenceReads = chapterNamedReferences.length
      ? factReads.filter(isNamedReference) : []
    const factItems = items.filter((item) => item.intent.kind === 'facts')
    // The admitted facts' observed dataset vector plus global reference is the
    // one acquisition identity auxiliary/cohort reads may reuse; without it
    // they re-read.
    let auxiliary: Awaited<ReturnType<typeof readAuxiliary>> = {
      responses: {}, failures: [], reads: [], items: [],
    }
    try {
      if (demand.auxiliary !== false) {
        auxiliary = await readAuxiliary(themeResources, type, !chapterScoped, undefined,
          acquisitionCoherence({ resource_reads: resourceReads }), demand.indicators, demand.priority)
        // Facts and auxiliary facts are one acquisition: every available read
        // must share its dataset-family clock and the global reference.
        validateAcquisitionGenerations([
          ...resourceReads.map((read, index) => ({ read, item: factItems[index] })),
          ...namedReferenceReads.map((read) => ({ read })),
          ...auxiliary.reads.map((read) => ({ read })),
        ], resources)
      }
    } catch (error) {
      if (error instanceof ThemeAcquisitionCoherenceError) {
        invalidateSemanticItems([...items, ...(auxiliary?.items ?? []), ...error.items])
      }
      throw error
    }
    const comparisonReads = items
      .map((item, index) => item.intent.kind !== 'facts' ? reads[index] : null)
      .filter((read): read is AlignedRead => read !== null)
      .map((read) => decorateRead(read, resources))
    const demandComparison: ThemeResponse['demand_comparison'] =
      demand.selection !== undefined && demand.selection !== null
        ? { selection: [...demand.selection], comparison_reads: comparisonReads }
        : undefined
    // A page whose header displays a selection never seeds the producer's
    // default slot: the default scope can only render when it was requested.
    const defaultComparison = { theme_id: theme,
      comparison_reads: demandComparison ? [] : comparisonReads }
    const result: ThemeResponse = { theme_id: theme, resource_reads: resourceReads,
      ...(demand.selection === null ? {} : { default_comparison: defaultComparison }) }
    const comparisonSnapshot: ThemeResponse = demandComparison
      ? { ...result, default_comparison: { theme_id: theme, comparison_reads: comparisonReads } }
      : result
    if (comparisonReads.length && !semanticPublicationsCompatible(comparisonSnapshot,
      { theme_id: theme, comparison_reads: comparisonReads }, { type, id })) {
      // The per-resource checks passed; this is a cross-resource incompatibility.
      // Drop every comparison rather than surfacing a ready but mismatched value.
      for (const read of comparisonReads) {
        allFailures.push(resourceFailure(resources, read.resource, 'comparison',
          new Error('Publications sémantiques focales et comparées incompatibles')))
      }
      comparisonReads.length = 0
      if (demandComparison) demandComparison.comparison_reads = comparisonReads
    }
    const declaredComparisonResources = intent === null ? [] : resources.filter((resource) =>
      resource.target_kinds.includes('territory') && resource.intents.includes(intent.kind))
    const successfulComparisonResources = new Set(comparisonReads.map((read) => read.resource))
    const comparison_error = declaredComparisonResources.length > 0 &&
      declaredComparisonResources.every((resource) => !successfulComparisonResources.has(resource.resource_id))
    if (demandComparison && comparison_error) {
      // Every declared comparison of the requested intent stayed unavailable.
      // It is a settled absence: the cache keeps it so the next select() throws
      // to the explicit retry surface instead of re-probing by itself.
      demandComparison.comparison_error = true
      demandComparison.comparison_failure = uniqueFailures(allFailures)
        .find((failure) => failure.stage === 'comparison')?.message
    }
    const unique = uniqueFailures([...allFailures, ...auxiliary.failures])
    return {
      ...result,
      ...(demandComparison ? { demand_comparison: demandComparison } : {}),
      ...auxiliary.responses,
      ...(chapterNamedReferences.length ? { named_reference_reads: namedReferenceReads } : {}),
      ...(unique.length ? { resource_failures: unique } : {}),
      ...(comparison_error ? {
        comparison_error: true,
        comparison_failure: unique.find((failure) => failure.stage === 'comparison')?.message,
      } : {}),
    }
  })()
}

export function acquireThemeComparison(type: string, id: string, theme: ThemeKey,
  selection?: readonly ThemeSelectionMember[], coherence?: string,
  indicators?: readonly string[], fresh?: boolean): Promise<ThemeResponse> {
  return (async () => {
    const themeResources = (await producerCatalogue()).filter((resource) => resource.theme_id === theme)
    const wanted = indicators === undefined ? null : new Set(indicators)
    const resources = retainedThemeResources(themeResources, theme, type)
      .filter((resource) => !wanted || wanted.has(resource.indicator_id))
      .filter((resource) => resource.target_kinds.includes('territory') && resource.intents.includes(selection === undefined ? 'fixed_comparison' : 'selected_comparison'))
    const intent: SemanticReadItem['intent'] = selection === undefined
      ? { kind: 'fixed_comparison', context: 'default' }
      : { kind: 'selected_comparison', members: selection.map(({ territory_type, territory_id }) => ({ type: territory_type, id: territory_id })) }
    const items = resources.flatMap((resource) => {
      const detailItems = declaredDetailComparisonItems(resource, type, id, intent)
      return detailItems.length
        ? detailItems
        : [territoryItem(resource.resource_id, type, id, intent)]
    })
    const { reads, failures } = items.length
      ? await readThemeOutcomes(items, resources, coherence, undefined, fresh)
      : { reads: [] as Array<AlignedRead | null>, failures: [] as ThemeResourceFailure[] }
    const comparisons = reads.filter((read): read is AlignedRead => read !== null)
    let auxiliary: Awaited<ReturnType<typeof readAuxiliary>> | undefined
    try {
      auxiliary = await readAuxiliary(themeResources, type, false, selection, coherence)
    } catch (error) {
      if (error instanceof ThemeAcquisitionCoherenceError) {
        invalidateSemanticItems([...items, ...error.items])
      }
      throw error
    }
    if (!auxiliary) throw new ThemeAcquisitionCoherenceError('Acquisition auxiliaire incomplète.', items)
    const echoedSelection = comparisons.length ? comparisons[0]!.data.selection : undefined
    if (comparisons.some(({ data }) => JSON.stringify(data.selection ?? null) !== JSON.stringify(echoedSelection ?? null))) {
      throw new Error('Les comparaisons sémantiques ne reflètent pas la même sélection')
    }
    const unique = uniqueFailures([...failures, ...auxiliary.failures])
    const comparison_error = items.length > 0 && comparisons.length === 0
    return { theme_id: theme, ...(selection === undefined ? {} : { selection }),
      comparison_reads: comparisons.map((read) => decorateRead(read, resources)), ...auxiliary.responses,
      ...(unique.length ? { resource_failures: unique } : {}),
      ...(comparison_error ? { comparison_error: true } : {}),
      ...(Array.isArray(echoedSelection) ? { selection: echoedSelection } : {}) }
  })()
}

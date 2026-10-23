export type ThemeKey = 'programmes' | 'demographie' | 'habitat' | 'economie' | 'milieux' | 'mobilite'
import type { Theme } from './types'
import { chargerCatalogueRessources, lireRessourcesBatch } from './semanticResourceClient'
import type { SemanticReadItem, SemanticResourceDeclaration } from './semanticResourceClient'
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
  resource_reads?: Array<{ resource: string; shapes?: string[]; data: Record<string, unknown> }>
  default_comparison?: { theme_id?: ThemeKey; selection?: readonly ThemeSelectionMember[]; comparison_reads: Array<{ resource: string; shapes?: string[]; data: Record<string, unknown> }> }
  comparison_reads?: Array<{ resource: string; shapes?: string[]; data: Record<string, unknown> }>
  comparison_error?: boolean
  selection?: unknown
  [key: string]: unknown
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
      const comparisons = new Map<string, ThemeResponse>()
      if (focal.default_comparison) comparisons.set('omitted', focal.default_comparison as ThemeResponse)
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
    const focal = await this.get(type, id, theme)
    if (!this.acquireComparison) return focal
    const selectionKey = cleSelectionComparaison(selection)
    const existing = focal.comparisons.get(selectionKey)
    if (existing) return focal
    const pendingKey = JSON.stringify([cacheKey, selectionKey])
    const pending = this.pendingComparisons.get(pendingKey)
    if (pending) {
      await pending
      return this.entries.get(cacheKey) ?? focal
    }
    const generation = (this.generations.get(cacheKey) ?? 0) + 1
    this.generations.set(cacheKey, generation)
    const request = this.acquireComparison(selection, theme, key).then((comparison) => {
      if (generation !== this.generations.get(cacheKey)) throw new Error('Stale theme comparison response')
      const compatible = semanticPublicationsCompatible(focal.focal, comparison)
      if (!compatible) throw new Error('Theme publication tokens do not match; retry comparison')
      const result = { ...focal, comparisons: new Map(focal.comparisons).set(selectionKey, comparison) }
      this.entries.set(cacheKey, result)
      return comparison
    }).finally(() => {
      if (this.pendingComparisons.get(pendingKey) === request) this.pendingComparisons.delete(pendingKey)
    })
    this.pendingComparisons.set(pendingKey, request)
    await request
    return this.entries.get(cacheKey) ?? focal
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
    for (const pendingKey of [...this.pendingComparisons.keys()]) {
      const [entryKey] = JSON.parse(pendingKey) as [string, string]
      const identity = JSON.parse(entryKey) as [string, string, ThemeKey]
      if (identity[0] === type && identity[1] === id && (!theme || identity[2] === theme)) {
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
function producerCatalogue(): Promise<SemanticResourceDeclaration[]> {
  if (!catalogueRequest) catalogueRequest = chargerCatalogueRessources().catch((error) => {
    catalogueRequest = null
    throw error
  })
  return catalogueRequest
}

function chunked<T>(items: T[], size = 12): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size))
  return batches
}

function territoryItem(resource: string, type: string, id: string, intent: SemanticReadItem['intent']): SemanticReadItem {
  return { resource, target: { kind: 'territory', type: type as SemanticReadItem['target']['type'], id }, intent }
}

function retainedThemeResources(catalogue: SemanticResourceDeclaration[], theme: ThemeKey, type: string) {
  return catalogue.filter((resource) => resource.theme_id === theme && resource.allowed_levels.includes(type as SemanticReadItem['target']['type']))
}

async function readAll(items: SemanticReadItem[]): Promise<Array<{ resource: string; data: Record<string, unknown> }>> {
  const output: Array<{ resource: string; data: Record<string, unknown> }> = []
  for (const batch of chunked(items)) {
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

export function semanticPublicationsCompatible(facts: ThemeResponse, comparison: ThemeResponse): boolean {
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
  return comparisonReads.every(({ resource, data }) => {
    const focal = focalByResource.get(resource)
    if (!focal) return false
    const focalVersion = focal.content_version ?? focal.publication_id
    const comparisonVersion = data.content_version ?? data.publication_id
    if (typeof focalVersion !== 'string' || !focalVersion || typeof comparisonVersion !== 'string' ||
        !comparisonVersion || focalVersion !== comparisonVersion) return false
    if (typeof focal.reference_content_version !== 'string' || !focal.reference_content_version ||
        typeof data.reference_content_version !== 'string' || !data.reference_content_version ||
        focal.reference_content_version !== data.reference_content_version) return false
    const focalDescriptor = focal.descriptor
    const comparisonResult = data.result
    if (typeof focalDescriptor === 'object' && focalDescriptor !== null &&
        typeof comparisonResult === 'object' && comparisonResult !== null) {
      const required = (comparisonResult as Record<string, unknown>).required_scalar_version
      const declared = (focalDescriptor as Record<string, unknown>).required_scalar_version
      if (required !== undefined && declared !== undefined && required !== declared) return false
    }
    return true
  })
}

export function acquireThemeFacts(type: string, id: string, theme: ThemeKey,
  _selection?: readonly ThemeSelectionMember[]): Promise<ThemeResponse> {
  return (async () => {
    const resources = retainedThemeResources(await producerCatalogue(), theme, type)
    const items = factAndDefaultComparisonItems(resources, type, id)
    if (!items.length) return { theme_id: theme, resource_reads: [],
      default_comparison: { theme_id: theme, comparison_reads: [] } }
    try {
      const paired = await readAll(items)
      const resourceReads = paired.filter((_, index) => items[index]!.intent.kind === 'facts')
        .map((read) => ({ ...read, shapes: resources.find((resource) => resource.resource_id === read.resource)?.shapes }))
      const comparisonReads = paired.filter((_, index) => items[index]!.intent.kind !== 'facts')
        .map((read) => ({ ...read, shapes: resources.find((resource) => resource.resource_id === read.resource)?.shapes }))
      const defaultComparison = { theme_id: theme, comparison_reads: comparisonReads }
      const result: ThemeResponse = { theme_id: theme, resource_reads: resourceReads, default_comparison: defaultComparison }
      if (!semanticPublicationsCompatible(result, defaultComparison)) throw new Error('Les publications sémantiques focales et comparées diffèrent')
      return result
    } catch (pairedFailure) {
      // A semantic batch is atomic. Never salvage a successful prefix: start a
      // new facts-only read set, which has its own snapshots and dependencies.
      const recovered = (await readAll(factItems(resources, type, id))).map((read) => ({ ...read,
        shapes: resources.find((resource) => resource.resource_id === read.resource)?.shapes }))
      return { theme_id: theme, resource_reads: recovered, comparison_error: true,
        comparison_failure: pairedFailure instanceof Error ? pairedFailure.message : String(pairedFailure) }
    }
  })()
}

export function acquireThemeComparison(type: string, id: string, theme: ThemeKey,
  selection?: readonly ThemeSelectionMember[]): Promise<ThemeResponse> {
  return (async () => {
    const resources = retainedThemeResources(await producerCatalogue(), theme, type)
      .filter((resource) => resource.target_kinds.includes('territory') && resource.intents.includes(selection === undefined ? 'fixed_comparison' : 'selected_comparison'))
    const intent: SemanticReadItem['intent'] = selection === undefined
      ? { kind: 'fixed_comparison', context: 'default' }
      : { kind: 'selected_comparison', members: selection.map(({ territory_type, territory_id }) => ({ type: territory_type, id: territory_id })) }
    const items = resources.map((resource) => territoryItem(resource.resource_id, type, id, intent))
    return { theme_id: theme, ...(selection === undefined ? {} : { selection }),
      comparison_reads: (await readAll(items)).map((read) => ({ ...read,
        shapes: resources.find((resource) => resource.resource_id === read.resource)?.shapes })) }
  })()
}

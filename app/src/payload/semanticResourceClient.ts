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
  target_ids?: string[]
  axes?: string[]
  axis_values?: Array<[string, string[]]>
  dynamic_axes?: string[]
  fields: string[]
  intents: string[]
  /** Producer map policy; null for non-indicator semantic resources. */
  map_eligible?: boolean | null
  /** Scalar-facet capability, not the presence of an observed count. */
  counts_available?: boolean
  /** Producer-owned facets and rank direction for AEDAR aggregate measures. */
  measure_facets?: Record<string, { facet: string; direction: 'high' | 'low'; ranked: boolean }>
}

export interface SemanticTerritoryTarget {
  kind: 'territory' | 'territory_cohort'
  type: TerritoireType
  id?: string
  department_id?: string | null
  epci_id?: string | null
}

export interface SemanticNamedReferenceTarget {
  kind: 'named_reference'
  id: string
}

export type SemanticReadTarget = SemanticTerritoryTarget | SemanticNamedReferenceTarget

export type SemanticComparisonIntent =
  | { kind: 'facts' }
  /** Producer-declared comparison context (`default`, `epci`, `bretagne`, ...). */
  | { kind: 'fixed_comparison'; context: string }
  | { kind: 'selected_comparison'; members: Array<{ type: TerritoireType; id: string }> }

export interface SemanticReadItem {
  resource: string
  target: SemanticReadTarget
  coordinates?: Record<string, string[]>
  fields?: string[]
  intent: SemanticComparisonIntent
}

type RecordValue = Record<string, unknown>

export const SEMANTIC_CATALOGUE_PATH = '/api/resources'
export const SEMANTIC_READ_PATH = '/api/resources/read'
export const SEMANTIC_BATCH_PATH = '/api/resources/read-batch'

/** The one shared client contract. v1 stays a server-side bridge, never a client mode. */
export const SEMANTIC_BATCH_CONTRACT = 'semantic-read-batch-v2'

/** Client packing budget: at most twelve items in one semantic read-batch. */
export const SEMANTIC_MAX_BATCH_ITEMS = 12

/** The shared API pool is small; the one scheduler never runs more than two semantic reads. */
export const SEMANTIC_MAX_ACTIVE_READS = 2

/**
 * Closed outcome vocabulary (#984). The family always comes from the producer
 * declaration; a client never derives it from the failed lookup.
 */
export const SEMANTIC_PUBLICATION_FAMILIES = [
  'scalar', 'profile', 'ordered_series', 'named_reference', 'typed_reading', 'collection', 'aedar',
] as const
export type SemanticPublicationFamily = typeof SEMANTIC_PUBLICATION_FAMILIES[number]

/** One closed reason code: the publication is not present, never a human message. */
export const SEMANTIC_PUBLICATION_REASONS = ['publication_absent'] as const
export type SemanticPublicationReason = typeof SEMANTIC_PUBLICATION_REASONS[number]

/**
 * The one app mirror of the API's `family_for_resource`: the typed-absence
 * family comes from the producer declaration, never from the failed lookup.
 */
export function publicationFamilyForResource(
  declaration: Pick<SemanticResourceDeclaration, 'shapes'> & { resource_kind?: unknown },
): SemanticPublicationFamily {
  const kind = typeof declaration.resource_kind === 'string' ? declaration.resource_kind : ''
  const shapes = new Set(declaration.shapes)
  if (kind === 'typed_reading' || shapes.has('typed_reading')) return 'typed_reading'
  if (kind.startsWith('aedar_') || shapes.has('aedar_source_grain') || shapes.has('aedar_territory_summary')) {
    return 'aedar'
  }
  if (shapes.has('declared_profile')) return 'profile'
  if (shapes.has('named_reference') && !shapes.has('ordered_series')) return 'named_reference'
  if (shapes.has('ordered_series')) return 'ordered_series'
  if (shapes.has('period_detail') || shapes.has('anchored_membership')) return 'collection'
  return 'scalar'
}

export interface SemanticOutcomeIdentity {
  /** Producer-declared resource identity as requested. */
  resource: string
  /** Exact requested target; an unavailable outcome carries no server data. */
  target: SemanticReadTarget
}

export type SemanticReadOutcome =
  | ({ status: 'available'; data: RecordValue } & SemanticOutcomeIdentity)
  | ({ status: 'publication_unavailable'; reason: SemanticPublicationReason;
    family: SemanticPublicationFamily } & SemanticOutcomeIdentity)

/**
 * Explicit per-item acquisition state. `unavailable` is a settled publication
 * absence (never a zero, never an automatic retry); `unrequested` has not been
 * asked for yet; `error` records a hard request/validation failure.
 */
export type SemanticReadState = 'unrequested' | 'pending' | 'available' | 'unavailable' | 'error'

export interface SemanticReadOptions {
  /** Browser fetch by default; AEDAR passes the transport it was given. */
  fetcher?: typeof fetch
  /** Caller-scoped cancellation: it never aborts the shared coalesced read. */
  signal?: AbortSignal
  /**
   * A clock-observing probe never reuses a settled outcome. It still joins an
   * identical in-flight read; one caller's cancellation never affects joiners.
   */
  fresh?: boolean
  /**
   * Caller-owned publication identity. A settled outcome is reusable only for
   * the same semantic item AND the same coherence token. Without a token the
   * transport keeps per-item state but never replays a settled read into a new
   * acquisition, so an assembled group can never mix dataset generations.
   */
  coherence?: string
  /**
   * Producer-declared family per resource, when the caller already discovered
   * the catalogue. A typed absence whose family disagrees is rejected.
   */
  expectedFamilies?: ReadonlyMap<string, SemanticPublicationFamily>
}

const FAMILY_SET = new Set<string>(SEMANTIC_PUBLICATION_FAMILIES)
const REASON_SET = new Set<string>(SEMANTIC_PUBLICATION_REASONS)
const MAX_CACHED_OUTCOMES = 500

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
  const path = SEMANTIC_CATALOGUE_PATH
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
        typeof candidate.theme_id !== 'string' ||
        typeof candidate.indicator_id !== 'string' || !candidate.indicator_id ||
        typeof candidate.label !== 'string' || typeof candidate.unit !== 'string' ||
        typeof candidate.direction !== 'string' || !strings(candidate.allowed_levels) ||
        !strings(candidate.sources) || !strings(candidate.shapes) || !strings(candidate.target_kinds) ||
        !strings(candidate.fields) || !strings(candidate.intents) ||
        (candidate.map_eligible !== undefined && candidate.map_eligible !== null &&
          typeof candidate.map_eligible !== 'boolean') ||
        (candidate.counts_available !== undefined && typeof candidate.counts_available !== 'boolean') ||
        (candidate.target_ids !== undefined && !strings(candidate.target_ids)) ||
        (candidate.axes !== undefined && !strings(candidate.axes)) ||
        (candidate.dynamic_axes !== undefined && !strings(candidate.dynamic_axes)) ||
        (candidate.measure_facets !== undefined && (!isRecord(candidate.measure_facets) ||
          Object.values(candidate.measure_facets).some((facet) => !isRecord(facet) ||
            typeof facet.facet !== 'string' || !facet.facet || (facet.direction !== 'high' && facet.direction !== 'low') ||
            typeof facet.ranked !== 'boolean'))) ||
        (candidate.axis_values !== undefined && (!Array.isArray(candidate.axis_values) || candidate.axis_values.some((entry) =>
          !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !strings(entry[1])))) ||
        seen.has(candidate.resource_id)) {
      throw new PayloadError('validation', path, 'Déclaration de ressource sémantique mal formée ou dupliquée.')
    }
    seen.add(candidate.resource_id)
    return candidate as unknown as SemanticResourceDeclaration
  })
  return resources
}

/** Identité signalée par le producteur ; jamais son message technique en copy UI. */
export class SemanticMemberError extends PayloadError {
  constructor(path: string, status: number, readonly member: { type: string; id: string }) {
    super('fetch', path, `Membre de comparaison indisponible : ${member.type}/${member.id}.`, status)
  }
}

/**
 * A settled per-item publication gap. Consumers render an explicit unavailable
 * state; nothing retries resource discovery and no value/version is invented.
 */
export class SemanticPublicationUnavailableError extends PayloadError {
  constructor(readonly outcome: Extract<SemanticReadOutcome, { status: 'publication_unavailable' }>) {
    super('fetch', SEMANTIC_BATCH_PATH,
      `Publication sémantique indisponible : ${outcome.resource} (${outcome.family}).`)
    this.name = 'SemanticPublicationUnavailableError'
  }
}

/** A late reply whose item generation was invalidated never applies. */
export class SemanticReadSupersededError extends Error {
  constructor(readonly key: string) {
    super('Semantic acquisition generation changed')
    this.name = 'SemanticReadSupersededError'
  }
}

async function poster(path: string, body: RecordValue, options: SemanticReadOptions = {}): Promise<unknown> {
  const fetcher = options.fetcher ?? globalThis.fetch
  let response: Response
  try {
    response = await fetcher(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), ...(options.signal ? { signal: options.signal } : {}) })
  } catch (cause) {
    throw new PayloadError('fetch', path, `Lecture sémantique indisponible : ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!response.ok) {
    // Publication classification never inspects messages. The legacy producer
    // still names a hard 422 member identity in `detail`; extracting that typed
    // member for UI copy is the existing identity contract, not publication
    // classification, and a failure without a typed identity stays HTTP-generic.
    if (response.status === 404 || response.status === 422) {
      const error: unknown = await response.json().catch(() => null)
      const identity = isRecord(error) && typeof error.detail === 'string'
        ? /\bselected comparison member(?: type does not match)? (commune|epci|departement|region)\/(\S{1,32})(?=\s|$)/i.exec(error.detail.replace(/\s+/gu, ' ')) : null
      if (identity) throw new SemanticMemberError(path, response.status, { type: identity[1]!, id: identity[2]! })
    }
    throw new PayloadError('fetch', path,
      `Lecture sémantique indisponible (HTTP ${response.status}).`, response.status)
  }
  return readJson(response, path)
}

function canonicalTarget(target: SemanticReadTarget): RecordValue {
  if (target.kind === 'named_reference') return { kind: target.kind, id: target.id }
  return {
    kind: target.kind, type: target.type,
    ...(target.kind === 'territory' ? { id: target.id } : {}),
    ...(target.kind === 'territory_cohort'
      ? { department_id: target.department_id ?? null, epci_id: target.epci_id ?? null } : {}),
  }
}

/**
 * One semantic item identity. Two reads share work only when their resource,
 * exact target, intent, coordinates, projected fields and selection all agree;
 * a role variant or another group context is a different read.
 */
export function semanticItemKey(item: SemanticReadItem): string {
  const coordinates = item.coordinates
    ? Object.fromEntries(Object.keys(item.coordinates).sort().map((axis) => [axis, [...item.coordinates![axis]!]]))
    : null
  const intent = item.intent.kind === 'selected_comparison'
    ? { kind: item.intent.kind, members: item.intent.members.map(({ type, id }) => ({ type, id })) }
    : item.intent.kind === 'fixed_comparison' ? { kind: item.intent.kind, context: item.intent.context } : { kind: item.intent.kind }
  return JSON.stringify([item.resource, canonicalTarget(item.target), intent,
    coordinates, item.fields ? [...item.fields].sort() : null])
}

function sameTarget(actual: unknown, expected: SemanticReadTarget): boolean {
  if (!isRecord(actual) || actual.kind !== expected.kind) return false
  const sameNullable = (value: unknown, wanted: string | null | undefined) =>
    (value === undefined || value === null ? null : value) === (wanted ?? null)
  if (expected.kind === 'named_reference') return actual.id === expected.id
  if (actual.type !== expected.type) return false
  if (expected.kind === 'territory') return actual.id === expected.id
  return sameNullable(actual.department_id, expected.department_id) &&
    sameNullable(actual.epci_id, expected.epci_id)
}

/** Group reads of one resource+target, keeping every group indivisible inside the 12-item budget. */
export function groupSemanticItems(items: readonly SemanticReadItem[]): SemanticReadItem[][] {
  const groups = new Map<string, SemanticReadItem[]>()
  for (const item of items) {
    const key = JSON.stringify([item.resource, canonicalTarget(item.target)])
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  const batches: SemanticReadItem[][] = []
  let batch: SemanticReadItem[] = []
  const push = (entries: readonly SemanticReadItem[]) => {
    if (batch.length + entries.length > SEMANTIC_MAX_BATCH_ITEMS) {
      batches.push(batch)
      batch = []
    }
    batch.push(...entries)
  }
  for (const group of groups.values()) {
    if (group.length <= SEMANTIC_MAX_BATCH_ITEMS) {
      push(group)
      continue
    }
    // One intent over many coordinate partitions (an AEDAR TYPEQU universe) is
    // independent bounded reads: split them. Two intents over one resource are
    // one atomic read group (facts + their comparisons) and must never split.
    const intents = new Set(group.map((item) => item.intent.kind))
    if (intents.size > 1) {
      throw new Error(`Lot sémantique indivisible supérieur à la limite de ${SEMANTIC_MAX_BATCH_ITEMS} lectures.`)
    }
    for (let start = 0; start < group.length; start += SEMANTIC_MAX_BATCH_ITEMS) {
      push(group.slice(start, start + SEMANTIC_MAX_BATCH_ITEMS))
    }
  }
  if (batch.length) batches.push(batch)
  return batches
}

class SemanticReadScheduler {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {}

  run<T>(read: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        read().then(resolve, reject).finally(() => {
          const next = this.waiting.shift()
          // Handing the slot straight to the next waiter keeps `active` unchanged.
          if (next) next()
          else this.active -= 1
        })
      }
      if (this.active < this.limit) {
        this.active += 1
        execute()
      } else this.waiting.push(execute)
    })
  }
}

interface CachedOutcome {
  item: SemanticReadItem
  coherence: string
  generation: number
  outcome: SemanticReadOutcome
}

interface PendingRead {
  item: SemanticReadItem
  generation: number
  promise: Promise<SemanticReadOutcome>
}

interface ItemState {
  item: SemanticReadItem
  state: Exclude<SemanticReadState, 'unrequested'>
  generation: number
}

interface SemanticClientState {
  scheduler: SemanticReadScheduler
  /** Settled outcomes, scoped by semantic item key and caller coherence token. */
  cache: Map<string, CachedOutcome>
  /** Identical in-flight items, always keyed by semantic item key only. */
  pending: Map<string, PendingRead>
  /** Per-item availability/error state, retained even without settled reuse. */
  states: Map<string, ItemState>
  generations: Map<string, number>
}

const stateByFetcher = new WeakMap<typeof fetch, SemanticClientState>()

function clientStateFor(fetcher: typeof fetch): SemanticClientState {
  let state = stateByFetcher.get(fetcher)
  if (!state) {
    state = { scheduler: new SemanticReadScheduler(SEMANTIC_MAX_ACTIVE_READS), cache: new Map(),
      pending: new Map(), states: new Map(), generations: new Map() }
    stateByFetcher.set(fetcher, state)
  }
  return state
}

function generationOf(state: SemanticClientState, key: string): number {
  return state.generations.get(key) ?? 0
}

function cacheKey(key: string, coherence: string): string {
  return `${key}\u0000${coherence}`
}

function remember(state: SemanticClientState, item: SemanticReadItem, coherence: string,
  generation: number, outcome: SemanticReadOutcome): void {
  const key = semanticItemKey(item)
  // A late reply for an invalidated generation never enters the cache.
  if (generationOf(state, key) !== generation) return
  const store = (token: string) => {
    const scoped = cacheKey(key, token)
    state.cache.delete(scoped)
    state.cache.set(scoped, { item, coherence: token, generation, outcome })
  }
  store(coherence)
  // An outcome also names its own publication identity. Storing that identity
  // lets a later acquisition of the same item reuse it only when it asks for
  // the same global reference clock — never when the dataset generation moved.
  if (outcome.status === 'available') {
    const reference = outcome.data.reference_content_version
    if (typeof reference === 'string' && reference.length > 0) {
      store(`territory-reference:${reference}`)
    }
  }
  while (state.cache.size > MAX_CACHED_OUTCOMES) {
    const oldest = state.cache.keys().next().value
    if (oldest === undefined) break
    state.cache.delete(oldest)
  }
}

function semanticRequestId(item: SemanticReadItem, index: number): string {
  return `semantic-${index}-${item.resource}`
}

/** Strict v2 envelope: one correlated outcome per requested item, in request order. */
export function parseSemanticBatchOutcomes(raw: unknown, items: readonly SemanticReadItem[],
  expectedFamilies?: ReadonlyMap<string, SemanticPublicationFamily>): SemanticReadOutcome[] {
  const path = SEMANTIC_BATCH_PATH
  const results = isRecord(raw) && raw.contract === SEMANTIC_BATCH_CONTRACT && Array.isArray(raw.results)
    ? raw.results : null
  if (!isRecord(raw) || raw.contract !== SEMANTIC_BATCH_CONTRACT || results === null ||
      results.length !== items.length) {
    throw new PayloadError('validation', path, 'Réponse du lot sémantique incompatible.')
  }
  return items.map((item, index) => {
    const result = results[index]
    if (!isRecord(result) || result.id !== semanticRequestId(item, index) ||
        result.resource !== item.resource) {
      throw new PayloadError('validation', path, 'La corrélation ou l’identité d’une ressource du lot est incompatible.')
    }
    if (result.status === 'available') {
      if (!isRecord(result.data) || result.data.resource !== item.resource ||
          !sameTarget(result.data.target, item.target)) {
        throw new PayloadError('validation', path, 'La cible renvoyée par le lot sémantique ne correspond pas à la lecture demandée.')
      }
      if ('reason' in result || 'family' in result) {
        throw new PayloadError('validation', path, 'Un résultat sémantique disponible porte un état de publication.')
      }
      return { status: 'available', resource: item.resource, target: item.target, data: result.data }
    }
    if (result.status === 'publication_unavailable') {
      if (typeof result.reason !== 'string' || !REASON_SET.has(result.reason) ||
          typeof result.family !== 'string' || !FAMILY_SET.has(result.family)) {
        throw new PayloadError('validation', path, 'Un état de publication indisponible est hors contrat.')
      }
      const expectedFamily = expectedFamilies?.get(item.resource)
      if (expectedFamily !== undefined && result.family !== expectedFamily) {
        throw new PayloadError('validation', path,
          `La famille d’un état de publication indisponible ne correspond pas à la ressource déclarée (${item.resource}: ${result.family} != ${expectedFamily}).`)
      }
      if ('data' in result || 'content_version' in result || 'reference_content_version' in result ||
          'descriptor_version' in result || 'version' in result) {
        throw new PayloadError('validation', path, 'Un état de publication indisponible invente des données ou une version.')
      }
      return { status: 'publication_unavailable', resource: item.resource, target: item.target,
        reason: result.reason as SemanticPublicationReason, family: result.family as SemanticPublicationFamily }
    }
    throw new PayloadError('validation', path, 'Un résultat de lot sémantique a un état inconnu.')
  })
}

async function postBatch(fetcher: typeof fetch, batch: readonly SemanticReadItem[],
  options: SemanticReadOptions = {}): Promise<SemanticReadOutcome[]> {
  const body = {
    contract: SEMANTIC_BATCH_CONTRACT,
    items: batch.map((item, index) => ({ ...item, id: semanticRequestId(item, index) })),
  }
  // No AbortSignal is forwarded: one caller cancelling never invalidates data
  // another caller is coalesced on.
  const raw = await poster(SEMANTIC_BATCH_PATH, body, { fetcher })
  return parseSemanticBatchOutcomes(raw, batch, options.expectedFamilies)
}

function abortedError(): PayloadError {
  return new PayloadError('fetch', SEMANTIC_BATCH_PATH, 'Lecture sémantique annulée.')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortedError()
}

interface OwnedItem {
  resolve: (outcome: SemanticReadOutcome) => void
  reject: (error: unknown) => void
  promise: Promise<SemanticReadOutcome>
}

/**
 * The one shared semantic read acquisition: strict v2 outcomes, semantic item
 * coalescing, per-item cache with generation fences and a scheduler bounded to
 * two active HTTP reads. Order in the returned array always matches the input.
 */
export async function readSemanticOutcomes(items: readonly SemanticReadItem[],
  options: SemanticReadOptions = {}): Promise<SemanticReadOutcome[]> {
  if (!items.length) {
    throw new PayloadError('validation', SEMANTIC_BATCH_PATH, 'Le lot sémantique doit contenir au moins une lecture.')
  }
  throwIfAborted(options.signal)
  const completion = acquireSemanticOutcomes(items, options)
  if (!options.signal) return completion
  // A caller cancellation stops waiting for the shared read; it never aborts
  // the request another caller is coalesced on.
  completion.catch(() => undefined)
  return raceWithAbort(completion, options.signal)
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortedError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

async function acquireSemanticOutcomes(items: readonly SemanticReadItem[],
  options: SemanticReadOptions): Promise<SemanticReadOutcome[]> {
  const fetcher = options.fetcher ?? globalThis.fetch
  const state = clientStateFor(fetcher)
  const keys = items.map((item) => semanticItemKey(item))
  const generations = keys.map((key) => generationOf(state, key))
  const resolved: Array<SemanticReadOutcome | undefined> = new Array(items.length)
  const failures: Array<unknown | undefined> = new Array(items.length)
  const primaryByKey = new Map<string, number>()
  const aliases: Array<[number, number]> = []
  const waiting: Array<{ index: number; promise: Promise<SemanticReadOutcome> }> = []

  for (let index = 0; index < items.length; index += 1) {
    const key = keys[index]!
    const generation = generations[index]!
    // A settled outcome is reused only for the same item AND the caller's own
    // publication identity. Without a coherence token a new acquisition never
    // replays an arbitrary settled read into an assembled group.
    if (!options.fresh && options.coherence !== undefined) {
      const cached = state.cache.get(cacheKey(key, options.coherence))
      if (cached && cached.generation === generation) {
        resolved[index] = cached.outcome
        continue
      }
    }
    // Identical in-flight work is always shared, including clock-observing
    // reads: `fresh` bypasses only a settled outcome, never a live fetch.
    const pending = state.pending.get(key)
    if (pending && pending.generation === generation) {
      waiting.push({ index, promise: pending.promise })
      continue
    }
    const primary = primaryByKey.get(key)
    if (primary !== undefined) aliases.push([index, primary])
    else primaryByKey.set(key, index)
  }

  const owned = new Map<number, OwnedItem>()
  const indexOfItem = new Map<SemanticReadItem, number>()
  // Registration pass. Re-checking the pending map here guarantees a racing
  // caller can never overwrite an in-flight entry another caller is joined on.
  for (const [key, index] of [...primaryByKey]) {
    const generation = generations[index]!
    const existing = state.pending.get(key)
    if (existing && existing.generation === generation) {
      primaryByKey.delete(key)
      waiting.push({ index, promise: existing.promise })
      continue
    }
    let resolve!: (outcome: SemanticReadOutcome) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<SemanticReadOutcome>((ok, fail) => { resolve = ok; reject = fail })
    // A coalesced read may have no waiter left after a caller cancels; the
    // rejection must never surface as an unhandled promise rejection.
    promise.catch(() => undefined)
    state.pending.set(key, { item: items[index]!, generation, promise })
    state.states.set(key, { item: items[index]!, state: 'pending', generation })
    owned.set(index, { resolve, reject, promise })
    indexOfItem.set(items[index]!, index)
  }

  if (owned.size) {
    try {
      const freshItems = [...owned.keys()].map((index) => items[index]!)
      const batches = groupSemanticItems(freshItems)
      await Promise.all(batches.map(async (batch) => {
        const indexes = batch.map((item) => indexOfItem.get(item)!)
        try {
          const outcomes = await state.scheduler.run(() => postBatch(fetcher, batch, options))
          outcomes.forEach((outcome, position) => {
            const index = indexes[position]!
            const key = keys[index]!
            const entry = owned.get(index)!
            if (generationOf(state, key) !== generations[index]) {
              if (state.pending.get(key)?.promise === entry.promise) state.pending.delete(key)
              entry.reject(new SemanticReadSupersededError(key))
              return
            }
            state.states.set(key, { item: items[index]!,
              state: outcome.status === 'available' ? 'available' : 'unavailable',
              generation: generations[index]! })
            if (options.coherence !== undefined) {
              remember(state, items[index]!, options.coherence, generations[index]!, outcome)
            }
            if (state.pending.get(key)?.promise === entry.promise) state.pending.delete(key)
            resolved[index] = outcome
            entry.resolve(outcome)
          })
        } catch (error) {
          for (const index of indexes) {
            const key = keys[index]!
            failures[index] = error
            if (generationOf(state, key) === generations[index]) {
              state.states.set(key, { item: items[index]!, state: 'error', generation: generations[index]! })
            }
            if (state.pending.get(key)?.promise === owned.get(index)!.promise) state.pending.delete(key)
            owned.get(index)!.reject(error)
          }
        }
      }))
    } catch (error) {
      for (const [index, entry] of owned) {
        const key = keys[index]!
        if (state.pending.get(key)?.promise === entry.promise) state.pending.delete(key)
        entry.reject(error)
      }
      throw error
    }
  }

  for (const { index, promise } of waiting) {
    const outcome = await promise
    // A coalesced item may have been invalidated while it was in flight.
    if (generationOf(state, keys[index]!) !== generations[index]) {
      throw new SemanticReadSupersededError(keys[index]!)
    }
    resolved[index] = outcome
  }
  for (const [alias, source] of aliases) resolved[alias] = resolved[source]
  if (options.signal?.aborted) throw abortedError()
  return keys.map((key, index) => {
    if (generationOf(state, key) !== generations[index]) throw new SemanticReadSupersededError(key)
    const outcome = resolved[index]
    if (!outcome) {
      if (failures[index] !== undefined) throw failures[index]
      throw new SemanticReadSupersededError(key)
    }
    return outcome
  })
}

/** Explicit state of one semantic item for the current client session. */
export function semanticReadState(item: SemanticReadItem, options: SemanticReadOptions = {}): SemanticReadState {
  const state = clientStateFor(options.fetcher ?? globalThis.fetch)
  const key = semanticItemKey(item)
  const generation = generationOf(state, key)
  const pending = state.pending.get(key)
  if (pending && pending.generation === generation) return 'pending'
  const entry = state.states.get(key)
  if (entry && entry.generation === generation) return entry.state
  return 'unrequested'
}

function invalidateKeys(state: SemanticClientState, keys: ReadonlySet<string>): number {
  let invalidated = 0
  for (const key of keys) {
    state.generations.set(key, generationOf(state, key) + 1)
    invalidated += 1
  }
  for (const [cacheId, entry] of [...state.cache]) {
    if (keys.has(semanticItemKey(entry.item))) state.cache.delete(cacheId)
  }
  for (const key of [...state.pending.keys()]) if (keys.has(key)) state.pending.delete(key)
  for (const key of [...state.states.keys()]) if (keys.has(key)) state.states.delete(key)
  return invalidated
}

/**
 * Explicit retry for an exact set of semantic items. Matching is by semantic
 * identity, so a structurally equal item object still invalidates the real
 * settled entry and any in-flight generation.
 */
export function invalidateSemanticItems(items: readonly SemanticReadItem[],
  options: SemanticReadOptions = {}): number {
  const state = clientStateFor(options.fetcher ?? globalThis.fetch)
  return invalidateKeys(state, new Set(items.map((item) => semanticItemKey(item))))
}

/**
 * Explicit invalidation/retry: bump the item generation so a late reply never
 * applies, drop its settled absence and let the next acquisition re-probe.
 */
export function invalidateSemanticReads(
  predicate?: (item: SemanticReadItem, key: string) => boolean,
  options: SemanticReadOptions = {},
): number {
  const state = clientStateFor(options.fetcher ?? globalThis.fetch)
  const keys = new Set<string>()
  for (const entry of state.cache.values()) {
    const key = semanticItemKey(entry.item)
    if (!predicate || predicate(entry.item, key)) keys.add(key)
  }
  for (const [key, entry] of state.pending) {
    if (!predicate || predicate(entry.item, key)) keys.add(key)
  }
  for (const [key, entry] of state.states) {
    if (!predicate || predicate(entry.item, key)) keys.add(key)
  }
  return invalidateKeys(state, keys)
}

/** Invalidate every cached read for one territory, optionally limited to resources. */
export function invalidateSemanticReadsForTarget(type: string, id: string,
  resources?: ReadonlySet<string>, options: SemanticReadOptions = {}): number {
  return invalidateSemanticReads((item) => {
    if (item.target.kind === 'named_reference') return false
    if (item.target.type !== type) return false
    if (item.target.kind === 'territory' && item.target.id !== id) return false
    return !resources || resources.has(item.resource)
  }, options)
}

/**
 * Compatibility entry point for callers that need the unchanged data payload.
 * An unavailable item is a typed error, never a fabricated value; the caller's
 * existing error surface stays explicit and nothing retries by itself.
 */
export async function lireRessourcesBatch(items: SemanticReadItem[],
  options: SemanticReadOptions = {}): Promise<RecordValue[]> {
  const outcomes = await readSemanticOutcomes(items, options)
  const unavailable = outcomes.find((outcome): outcome is Extract<SemanticReadOutcome,
    { status: 'publication_unavailable' }> => outcome.status === 'publication_unavailable')
  if (unavailable) throw new SemanticPublicationUnavailableError(unavailable)
  return outcomes.map((outcome) => (outcome as Extract<SemanticReadOutcome, { status: 'available' }>).data)
}

/** Comparison reads share the same closed semantic item grammar. */
export async function lireRessource(item: SemanticReadItem): Promise<RecordValue> {
  const path = SEMANTIC_READ_PATH
  const raw = await poster(path, item as unknown as RecordValue)
  if (!isRecord(raw) || raw.resource !== item.resource) {
    throw new PayloadError('validation', path, 'La lecture sémantique ne correspond pas à la ressource demandée.')
  }
  return raw
}

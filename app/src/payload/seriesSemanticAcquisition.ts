import type { Territoire, TerritoireType } from './types'
import type { OrderedSeriesRead } from './orderedSeriesAdapter'
import { lireRessourcesBatch } from './semanticResourceClient'
import type { SemanticReadItem } from './semanticResourceClient'

type Row = Record<string, any>
const record = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** The facts half of an admitted ordered-series read: everything the page can
 *  keep rendering while a comparison alone is rejected or retried (#857). */
export interface OrderedSeriesFactsEvidence {
  indicator_id: string
  axis_kind: string
  unit: string
  territory: { id: string; type: string; name?: string }
  points: Row[]
  dataset_id?: string
  scope_series: Row[]
  native_descriptor: OrderedSeriesRead['native_descriptor']
  scalar_facet?: OrderedSeriesRead['scalar_facet']
  /** The full validated cohort descriptor and its publication identity. */
  descriptor: Row
  content_version: string
  reference_content_version: string
  /** The producer's own state-role marking on the acquired points (OCS-GE M2/M3). */
  role_axes: string[]
  /** Every producer source id the cohort's own provenance declared. */
  declared_source_ids: string[]
  /** API-resolved typed population, distinct from rows with available facts. */
  resolved_cohort_type: string
  resolved_cohort_members: Array<{ id: string; type: string }>
  cohort_is_filtered: boolean
  cohort_department_id?: string | null
  cohort_epci_id?: string | null
}

export interface OrderedSeriesSemanticSession {
  acquire(input: OrderedSeriesAcquireInput): Promise<OrderedSeriesRead>
  clearCohort(input: Pick<OrderedSeriesAcquireInput, 'resource' | 'level' | 'includeScalarFacet' | 'departmentId' | 'epciId'>): void
  refresh(input: OrderedSeriesAcquireInput): Promise<OrderedSeriesRead>
}

export interface OrderedSeriesAcquireInput {
  resource: string
  level: TerritoireType
  focal: Territoire
  territories: readonly Territoire[]
  includeScalarFacet?: boolean
  departmentId?: string
  epciId?: string
}

type SessionEntries = {
  cohorts: Map<string, OrderedSeriesFactsEvidence>
  focals: Map<string, OrderedSeriesFactsEvidence>
  comparisons: Map<string, OrderedSeriesRead>
  cohortGenerations: Map<string, number>
}

const cohortKey = (input: OrderedSeriesAcquireInput) => JSON.stringify([
  input.resource, input.level, input.departmentId ?? null, input.epciId ?? null,
  Boolean(input.includeScalarFacet),
])
const focalKey = (input: OrderedSeriesAcquireInput) => JSON.stringify([
  cohortKey(input), input.focal.type, input.focal.territoire,
])
const comparisonKey = (input: OrderedSeriesAcquireInput) => JSON.stringify([
  focalKey(input), scopedMembers(input)?.map(({ type, id }) => [type, id]).sort((a, b) =>
    `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`)) ?? 'fixed-default',
])

/** A comparison whose native evidence failed strict binding. The already
 *  validated facts stay admitted; only the comparison is reacquired. */
export class SeriesComparisonRejectedError extends Error {
  constructor(message: string, readonly facts: OrderedSeriesFactsEvidence) {
    super(message)
    this.name = 'SeriesComparisonRejectedError'
  }
}

/** A native owner clock changed underneath admitted facts. Unlike a transient
 *  comparison failure, this requires a scoped facts refresh before retrying. */
export class SeriesPublicationMismatchError extends Error {
  constructor(readonly facet: 'series' | 'scalar', message: string,
    readonly facts?: OrderedSeriesFactsEvidence) {
    super(message)
    this.name = 'SeriesPublicationMismatchError'
  }
}

/** Cohort admission survives an exact-focal request failure; it contains no
 *  claim that a focal observation was acquired. */
export class SeriesCohortAvailableError extends Error {
  constructor(message: string, readonly cohort: OrderedSeriesFactsEvidence) {
    super(message)
    this.name = 'SeriesCohortAvailableError'
  }
}

export function projectAdmittedCohortForFocal(cohort: OrderedSeriesFactsEvidence,
  focal: Territoire): OrderedSeriesRead {
  const matching = cohort.scope_series.find((group) => group.territory.id === focal.territoire &&
    group.territory.type === focal.type)
  return { ...cohort,
    territory: matching?.territory ?? { id: focal.territoire, type: focal.type, name: focal.nom },
    points: matching?.points ?? [],
    scalar_facet: cohort.scalar_facet?.cohort ? { cohort: cohort.scalar_facet.cohort } : undefined,
    comparison: null,
  } as unknown as OrderedSeriesRead
}

function assertDescriptor(value: unknown): Row {
  if (!record(value) || !text(value.dataset_id) || !text(value.theme_id) || !text(value.axis_kind) ||
      !Array.isArray(value.axis_values) || !value.axis_values.every((axis: unknown) => text(axis)) ||
      !(value.axis_numeric_values === null || (Array.isArray(value.axis_numeric_values) &&
        value.axis_numeric_values.every((axis: unknown) => finite(axis)))) ||
      !['may_be_missing', 'dense_complete'].includes(value.completeness) ||
      !text(value.absence_semantics) || !text(value.label) || !text(value.unit) ||
      !['high', 'low', 'none'].includes(value.direction) || !text(value.descriptor_version) ||
      !Array.isArray(value.allowed_levels) ||
      !(value.comparison_point === null || text(value.comparison_point)) ||
      !(value.observation_period_kind === null || text(value.observation_period_kind))) {
    throw new Error('Descripteur de série sémantique incompatible')
  }
  return value
}

/** One series point: a measured point carries a finite value, a missing point
 *  carries none, and provenance binds only the cohort's declared sources. */
function assertSeriesPoint(point: unknown, declaredSourceIds: Set<string> | null, context: string): void {
  if (!record(point) || !text(point.axis) || !['measured', 'missing'].includes(point.status) ||
      !(point.observation_period === null || point.observation_period === undefined ||
        text(point.observation_period)) ||
      !(point.missing_reason === null || point.missing_reason === undefined || text(point.missing_reason))) {
    throw new Error(`Point de série invalide (${context})`)
  }
  if (point.status === 'measured') {
    if (!finite(point.value)) throw new Error(`Valeur mesurée absente du fil natif (${context})`)
  } else if (point.value !== null && point.value !== undefined) {
    throw new Error(`Point manquant porteur de valeur (${context})`)
  }
  if (!Array.isArray(point.provenance)) throw new Error(`Provenance de point absente (${context})`)
  for (const revision of point.provenance) {
    if (!record(revision) || !text(revision.revision_id) || !text(revision.source_id) ||
        !text(revision.vintage_id) || !text(revision.source_name) || !text(revision.version) ||
        (declaredSourceIds !== null && !declaredSourceIds.has(revision.source_id)) ||
        !(revision.reference_date === null || text(revision.reference_date)) ||
        !(revision.publication_date === null || text(revision.publication_date))) {
      throw new Error(`Provenance de point non déclarée (${context})`)
    }
  }
}

function cohortSourceIds(series: Row[]): Set<string> {
  return new Set(series.flatMap((group) => group.points.flatMap((point: Row) =>
    (Array.isArray(point?.provenance) ? point.provenance : []).map((revision: Row) => revision.source_id)
      .filter((sourceId: unknown): sourceId is string => text(sourceId)))))
}

/** The comparison request item shared by the initial batch and the
 *  comparison-only re-acquisition. */
function comparisonItem(input: {
  resource: string; focal: Territoire; includeScalarFacet?: boolean
}, members: Array<{ type: TerritoireType; id: string }> | null): SemanticReadItem {
  const fields = input.includeScalarFacet
    ? ['axis_comparisons', 'scalar_facet', 'median', 'rank', 'rank_size', 'rank_ties',
      'selected_member_count', 'eligible_count', 'missing_count', 'member_ranks']
    : ['axis_comparisons']
  return {
    resource: input.resource,
    target: { kind: 'territory', type: input.focal.type, id: input.focal.territoire },
    intent: members
      ? { kind: 'selected_comparison', members }
      : { kind: 'fixed_comparison', context: 'default' },
    fields,
  }
}

function publicationMismatch(comparisonData: Row, facts: OrderedSeriesFactsEvidence):
  'series' | 'scalar' | null {
  if (text(comparisonData.content_version) && comparisonData.content_version !== facts.content_version ||
      text(comparisonData.reference_content_version) &&
        comparisonData.reference_content_version !== facts.reference_content_version) return 'series'
  if (facts.scalar_facet && record(comparisonData.scalar_facet)) {
    const scalar = comparisonData.scalar_facet
    const admitted = facts.scalar_facet
    const expectedVersion = admitted.cohort?.content_version
    if (text(expectedVersion) && text(scalar.content_version) && scalar.content_version !== expectedVersion) return 'scalar'
  }
  return null
}

function scopedMembers(input: {
  level: TerritoireType; territories: readonly Territoire[]; departmentId?: string; epciId?: string
}): Array<{ type: TerritoireType; id: string }> | null {
  const explicitFilter = input.level === 'commune' && Boolean(input.departmentId || input.epciId)
  if (!explicitFilter) return null
  return input.territories.filter((territory) => territory.type === 'commune' &&
    (!input.departmentId || territory.departement === input.departmentId) &&
    (!input.epciId || territory.epci === input.epciId))
    .map((territory) => ({ type: 'commune' as const, id: territory.territoire }))
}

/** Validate one comparison response against the admitted facts' descriptor,
 *  publication identity, resolved selection and declared sources, then map it
 *  to the read's comparison evidence. Any single corrupt wire field rejects the
 *  whole comparison before it is cached (#857). */
function bindComparisonEvidence(comparisonData: Row, facts: {
  descriptor: Row; contentVersion: string; referenceContentVersion: string
  declaredSourceIds: Set<string>; resolvedCohortType: string
  resolvedCohortMembers: Array<{ id: string; type: string }>; cohortIsFiltered: boolean
  focal: { id: string; type: string }; resource: string
}, requestedMembers: Array<{ type: TerritoireType; id: string }> | null): OrderedSeriesRead['comparison'] {
  const result = comparisonData.result
  const target = comparisonData.target
  if (!record(result) || !record(target) || target.kind !== 'territory' ||
      target.id !== facts.focal.id || target.type !== facts.focal.type ||
      comparisonData.resource !== facts.resource || result.indicator_id !== facts.resource ||
      !['median', 'mean'].includes(result.statistic) ||
      !['available', 'unavailable'].includes(result.status) ||
      comparisonData.content_version !== facts.contentVersion ||
      comparisonData.reference_content_version !== facts.referenceContentVersion ||
      result.descriptor_version !== facts.descriptor.descriptor_version) {
    throw new Error('Identité ou publication de comparaison sémantique incompatible')
  }
  if (requestedMembers) {
    const selection = comparisonData.selection
    if (!Array.isArray(selection) || selection.length !== requestedMembers.length ||
        !selection.every((member: Row) => record(member) &&
          requestedMembers.some((requested) => requested.type === member.territory_type &&
            requested.id === member.territory_id))) {
      throw new Error('Écho de sélection de comparaison incompatible')
    }
    const requestedIds = new Set(requestedMembers.map((member) => member.id))
    const resolvedIds = new Set(facts.resolvedCohortMembers.map((member) => member.id))
    if (requestedMembers.some((member) => member.type !== facts.resolvedCohortType) ||
        requestedIds.size !== resolvedIds.size || [...requestedIds].some((id) => !resolvedIds.has(id))) {
      throw new Error('Sélection de comparaison incompatible avec la population API résolue')
    }
  }
  const scope = comparisonData.scope
  if (!record(scope) || !text(scope.kind) ||
      !Number.isInteger(scope.member_count) || scope.member_count < 1) {
    throw new Error('Périmètre de comparaison sémantique incompatible')
  }
  const selectedTypes = requestedMembers ? [...new Set(requestedMembers.map((member) => member.type))] : []
  const expectedScopeType = selectedTypes.length === 1 ? selectedTypes[0] : facts.resolvedCohortType
  if (scope.territory_type !== undefined && expectedScopeType !== undefined &&
      scope.territory_type !== expectedScopeType) {
    throw new Error('Type du périmètre de comparaison incompatible')
  }
  let expectedMembers: Set<string> | undefined
  let exactPopulation = false
  if (requestedMembers) {
    expectedMembers = new Set(requestedMembers.map((member) => member.id))
    exactPopulation = true
  } else if (!facts.cohortIsFiltered && scope.territory_type === facts.resolvedCohortType) {
    expectedMembers = new Set(facts.resolvedCohortMembers.map((member) => member.id))
    exactPopulation = scope.kind === 'same_level'
    if (exactPopulation && scope.member_count !== facts.resolvedCohortMembers.length) {
      throw new Error('Population native de comparaison incohérente avec la cohorte résolue')
    }
  }
  const axisComparisons = Array.isArray(result.axis_comparisons) ? result.axis_comparisons : []
  if (!axisComparisons.length) throw new Error('Preuve de comparaison par axe absente')
  const mapped = axisComparisons.map((candidate: unknown) => {
    const axis = record(candidate) && text(candidate.axis) ? candidate.axis : '?'
    if (!record(candidate) || !['median', 'mean'].includes(candidate.statistic) ||
        candidate.statistic !== result.statistic ||
        !['available', 'unavailable'].includes(candidate.status) ||
        !(candidate.value === null || finite(candidate.value)) ||
        !(candidate.min === null || finite(candidate.min)) ||
        !(candidate.max === null || finite(candidate.max)) ||
        !Number.isInteger(candidate.selected_member_count) || candidate.selected_member_count < 1 ||
        !Number.isInteger(candidate.eligible_count) || candidate.eligible_count < 0 ||
        !Number.isInteger(candidate.missing_count) || candidate.missing_count < 0 ||
        candidate.eligible_count + candidate.missing_count !== candidate.selected_member_count ||
        !Array.isArray(candidate.member_ranks) || !Array.isArray(candidate.sources)) {
      throw new Error(`Preuve de comparaison par axe invalide (${axis})`)
    }
    if (candidate.selected_member_count !== scope.member_count) {
      throw new Error(`Population de comparaison incohérente (${axis})`)
    }
    for (const source of candidate.sources) {
      if (!record(source) || !text(source.source_id) || !facts.declaredSourceIds.has(source.source_id) ||
          !text(source.revision_id) || !text(source.vintage_id) || !text(source.version) ||
          !(source.reference_date === null || text(source.reference_date)) ||
          !(source.publication_date === null || text(source.publication_date))) {
        throw new Error(`Source de comparaison non déclarée (${axis})`)
      }
    }
    if (candidate.status === 'available') {
      if (candidate.value === null || candidate.min === null || candidate.max === null ||
          candidate.min > candidate.max || candidate.value < candidate.min ||
          candidate.value > candidate.max || candidate.eligible_count < 2) {
        throw new Error(`Agrégat de comparaison incohérent (${axis})`)
      }
    } else if (candidate.value !== null || candidate.min !== null || candidate.max !== null) {
      throw new Error(`Comparaison indisponible porteuse de valeurs (${axis})`)
    }
    const rankIds = new Set<string>()
    for (const rank of candidate.member_ranks) {
      if (!record(rank) || !text(rank.territory_id) || rankIds.has(rank.territory_id) ||
          (expectedMembers !== undefined && !expectedMembers.has(rank.territory_id)) ||
          !(rank.rank === null || Number.isInteger(rank.rank)) ||
          !(rank.rank_size === null || Number.isInteger(rank.rank_size)) ||
          !(rank.rank_ties === null || Number.isInteger(rank.rank_ties))) {
        throw new Error(`Rang de pair invalide (${axis})`)
      }
      rankIds.add(rank.territory_id)
      if (candidate.status !== 'available') {
        if (rank.rank !== null || rank.rank_size !== null || rank.rank_ties !== null) {
          throw new Error(`Rang porté par une comparaison indisponible (${axis})`)
        }
        continue
      }
      // A member without a measured value legitimately carries no rank; the
      // ranked-count check below reconciles them with the eligibility.
      if (rank.rank === null) continue
      if (!Number.isInteger(rank.rank) || !Number.isInteger(rank.rank_size) ||
          !Number.isInteger(rank.rank_ties) || rank.rank_size !== candidate.eligible_count ||
          rank.rank_size < 1 || rank.rank < 1 || rank.rank > rank.rank_size ||
          rank.rank_ties < 1 || rank.rank_ties > rank.rank_size ||
          rank.rank + rank.rank_ties > rank.rank_size + 1) {
        throw new Error(`Span de rang publié impossible (${axis})`)
      }
    }
    if (rankIds.size !== candidate.selected_member_count ||
        (exactPopulation && expectedMembers !== undefined &&
          (rankIds.size !== expectedMembers.size || [...expectedMembers].some((id) => !rankIds.has(id))))) {
      throw new Error(`Population de rangs publiée incompatible (${axis})`)
    }
    const rankedCount = candidate.member_ranks.filter((rank: Row) => rank.rank !== null).length
    if (candidate.status === 'available' ? rankedCount !== candidate.eligible_count : rankedCount !== 0) {
      throw new Error(`Rangs de pairs incohérents avec l'éligibilité (${axis})`)
    }
    return candidate
  })
  const comparisonPoint = facts.descriptor.comparison_point
  const selected = mapped.find((item: Row) => item.axis === comparisonPoint)
  const focalRank = selected?.member_ranks?.find((rank: Row) =>
    rank.territory_id === facts.focal.id)
  return {
    point: comparisonPoint,
    value: selected?.value,
    median: selected?.statistic === 'median' ? selected.value : undefined,
    mean: selected?.statistic === 'mean' ? selected.value : undefined,
    rank: focalRank?.rank ?? null,
    ties: focalRank?.rank_ties ?? null,
    comparable_count: selected?.eligible_count,
    direction: facts.descriptor.direction,
    axis_comparisons: mapped,
    scope,
  } as unknown as OrderedSeriesRead['comparison']
}

/** One bounded semantic batch: filtered cohort facts, exact focal facts, and
 *  comparison evidence — each part bound to the others' publication identity,
 *  declared sources and resolved selection before anything is admitted (#857).
 *  A comparison whose evidence fails binding rejects alone: the validated facts
 *  stay admitted on the typed error and only the comparison is reacquired. */
async function acquireWithinSession(input: OrderedSeriesAcquireInput, entries: SessionEntries): Promise<OrderedSeriesRead> {
  const members = scopedMembers(input)
  const key = cohortKey(input)
  const exactKey = focalKey(input)
  const compareKey = comparisonKey(input)
  const generation = (entries.cohortGenerations.get(key) ?? 0) + (entries.cohorts.has(key) ? 0 : 1)
  if (!entries.cohorts.has(key)) entries.cohortGenerations.set(key, generation)
  const admittedCohort = entries.cohorts.get(key)
  const admittedFocal = entries.focals.get(exactKey)
  if (admittedFocal && admittedCohort &&
      admittedFocal.content_version === admittedCohort.content_version &&
      admittedFocal.reference_content_version === admittedCohort.reference_content_version &&
      admittedFocal.descriptor.descriptor_version === admittedCohort.descriptor.descriptor_version) {
    const cached = entries.comparisons.get(compareKey)
    if (cached) return cached
    try {
      const [comparisonData] = await lireRessourcesBatch([comparisonItem(input, members)])
      const mismatch = publicationMismatch(comparisonData, admittedFocal)
      if (mismatch) throw new SeriesPublicationMismatchError(mismatch,
        'La publication native a changé depuis le chargement des faits.', admittedFocal)
      const comparison = bindComparisonEvidence(comparisonData, {
        descriptor: admittedFocal.descriptor, contentVersion: admittedFocal.content_version,
        referenceContentVersion: admittedFocal.reference_content_version,
        declaredSourceIds: new Set(admittedFocal.declared_source_ids),
        resolvedCohortType: admittedFocal.resolved_cohort_type,
        resolvedCohortMembers: admittedFocal.resolved_cohort_members,
        cohortIsFiltered: admittedFocal.cohort_is_filtered,
        focal: admittedFocal.territory, resource: input.resource,
      }, members)
      const result = attachAdmittedComparison(admittedFocal, comparison, comparisonData, input)
      if (entries.cohortGenerations.get(key) === generation) entries.comparisons.set(compareKey, result)
      return result
    } catch (cause) {
      if (cause instanceof SeriesPublicationMismatchError) throw cause
      throw new SeriesComparisonRejectedError(cause instanceof Error ? cause.message : String(cause), admittedFocal)
    }
  }
  const cohortTarget = { kind: 'territory_cohort' as const, type: input.level,
    ...(input.level === 'commune' ? { department_id: input.departmentId ?? null, epci_id: input.epciId ?? null } : {}) }
  const focalItem: SemanticReadItem = { resource: input.resource,
    target: { kind: 'territory', type: input.focal.type, id: input.focal.territoire }, intent: { kind: 'facts' } }
  let cohort: Row
  let focal: Row
  let comparisonData: Row | undefined
  if (admittedCohort) {
    try {
      [focal] = await lireRessourcesBatch([focalItem])
    } catch (cause) {
      throw new SeriesCohortAvailableError('Les faits du territoire focal sont indisponibles.', admittedCohort)
    }
    if ((text(focal.content_version) && focal.content_version !== admittedCohort.content_version) ||
        (text(focal.reference_content_version) &&
          focal.reference_content_version !== admittedCohort.reference_content_version)) {
      throw new SeriesPublicationMismatchError('series',
        'La publication native a changé depuis le chargement des faits.', admittedCohort)
    }
    const admittedScalarCohort = admittedCohort.scalar_facet?.cohort
    if (input.includeScalarFacet && record(admittedScalarCohort) && record(focal.scalar_facet) &&
        text(admittedScalarCohort.content_version) && text(focal.scalar_facet.content_version) &&
        focal.scalar_facet.content_version !== admittedScalarCohort.content_version) {
      throw new SeriesPublicationMismatchError('scalar',
        'La publication de la facette scalaire a changé depuis le chargement des faits.', admittedCohort)
    }
    cohort = cohortResponseFromFacts(admittedCohort, input)
  } else {
    [cohort, focal, comparisonData] = await lireRessourcesBatch([
      { resource: input.resource, target: cohortTarget, intent: { kind: 'facts' },
        fields: input.includeScalarFacet ? ['value', 'scalar_facet'] : ['value'] },
      focalItem,
      comparisonItem(input, members),
    ])
  }
  if (cohort.shape !== 'ordered_series' || !Array.isArray(cohort.series) ||
      !record(cohort.cohort) || !Array.isArray(cohort.cohort.members) ||
      !record(focal.territory) || !Array.isArray(focal.points)) {
    throw new Error('Réponse de série sémantique incompatible')
  }
  const descriptor = assertDescriptor(cohort.descriptor)
  const resolvedCohort = cohort.cohort
  if (resolvedCohort.territory_type !== input.level ||
      resolvedCohort.department_id !== (input.departmentId ?? null) ||
      resolvedCohort.epci_id !== (input.epciId ?? null) ||
      resolvedCohort.reference_content_version !== cohort.reference_content_version ||
      !Number.isInteger(resolvedCohort.member_count) ||
      resolvedCohort.member_count !== resolvedCohort.members.length ||
      !resolvedCohort.members.every((member: Row) => record(member) && text(member.id) &&
        member.type === resolvedCohort.territory_type) ||
      new Set(resolvedCohort.members.map((member: Row) => member.id)).size !== resolvedCohort.members.length) {
    throw new Error('Population territoriale résolue incompatible')
  }
  if (cohort.resource !== input.resource || focal.resource !== input.resource ||
      !text(cohort.content_version) || !text(cohort.reference_content_version) ||
      !(focal.content_version === cohort.content_version ||
        focal.publication_id === cohort.content_version) ||
      focal.reference_content_version !== cohort.reference_content_version ||
      focal.descriptor_version !== descriptor.descriptor_version ||
      focal.indicator_id !== input.resource || focal.dataset_id !== descriptor.dataset_id) {
    throw new Error('Identité ou publication de série sémantique incompatible')
  }
  const focalTerritory = focal.territory
  if (focalTerritory.id !== input.focal.territoire || focalTerritory.type !== input.focal.type) {
    throw new Error('Territoire focal de série sémantique incompatible')
  }
  const groupSeries = cohort.series.map((candidate: unknown) => {
    if (!record(candidate) || !record(candidate.territory) || !Array.isArray(candidate.points) ||
        !text(candidate.territory.id) || !text(candidate.territory.type)) {
      throw new Error('Faits de cohorte de série invalides')
    }
    return candidate
  })
  // The cohort's own provenance declares the resource's admissible sources.
  const declaredSourceIds = cohortSourceIds(groupSeries)
  for (const group of groupSeries) {
    group.points.forEach((point: unknown, index: number) =>
      assertSeriesPoint(point, declaredSourceIds, `${group.territory.id}#${index}`))
  }
  focal.points.forEach((point: unknown, index: number) =>
    assertSeriesPoint(point, declaredSourceIds, `focal#${index}`))
  if (input.includeScalarFacet) {
    for (const facet of [cohort.scalar_facet, focal.scalar_facet]) {
      if (facet !== undefined && facet !== null && !record(facet)) {
        throw new Error('Facette scalaire de série sémantique incompatible')
      }
    }
  }
  const cohortMembers = resolvedCohort.members.map((member: Row) => ({ id: member.id, type: member.type }))
  const facts: OrderedSeriesFactsEvidence = {
    indicator_id: input.resource,
    axis_kind: descriptor.axis_kind,
    unit: descriptor.unit,
    territory: { id: focalTerritory.id, type: focalTerritory.type, name: focalTerritory.name },
    points: focal.points,
    dataset_id: descriptor.dataset_id,
    scope_series: groupSeries,
    native_descriptor: { label: descriptor.label, unit: descriptor.unit, direction: descriptor.direction,
      axis_kind: descriptor.axis_kind, axis_values: descriptor.axis_values,
      comparison_point: descriptor.comparison_point ?? null },
    ...(input.includeScalarFacet ? { scalar_facet: {
      cohort: cohort.scalar_facet as Row | undefined, focal: focal.scalar_facet as Row | undefined,
    } } : {}),
    descriptor,
    content_version: cohort.content_version,
    reference_content_version: cohort.reference_content_version,
    role_axes: [...new Set([...focal.points, ...groupSeries.flatMap((group: Row) => group.points)]
      .flatMap((point: Row) => text(point.state_role) ? [point.state_role] : []))],
    declared_source_ids: [...declaredSourceIds],
    resolved_cohort_type: resolvedCohort.territory_type,
    resolved_cohort_members: cohortMembers,
    cohort_is_filtered: Boolean(resolvedCohort.department_id || resolvedCohort.epci_id),
    cohort_department_id: resolvedCohort.department_id,
    cohort_epci_id: resolvedCohort.epci_id,
  }
  if (entries.cohortGenerations.get(key) === generation) {
    entries.cohorts.set(key, facts)
    entries.focals.set(exactKey, facts)
  }
  try {
    if (!comparisonData) [comparisonData] = await lireRessourcesBatch([comparisonItem(input, members)])
    const comparison = bindComparisonEvidence(comparisonData, {
      descriptor, contentVersion: cohort.content_version,
      referenceContentVersion: cohort.reference_content_version,
      declaredSourceIds, resolvedCohortType: resolvedCohort.territory_type,
      resolvedCohortMembers: cohortMembers, cohortIsFiltered: facts.cohort_is_filtered,
      focal: facts.territory, resource: input.resource,
    }, members)
    const result = attachAdmittedComparison(facts, comparison, comparisonData, input)
    if (entries.cohortGenerations.get(key) === generation) {
      entries.comparisons.set(compareKey, result)
    }
    return result
  } catch (cause) {
    throw new SeriesComparisonRejectedError(
      cause instanceof Error ? cause.message : String(cause), facts)
  }
}

function attachAdmittedComparison(facts: OrderedSeriesFactsEvidence,
  comparison: OrderedSeriesRead['comparison'], comparisonData: Row,
  input: OrderedSeriesAcquireInput): OrderedSeriesRead {
  let scalarComparison: Row | undefined
  if (facts.scalar_facet) {
    if (!isValidScalarComparisonFacet(comparisonData.scalar_facet, facts, input)) {
      throw new Error('Preuve de comparaison scalaire native absente ou incompatible')
    }
    scalarComparison = comparisonData.scalar_facet as Row
  }
  return { ...facts, comparison,
    ...(facts.scalar_facet ? { scalar_facet: { ...facts.scalar_facet,
      comparison: scalarComparison,
    } } : {}),
  } as unknown as OrderedSeriesRead
}

function isValidScalarComparisonFacet(value: unknown, facts: OrderedSeriesFactsEvidence,
  input: OrderedSeriesAcquireInput): boolean {
  const admitted = facts.scalar_facet
  if (!record(value) || !admitted || !record(admitted.cohort) || !record(admitted.focal)) return false
  const cohort = admitted.cohort
  const focal = admitted.focal
  const cohortDescriptor = cohort.descriptor
  const focalDescriptor = focal.descriptor
  const descriptor = value.descriptor
  const result = value.result
  const selection = scopedMembers(input)
  const cohortEvidence = cohort.cohort
  const cohortObservations = cohort.observations
  const focalObservation = focal.observation
  if (value.shape !== 'scalar' || value.source_facet !== input.resource ||
      value.content_version !== cohort.content_version || value.content_version !== focal.content_version ||
      value.reference_content_version !== cohort.reference_content_version ||
      value.reference_content_version !== focal.reference_content_version ||
      value.descriptor_version !== cohortDescriptor?.descriptor_version ||
      value.descriptor_version !== focalDescriptor?.descriptor_version ||
      value.descriptor_version !== descriptor?.descriptor_version ||
      !record(cohortEvidence) || cohort.resource !== input.resource || cohort.shape !== 'scalar' ||
      cohort.target?.kind !== 'territory_cohort' || cohort.target.type !== input.level ||
      cohort.target.department_id !== (input.departmentId ?? null) ||
      cohort.target.epci_id !== (input.epciId ?? null) ||
      cohortEvidence.territory_type !== facts.resolved_cohort_type ||
      cohortEvidence.department_id !== (input.departmentId ?? null) ||
      cohortEvidence.epci_id !== (input.epciId ?? null) ||
      cohortEvidence.reference_content_version !== value.reference_content_version ||
      !Number.isInteger(cohortEvidence.member_count) || cohortEvidence.member_count < 1 ||
      !sameCohortMembers(cohortEvidence.members, cohortEvidence.members) ||
      cohortEvidence.member_count !== cohortEvidence.members.length ||
      focal.shape !== 'scalar' || focal.source_facet !== input.resource ||
      !record(focalObservation) || focalObservation.territory_id !== facts.territory.id ||
      focalObservation.territory_type !== facts.territory.type ||
      descriptor?.indicator_id !== input.resource || descriptor.theme_id !== cohortDescriptor?.theme_id ||
      descriptor.comparison_facet !== input.resource || descriptor.direction !== cohortDescriptor?.direction ||
      !record(result) || result.indicator_id !== input.resource || result.source_facet !== input.resource ||
      result.descriptor_version !== value.descriptor_version || result.direction !== descriptor.direction ||
      result.statistic !== 'median' || !['available', 'unavailable'].includes(result.status) ||
      typeof result.focal_in_selection !== 'boolean' || !record(value.scope) || !text(value.scope.kind) ||
      !Number.isInteger(value.scope.member_count) || value.scope.member_count < 1 ||
      !Number.isInteger(result.selected_member_count) || result.selected_member_count !== value.scope.member_count ||
      !Number.isInteger(result.eligible_count) || result.eligible_count < 0 ||
      !Number.isInteger(result.missing_count) || result.missing_count < 0 ||
      result.eligible_count + result.missing_count !== result.selected_member_count ||
      (selection !== null && (value.scope.kind !== 'explicit_selection' ||
        value.scope.member_count !== selection.length || !sameTypedMembers(value.selection, selection))) ||
      (selection === null && value.selection !== null && value.selection !== undefined)) return false

  const selectedIds = selection?.map((member) => member.id) ?? null
  const scalarCohortMembers = (cohortEvidence.members as Row[]).map((member) => ({
    id: member.id as string, type: member.type as string,
  }))
  if (selection && selection.some((member) => !scalarCohortMembers.some((candidate) =>
      candidate.id === member.id && candidate.type === member.type))) return false
  const focalSelected = selectedIds === null || selectedIds.includes(facts.territory.id)
  if (selection && result.focal_in_selection !== focalSelected) return false

  const sourceIdentity = (source: Row) => JSON.stringify([source.source_id, source.vintage_id,
    source.version, source.reference_date ?? null, source.publication_date ?? null])
  const factSources = new Set((Array.isArray(cohortObservations) ? cohortObservations : []).flatMap((observation: Row) =>
    Array.isArray(observation.sources) ? observation.sources.filter(record).map(sourceIdentity) : []))
  const comparisonSources = result.comparison_sources
  if (!Array.isArray(comparisonSources) || comparisonSources.length === 0 ||
      !comparisonSources.every((source: unknown) => record(source) && text(source.source_id) &&
        text(source.vintage_id) && text(source.version) &&
        (source.reference_date === null || text(source.reference_date)) &&
        (source.publication_date === null || text(source.publication_date)) &&
        factSources.has(sourceIdentity(source))) ||
        new Set(comparisonSources.map(sourceIdentity)).size !== comparisonSources.length) throw new Error('scalar comparison provenance mismatch')

  const factValues = new Map<string, number>()
  if (Array.isArray(cohortObservations)) {
    for (const observation of cohortObservations) {
      if (!record(observation) || !record(observation.territory) ||
          observation.territory.type !== facts.resolved_cohort_type ||
          !scalarCohortMembers.some((member) => member.id === observation.territory.id) ||
          factValues.has(observation.territory.id) ||
          !['measured', 'unavailable'].includes(observation.status)) return false
      if (observation.status === 'measured') {
        if (!finite(observation.value)) return false
        factValues.set(observation.territory.id, observation.value)
      } else {
        if (observation.value !== null && observation.value !== undefined) return false
      }
    }
  } else throw new Error('scalar cohort observation evidence malformed')
  if (selection) {
    const selectedValues = selection.map((member) => factValues.get(member.id)).filter(finite)
    if (selectedValues.length !== result.eligible_count ||
        selection.length - selectedValues.length !== result.missing_count) throw new Error('scalar cohort values/counts mismatch')
    const ascending = [...selectedValues].sort((left, right) => left - right)
    const midpoint = Math.floor(ascending.length / 2)
    const expectedMedian = ascending.length === 0 ? null : ascending.length % 2
      ? ascending[midpoint] : (ascending[midpoint - 1] + ascending[midpoint]) / 2
    if (result.status === 'available' && result.median !== expectedMedian) throw new Error('scalar median does not match admitted values')
    const expectedMemberRanks = new Map<string, { rank: number; ties: number }>()
    const counts = new Map<number, number>()
    for (const value of selectedValues) counts.set(value, (counts.get(value) ?? 0) + 1)
    let preceding = 0
    for (const value of [...counts.keys()].sort((left, right) => left - right)) {
      const count = counts.get(value)!
      const rank = descriptor.direction === 'low' ? preceding + 1 : selectedValues.length - preceding - count + 1
      for (const member of selection) {
        if (factValues.get(member.id) === value) expectedMemberRanks.set(member.id, { rank, ties: count })
      }
      preceding += count
    }
    for (const row of result.member_ranks ?? []) {
      const expected = expectedMemberRanks.get(row.territory_id)
      if ((expected && (row.rank !== expected.rank || row.rank_size !== selectedValues.length ||
          row.rank_ties !== expected.ties)) || (!expected && row.rank !== null)) throw new Error('scalar member rank does not match admitted values')
    }
    if (result.focal_in_selection) {
      const focalExpected = expectedMemberRanks.get(facts.territory.id)
      if (result.status === 'available' && focalExpected &&
          (result.rank !== focalExpected.rank || result.rank_size !== selectedValues.length ||
            result.rank_ties !== focalExpected.ties)) throw new Error('scalar focal rank does not match admitted values')
    }
  }
  if (selection?.some((member) => member.id === facts.territory.id) && focalObservation.status === 'measured' &&
       factValues.get(facts.territory.id) !== focalObservation.value) throw new Error('scalar focal fact mismatch')

  if (!Array.isArray(result.member_ranks) || result.member_ranks.length !== result.selected_member_count) throw new Error('scalar peer ranks absent')
  const rankIds = new Set<string>()
  const ranksByPosition = new Map<number, { ties: number; count: number }>()
  let ranked = 0
  for (const rank of result.member_ranks) {
    if (!record(rank) || !text(rank.territory_id) || rankIds.has(rank.territory_id) ||
        (selectedIds !== null && !selectedIds.includes(rank.territory_id))) throw new Error('scalar peer rank identities invalid')
    rankIds.add(rank.territory_id)
    if (selection) {
      const factMeasured = factValues.has(rank.territory_id)
      if (factMeasured !== (rank.rank !== null)) throw new Error('scalar peer rank availability mismatch')
    }
    if (rank.rank === null) {
      if (rank.rank_size !== null || rank.rank_ties !== null) throw new Error('scalar missing peer rank carries values')
      continue
    }
    if (!Number.isInteger(rank.rank) || !Number.isInteger(rank.rank_size) ||
        !Number.isInteger(rank.rank_ties) || rank.rank_size !== result.eligible_count ||
        rank.rank < 1 || rank.rank > rank.rank_size || rank.rank_ties < 1 ||
        rank.rank_ties > rank.rank_size || rank.rank + rank.rank_ties > rank.rank_size + 1) throw new Error('scalar peer rank bounds invalid')
    ranked += 1
    const group = ranksByPosition.get(rank.rank)
    if (group && group.ties !== rank.rank_ties) throw new Error('scalar tie declarations conflict')
    ranksByPosition.set(rank.rank, { ties: rank.rank_ties, count: (group?.count ?? 0) + 1 })
  }
  if (rankIds.size !== result.selected_member_count ||
      (selectedIds !== null && selectedIds.some((id) => !rankIds.has(id)))) throw new Error('scalar peer rank population mismatch')

  if (result.status === 'available') {
    if (result.reason !== null || result.eligible_count < 1 || !finite(result.median) ||
        ranked !== result.eligible_count ||
        [...ranksByPosition.values()].some((group) => group.count !== group.ties)) throw new Error('scalar available result inconsistent')
    const groups = [...ranksByPosition.entries()].sort(([a], [b]) => a - b)
    let nextRank = 1
    for (const [rank, group] of groups) {
      if (rank !== nextRank) throw new Error('scalar rank sequence has gaps')
      nextRank += group.ties
    }
    if (result.focal_in_selection && focalObservation.status === 'measured') {
      if (!Number.isInteger(result.rank) || !Number.isInteger(result.rank_size) ||
          !Number.isInteger(result.rank_ties) || result.rank_size !== result.eligible_count) throw new Error('scalar focal rank missing')
    } else if (result.rank !== null || result.rank_size !== null || result.rank_ties !== null) throw new Error('scalar non-focal rank unexpectedly present')
  } else if (result.reason === null || result.median !== null || ranked !== 0 ||
      result.rank !== null || result.rank_size !== null || result.rank_ties !== null) {
    throw new Error('scalar unavailable result inconsistent')
  }

  const focalRank = result.member_ranks.find((rank: Row) => rank.territory_id === facts.territory.id)
  if (result.focal_in_selection) {
    const focalMeasured = focalObservation.status === 'measured'
    if (focalMeasured && result.status === 'available' &&
        (focalRank?.rank === null || result.rank !== focalRank.rank ||
          result.rank_size !== focalRank.rank_size || result.rank_ties !== focalRank.rank_ties)) throw new Error('scalar focal/member rank mismatch')
    if ((!focalMeasured || result.status !== 'available') &&
        (result.rank !== null || result.rank_size !== null || result.rank_ties !== null)) throw new Error('scalar focal rank must be null')
  } else if (result.rank !== null || result.rank_size !== null || result.rank_ties !== null) throw new Error('scalar out-of-selection rank must be null')
  return true
}

function sameTypedMembers(actual: unknown, expected: readonly { id: string; type: string }[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((member: Row) => record(member) && text(member.territory_type) && text(member.territory_id)) &&
    new Set(actual.map((member: Row) => `${member.territory_type}\u0000${member.territory_id}`)).size === actual.length &&
    expected.every((member) => actual.some((candidate: Row) =>
      candidate.territory_type === member.type && candidate.territory_id === member.id))
}

function sameCohortMembers(actual: unknown, expected: readonly { id: string; type: string }[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((member: Row) => record(member) && text(member.type) && text(member.id)) &&
    new Set(actual.map((member: Row) => `${member.type}\u0000${member.id}`)).size === actual.length &&
    expected.every((member) => actual.some((candidate: Row) =>
      candidate.type === member.type && candidate.id === member.id))
}

function cohortResponseFromFacts(facts: OrderedSeriesFactsEvidence, input: OrderedSeriesAcquireInput): Row {
  return { resource: input.resource, shape: 'ordered_series',
    content_version: facts.content_version, reference_content_version: facts.reference_content_version,
    descriptor: facts.descriptor, series: facts.scope_series,
    cohort: { territory_type: facts.resolved_cohort_type,
      department_id: facts.cohort_department_id ?? null, epci_id: facts.cohort_epci_id ?? null,
      member_count: facts.resolved_cohort_members.length, members: facts.resolved_cohort_members,
      reference_content_version: facts.reference_content_version },
    ...(facts.scalar_facet?.cohort ? { scalar_facet: facts.scalar_facet.cohort } : {}),
  }
}

/** A per-page-lifetime cache for validated native series evidence. No module/global state. */
export function createOrderedSeriesSemanticSession(): OrderedSeriesSemanticSession {
  const entries: SessionEntries = { cohorts: new Map(), focals: new Map(), comparisons: new Map(),
    cohortGenerations: new Map() }
  return {
    acquire: (input) => acquireWithinSession(input, entries),
    clearCohort: (input) => {
      const key = JSON.stringify([input.resource, input.level, input.departmentId ?? null,
        input.epciId ?? null, Boolean(input.includeScalarFacet)])
      entries.cohorts.delete(key)
      for (const focal of [...entries.focals.keys()]) if (JSON.parse(focal)[0] === key) entries.focals.delete(focal)
      for (const comparison of [...entries.comparisons.keys()]) {
        const focal = JSON.parse(comparison)[0] as string
        if (JSON.parse(focal)[0] === key) entries.comparisons.delete(comparison)
      }
      entries.cohortGenerations.set(key, (entries.cohortGenerations.get(key) ?? 0) + 1)
    },
    refresh: async (input) => {
      const key = cohortKey(input)
      entries.cohorts.delete(key)
      for (const focal of [...entries.focals.keys()]) if (JSON.parse(focal)[0] === key) entries.focals.delete(focal)
      for (const comparison of [...entries.comparisons.keys()]) {
        const focal = JSON.parse(comparison)[0] as string
        if (JSON.parse(focal)[0] === key) entries.comparisons.delete(comparison)
      }
      entries.cohortGenerations.set(key, (entries.cohortGenerations.get(key) ?? 0) + 1)
      return acquireWithinSession(input, entries)
    },
  }
}

/** One-shot compatibility seam for consumers which do not own a page-lifetime session. */
export function acquireOrderedSeriesSemantic(input: OrderedSeriesAcquireInput): Promise<OrderedSeriesRead> {
  return createOrderedSeriesSemanticSession().acquire(input)
}

/** Comparison-only re-acquisition: one bounded read validated against the
 *  already admitted facts' identity — the warm facts are never reread (#857). */
export async function reacquireOrderedSeriesComparison(input: {
  resource: string
  level: TerritoireType
  focal: Territoire
  territories: readonly Territoire[]
  includeScalarFacet?: boolean
  departmentId?: string
  epciId?: string
  facts: OrderedSeriesFactsEvidence
}): Promise<OrderedSeriesRead['comparison']> {
  if (input.facts.indicator_id !== input.resource ||
      input.facts.territory.id !== input.focal.territoire ||
      input.facts.territory.type !== input.focal.type) {
    throw new Error('Faits admis incompatibles avec la cible de comparaison')
  }
  const members = scopedMembers(input)
  const [comparisonData] = await lireRessourcesBatch([comparisonItem(input, members)])
  if (!record(comparisonData)) throw new Error('Réponse de comparaison sémantique incompatible')
  return bindComparisonEvidence(comparisonData, {
    descriptor: input.facts.descriptor,
    contentVersion: input.facts.content_version,
    referenceContentVersion: input.facts.reference_content_version,
    declaredSourceIds: new Set(input.facts.declared_source_ids),
    resolvedCohortType: input.facts.resolved_cohort_type,
    resolvedCohortMembers: input.facts.resolved_cohort_members,
    cohortIsFiltered: input.facts.cohort_is_filtered,
    focal: input.facts.territory, resource: input.resource,
  }, members)
}

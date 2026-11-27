import type { Histoire, Indicateur, NativeThemeFactContract, NativeThemeFactAxis, TerritoireType, ThemeMetadata } from './types'
import type { SemanticThemeRead, ThemeKey, ThemeResponse, ThemeSelectionMember } from './themeAcquisition'
import { DESCRIPTIONS_SOURCES } from '@/methodes/sources'

/**
 * L'adaptateur du contrat `theme-facts-v1` (#627) : la réponse POST de faits
 * du thème devient les lignes `Indicateur`/`Histoire` que la grammaire de la
 * fiche consomme. Discipline de l'adaptateur Mobilité : valider fort, échouer
 * fermé — une réponse incohérente ne produit jamais de fait silencieux.
 *
 * Les colonnes de rang héritées (rang_epci…) restent null dans le chemin
 * migré : elles sont le contrat de compatibilité retiré (CONTEXT.md —
 * Contexte de comparaison), et une comparaison API porte sa portée déclarée,
 * jamais celle d'une colonne fixe.
 */
type Row = Record<string, unknown>

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const rows = (value: unknown, field: string): Row[] => {
  if (!Array.isArray(value) || value.some((row) => !isRecord(row))) {
    throw new Error(`Réponse du thème invalide : ${field}`)
  }
  return value
}
const text = (value: unknown): value is string => typeof value === 'string'
const texteNonVide = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
// JSON object member order is not contractual; array order and JSON value types are.
const sameSemanticJson = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameSemanticJson(value, right[index]))
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(right, key) && sameSemanticJson(left[key], right[key]))
  }
  return false
}

function validerPorteeComparaison(scope: unknown, selection: unknown, target: unknown,
  result: Row, shape: unknown, data: Row): void {
  if (!isRecord(target) || !texteNonVide(target.id) ||
      !['commune', 'epci', 'departement', 'region'].includes(String(target.type))) {
    throw new Error('Cible de comparaison sémantique invalide')
  }
  if (scope === null || scope === undefined) {
    if (target.type === 'region' && selection == null && shape === 'series' &&
        result.status === 'unavailable' && result.reason === 'unsupported_comparison_contract' &&
        (!texteNonVide(data.content_version) || result.owned_content_version !== data.content_version)) {
      throw new Error('Version propriétaire de la série comparée incohérente avec sa publication')
    }
    const unsupportedRegion = target.type === 'region' && selection == null && shape === 'series' &&
      result.status === 'unavailable' && result.reason === 'unsupported_comparison_contract' &&
      texteNonVide(data.content_version) && result.owned_content_version === data.content_version &&
      result.selected_member_count === 0 && result.eligible_count === 0 && result.missing_count === 0 &&
      result.mean === null && result.mean_curve === null && result.rank === null && result.rank_size === null &&
      Array.isArray(result.comparison_sources) && result.comparison_sources.length === 0
    if (unsupportedRegion) return
    throw new Error('Portée de comparaison sémantique invalide')
  }
  if (!isRecord(scope) || !Number.isInteger(scope.member_count) ||
      (scope.member_count as number) < 0) throw new Error('Portée de comparaison sémantique invalide')
  if (scope.kind === 'density_class') {
    if (target.type !== 'commune' || scope.territory_type !== 'commune' ||
        !texteNonVide(scope.density_class_code) || selection != null) {
      throw new Error('Portée de comparaison sémantique invalide')
    }
    return
  }
  if (scope.kind === 'same_level') {
    if (scope.territory_type !== target.type || selection != null) {
      throw new Error('Portée de comparaison sémantique invalide')
    }
    return
  }
  if (scope.kind === 'explicit_selection') {
    if (!Array.isArray(selection)) throw new Error('Portée de comparaison sémantique invalide')
    const selected = rows(selection, 'comparison.selection')
    const identities = selected.map((member) => {
      if (!texteNonVide(member.territory_id) ||
          !['commune', 'epci', 'departement', 'region'].includes(String(member.territory_type))) {
        throw new Error('Portée de comparaison sémantique invalide')
      }
      return `${member.territory_type}\u0000${member.territory_id}`
    })
    if (!Number.isInteger(result.selected_member_count) || (result.selected_member_count as number) < 0 ||
        (selected.length > 0 && result.selected_member_count === 0) ||
        scope.member_count !== result.selected_member_count || new Set(identities).size !== identities.length) {
      throw new Error('Portée de comparaison sémantique invalide')
    }
    return
  }
  throw new Error('Portée de comparaison sémantique invalide')
}

function validerResultatMoyenneProfile(result: Row): void {
  const statistic = result.statistic
  if (statistic !== undefined && statistic !== 'median' && statistic !== 'mean') {
    throw new Error('Statistique de comparaison sémantique invalide')
  }
  if (statistic !== 'mean') {
    if ('mean' in result || 'eligible_members' in result) {
      throw new Error('Une comparaison non moyenne porte une valeur moyenne')
    }
    return
  }
  if ('median' in result) {
    throw new Error('Une comparaison moyenne porte une médiane')
  }
  const selected = result.selected_member_count
  const eligible = result.eligible_count
  const missing = result.missing_count
  if (!Number.isInteger(selected) || (selected as number) < 0 ||
      !Number.isInteger(eligible) || (eligible as number) < 0 ||
      !Number.isInteger(missing) || (missing as number) < 0 ||
      (eligible as number) + (missing as number) !== selected) {
    throw new Error('Comptes de la comparaison moyenne invalides')
  }
  const members = result.eligible_members
  if (!Array.isArray(members) || members.length !== eligible || members.length > 1500 ||
      members.some((member) => !texteNonVide(member) || (member as string).length > 64) ||
      new Set(members).size !== members.length) {
    throw new Error('Identités éligibles de la comparaison moyenne invalides')
  }
  if (typeof result.focal_in_selection !== 'boolean' ||
      !isRecord(result.source_facet) || !texteNonVide(result.source_facet.detail) ||
      !(result.source_facet.sex === null || texteNonVide(result.source_facet.sex)) ||
      !texteNonVide(result.unit)) {
    throw new Error('Facette de la comparaison moyenne invalide')
  }
  if (result.status === 'available') {
    if (!finite(result.mean) || result.reason !== null || members.length < 1 ||
        !Array.isArray(result.comparison_sources) || result.comparison_sources.length === 0) {
      throw new Error('Moyenne de comparaison sémantique invalide')
    }
    return
  }
  if (result.mean !== null || result.reason !== 'no_selected_comparable_values' ||
      members.length !== 0 || eligible !== 0 || missing !== selected) {
    throw new Error('Moyenne indisponible de comparaison sémantique invalide')
  }
}

function validerResultatComparaison(result: Row, data: Row, declaration?: Row): void {
  if (result.status !== 'available' && result.status !== 'unavailable') {
    throw new Error('Statut de comparaison sémantique invalide')
  }
  const direction = result.direction
  const declaredDirection = declaration?.direction
  if (declaredDirection !== undefined && !['high', 'low', 'none'].includes(String(declaredDirection))) {
    throw new Error('Direction déclarée de comparaison sémantique invalide')
  }
  if (direction !== undefined && !['high', 'low', 'none'].includes(String(direction))) {
    throw new Error('Direction de comparaison sémantique invalide')
  }
  if (direction !== undefined && declaredDirection !== undefined && direction !== declaredDirection) {
    throw new Error('Direction de comparaison incompatible avec le catalogue producteur')
  }
  if (result.status === 'available' && direction !== 'high' && direction !== 'low') {
    throw new Error('Direction de comparaison absente pour un résultat disponible')
  }
  const profilePointFacet = data.shape === 'profile' && isRecord(result.source_facet) &&
    texteNonVide(result.source_facet.detail) &&
    (result.source_facet.sex === null || texteNonVide(result.source_facet.sex))
  if (result.source_facet !== undefined && result.source_facet !== null &&
      !texteNonVide(result.source_facet) && !profilePointFacet) {
    throw new Error('Facette de comparaison sémantique invalide')
  }
  if (result.status === 'available' && data.shape === 'scalar' &&
      result.source_facet !== data.indicator_id) throw new Error('Facette de comparaison scalaire incohérente')
  if (result.status === 'available' && data.shape === 'series' && !texteNonVide(result.source_facet)) {
    throw new Error('Facette de série de comparaison absente')
  }

  const rank = result.rank
  const rankSize = result.rank_size
  if (rank !== undefined && rank !== null && (!Number.isInteger(rank) || (rank as number) < 1)) {
    throw new Error('Rang de comparaison sémantique invalide')
  }
  if (rankSize !== undefined && rankSize !== null &&
      (!Number.isInteger(rankSize) || (rankSize as number) < 1 ||
       (rank !== undefined && rank !== null && (rankSize as number) < (rank as number)))) {
    throw new Error('Taille de rang de comparaison sémantique invalide')
  }
  if ((rank === null || rank === undefined) !== (rankSize === null || rankSize === undefined) ||
      (result.status === 'unavailable' && (rank !== null && rank !== undefined ||
        rankSize !== null && rankSize !== undefined))) {
    throw new Error('Rang de comparaison incompatible avec son statut')
  }
  if (data.shape === 'profile') validerResultatMoyenneProfile(result)
}

function validerLectureComparaison(read: Row, focalReads?: unknown, requireFocalSeries = false,
  expectedTarget?: { type: TerritoireType; id: string }): void {
  const data = isRecord(read.data) ? read.data : null
  const result = data && isRecord(data.result) ? data.result : null
  if (!data || !result || !isRecord(data.target)) {
    throw new Error('Lecture de comparaison sémantique incomplète')
  }
  if (!texteNonVide(read.resource) || data.indicator_id !== read.resource ||
      result.indicator_id !== data.indicator_id) {
    throw new Error('Identité d’indicateur de comparaison sémantique incohérente')
  }
  const focal = Array.isArray(focalReads) ? focalReads.find((candidate) =>
    isRecord(candidate) && candidate.resource === read.resource) : undefined
  const focalData = isRecord(focal) && isRecord(focal.data) ? focal.data : null
  const expected = expectedTarget ?? (focalData && isRecord(focalData.target) &&
    focalData.target.type && focalData.target.id
    ? { type: focalData.target.type as TerritoireType, id: String(focalData.target.id) } : undefined)
  if (!expected || data.target.kind !== 'territory' || data.target.type !== expected.type ||
      data.target.id !== expected.id || (focalData && (!isRecord(focalData.target) ||
        focalData.target.kind !== 'territory' || focalData.target.type !== expected.type ||
        focalData.target.id !== expected.id))) {
    throw new Error('Cible de comparaison sémantique différente de la requête focale')
  }
  const declaration = isRecord(read.declaration) ? read.declaration : undefined
  if (declaration && declaration.resource_id !== read.resource) {
    throw new Error('Identité de ressource de comparaison sémantique incohérente avec sa déclaration')
  }
  if (Array.isArray(focalReads) && data.shape === 'series' && data.target.type === 'region' &&
      data.scope == null && result.status === 'unavailable' &&
      result.reason === 'unsupported_comparison_contract') {
    const ownerContentVersion = focalData?.content_version
    if (!texteNonVide(ownerContentVersion) || data.content_version !== ownerContentVersion ||
        result.owned_content_version !== ownerContentVersion) {
      throw new Error('Version propriétaire de la série comparée incohérente avec les faits focaux')
    }
  }
  validerPorteeComparaison(data.scope, data.selection, data.target, result, data.shape, data)
  validerResultatComparaison(result, data, declaration)
  if (data.shape === 'series' && result.status === 'available' && requireFocalSeries && !Array.isArray(focalReads)) {
    throw new Error('Faits focaux absents pour valider la facette de série comparée')
  }
  if (data.shape === 'series' && (result.status === 'available' ||
      (result.source_facet !== null && result.source_facet !== undefined)) && Array.isArray(focalReads)) {
    const comparisonPoint = focalData?.comparison_point
    if (!focalData || !texteNonVide(comparisonPoint) || result.source_facet !== comparisonPoint ||
        (Array.isArray(focalData.axis_values) && !focalData.axis_values.includes(comparisonPoint))) {
      throw new Error('Facette de série de comparaison incompatible avec les faits producteurs')
    }
  }
  if (isRecord(data.scalar_facet)) {
    const scalar = data.scalar_facet
    if (isRecord(scalar.result)) {
      const scalarDeclaration = isRecord(scalar.descriptor) ? scalar.descriptor : undefined
      if (!sameSemanticJson(scalar.scope ?? null, data.scope ?? null) ||
          !sameSemanticJson(scalar.selection ?? null, data.selection ?? null)) {
        throw new Error('Portée de facette scalaire différente de la comparaison')
      }
      validerResultatComparaison(scalar.result, { ...data, shape: 'scalar', indicator_id: read.resource }, scalarDeclaration)
    }
  }
}

interface ProvenanceSource {
  sourceId: string
  source: string
  version: string
  referenceDate: string | null
  publicationDate: string | null
  lineage: Row
}

function apiSources(value: unknown, contexte: string): ProvenanceSource[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`Provenance SQL du thème invalide : ${contexte}`)
  return value.map((source) => {
    // The public fact contract's ordinary observations and collections expose
    // `name`; owned-series provenance exposes the same source label as
    // `source_name`. Normalize both at this boundary, retaining the original
    // fields in lineage.
    const sourceName = isRecord(source) ? source.name ?? source.source_name : undefined
    if (!isRecord(source) || !texteNonVide(source.source_id) || !texteNonVide(sourceName) ||
        !texteNonVide(source.version) ||
        !(source.reference_date === null || text(source.reference_date)) ||
        !(source.publication_date === null || text(source.publication_date))) {
      throw new Error(`Provenance SQL du thème invalide : ${contexte}`)
    }
    return { sourceId: source.source_id, source: sourceName, version: source.version,
      referenceDate: source.reference_date, publicationDate: source.publication_date,
      lineage: { ...source } }
  })
}

function indicateurDeSql(
  theme: ThemeKey,
  target: { territoire: string; type: TerritoireType },
  fact: Row,
  metadata: Row[],
): Indicateur {
  if (!texteNonVide(fact.indicator_id) || !texteNonVide(fact.unit) || !texteNonVide(fact.status) || !isRecord(fact.dimensions)) {
    throw new Error(`Fait indicateur SQL du thème invalide : ${String(fact.indicator_id)}`)
  }
  const dimensions = fact.dimensions
  for (const key of ['detail', 'sex', 'axis', 'observation_period', 'state_role']) {
    if (key in dimensions && dimensions[key] !== null && !text(dimensions[key])) {
      throw new Error(`Dimension SQL du thème invalide : ${key}`)
    }
  }
  if ('numeric_axis_value' in dimensions && dimensions.numeric_axis_value !== null &&
      !finite(dimensions.numeric_axis_value)) {
    throw new Error('Axe numérique SQL du thème invalide')
  }
  const descriptor = metadata.find((item) => item.indicator_id === fact.indicator_id)
  if (theme === 'demographie' && fact.indicator_id === 'structure_age') {
    if (!descriptor || !Array.isArray(descriptor.axes)) throw new Error('Axes SQL Démographie absents : structure_age')
    for (const key of ['detail', 'sex'] as const) {
      if (!texteNonVide(dimensions[key]) || !descriptor.axes.some((axis) => isRecord(axis) && axis.name === key && axis.key === dimensions[key])) {
        throw new Error(`Coordonnée SQL Démographie non déclarée : ${key}`)
      }
    }
  }
  if (descriptor && Array.isArray(descriptor.axes)) {
    for (const key of ['detail', 'sex'] as const) {
      if (dimensions[key] !== undefined && dimensions[key] !== null &&
          !descriptor.axes.some((axis) => isRecord(axis) && axis.name === key && axis.key === dimensions[key])) {
        throw new Error(`Coordonnée SQL du thème non déclarée : ${key}`)
      }
    }
  }
  if (text(dimensions.axis) && descriptor && Array.isArray(descriptor.axis_values) &&
      !descriptor.axis_values.includes(dimensions.axis)) {
    throw new Error('Axe SQL du thème non déclaré')
  }
  // Une absence d'observation n'a pas de source à attribuer : un fait non mesuré
  // peut porter une provenance vide. Un fait mesuré, lui, doit rester sourcé.
  const provenance = fact.status !== 'measured' && Array.isArray(fact.sources) && fact.sources.length === 0
    ? [] : apiSources(fact.sources, String(fact.indicator_id))
  for (const field of ['support_count', 'denominator_count']) {
    if (field in fact && !(fact[field] === null || finite(fact[field]))) {
      throw new Error(`Comptage SQL du thème invalide : ${field}`)
    }
  }
  const measured = fact.status === 'measured'
  const factStatus = typeof fact.status === 'string' &&
    ['measured', 'suppressed', 'unsupported', 'not_available', 'not_published', 'unavailable'].includes(fact.status)
    ? fact.status as Indicateur['fact_status'] : undefined
  if (measured && !finite(fact.value)) throw new Error(`Valeur mesurée absente : ${String(fact.indicator_id)}`)
  const detail = text(dimensions.detail) ? dimensions.detail : text(dimensions.axis) ? dimensions.axis : null
  return {
    territoire: target.territoire, type: target.type, theme, key: fact.indicator_id,
    detail, sex: text(dimensions.sex) ? dimensions.sex as Indicateur['sex'] : null, dimension: null,
    ...(dimensions.numeric_axis_value === undefined ? {} : { numericAxisValue: dimensions.numeric_axis_value as number | null }),
    value: measured ? fact.value as number : null, unit: fact.unit,
    rider: measured ? null : fact.status,
    observation_status: measured ? 'measured' : 'missing',
    ...(factStatus === undefined ? {} : { fact_status: factStatus }),
    ...(fact.support_count === undefined ? {} : { support_count: fact.support_count as number | null }),
    ...(fact.denominator_count === undefined ? {} : { denominator_count: fact.denominator_count as number | null }),
    observation_period: text(dimensions.observation_period) ? dimensions.observation_period : null,
    vintage_source: provenance[0]?.source ?? '', vintage_version: provenance[0]?.version ?? '',
    vintage_date_reference: provenance[0]?.referenceDate ?? null,
    vintage_date_publication: provenance[0]?.publicationDate ?? null,
    rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
    fact_sources: provenance.map((source) => ({ ...source, sourceId: source.sourceId ?? '' })),
  }
}

export interface ThemeFactsRows {
  indicateurs: Indicateur[]
  histoires: Histoire[]
  unavailableReadings?: string[]
}

/** Read only the small API-owned descriptor slice needed to present native facts. */
export function nativeFactContractFromEnvelope(value: unknown): NativeThemeFactContract | undefined {
  if (!isRecord(value)) return undefined
  const contract: NativeThemeFactContract = {}
  if (texteNonVide(value.label)) contract.label = value.label
  if (texteNonVide(value.direction)) contract.direction = value.direction
  if (Array.isArray(value.shapes) && value.shapes.every(text)) contract.shapes = value.shapes
  if (Array.isArray(value.axes)) {
    const axes: NativeThemeFactAxis[] = value.axes.flatMap((candidate) => {
      if (!isRecord(candidate) || !texteNonVide(candidate.name) || !texteNonVide(candidate.key)) return []
      return [{ name: candidate.name, key: candidate.key,
        ...(texteNonVide(candidate.label) ? { label: candidate.label } : {}),
        ...(Number.isInteger(candidate.order) ? { order: candidate.order as number } : {}),
        ...(texteNonVide(candidate.unit) ? { unit: candidate.unit } : {}) }]
    })
    if (axes.length) contract.axes = axes
  }
  if (texteNonVide(value.axisKind)) contract.axisKind = value.axisKind
  if (Array.isArray(value.axisValues) && value.axisValues.every(text)) contract.axisValues = value.axisValues
  if (Array.isArray(value.axisNumericValues) && value.axisNumericValues.every((item) => item === null || finite(item))) {
    contract.axisNumericValues = value.axisNumericValues
  }
  return Object.keys(contract).length ? contract : undefined
}

function sourceName(source: Row): unknown { return source.name ?? source.source_name }

function normalizeNativeSources(value: unknown): Row[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((source) => ({ ...source, name: sourceName(source) }))
}

export type ThemeSourceMetadata = Pick<ThemeMetadata, 'sources' | 'source_records' | 'indicator_pages'>

const OWNED_SERIES_FACT_MARKERS = ['dataset_id', 'theme_id', 'axis_values', 'axis_numeric_values',
  'content_version', 'reference_content_version', 'published_at', 'observation_period_kind',
  'comparison_contract', 'scope_series', 'named_references', 'context'] as const
const LEGACY_SERIES_POINT_FIELDS = ['source_id', 'vintage_id', 'source_version',
  'source_reference_date', 'source_publication_date'] as const
const LEGACY_NO_RECORD_SOURCE_NAME = Symbol('legacy-no-record-source-name')

function hasOwn(value: Row, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function hasOwnAny(value: Row, keys: readonly string[]): boolean {
  return keys.some((key) => hasOwn(value, key))
}

/** Identify the legacy focal envelope by its contract markers, not by resource ID. */
function isLegacyOrderedSeriesRead(shapes: unknown, data: Row): boolean {
  if (!Array.isArray(shapes) || !shapes.includes('ordered_series') ||
      hasOwnAny(data, OWNED_SERIES_FACT_MARKERS) ||
      !texteNonVide(data.publication_id) || !texteNonVide(data.axis_kind) ||
      !texteNonVide(data.completeness) || !texteNonVide(data.label) || !texteNonVide(data.unit) ||
      !texteNonVide(data.direction) || !texteNonVide(data.descriptor_version) ||
      !hasOwn(data, 'comparison_point') || !texteNonVide(data.availability) ||
      !Array.isArray(data.points) || data.points.length === 0) return false
  return data.points.every((point) => isRecord(point) &&
    LEGACY_SERIES_POINT_FIELDS.every((field) => hasOwn(point, field)))
}

function boundLegacySourceLabel(read: SemanticThemeRead, themeMetadata: ThemeSourceMetadata | undefined,
  sourceId: string): string {
  const resource = read.resource
  const declaration = isRecord(read.declaration) ? read.declaration : null
  const apiSources = declaration?.sources
  if (!Array.isArray(apiSources) || !apiSources.includes(sourceId)) {
    throw new Error(`Source de série non déclarée pour la ressource ${resource} : ${sourceId}`)
  }
  const label = DESCRIPTIONS_SOURCES[sourceId]
  if (label) return label
  const record = themeMetadata?.source_records?.[sourceId]
  const legacyLabel = isRecord(record)
    ? (texteNonVide(record.publisher) ? record.publisher : record.dataset)
    : undefined
  if (!texteNonVide(legacyLabel)) throw new Error(`Description éditoriale absente pour la source ${sourceId}`)
  return legacyLabel
}

/** Convert only the legacy point envelope; values and all clocks remain API-owned. */
interface LegacySeriesPointSources {
  sources: Row[]
  noRecordSourceName?: string
}

function legacySeriesPointSources(point: Row, read: SemanticThemeRead,
  themeMetadata: ThemeSourceMetadata | undefined): LegacySeriesPointSources {
  if (!LEGACY_SERIES_POINT_FIELDS.every((field) => hasOwn(point, field)) ||
      !texteNonVide(point.source_id) || !texteNonVide(point.vintage_id) ||
      !(point.source_version === null || texteNonVide(point.source_version)) ||
      !(point.source_reference_date === null || text(point.source_reference_date)) ||
      !(point.source_publication_date === null || text(point.source_publication_date))) {
    throw new Error(`Provenance de série legacy invalide : ${String(point.axis)}`)
  }

  // source_vintage.version is NOT NULL. In the legacy focal API projection a
  // null version and null dates therefore identify its descriptor-only point
  // (row=None), not an observed point with relaxed provenance.
  const noRecordPoint = point.status === 'missing' && point.value === null &&
    point.observation_period === null && point.source_version === null &&
    point.source_reference_date === null && point.source_publication_date === null
  if (noRecordPoint) {
    const data = read.data
    const declaration = isRecord(read.declaration) ? read.declaration : null
    const indicatorId = data.indicator_id
    if (!texteNonVide(indicatorId) || declaration?.indicator_id !== indicatorId ||
        data.completeness !== 'may_be_missing' || data.availability !== 'incomplete') {
      throw new Error(`Absence de série legacy non déclarée : ${String(point.axis)}`)
    }
    if (hasOwn(point, 'provenance') && rows(point.provenance, 'legacy_series.provenance').length !== 0) {
      throw new Error(`Provenance observée sur un axe sans ligne : ${String(point.axis)}`)
    }
    const sourceId = point.source_id
    const label = boundLegacySourceLabel(read, themeMetadata, sourceId)
    return { sources: [], noRecordSourceName: label }
  }

  if (!texteNonVide(point.source_version)) {
    throw new Error(`Provenance de série legacy invalide : ${String(point.axis)}`)
  }

  const existing = hasOwn(point, 'provenance')
    ? rows(point.provenance, 'legacy_series.provenance') : null
  if (existing && existing.length !== 1) {
    throw new Error(`Provenance de série legacy ambiguë : ${String(point.axis)}`)
  }
  const source = existing?.[0]
  if (source && (source.source_id !== point.source_id || source.vintage_id !== point.vintage_id ||
      (hasOwn(source, 'version') ? source.version : source.source_version) !== point.source_version ||
      (hasOwn(source, 'reference_date') ? source.reference_date : source.source_reference_date) !== point.source_reference_date ||
      (hasOwn(source, 'publication_date') ? source.publication_date : source.source_publication_date) !== point.source_publication_date)) {
    throw new Error(`Provenance liée à une autre observation : ${String(point.axis)}`)
  }

  const sourceId = point.source_id
  const declaration = isRecord(read.declaration) ? read.declaration : null
  if (!Array.isArray(declaration?.sources) || !declaration.sources.includes(sourceId)) {
    throw new Error(`Source de série non déclarée pour la ressource ${read.resource} : ${sourceId}`)
  }
  const hasApiLabel = source !== undefined && (hasOwn(source, 'name') || hasOwn(source, 'source_name'))
  const apiLabel = source ? sourceName(source) : undefined
  if (hasApiLabel && !texteNonVide(apiLabel)) {
    throw new Error(`Libellé API de provenance invalide : ${String(point.axis)}`)
  }
  const label = hasApiLabel ? apiLabel as string : boundLegacySourceLabel(read, themeMetadata, sourceId)
  const normalizedSource = { ...(source ?? {}), source_id: sourceId, vintage_id: point.vintage_id,
    source_name: label, name: label, version: point.source_version,
    reference_date: point.source_reference_date, publication_date: point.source_publication_date,
    source_version: point.source_version, source_reference_date: point.source_reference_date,
    source_publication_date: point.source_publication_date }
  return { sources: [normalizedSource] }
}

function dualShapeScalarObservation(data: Row, resource: string,
  target: { territoire: string; type: TerritoireType }): Row | null {
  const facet = data.scalar_facet
  if (facet === undefined) return null
  const invalid = () => { throw new Error(`Facette scalaire sémantique invalide : ${resource}`) }
  if (!isRecord(facet) || facet.shape !== 'scalar' || facet.source_facet !== resource ||
      !texteNonVide(facet.content_version) || !texteNonVide(facet.reference_content_version) ||
      !texteNonVide(facet.descriptor_version) || !isRecord(facet.descriptor) ||
      facet.descriptor.indicator_id !== resource || facet.descriptor.descriptor_version !== facet.descriptor_version ||
      !isRecord(facet.observation) || facet.observation.territory_id !== target.territoire ||
      facet.observation.territory_type !== target.type || !texteNonVide(facet.observation.status) ||
      !texteNonVide(facet.descriptor.unit)) return invalid()
  const observation = facet.observation
  if (!(observation.status === 'measured' || observation.status === 'suppressed' ||
      observation.status === 'unsupported' || observation.status === 'not_available' ||
      observation.status === 'not_published' || observation.status === 'unavailable') ||
      !(observation.value === undefined || observation.value === null || finite(observation.value)) ||
      (observation.status === 'measured' && !finite(observation.value)) ||
      !Array.isArray(observation.sources) ||
      ['support_count', 'denominator_count'].some((field) =>
        field in observation && !(observation[field] === null || finite(observation[field])))) return invalid()
  const sources = normalizeNativeSources(observation.sources)
  if (sources.length !== observation.sources.length ||
      (observation.status === 'unavailable' ? sources.length !== 0 : sources.length === 0)) return invalid()
  return { indicator_id: resource, unit: facet.descriptor.unit, ...facet.observation,
    dimensions: {}, sources }
}

/**
 * Adapt the producer's declared native resource envelopes to the fiche's
 * existing fact grammar. This is a consumer projection only: resource
 * membership, shapes, axes, units, statuses and lineage stay API-owned.
 */
export function themeFactsEnvelopeFromSemantic(theme: ThemeKey, acquired: ThemeResponse,
  target: { territoire: string; type: TerritoireType }, themeMetadata?: ThemeSourceMetadata): Row {
  if (!Array.isArray(acquired.resource_reads)) throw new Error('Lectures sémantiques du thème absentes')
  const indicators: Row[] = []
  const indicatorMetadata: Row[] = []
  const collections: Row[] = []
  const ownedSeries: Row[] = []
  const namedReferences: Row[] = []
  const unavailableReadings: string[] = []
  const nativeContracts: Array<{ indicator_id: string; native_contract: NativeThemeFactContract }> = []
  const reads = acquired.resource_reads

  for (const read of reads) {
    if (!isRecord(read) || !texteNonVide(read.resource) || !isRecord(read.data) ||
        read.data.resource !== read.resource || !isRecord(read.data.target) ||
        read.data.target.kind !== 'territory' || read.data.target.id !== target.territoire || read.data.target.type !== target.type) {
      throw new Error('Identité de lecture sémantique du thème invalide')
    }
    const declaration = isRecord(read.declaration) ? read.declaration : null
    const descriptor = isRecord(read.data.descriptor) ? read.data.descriptor : null
    const indicatorId = texteNonVide(declaration?.indicator_id) ? declaration.indicator_id
      : texteNonVide(read.data.indicator_id) ? read.data.indicator_id : read.resource
    const declaredAxis = Array.isArray(declaration?.axes) ? declaration.axes.find(text) : undefined
    const declaredAxisValues = Array.isArray(declaration?.axis_values)
      ? declaration.axis_values.find((entry) => Array.isArray(entry) && entry.length === 2 &&
        (entry[0] === read.data.axis_kind || entry[0] === declaredAxis))?.[1]
      : undefined
    const nativeContract = nativeFactContractFromEnvelope({
      label: texteNonVide(descriptor?.label) ? descriptor.label
        : texteNonVide(declaration?.label) ? declaration.label : read.data.label,
      direction: texteNonVide(read.data.direction) ? read.data.direction : declaration?.direction,
      shapes: Array.isArray(read.shapes) ? read.shapes : declaration?.shapes,
      axes: descriptor?.axes,
      axisKind: texteNonVide(read.data.axis_kind) ? read.data.axis_kind : declaredAxis,
      axisValues: Array.isArray(read.data.axis_values) ? read.data.axis_values : declaredAxisValues,
      axisNumericValues: read.data.axis_numeric_values,
    })
    if (nativeContract) nativeContracts.push({ indicator_id: indicatorId, native_contract: nativeContract })
    // Do not pool provenance across resources. A source/vintage pair on an
    // observation is not permission to borrow labels or dates from a sibling
    // indicator; only evidence attached to this exact native resource read is
    // eligible to resolve it.
  }

  // A typed publication absence is an explicit per-resource state, never a
  // fabricated value: surface it through the same unavailable-reading channel
  // that already renders an accessible, retryable banner.
  for (const failure of Array.isArray(acquired.resource_failures) ? acquired.resource_failures : []) {
    if (isRecord(failure) && failure.stage === 'facts' && texteNonVide(failure.resource)) {
      unavailableReadings.push(failure.resource)
    }
  }

  for (const read of reads) {
    const data = read.data
    const resource = read.resource
    const shapes = Array.isArray(read.shapes) ? read.shapes : []

    if (shapes.includes('anchored_membership') || shapes.includes('period_detail')) {
      collections.push({ ...data, indicator_id: resource })
      continue
    }
    if (shapes.includes('declared_profile')) {
      if (!isRecord(data.descriptor) || !Array.isArray(data.observations)) throw new Error(`Profil sémantique invalide : ${resource}`)
      const descriptor = data.descriptor
      indicatorMetadata.push({ indicator_id: resource, axes: descriptor.axes,
        unit: descriptor.unit, label: descriptor.label, comparison_point: descriptor.comparison_point })
      for (const cell of rows(data.observations, 'profile.observations')) {
        indicators.push({ indicator_id: resource, unit: cell.unit ?? descriptor.unit, status: cell.status,
          value: cell.value, dimensions: { detail: cell.detail, sex: cell.sex ?? null },
          sources: normalizeNativeSources(cell.sources) })
      }
      continue
    }
    if (Array.isArray(data.points)) {
      const points = rows(data.points, 'ordered_series.points')
      const legacySeries = isLegacyOrderedSeriesRead(shapes, data)
      const declaration: Row = isRecord(read.declaration) ? read.declaration : {}
      const declaredAxes = Array.isArray(declaration.axes) ? declaration.axes : []
      const declaredAxis = declaredAxes.find(text)
      const axisValues = Array.isArray(data.axis_values) ? data.axis_values
        : points.map((point) => point.axis)
      const series: Row = { ...data, indicator_id: resource,
        axis_kind: data.axis_kind ?? declaredAxis,
        axis_values: axisValues,
        points: points.map((point) => {
          if (!legacySeries) return { ...point, provenance: normalizeNativeSources(point.provenance) }
          const normalized = legacySeriesPointSources(point, read, themeMetadata)
          return { ...point, provenance: normalized.sources,
            ...(normalized.noRecordSourceName
              ? { [LEGACY_NO_RECORD_SOURCE_NAME]: normalized.noRecordSourceName } : {}) }
        }) }
      if (resource === 'subventions_annuelles' || resource === 'prix_m2') ownedSeries.push(series)
      else {
        const axisValues = Array.isArray(data.axis_values) ? data.axis_values : []
        const axisNumbers = Array.isArray(data.axis_numeric_values) ? data.axis_numeric_values : []
        for (const point of points) {
          const axisIndex = axisValues.indexOf(point.axis)
          indicators.push({ indicator_id: resource, unit: data.unit, value: point.value,
            status: point.status, dimensions: { axis: point.axis,
              ...(axisIndex >= 0 && finite(axisNumbers[axisIndex]) ? { numeric_axis_value: axisNumbers[axisIndex] } : {}),
              observation_period: point.observation_period ?? null, state_role: point.state_role ?? null },
            sources: normalizeNativeSources(point.provenance) })
        }
      }
      if (series.axis_kind && Array.isArray(series.axis_values)) {
        indicatorMetadata.push({ indicator_id: resource, axis_kind: series.axis_kind,
          axis_values: series.axis_values, axis_numeric_values: series.axis_numeric_values,
          comparison_point: data.comparison_point, completeness: data.completeness,
          comparison_contract: data.comparison_contract ?? declaration.comparison_contract })
      }
      for (const reference of rows(data.named_references ?? [], 'series.named_references')) {
        namedReferences.push({ ...reference, indicator_id: resource,
          points: rows(reference.points, 'series.reference.points').map((point) => ({ ...point,
            provenance: normalizeNativeSources(point.provenance).map((source) => ({ ...source, source_name: source.name })) })) })
      }
      if (isRecord(data.context)) indicatorMetadata.push({ indicator_id: resource, unit: data.unit, context: data.context })
      // Some producers declare both a pooled scalar headline and a separate
      // ordered series (notably DVF). Keep the scalar distinct from points;
      // never coerce the trajectory into the headline or infer a latest year.
      if ('value' in data || 'status' in data) {
        indicators.push({ indicator_id: resource, unit: data.unit, value: data.value,
          status: data.status, dimensions: {}, sources: normalizeNativeSources(data.sources) })
      }
      if (shapes.includes('scalar') && shapes.includes('ordered_series')) {
        const observation = dualShapeScalarObservation(data, resource, target)
        if (observation && (observation.status !== 'measured' || finite(observation.value))) {
          indicators.push(observation)
        }
      }
      continue
    }
    if ('value' in data || 'status' in data) {
      indicators.push({ indicator_id: resource, unit: data.unit, value: data.value, status: data.status,
        dimensions: {}, sources: normalizeNativeSources(data.sources) })
    }
  }

  for (const read of acquired.named_reference_reads ?? []) {
    if (!isRecord(read) || !texteNonVide(read.resource) || !isRecord(read.data) ||
        read.data.resource !== read.resource || !isRecord(read.data.target) ||
        read.data.target.kind !== 'named_reference' || !texteNonVide(read.data.target.id) ||
        !isRecord(read.data.reference) || read.data.reference.id !== read.data.target.id ||
        !texteNonVide(read.data.indicator_id) || !Array.isArray(read.data.points)) {
      throw new Error('Identité de lecture nommée sémantique invalide')
    }
    const owner = reads.find((candidate) => candidate.data.dataset_id === read.data.dataset_id)
    const ownerData = owner?.data
    // An isolated focal-series failure leaves no owner for an auxiliary named
    // reference. The reference cannot be bound, so it is honestly omitted;
    // an owner that IS present but contradicts its reference still fails closed.
    if (!ownerData) continue
    const ownerVersion = isRecord(ownerData) ? ownerData.content_version ?? ownerData.publication_id : undefined
    const namedVersion = read.data.content_version ?? read.data.publication_id
    if (typeof ownerVersion !== 'string' || !ownerVersion ||
        typeof namedVersion !== 'string' || ownerVersion !== namedVersion ||
        ownerData.reference_content_version !== read.data.reference_content_version) {
      throw new Error(`Dépendance de référence nommée incompatible : ${read.resource}`)
    }
    // The resource target identity is deliberately kept as the producer-owned
    // named-reference ID; it is never projected onto a territory or a model
    // reference territory.
    for (let index = namedReferences.length - 1; index >= 0; index--) {
      const existing = namedReferences[index]!
      if (existing.indicator_id === read.data.indicator_id && existing.id === read.data.reference.id) {
        namedReferences.splice(index, 1)
      }
    }
    namedReferences.push({ indicator_id: owner?.resource ?? read.data.indicator_id, ...read.data.reference,
      unit: read.data.unit, points: rows(read.data.points, 'named_reference.points').map((point) => ({
        ...point, provenance: normalizeNativeSources(point.provenance)
          .map((source) => ({ ...source, source_name: source.name })),
      })) })
  }

  for (const { indicator_id, native_contract } of nativeContracts) {
    const existing = indicatorMetadata.find((item) => item.indicator_id === indicator_id)
    if (existing) existing.native_contract = native_contract
    else indicatorMetadata.push({ indicator_id, native_contract })
  }

  const territory = acquired.target
  if (isRecord(territory) && (territory.id !== target.territoire || territory.type !== target.type)) {
    throw new Error('Cible de la fiche différente des lectures sémantiques')
  }
  return { contract: 'theme-facts-v1', theme_id: theme,
    territory: { territory_id: target.territoire, territory_type: target.type },
    indicators, indicator_metadata: indicatorMetadata, named_reference_evidence: namedReferences,
    unavailable_readings: [...new Set(unavailableReadings)],
    readings: [], collections, owned_series: ownedSeries }
}

export function semanticComparisonForTheme(response: unknown, _reference?: unknown, focalReads?: unknown,
  expectedTarget?: { type: TerritoireType; id: string }): Row | null {
  if (!isRecord(response) || !Array.isArray(response.comparison_reads)) return null
  const results: Row[] = []
  const profiles: Row[] = []
  const scopes: unknown[] = []
  const selections: unknown[] = []
  const legacyReferenceTarget = isRecord(_reference) && isRecord(_reference.target)
    && texteNonVide(_reference.target.territoire) && text(_reference.target.type)
    ? { type: _reference.target.type as TerritoireType, id: _reference.target.territoire } : undefined
  const comparisonTarget = expectedTarget ?? legacyReferenceTarget
  for (const item of response.comparison_reads) {
    if (!isRecord(item) || !texteNonVide(item.resource) || !isRecord(item.data) || !isRecord(item.data.result)) {
      throw new Error('Résultat de comparaison sémantique invalide')
    }
    validerLectureComparaison(item, focalReads, focalReads !== undefined, comparisonTarget)
    const result = item.data.result
    const shape = item.data.shape
    scopes.push(item.data.scope ?? null)
    selections.push(item.data.selection ?? null)
    if ('scalar_facet' in item.data) {
      const scalarFacet = item.data.scalar_facet
      const scalarResult = isRecord(scalarFacet) ? scalarFacet.result : undefined
      const descriptor = isRecord(scalarFacet) ? scalarFacet.descriptor : undefined
      if (!isRecord(scalarFacet) || scalarFacet.shape !== 'scalar' || scalarFacet.source_facet !== item.resource ||
          !texteNonVide(scalarFacet.content_version) || !texteNonVide(scalarFacet.reference_content_version) ||
          !texteNonVide(scalarFacet.descriptor_version) || !isRecord(descriptor) ||
          descriptor.indicator_id !== item.resource || descriptor.descriptor_version !== scalarFacet.descriptor_version ||
          !texteNonVide(descriptor.unit) || !isRecord(scalarResult) ||
          scalarResult.indicator_id !== item.resource || scalarResult.source_facet !== item.resource ||
          scalarResult.descriptor_version !== scalarFacet.descriptor_version || !texteNonVide(scalarResult.status) ||
          !sameSemanticJson(scalarFacet.scope ?? null, item.data.scope ?? null) ||
          !sameSemanticJson(scalarFacet.selection ?? null, item.data.selection ?? null) ||
          (scalarFacet.comparison_content_version !== undefined && !texteNonVide(scalarFacet.comparison_content_version)) ||
          (scalarFacet.selection == null && !texteNonVide(scalarFacet.comparison_content_version))) {
        throw new Error(`Facette de comparaison scalaire invalide : ${item.resource}`)
      }
      results.push({ ...scalarResult, indicator_id: item.data.indicator_id ?? item.resource,
        source_facet: scalarResult.source_facet })
    }
    if (shape === 'declared_profile' || (Array.isArray(item.shapes) && item.shapes.includes('declared_profile'))) {
      profiles.push({ ...result, indicator: item.data.indicator_id ?? item.resource,
        facet: result.source_facet ?? result.facet })
    } else results.push({ ...result, indicator_id: item.data.indicator_id ?? item.resource,
      source_facet: result.source_facet })
  }
  if (scopes.some((scope) => !sameSemanticJson(scope, scopes[0])) ||
      selections.some((selection) => !sameSemanticJson(selection, selections[0]))) {
    throw new Error('Portée ou sélection des comparaisons sémantiques incohérente')
  }
  return { results, profile_comparisons: profiles,
    selection: selections[0] ?? response.selection,
    scope: scopes[0] ?? null }
}

export function themeFactsRowsFromSemantic(
  theme: ThemeKey,
  response: ThemeResponse,
  target: { territoire: string; type: TerritoireType },
  referential: { epci?: string | null; region?: string | null } = {},
  themeMetadata?: ThemeSourceMetadata,
): ThemeFactsRows {
  const normalized = themeFactsEnvelopeFromSemantic(theme, response, target, themeMetadata)
  return { ...themeFactsRowsFromApi(theme, normalized, target, referential),
    unavailableReadings: normalized.unavailable_readings as string[] }
}

/** Attach API-ranked facts without deriving anything from retired rank columns or changing focal values. */
export function lignesAvecComparaisonApi(lignes: Indicateur[], comparison: unknown, portee: string | null): Indicateur[] {
  if (comparison === null || comparison === undefined) return lignes.map(({ comparaisonApi: _rank, ...row }) => row)
  if (!isRecord(comparison) || !Array.isArray(comparison.results) || !Array.isArray(comparison.profile_comparisons)) {
    throw new Error('Réponse de comparaison du thème invalide')
  }
  const results = rows(comparison.results, 'results')
  const profiles = rows(comparison.profile_comparisons, 'profile_comparisons')
  return lignes.map(({ comparaisonApi: _old, ...row }) => {
    const match = results.find((item) => {
      if (item.indicator_id !== row.key) return false
      // A producer may publish a comparison for one member of an ordered
      // series (for example the resolved current year). Its facet is a fact
      // coordinate, not a label to spread across every point in that series.
      if (item.source_facet !== undefined && item.source_facet !== null) {
        const coordinate = row.dimension ?? row.detail
        // Scalar comparisons identify their indicator as the source facet;
        // ordered-series comparisons identify the selected axis coordinate.
        if ((coordinate ?? row.key) !== item.source_facet) return false
      }
      return true
    }) ?? profiles.find((item) => {
      if (item.indicator !== row.key) return false
      const facet = isRecord(item.facet) ? item.facet : {}
      return (facet.detail ?? null) === (row.detail ?? null) && (facet.sex ?? null) === (row.sex ?? null)
    })
    if (!match) return row
    validerResultatComparaison(match, profiles.includes(match) ? { shape: 'profile' } : {})
    if (match.status !== 'available') return row
    const reference = finite(match.mean) ? { kind: 'mean' as const, value: match.mean,
      ...(Array.isArray(match.eligible_members) ? { eligibleMembers: match.eligible_members as string[] } : {}) }
      : finite(match.median) ? { kind: 'median' as const, value: match.median } : undefined
    if (match.rank == null && !reference) return row
    return { ...row, comparaisonApi: { rang: (match.rank as number | null) ?? null, taille: (match.rank_size as number | null) ?? null,
      portee, direction: match.direction as 'high' | 'low',
      ...(Number.isSafeInteger(match.rank_ties) ? { ties: match.rank_ties as number } : {}),
      ...(reference ? { reference } : {}) } }
  })
}

function vintageSql(sources: unknown, context: string) {
  const provenance = apiSources(sources, context)
  const source = provenance[0]!
  if (source.referenceDate === null && source.publicationDate === null) {
    throw new Error(`Date de référence et de publication absentes : ${context}`)
  }
  return { vintage_source: source.source, vintage_version: source.version,
    vintage_date_reference: source.referenceDate, vintage_date_publication: source.publicationDate,
    fact_sources: provenance.map((item) => ({ ...item, sourceId: item.sourceId })) }
}

function programmesRows(response: Row, target: { territoire: string; type: TerritoireType }, referential: { epci?: string | null; region?: string | null } = {}): Indicateur[] {
  const result: Indicateur[] = []
  for (const collection of rows(response.collections, 'collections')) {
    if (!texteNonVide(collection.indicator_id) || !texteNonVide(collection.kind) ||
        !Array.isArray(collection.entries) ||
        (collection.kind === 'anchored_membership' && !Array.isArray(collection.relationships))) {
      throw new Error('Collection Programmes invalide')
    }
    if (collection.kind === 'anchored_membership') {
      const unit = collection.unit
      if (!texteNonVide(unit) || !unit.trim()) {
        throw new Error('Unité de collection Programmes absente ou invalide')
      }
      if (collection.availability === 'no_record') continue
      const add = (territory: { id: unknown; type: unknown }, entry: Row) => {
        if (!texteNonVide(territory.id) || !['commune', 'epci', 'departement', 'region'].includes(String(territory.type)) ||
            !texteNonVide(entry.detail) || !(entry.rider === null || text(entry.rider))) throw new Error('Adhésion Programmes invalide')
        // Le rider est le libellé producteur, déjà conditionné par le fait
        // convention_valant_ort dans la collection native. Le conserver tel
        // quel évite de transformer un autre libellé déclaré en affirmation ORT.
        result.push({ territoire: territory.id, type: territory.type as TerritoireType, theme: 'programmes',
          key: 'couverture_programmes', detail: entry.detail, value: null, unit,
          rider: entry.rider, ...vintageSql(entry.sources, entry.detail),
          rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null })
      }
      for (const entry of rows(collection.entries, 'collection.entries')) add({ id: target.territoire, type: target.type }, entry)
      for (const relationship of rows(collection.relationships, 'collection.relationships')) {
        if (!isRecord(relationship.anchor)) throw new Error('Ancrage Programmes invalide')
        add(relationship.anchor as { id: unknown; type: unknown }, relationship)
      }
    } else if (collection.kind === 'period_detail') {
      // Le contrat servi theme-facts-v1 réserve relationships aux anchored_membership;
      // period_detail n'en requiert pas (et accepte un champ additionnel s'il est fourni).
      if (collection.availability === 'no_record') continue
      // L'unité vient du descripteur publié — jamais de « € » implicite : une
      // collection sans unité est une publication incomplète, pas un défaut.
      if (!texteNonVide(collection.unit)) throw new Error('Unité de collection Programmes absente')
      for (const entry of rows(collection.entries, 'collection.entries')) {
        if (!texteNonVide(entry.observation_period) || !texteNonVide(entry.label) || !finite(entry.value)) throw new Error('Subvention Programmes invalide')
        result.push({ territoire: target.territoire, type: target.type, theme: 'programmes', key: 'subventions_par_domaine',
          detail: entry.label, dimension: entry.observation_period, value: entry.value, unit: collection.unit,
          rider: null, ...vintageSql(entry.sources, entry.label), rang_epci: null, rang_epci_n: null,
          rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null })
      }
    } else throw new Error(`Collection Programmes non prise en charge : ${collection.kind}`)
  }
  for (const series of rows(response.owned_series ?? [], 'owned_series')) {
    if (!texteNonVide(series.indicator_id)) throw new Error('Série Programmes invalide')
    if (series.indicator_id !== 'subventions_annuelles') continue
    if (!texteNonVide(series.unit)) throw new Error('Unité de série Programmes absente')
    for (const point of rows(series.points, 'series.points')) {
      if (!texteNonVide(point.axis) || !(point.status === 'measured' || point.status === 'missing') ||
          !(point.status === 'measured' ? finite(point.value) : point.value === null)) {
        throw new Error('Point annuel Programmes invalide')
      }
      const noRecordSourceName = (point as Row & { [LEGACY_NO_RECORD_SOURCE_NAME]?: string })[
        LEGACY_NO_RECORD_SOURCE_NAME]
      const noRecord = texteNonVide(noRecordSourceName)
      if (noRecord && (point.status !== 'missing' || point.value !== null ||
          point.source_version !== null || point.source_reference_date !== null ||
          point.source_publication_date !== null || !texteNonVide(point.source_id) ||
          !texteNonVide(point.vintage_id))) {
        throw new Error(`Sentinelle d’absence de série Programmes invalide : ${point.axis}`)
      }
      const pointSources = rows(point.provenance, 'series provenance')
      if (noRecord && pointSources.length !== 0) {
        throw new Error(`Provenance observée sur un axe Programmes sans ligne : ${point.axis}`)
      }
      const vintage = noRecord
        ? { vintage_source: noRecordSourceName as string, vintage_version: null,
          vintage_date_reference: point.source_reference_date as null,
          vintage_date_publication: point.source_publication_date as null }
        : vintageSql(pointSources, point.axis)
      const pointSource = noRecord ? null : pointSources[0]!
      result.push({ territoire: target.territoire, type: target.type, theme: 'programmes', key: 'subventions_annuelles',
        detail: null, dimension: point.axis, value: point.status === 'measured' ? point.value as number : null,
        unit: series.unit, rider: point.status === 'measured' ? null : text(point.missing_reason) ? point.missing_reason : String(point.status),
        observation_status: point.status, observation_period: text(point.observation_period) ? point.observation_period : null,
        source_id: noRecord ? point.source_id as string : texteNonVide(pointSource?.source_id) ? pointSource.source_id : null,
        vintage_id: noRecord ? point.vintage_id as string : texteNonVide(pointSource?.vintage_id) ? pointSource.vintage_id : null,
        ...(noRecord ? { source_version: point.source_version as null,
          source_reference_date: point.source_reference_date as null,
          source_publication_date: point.source_publication_date as null } : {}),
        ...vintage,
        rang_epci: null, rang_epci_n: null,
        rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null })
    }
  }
  const parentType = target.type === 'commune' ? 'epci' : target.type === 'region' ? null : 'region'
  const parentId = parentType === 'epci' ? referential.epci : parentType === 'region' ? referential.region : null
  const metadata = rows(response.indicator_metadata ?? [], 'indicator_metadata')
    .filter((item) => item.indicator_id === 'subventions_annuelles')
  if (parentType && parentId && metadata.length === 1) {
    const context = metadata[0]!.context
    if (isRecord(context) && isRecord(context.parent) && context.parent.id === parentId && context.parent.type === parentType &&
        Array.isArray(context.points)) {
      const focalYears = new Set<string>()
      for (const fact of rows(response.indicators ?? [], 'indicators')) {
        if (fact.indicator_id === 'subventions_annuelles' && fact.status === 'measured' && finite(fact.value) &&
            isRecord(fact.dimensions) && text(fact.dimensions.axis)) focalYears.add(fact.dimensions.axis)
      }
      result.filter((row) => row.key === 'subventions_annuelles' && row.territoire === target.territoire && row.value !== null)
        .map((row) => row.dimension).filter(text).forEach((year) => focalYears.add(year))
      for (const point of context.points) {
        if (!isRecord(point) || !text(point.axis) || point.observation_period !== point.axis ||
            point.status !== 'measured' || !finite(point.value) || !focalYears.has(point.axis) ||
            !Array.isArray(point.provenance)) continue
        const provenance = point.provenance.map((source) => {
          if (!isRecord(source) || !texteNonVide(source.source_id) || !texteNonVide(source.source_name) ||
              !texteNonVide(source.version) || !(source.reference_date === null || text(source.reference_date)) ||
              !(source.publication_date === null || text(source.publication_date))) return null
          return { sourceId: source.source_id, source: source.source_name, version: source.version,
            referenceDate: source.reference_date, publicationDate: source.publication_date, lineage: { ...source } }
        }).filter((source): source is NonNullable<typeof source> => source !== null)
        if (!provenance.length || provenance.length !== point.provenance.length) continue
        result.push({ territoire: parentId, type: parentType as TerritoireType, theme: 'programmes', key: 'subventions_annuelles',
          detail: null, dimension: point.axis, value: point.value as number, unit: metadata[0]!.unit as string,
          rider: null, vintage_source: provenance[0]!.source, vintage_version: provenance[0]!.version,
          vintage_date_reference: provenance[0]!.referenceDate, vintage_date_publication: provenance[0]!.publicationDate,
          fact_sources: provenance.map((source) => ({ ...source, sourceId: source.sourceId })), rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null })
      }
    }
  }
  return result
}

/** Projette une réponse `theme-facts-v1` en lignes consommables par la fiche. */
export function themeFactsRowsFromApi(
  theme: ThemeKey,
  response: unknown,
  target: { territoire: string; type: TerritoireType },
  referential: { epci?: string | null; region?: string | null } = {},
): ThemeFactsRows {
  if (!isRecord(response) || response.contract !== 'theme-facts-v1' || response.theme_id !== theme ||
      !Array.isArray(response.indicators) || !Array.isArray(response.indicator_metadata) ||
      !Array.isArray(response.named_reference_evidence) || !Array.isArray(response.readings)) {
    throw new Error('Réponse de faits du thème invalide')
  }
  const territory = isRecord(response.territory) ? response.territory : null
  if (!territory || territory.territory_id !== target.territoire || territory.territory_type !== target.type) {
    throw new Error('Territoire de la réponse du thème invalide')
  }
  const metadata = rows(response.indicator_metadata, 'indicator_metadata')
  const nativeContracts = new Map(metadata.flatMap((item) => {
    const contract = nativeFactContractFromEnvelope(item.native_contract)
    return texteNonVide(item.indicator_id) && contract ? [[item.indicator_id, contract] as const] : []
  }))
  const indicateurs = rows(response.indicators, 'indicators')
    .map((fact) => indicateurDeSql(theme, target, fact, metadata))
  if (theme === 'programmes') indicateurs.push(...programmesRows(response, target, referential))
  if (theme === 'habitat') {
    for (const series of rows(response.owned_series ?? [], 'owned_series')) {
      if (series.indicator_id !== 'prix_m2') continue
      if (!texteNonVide(series.unit)) throw new Error('Unité de série Habitat absente')
      const axisValues = Array.isArray(series.axis_values) ? series.axis_values : []
      const axisNumericValues = Array.isArray(series.axis_numeric_values) ? series.axis_numeric_values : []
      for (const point of rows(series.points, 'series.points')) {
        if (!texteNonVide(point.axis) || !(point.status === 'measured' ? finite(point.value) : point.value === null)) {
          throw new Error('Point annuel Habitat invalide')
        }
        const provenance = rows(point.provenance, 'series provenance')
        const converted = apiSources(provenance.map((source) => ({ source_id: source.source_id,
          name: source.source_name, version: source.version, reference_date: source.reference_date,
          publication_date: source.publication_date })), 'prix_m2')
        const axisIndex = axisValues.indexOf(point.axis)
        indicateurs.push({ territoire: target.territoire, type: target.type, theme, key: series.indicator_id,
          detail: point.axis, sex: null, dimension: null, value: point.status === 'measured' ? point.value as number : null,
          ...(axisIndex >= 0 && finite(axisNumericValues[axisIndex])
            ? { numericAxisValue: axisNumericValues[axisIndex] as number } : {}),
          unit: series.unit as string, rider: point.status === 'measured' ? null : text(point.missing_reason) ? point.missing_reason as string : point.status as string,
          observation_status: point.status === 'measured' ? 'measured' : 'missing', observation_period: text(point.observation_period) ? point.observation_period : null,
          vintage_source: converted[0]?.source ?? '', vintage_version: converted[0]?.version ?? '',
          vintage_date_reference: converted[0]?.referenceDate ?? null, vintage_date_publication: converted[0]?.publicationDate ?? null,
          rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
          fact_sources: converted.map((source) => ({ ...source, sourceId: source.sourceId ?? '' })) })
      }
    }
  }
  const histoires: Histoire[] = []
  return { indicateurs: indicateurs.map((row) => {
    const nativeContract = nativeContracts.get(row.key)
    return nativeContract ? { ...row, nativeContract } : row
  }), histoires }
}

/** Valide la réponse comparison-only d'un thème contre la sélection demandée —
 * l'écho doit être la liste du demandeur, dans son ordre (le serveur retient
 * la liste d'origine, jamais une liste résolue différente). */
export function validerReponseComparaisonTheme(
  theme: ThemeKey,
  response: unknown,
  selectionAttendue: readonly ThemeSelectionMember[] | undefined,
  targetAttendu?: { type: TerritoireType; id: string },
  meanResources: readonly string[] = [],
): void {
  if (isRecord(response) && Array.isArray(response.comparison_reads)) {
    if (response.theme_id !== theme ||
        (selectionAttendue === undefined ? response.selection !== undefined : !Array.isArray(response.selection)) ||
        !targetAttendu || !texteNonVide(targetAttendu.id) ||
        !['commune', 'epci', 'departement', 'region'].includes(targetAttendu.type)) {
      throw new Error('Réponse de comparaison sémantique incompatible')
    }
    if (selectionAttendue !== undefined) {
      const echo = response.selection as unknown[]
      if (echo.length !== selectionAttendue.length || echo.some((item, index) => !isRecord(item) ||
          item.territory_type !== selectionAttendue[index]!.territory_type ||
          item.territory_id !== selectionAttendue[index]!.territory_id)) {
        throw new Error('La comparaison sémantique ne reflète pas la sélection demandée')
      }
    }
    for (const comparison of response.comparison_reads) {
      if (!isRecord(comparison) || !texteNonVide(comparison.resource) || !isRecord(comparison.data) ||
          comparison.data.contract !== 'indicator-comparison-v1' ||
          comparison.data.indicator_id !== comparison.resource ||
          !isRecord(comparison.data.target) || comparison.data.target.kind !== 'territory' ||
          !isRecord(comparison.data.result) ||
          (selectionAttendue === undefined
            ? comparison.data.selection !== null && comparison.data.selection !== undefined
            : !Array.isArray(comparison.data.selection))) {
        throw new Error('Résultat de comparaison sémantique mal formé')
      }
      validerLectureComparaison(comparison, undefined, false, targetAttendu)
      const expectsMean = selectionAttendue !== undefined &&
        selectionAttendue.every((member) => member.territory_type === 'commune') &&
        meanResources.includes(comparison.resource)
      if (expectsMean && comparison.data.result.statistic !== 'mean') {
        // A median answer to an explicit mean request is an integrity failure,
        // never a comparison to relabel or to draw as a mean (#997).
        throw new Error('La comparaison sélectionnée ne sert pas la moyenne demandée')
      }
      if (selectionAttendue !== undefined) {
        const actual = comparison.data.selection as unknown[]
        if (actual.length !== selectionAttendue.length || actual.some((item, index) => !isRecord(item) ||
            item.territory_type !== selectionAttendue[index]!.territory_type ||
            item.territory_id !== selectionAttendue[index]!.territory_id)) {
          throw new Error('La sélection de comparaison sémantique est incohérente')
        }
      }
    }
    return
  }
  if (!isRecord(response) || response.contract !== 'theme-comparison-v1' || response.theme_id !== theme ||
      !Array.isArray(response.profile_comparisons)) {
    throw new Error('Réponse de comparaison du thème invalide')
  }
  if (selectionAttendue === undefined) throw new Error('La sélection native de comparaison est absente')
  rows(response.results, 'results')
  const echo = Array.isArray(response.selection) ? response.selection : []
  if (echo.length !== selectionAttendue.length || echo.some((item, index) => !isRecord(item) ||
      String(item.territory_type) !== selectionAttendue[index]!.territory_type ||
      String(item.territory_id) !== selectionAttendue[index]!.territory_id)) {
    throw new Error('La comparaison du thème ne reflète pas la sélection demandée')
  }
}

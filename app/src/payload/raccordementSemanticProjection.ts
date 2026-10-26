import type { Indicateur, Territoire } from './types'
import type { ThemeResponse, ThemeSelectionMember } from './themeAcquisition'
import { semanticPublicationsCompatible } from './themeAcquisition'
import { themeFactsRowsFromSemantic, validerReponseComparaisonTheme } from './themeFactsAdapter'

type Row = Record<string, any>

export interface RaccordementSemanticRead {
  indicator_id: 'raccordement_courbe'
  dataset_id: string
  publication_id: string
  content_version?: string
  reference_content_version: string
  descriptor_version: string
  territory: { id: string; type: string; name?: string }
  axis_kind: string
  axis_values: string[]
  axis_numeric_values: number[]
  label: string
  unit: string
  direction: 'high' | 'low'
  comparison_point: string
  comparison_contract: { statistic: string; scope: string }
  points: Row[]
  named_references: Row[]
}

export interface RaccordementSemanticComparison {
  status: 'available' | 'unavailable'
  reason: string | null
  scope: { kind: string; member_count: number; territory_type?: string; density_class_code?: string } | null
  statistic: 'mean'
  valueAtComparisonPoint: number | null
  selectedMemberCount: number
  eligibleCount: number
  rank: number | null
  rankSize: number | null
  points: { detail: string; value: number }[]
}

export interface RaccordementSemanticFocalProjection {
  metadata: RaccordementSemanticRead
  facts: Indicateur[]
  /** Named references stay independent of territory identity in this consumer projection. */
  referenceFacts: Array<Pick<Indicateur, 'detail' | 'value'>>
}

export interface RaccordementSemanticProjection extends RaccordementSemanticFocalProjection {
  /** Null while a scoped comparison is pending or has failed; focal evidence remains usable. */
  comparison: RaccordementSemanticComparison | null
}

const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function readFor(response: ThemeResponse, resourceId: string, kind: 'resource_reads' | 'comparison_reads') {
  const reads = response[kind]
  return Array.isArray(reads) ? reads.find((read) => isRecord(read) && read.resource === resourceId) : undefined
}

function sameLineage(actual: Row, expected: Row): boolean {
  return ['source_id', 'vintage_id', 'source_name', 'version', 'reference_date', 'publication_date', 'revision_hash']
    .every((key) => actual[key] === expected[key])
}

function validLineage(value: Row): boolean {
  return text(value.source_id) && text(value.vintage_id) && text(value.source_name) &&
    text(value.version) && text(value.revision_hash) &&
    (value.reference_date === null || text(value.reference_date)) &&
    (value.publication_date === null || text(value.publication_date))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  return value
}

function assertFocalSeries(data: Row, target: Territoire): asserts data is Row & RaccordementSemanticRead {
  const axes = data.axis_values
  const numeric = data.axis_numeric_values
  const points = data.points
  if (data.indicator_id !== 'raccordement_courbe' || !text(data.dataset_id) || !text(data.publication_id) ||
      !text(data.reference_content_version) || !isRecord(data.territory) ||
      data.territory.id !== target.territoire || data.territory.type !== target.type ||
      (data.content_version !== undefined && !text(data.content_version)) || !text(data.descriptor_version) ||
      data.axis_kind !== 'duration_minute' || !Array.isArray(axes) || !Array.isArray(numeric) ||
      axes.length < 2 || numeric.length !== axes.length || !Array.isArray(points) || points.length !== axes.length ||
      !text(data.label) || !text(data.unit) || (data.direction !== 'high' && data.direction !== 'low') || !text(data.comparison_point) ||
      !isRecord(data.comparison_contract) || data.comparison_contract.statistic !== 'mean' ||
      data.comparison_contract.scope !== 'selected_group' || !axes.includes(data.comparison_point)) {
    throw new Error('Lecture native de la courbe raccordement invalide')
  }
  for (let index = 0; index < axes.length; index++) {
    const point = points[index]
    if (!text(axes[index]) || !finite(numeric[index]) || (index > 0 && numeric[index] <= numeric[index - 1]!) ||
        !isRecord(point) || point.axis !== axes[index] || point.status !== 'measured' || !finite(point.value) ||
        !text(point.observation_period) || !Array.isArray(point.provenance) || point.provenance.length === 0 ||
        !(point.provenance as Row[]).every(validLineage)) {
      throw new Error('Grille ou provenance native de la courbe raccordement invalide')
    }
  }
  const sourceLineage = (points[0]!.provenance as Row[])[0]!
  if (points.some((point) => !(point.provenance as Row[]).every((source) => sameLineage(source, sourceLineage)))) {
    throw new Error('La courbe raccordement mélange ses provenances')
  }
}

function assertReference(data: Row, series: RaccordementSemanticRead): asserts data is Row {
  const expected = series.named_references[0]
  const reference = data.reference
  const points = data.points
  if (!expected || !isRecord(reference) || reference.id !== data.target?.id || reference.id !== expected.id ||
      reference.role !== expected.role || reference.label !== expected.label ||
      reference.statistic !== expected.statistic || reference.required !== true ||
      !isRecord(data.target) || data.target.kind !== 'named_reference' ||
      data.dataset_id !== series.dataset_id || data.publication_id !== series.publication_id ||
      data.reference_content_version !== series.reference_content_version || data.indicator_id !== 'raccordement_reference' ||
      data.axis_kind !== series.axis_kind || data.unit !== series.unit ||
      !Array.isArray(points) || points.length !== series.axis_values.length ||
      points.some((point, index) => !isRecord(point) || point.axis !== series.axis_values[index] ||
        point.status !== 'measured' || !finite(point.value) || !text(point.observation_period) ||
        !Array.isArray(point.provenance) || point.provenance.length === 0 ||
        !(point.provenance as Row[]).every((source) => sameLineage(source,
          ((series.points[0] as Row).provenance as Row[])[0]!)))) {
    throw new Error('Référence nommée native du raccordement incompatible avec sa publication propriétaire')
  }
}

function validateScope(data: Row, result: Row, target: Territoire,
  selection: readonly ThemeSelectionMember[] | undefined, count: number): void {
  const scope = isRecord(data.scope) ? data.scope : null
  const meanCurve = isRecord(result.mean_curve) ? result.mean_curve : null
  const curveScope = meanCurve && isRecord(meanCurve.scope) ? meanCurve.scope : null
  if (selection === undefined && target.type === 'region') {
    if (data.scope != null || data.selection != null || result.status !== 'unavailable' ||
        result.reason !== 'unsupported_comparison_contract' || count !== 0) {
      throw new Error('La comparaison régionale native ne reflète pas le contrat API sans groupe')
    }
    return
  }
  if (!scope || result.status === 'available' && (!curveScope ||
      JSON.stringify(stableValue(scope)) !== JSON.stringify(stableValue(curveScope)))) {
    throw new Error('Portée native du raccordement incohérente entre enveloppe et moyenne')
  }
  if (selection !== undefined) {
    const returned = data.selection
    const expectedKeys = selection.map((member) => `${member.territory_type}/${member.territory_id}`)
    const actualKeys = Array.isArray(returned) ? returned.filter(isRecord)
      .map((member) => `${String(member.territory_type)}/${String(member.territory_id)}`) : []
    if (scope.kind !== 'explicit_selection' || scope.member_count !== count ||
        actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index]) ||
        new Set(actualKeys).size !== actualKeys.length ||
        comparisonTargetMismatch(data.target, target)) {
      throw new Error('La comparaison native du raccordement ne reflète pas la sélection demandée')
    }
  } else if (data.selection != null || comparisonTargetMismatch(data.target, target) ||
      scope.member_count !== count || (target.type === 'commune'
    ? scope.kind !== 'density_class' || scope.territory_type !== 'commune' ||
      scope.density_class_code !== target.classe_densite_code
    : scope.kind !== 'same_level' || scope.territory_type !== target.type)) {
    throw new Error('La portée native par défaut du raccordement diffère du contrat producteur')
  }
}

function comparisonTargetMismatch(value: unknown, target: Territoire): boolean {
  return !isRecord(value) || value.kind !== 'territory' || value.id !== target.territoire || value.type !== target.type
}

function validatedFocalReads(focal: ThemeResponse, target: Territoire) {
  const seriesRead = readFor(focal, 'raccordement_courbe', 'resource_reads')
  const seriesData = seriesRead && isRecord(seriesRead.data) ? seriesRead.data : null
  const declaration = seriesRead && isRecord(seriesRead.declaration) ? seriesRead.declaration : null
  if (!seriesData || !declaration || !Array.isArray(declaration.allowed_levels) ||
      !declaration.allowed_levels.includes(target.type) ||
      !Array.isArray(seriesRead?.shapes) || !seriesRead.shapes.includes('ordered_series')) {
    throw new Error('Lecture focale native du raccordement absente ou niveau non déclaré')
  }
  assertFocalSeries(seriesData, target)
  const namedDeclaration = seriesData.named_references[0]
  if (!isRecord(namedDeclaration) || !text(namedDeclaration.id)) {
    throw new Error('La courbe raccordement ne déclare aucune référence nommée')
  }
  const referenceRead = (focal.named_reference_reads ?? []).find((read) => isRecord(read) &&
    isRecord(read.data) && read.resource === 'raccordement_reference' &&
    isRecord(read.data.target) && read.data.target.kind === 'named_reference' &&
    read.data.target.id === namedDeclaration.id)
  if (!referenceRead || !isRecord(referenceRead.data)) throw new Error('Lecture de référence nommée du raccordement absente')
  assertReference(referenceRead.data, seriesData)
  return { seriesRead, seriesData, referenceData: referenceRead.data }
}

/** Validate and publish only the focal series plus its declared named reference. */
export function projectRaccordementSemanticFocal(
  focal: ThemeResponse,
  target: Territoire,
): RaccordementSemanticFocalProjection {
  const { seriesData, referenceData } = validatedFocalReads(focal, target)
  const curveOnlyFocal: ThemeResponse = { ...focal,
    resource_reads: (focal.resource_reads ?? []).filter((read) => read.resource === 'raccordement_courbe'),
    named_reference_reads: (focal.named_reference_reads ?? []).filter((read) => read.resource === 'raccordement_reference'),
  }
  const adapted = themeFactsRowsFromSemantic('mobilite', curveOnlyFocal, {
    territoire: target.territoire, type: target.type,
  }, { epci: target.epci })
  const facts = adapted.indicateurs.filter((fact) => fact.key === 'raccordement_courbe')
  if (facts.length !== seriesData.axis_values.length || facts.some((fact, index) =>
    fact.detail !== seriesData.axis_values[index] || fact.observation_status !== 'measured' ||
    fact.value !== seriesData.points[index]!.value)) {
    throw new Error('Les faits projetés de la courbe raccordement ont perdu leurs axes ou leurs valeurs')
  }
  const referenceFacts = (referenceData.points as Row[]).map((point) => ({
    detail: point.axis as string,
    value: point.status === 'measured' ? point.value as number : null,
  }))
  return { metadata: seriesData as unknown as RaccordementSemanticRead, facts, referenceFacts }
}

/** Validate one scoped comparison independently of the already publishable focal facts. */
export function projectRaccordementSemanticComparison(
  focal: ThemeResponse,
  comparison: ThemeResponse,
  target: Territoire,
  selection: readonly ThemeSelectionMember[] | undefined,
): RaccordementSemanticComparison {
  if (!semanticPublicationsCompatible(focal, comparison, { type: target.type, id: target.territoire })) {
    throw new Error('Les publications natives focales et comparées du raccordement diffèrent')
  }
  validerReponseComparaisonTheme('mobilite', comparison, selection,
    { type: target.type, id: target.territoire })
  const { seriesData } = validatedFocalReads(focal, target)
  const comparisonRead = readFor(comparison, 'raccordement_courbe', 'comparison_reads')
  const comparisonData = comparisonRead && isRecord(comparisonRead.data) ? comparisonRead.data : null
  const comparisonDeclaration = comparisonRead && isRecord(comparisonRead.declaration) ? comparisonRead.declaration : null
  const result = comparisonData && isRecord(comparisonData.result) ? comparisonData.result : null
  const expectedVersion = seriesData.content_version ?? seriesData.publication_id
  if (!comparisonData || !comparisonDeclaration || !Array.isArray(comparisonDeclaration.allowed_levels) ||
      !comparisonDeclaration.allowed_levels.includes(target.type) || !result ||
      comparisonData.contract !== 'indicator-comparison-v1' || comparisonData.complete_theme !== false ||
      comparisonData.indicator_id !== 'raccordement_courbe' || comparisonData.theme_id !== 'mobilite' ||
      comparisonTargetMismatch(comparisonData.target, target) || comparisonData.content_version !== expectedVersion ||
      comparisonData.reference_content_version !== seriesData.reference_content_version ||
      result.indicator_id !== 'raccordement_courbe' || result.descriptor_version !== seriesData.descriptor_version ||
      result.status !== 'available' && result.status !== 'unavailable' ||
      result.owned_content_version !== expectedVersion ||
      result.statistic !== seriesData.comparison_contract.statistic || result.source_facet !== seriesData.comparison_point ||
      !Number.isInteger(result.selected_member_count) || (result.selected_member_count as number) < 0 ||
      !Number.isInteger(result.eligible_count) || (result.eligible_count as number) < 0 ||
      (result.eligible_count as number) > (result.selected_member_count as number) ||
      result.missing_count !== (result.selected_member_count as number) - (result.eligible_count as number) ||
      !Array.isArray(result.comparison_sources)) {
    throw new Error('Réponse de comparaison native de la courbe raccordement invalide')
  }
  validateScope(comparisonData, result, target, selection, result.selected_member_count as number)
  const focalLineage = (seriesData.points[0]!.provenance as Row[])[0]!
  const comparisonSources = result.comparison_sources as Row[]
  if (comparisonSources.some((source) => !isRecord(source) || !validLineage(source)) ||
      comparisonSources.some((source) => !sameLineage(source, focalLineage))) {
    throw new Error('La comparaison native du raccordement mélange ses provenances')
  }
  const apiScope = isRecord(comparisonData.scope) ? comparisonData.scope : null
  const scopeProjection = apiScope ? apiScope as RaccordementSemanticComparison['scope'] : null

  if (result.status === 'unavailable') {
    const reason = result.reason
    const unavailableReasons = ['fewer_than_two_comparable_values', 'no_selected_comparable_values',
      'unsupported_comparison_contract']
    if (!unavailableReasons.includes(String(reason)) || result.mean !== null || result.mean_curve !== null ||
        result.rank !== null || result.rank_size !== null || (result.eligible_count as number) > 1 ||
        reason === 'no_selected_comparable_values' && result.eligible_count !== 0 ||
        reason === 'fewer_than_two_comparable_values' && result.eligible_count !== 1 ||
        reason === 'unsupported_comparison_contract' && (target.type !== 'region' || selection !== undefined ||
          result.selected_member_count !== 0 || result.eligible_count !== 0)) {
      throw new Error('Réponse indisponible de comparaison native de la courbe raccordement invalide')
    }
    return { status: 'unavailable', reason: reason as string, scope: scopeProjection, statistic: 'mean',
      valueAtComparisonPoint: null, selectedMemberCount: result.selected_member_count as number,
      eligibleCount: result.eligible_count as number, rank: null, rankSize: null, points: [] }
  }

  const meanCurve = isRecord(result.mean_curve) ? result.mean_curve : null
  const meanPoints = meanCurve && Array.isArray(meanCurve.points) ? meanCurve.points : null
  if (!meanCurve || !meanPoints || !finite(result.mean) ||
      result.selected_member_count !== result.eligible_count || (result.selected_member_count as number) < 2 ||
      result.missing_count !== 0 || meanCurve.statistic !== seriesData.comparison_contract.statistic ||
      meanCurve.axis_kind !== seriesData.axis_kind || meanCurve.selected_member_count !== result.selected_member_count ||
      meanCurve.eligible_count !== result.eligible_count || meanPoints.length !== seriesData.axis_values.length ||
      meanPoints.some((point, index) => !isRecord(point) || point.axis !== seriesData.axis_values[index] ||
        point.status !== 'measured' || !finite(point.value))) {
    throw new Error('Réponse disponible de comparaison native de la courbe raccordement invalide')
  }
  const pointAtFacet = meanPoints.find((point) => isRecord(point) && point.axis === seriesData.comparison_point)
  if (!pointAtFacet || !isRecord(pointAtFacet) || Math.abs((pointAtFacet.value as number) - result.mean) > 1e-12) {
    throw new Error('Moyenne native du raccordement incohérente avec sa facette')
  }
  if (!comparisonSources.length) throw new Error('Provenance de comparaison native du raccordement absente')
  return { status: 'available', reason: null, scope: scopeProjection, statistic: 'mean',
    valueAtComparisonPoint: result.mean as number, selectedMemberCount: result.selected_member_count as number,
    eligibleCount: result.eligible_count as number, rank: finite(result.rank) ? result.rank : null,
    rankSize: finite(result.rank_size) ? result.rank_size : null,
    points: meanPoints.map((point) => ({ detail: (point as Row).axis as string,
      value: (point as Row).value as number })) }
}

/** Combined projection retained for pure adapter callers; mounted consumers can publish the focal part first. */
export function projectRaccordementSemanticReads(
  focal: ThemeResponse,
  comparison: ThemeResponse,
  target: Territoire,
  selection: readonly ThemeSelectionMember[] | undefined,
): RaccordementSemanticProjection {
  return { ...projectRaccordementSemanticFocal(focal, target),
    comparison: projectRaccordementSemanticComparison(focal, comparison, target, selection) }
}

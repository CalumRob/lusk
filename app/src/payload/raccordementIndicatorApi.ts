import type { Indicateur, Territoire } from './types'

type Row = Record<string, unknown>
const record = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export interface RaccordementIndicatorRead {
  indicator_id: 'raccordement_courbe'
  dataset_id: 'raccordement_courbe'
  publication_id: string
  reference_content_version: string
  territory: { id: string; type: string; name: string }
  axis_kind: 'duration_minute'
  axis_values: string[]
  axis_numeric_values: number[]
  label: string
  unit: string
  direction: 'high' | 'low'
  comparison_point: string
  points: Row[]
  named_references: Row[]
  comparison_contract: { statistic: 'mean'; scope: 'selected_group' }
}

export interface RaccordementIndicatorComparison {
  scopeLabel: string
  statistic: 'mean'
  valueAtComparisonPoint: number
  selectedMemberCount: number
  rank: number | null
  rankSize: number | null
  points: { detail: string; value: number }[]
}

/** Parse the actual indicator-series + scoped-comparison API contracts; never derive peers or values. */
export function validateRaccordementIndicatorRead(
  read: unknown,
  comparison: unknown,
  target: Territoire,
  expectedSelection?: readonly { territory_type: string; territory_id: string }[],
  scopeLabel?: string,
): { facts: Indicateur[]; referenceFacts: Indicateur[]; metadata: RaccordementIndicatorRead; comparison: RaccordementIndicatorComparison } {
  if (!record(read) || !record(comparison) || read.indicator_id !== 'raccordement_courbe' ||
      read.dataset_id !== 'raccordement_courbe' || read.axis_kind !== 'duration_minute' ||
      !text(read.publication_id) || !text(read.reference_content_version) || !record(read.territory) ||
      read.territory.id !== target.territoire || read.territory.type !== target.type ||
      !Array.isArray(read.axis_values) || !Array.isArray(read.axis_numeric_values) ||
      !Array.isArray(read.points) || read.points.length !== read.axis_values.length ||
      read.axis_numeric_values.length !== read.axis_values.length || !Array.isArray(read.named_references) ||
      !text(read.label) || !text(read.unit) || (read.direction !== 'high' && read.direction !== 'low') ||
      !text(read.comparison_point) || !record(read.comparison_contract) ||
      read.comparison_contract.statistic !== 'mean' || read.comparison_contract.scope !== 'selected_group') {
    throw new Error('Réponse de trajectoire raccordement invalide')
  }
  const axes = read.axis_values as string[]
  const minutes = read.axis_numeric_values as number[]
  const focalPoints = read.points as Row[]
  const pointUnit = read.unit
  if (axes.length < 2 || axes.some((axis, index) => !text(axis) || !/^t\d{4}$/.test(axis) ||
      Number(axis.slice(1)) !== minutes[index] || !finite(minutes[index]) ||
      (index > 0 && minutes[index]! <= minutes[index - 1]!)) ||
      new Set(axes).size !== axes.length || !axes.includes(read.comparison_point as string) ||
      focalPoints.some((point, index) => !record(point) || point.axis !== axes[index] ||
        point.status !== 'measured' || !finite(point.value) || !Array.isArray(point.provenance) || point.provenance.length === 0) ||
      !(read.named_references as unknown[]).some((reference) => record(reference) && text(reference.id) &&
        text(reference.label) && reference.role === 'analytical_reference' && text(reference.statistic) &&
        Array.isArray(reference.points) && reference.points.length === axes.length &&
        (reference.points as unknown[]).every((point, index) => record(point) && point.axis === axes[index] &&
          point.status === 'measured' && finite(point.value) && Array.isArray(point.provenance) && point.provenance.length > 0))) {
    throw new Error('Grille ou provenance de trajectoire raccordement invalide')
  }
  const comparisonEnvelope = comparison as Row
  const result = record(comparisonEnvelope.result) ? comparisonEnvelope.result : null
  const scope = result && record(result.mean_curve) && record(result.mean_curve.scope) ? result.mean_curve.scope : null
  const envelopeScope = record(comparisonEnvelope.scope) ? comparisonEnvelope.scope : null
  const selection = comparisonEnvelope.selection
  const keys = (items: readonly { territory_type: string; territory_id: string }[]) =>
    items.map((item) => `${item.territory_type}/${item.territory_id}`).sort()
  const actualKeys = Array.isArray(selection) ? selection.filter(record)
    .map((item) => `${String(item.territory_type)}/${String(item.territory_id)}`).sort() : []
  const expectedKeys = expectedSelection === undefined ? [] : keys(expectedSelection)
  const densityValid = scope?.kind === 'density_class' && envelopeScope?.kind === 'density_class' &&
    scope.territory_type === target.type && text(scope.density_class_code) &&
    scope.density_class_code === target.classe_densite_code &&
    envelopeScope.density_class_code === scope.density_class_code && selection == null
  const explicitValid = scope?.kind === 'explicit_selection' && envelopeScope?.kind === 'explicit_selection' &&
    expectedKeys.length >= 2 && actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => key.startsWith('commune/')) &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  const focalLineage = (focalPoints[0]?.provenance as Row[] | undefined)?.[0]
  const comparisonLineage = Array.isArray(result?.comparison_sources) ? result.comparison_sources.filter(record)[0] : null
  if (comparisonEnvelope.contract !== 'indicator-comparison-v1' || comparisonEnvelope.complete_theme !== false ||
      comparisonEnvelope.indicator_id !== 'raccordement_courbe' || comparisonEnvelope.theme_id !== 'mobilite' ||
      comparisonEnvelope.content_version !== read.publication_id ||
      !result || result.indicator_id !== 'raccordement_courbe' || result.status !== 'available' ||
      result.statistic !== 'mean' || result.source_facet !== read.comparison_point ||
      result.selected_member_count !== result.eligible_count || !finite(result.selected_member_count) ||
      !finite(result.mean) || !finite(result.rank_size) && result.rank !== null ||
      !Array.isArray(result.comparison_sources) || result.comparison_sources.length !== 1 ||
      !record(focalLineage) || !comparisonLineage ||
      focalLineage.source_id !== comparisonLineage.source_id ||
      focalLineage.revision_hash !== comparisonLineage.revision_hash ||
      !record(result.mean_curve) || result.mean_curve.statistic !== 'mean' ||
      result.mean_curve.axis_kind !== read.axis_kind || result.mean_curve.selected_member_count !== result.selected_member_count ||
      result.mean_curve.eligible_count !== result.selected_member_count ||
      !Array.isArray(result.mean_curve.points) || result.mean_curve.points.length !== axes.length ||
      (result.mean_curve.points as Row[]).some((point, index) => !record(point) || point.axis !== axes[index] ||
        point.status !== 'measured' || !finite(point.value)) ||
      (densityValid ? result.selected_member_count !== envelopeScope?.member_count : !explicitValid) ||
      (expectedSelection === undefined && selection != null)) {
    throw new Error('Portée ou courbe moyenne raccordement incohérente avec la réponse API')
  }
  const meanPoints = result.mean_curve.points as Row[]
  const comparisonPoint = meanPoints.find((point) => point.axis === read.comparison_point)
  if (!comparisonPoint || Math.abs((comparisonPoint.value as number) - (result.mean as number)) > 1e-12) {
    throw new Error('Facette moyenne raccordement incohérente')
  }
  const makeFact = (territory: Territoire, key: string, point: Row, detail: string | null): Indicateur => {
    const provenance = (point.provenance as Row[]).filter(record)
    const first = provenance[0] ?? {}
    return { territoire: territory.territoire, type: territory.type, theme: 'mobilite', key, detail,
      value: point.status === 'measured' ? point.value as number : null, unit: pointUnit,
      rider: null, vintage_source: String(first.source_name ?? ''), vintage_version: String(first.version ?? ''),
      vintage_date_reference: text(first.reference_date) ? first.reference_date : null,
      vintage_date_publication: text(first.publication_date) ? first.publication_date : null,
      rang_epci: detail === read.comparison_point && densityValid && finite(result.rank) ? result.rank : null,
      rang_epci_n: detail === read.comparison_point && densityValid && finite(result.rank_size) ? result.rank_size : null,
      rang_dep: detail === read.comparison_point && explicitValid && finite(result.rank) ? result.rank : null,
      rang_dep_n: detail === read.comparison_point && explicitValid && finite(result.rank_size) ? result.rank_size : null,
      rang_reg: null, rang_reg_n: null,
      observation_status: 'measured', observation_period: text(point.observation_period) ? point.observation_period : null,
      source_id: text(first.source_id) ? first.source_id : null, vintage_id: text(first.vintage_id) ? first.vintage_id : null,
      provenance_revisions: provenance as Indicateur['provenance_revisions'] }
  }
  const facts = (read.points as Row[]).map((point) => makeFact(target, 'raccordement_courbe', point, point.axis as string))
  const referenceFacts: Indicateur[] = []
  for (const named of read.named_references as Row[]) {
    if (!text(named.id) || !text(named.label) || !Array.isArray(named.points)) continue
    const referenceTerritory: Territoire = { ...target, territoire: named.id, nom: named.label }
    referenceFacts.push(...(named.points as Row[]).filter((point) => record(point) && axes.includes(String(point.axis)))
      .map((point) => makeFact(referenceTerritory, 'raccordement_reference', point, point.axis as string)))
  }
  const metadata = read as unknown as RaccordementIndicatorRead
  const resolvedScopeLabel = scopeLabel || (densityValid ? target.classe_densite_libelle_public : undefined)
  if (!text(resolvedScopeLabel)) throw new Error('Libellé de portée raccordement indisponible')
  return { facts, referenceFacts, metadata, comparison: { scopeLabel: resolvedScopeLabel, statistic: 'mean',
    valueAtComparisonPoint: result.mean as number, selectedMemberCount: result.selected_member_count as number,
    rank: finite(result.rank) ? result.rank : null, rankSize: finite(result.rank_size) ? result.rank_size : null,
    points: meanPoints.map((point) => ({ detail: point.axis as string, value: point.value as number })) } }
}

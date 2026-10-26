import type { Payload, Indicateur, ProfilAccesBpeRow, DistributionAccesBatimentsRow,
  RampeAccesBatimentsRow } from '@/payload/types'
import type { TerritoryComparisonContext } from '@/payload/territoryReadModel'
import type { ThemeResponse } from '@/payload/themeAcquisition'
import { semanticComparisonForTheme, themeFactsEnvelopeFromSemantic } from '@/payload/themeFactsAdapter'
import { ACCESS_INDICATOR_KEYS, territoryFactsFor } from './territoryFacts'
import type { FactProvenance, MobilityTrajectoryContract, NamedTrajectoryReference, NumericFact,
  SelectedTrajectoryComparison, TerritoryFacts } from './territoryFacts'
import { clearBuildingApiPeers } from './buildingApiFacts'

type Row = Record<string, unknown>

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const rows = (value: unknown, field: string): Row[] => {
  if (!Array.isArray(value) || value.some((row) => !isRecord(row))) {
    throw new Error(`Réponse Mobilité invalide : ${field}`)
  }
  return value
}
const text = (value: unknown): value is string => typeof value === 'string'
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function apiSources(value: unknown): FactProvenance[] {
  if (!Array.isArray(value) || !value.length) throw new Error('Sources SQL Mobilité invalides')
  return value.map((source) => {
    if (!isRecord(source) || !text(source.source_id) || !text(source.name) ||
        !text(source.version) || !(source.reference_date === null || text(source.reference_date)) ||
        !(source.publication_date === null || text(source.publication_date))) {
      throw new Error('Provenance SQL Mobilité invalide')
    }
    return { sourceId: source.source_id, source: source.name, version: source.version,
      referenceDate: source.reference_date, publicationDate: source.publication_date,
      lineage: { ...source } }
  })
}

function indicatorFromSql(
  target: Payload['territoires'][number],
  indicatorId: unknown,
  value: unknown,
  status: unknown,
  unit: unknown,
  sourceRows: unknown,
  detail: string | null = null,
  sex: string | null = null,
  dimension: string | null = null,
): Indicateur {
  if (!text(indicatorId) || !text(unit) || !text(status)) throw new Error('Fait SQL Mobilité invalide')
  const provenance = apiSources(sourceRows)
  const measured = status === 'measured'
  if (measured && !finite(value)) throw new Error(`Valeur mesurée absente : ${indicatorId}`)
  return {
    territoire: target.territoire, type: target.type, theme: 'mobilite', key: indicatorId,
    detail, sex: sex as Indicateur['sex'], dimension, value: measured ? value as number : null, unit,
    rider: measured ? null : status,
    vintage_source: provenance[0]?.source ?? '', vintage_version: provenance[0]?.version ?? '',
    vintage_date_reference: provenance[0]?.referenceDate ?? null,
    vintage_date_publication: provenance[0]?.publicationDate ?? null,
    rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
    fact_sources: provenance.map((source) => ({ ...source, sourceId: source.sourceId ?? '' })),
  }
}

function buckets(value: unknown): { key: string; min: number; max: number | null; label: string }[] {
  return rows(value, 'building_access.presentation.bins').map((bin) => {
    // The deployed API publishes the open-ended R bucket as the literal "NA";
    // at the figure boundary that means no upper bound, like canonical JSON null.
    const max = bin.max_value === 'NA' ? null : bin.max_value
    if (!text(bin.key) || !text(bin.label) || !finite(bin.min_value) ||
        !(max === null || finite(max))) throw new Error('Classe SQL de distribution invalide')
    return { key: bin.key, min: bin.min_value, max, label: bin.label }
  })
}

function buildingRows(response: Row, target: Payload['territoires'][number]): {
  distribution: DistributionAccesBatimentsRow[]; ramp: RampeAccesBatimentsRow[]
} {
  const evidence = response.building_access
  if (evidence === null || evidence === undefined) return { distribution: [], ramp: [] }
  if (!isRecord(evidence) || !text(evidence.publication_id)) {
    throw new Error('Publication SQL bâtiments invalide')
  }
  if (evidence.availability === 'absent') return { distribution: [], ramp: [] }
  if (evidence.availability !== 'complete' || !Array.isArray(evidence.distribution) ||
      !Array.isArray(evidence.ramp) || !Array.isArray(evidence.sources)) throw new Error('Publication SQL bâtiments invalide')
  const sourceRows = apiSources(evidence.sources).map((source) => source)
  if (!sourceRows.length) throw new Error('Provenance SQL bâtiments absente')
  const source = sourceRows[0]!
  const grid = rows(evidence.distribution, 'building_access.distribution')
  const rampRows = rows(evidence.ramp, 'building_access.ramp')
  const presentation = evidence.presentation
  if (!isRecord(presentation) || !isRecord(presentation.building_grid) ||
      !isRecord(presentation.building_ramp)) throw new Error('Métadonnées SQL bâtiments absentes')
  const gridPresentation = presentation.building_grid
  const rampPresentation = presentation.building_ramp
  if (!text(gridPresentation.mode_label) || !text(gridPresentation.breadth_axis_label) ||
      !text(gridPresentation.depth_axis_label) || !text(rampPresentation.x_axis_label) ||
      !text(rampPresentation.y_axis_label) || !isRecord(rampPresentation.modes) ||
      !Array.isArray(rampPresentation.quantile_labels) || rampPresentation.quantile_labels.some((label) => !text(label))) {
    throw new Error('Métadonnées SQL bâtiments invalides')
  }
  const breadth = buckets(gridPresentation.breadth)
  const depth = buckets(gridPresentation.depth)
  if (grid.some((cell) => !breadth.some((bin) => bin.key === cell.breadth_bucket) ||
      !depth.some((bin) => bin.key === cell.depth_bucket) || !finite(cell.share)) ||
      rampRows.some((point) => !text((rampPresentation.modes as Row)[String(point.mode)]) ||
        !text((rampPresentation.quantile_labels as unknown[])[Number(point.quantile_index)]))) {
    throw new Error('Axes SQL bâtiments incohérents')
  }
  const total = grid.length && finite(grid[0]!.total_buildings) ? grid[0]!.total_buildings : 0
  if (grid.length !== 30 || rampRows.length !== 33 || !total) throw new Error('Publication SQL bâtiments incomplète')
  const distribution: DistributionAccesBatimentsRow[] = grid.map((cell) => ({
    territoire: target.territoire, type: target.type, availability: 'complete', total_buildings: cell.total_buildings as number,
    breadth_bucket: cell.breadth_bucket as string,
    breadth_min: breadth.find((item) => item.key === cell.breadth_bucket)!.min,
    breadth_max: breadth.find((item) => item.key === cell.breadth_bucket)!.max,
    breadth_label: breadth.find((item) => item.key === cell.breadth_bucket)!.label,
    depth_bucket: cell.depth_bucket as string,
    depth_min: depth.find((item) => item.key === cell.depth_bucket)!.min,
    depth_max: depth.find((item) => item.key === cell.depth_bucket)!.max,
    depth_label: depth.find((item) => item.key === cell.depth_bucket)!.label,
    building_count: cell.building_count as number,
    share: cell.share as number,
    mode: 't', mode_label: gridPresentation.mode_label as string, breadth_axis_label: gridPresentation.breadth_axis_label as string,
    depth_axis_label: gridPresentation.depth_axis_label as string, source_id: source.sourceId!, source: source.source,
    version: source.version, date_reference: source.referenceDate ?? '', date_publication: source.publicationDate ?? '',
    comparison_label: null, comparison_total_buildings: null, comparison_building_count: null, comparison_share: null,
  }))
  const ramp: RampeAccesBatimentsRow[] = rampRows.map((point) => ({
    territoire: target.territoire, type: target.type, availability: 'complete',
    total_buildings: point.total_buildings as number, mode: point.mode as RampeAccesBatimentsRow['mode'],
    mode_label: (rampPresentation.modes as Row)[String(point.mode)] as string,
    quantile: point.quantile as number, quantile_label: (rampPresentation.quantile_labels as string[])[Number(point.quantile_index)]!,
    accessible_types: point.accessible_types as number, x_axis_label: rampPresentation.x_axis_label as string,
    y_axis_label: rampPresentation.y_axis_label as string, source_id: source.sourceId!, source: source.source,
    version: source.version, date_reference: source.referenceDate ?? '', date_publication: source.publicationDate ?? '',
    comparison_label: null, comparison_total_buildings: null, comparison_accessible_types: null,
  }))
  return { distribution, ramp }
}

function payloadFromSql(payload: Payload, response: Row): Payload {
  const target = payload.territoires.find((item) => item.territoire ===
    (isRecord(response.territory) ? response.territory.territory_id : null))
  if (!target || !isRecord(response.territory) || response.territory.territory_type !== target.type) {
    throw new Error('Territoire de la réponse Mobilité invalide')
  }

  const indicators = rows(response.indicators, 'indicators').map((fact) => {
    if (!text(fact.indicator_id) || !isRecord(fact.dimensions)) throw new Error('Fait indicateur SQL Mobilité invalide')
    const dimensions = fact.dimensions
    for (const key of ['detail', 'sex', 'axis', 'observation_period', 'state_role']) {
      if (key in dimensions && dimensions[key] !== null && !text(dimensions[key])) {
        throw new Error(`Dimension SQL Mobilité invalide : ${key}`)
      }
    }
    if ('numeric_axis_value' in dimensions && dimensions.numeric_axis_value !== null &&
        !finite(dimensions.numeric_axis_value)) throw new Error('Axe numérique SQL Mobilité invalide')
    const descriptor = rows(response.indicator_metadata, 'indicator_metadata')
      .find((item) => item.indicator_id === fact.indicator_id)
    if (descriptor && Array.isArray(descriptor.axes)) {
      for (const key of ['detail', 'sex'] as const) {
        if (dimensions[key] !== undefined && dimensions[key] !== null &&
            !descriptor.axes.some((axis) => isRecord(axis) && axis.name === key && axis.key === dimensions[key])) {
          throw new Error(`Coordonnée SQL Mobilité non déclarée : ${key}`)
        }
      }
    }
    if (text(dimensions.axis) && descriptor && Array.isArray(descriptor.axis_values) &&
        !descriptor.axis_values.includes(dimensions.axis)) throw new Error('Axe SQL Mobilité non déclaré')
    return indicatorFromSql(target, fact.indicator_id, fact.value, fact.status, fact.unit, fact.sources,
      text(dimensions.detail) ? dimensions.detail : text(dimensions.axis) ? dimensions.axis : null,
      text(dimensions.sex) ? dimensions.sex : null,
      text(dimensions.observation_period) ? dimensions.observation_period : null)
  })
  const territories = [...payload.territoires]
  if (response.service_reference !== undefined) {
    const reference = response.service_reference
    if (!isRecord(reference) || !isRecord(reference.territory) ||
        reference.territory.territory_type !== 'region' || !text(reference.territory.territory_id) ||
        !text(reference.territory.name) || reference.indicator_id !== 'nb_buildings') {
      throw new Error('Référence SQL des services invalide')
    }
    const referenceTerritory: Payload['territoires'][number] = {
      territoire: reference.territory.territory_id, type: 'region', nom: reference.territory.name,
      departement: null, epci: null,
    }
    if (!territories.some((territory) => territory.territoire === referenceTerritory.territoire)) {
      territories.push(referenceTerritory)
    }
    if (target.territoire !== referenceTerritory.territoire) {
      indicators.push(indicatorFromSql(referenceTerritory, reference.indicator_id, reference.value,
        reference.status, reference.unit, reference.sources))
    }
  }
  rows(response.readings, 'readings')
  const bpeRows: ProfilAccesBpeRow[] = []
  if (response.bpe_profile_evidence !== null && response.bpe_profile_evidence !== undefined) {
    const bpe = response.bpe_profile_evidence
    if (!isRecord(bpe) || !Array.isArray(bpe.classes)) throw new Error('Profils BPE SQL invalides')
    for (const item of rows(bpe.classes, 'bpe_profile_evidence.classes')) {
      if (!text(item.class_key) || !text(item.label) || !finite(item.count)) throw new Error('Classe BPE SQL invalide')
      const exemplar = isRecord(item.exemplar) ? item.exemplar : null
      const access = exemplar && isRecord(exemplar.access) ? exemplar.access : null
      bpeRows.push({ territoire: target.territoire, type: target.type,
        profil: item.class_key as ProfilAccesBpeRow['profil'], profil_libelle: item.label,
        nombre_typequ: item.count, exemplar_typequ: exemplar && text(exemplar.typequ) ? exemplar.typequ : '',
        exemplar_libelle: exemplar && text(exemplar.label) ? exemplar.label : '',
        exemplar_c: access && finite(access.car) ? access.car : 0,
        exemplar_b: access && finite(access.bike) ? access.bike : 0,
        exemplar_t: access && finite(access.walk_transit) ? access.walk_transit : 0 })
    }
  }

  const building = buildingRows(response, target)
  // Values come only from the SQL product. The original payload contributes
  // territory identity and declared presentation metadata, not numeric rows.
  return { ...payload, territoires: territories, indicateurs: indicators, histoires: [], profilsAccesBpe: bpeRows,
    distributionAccesBatiments: building.distribution, rampeAccesBatiments: building.ramp }
}

function presentationOnlyPayload(payload: Payload): Payload {
  return { ...payload, indicateurs: [], histoires: [], profilsAccesBpe: [],
    distributionAccesBatiments: [], rampeAccesBatiments: [] }
}

function loadingFacts(payload: Payload, territoryId: string, context?: TerritoryComparisonContext): TerritoryFacts {
  const empty = territoryFactsFor(presentationOnlyPayload(payload), territoryId, context)
  if (!empty) throw new Error('Territoire inconnu')
  return { ...empty, mobility: { ...empty.mobility,
    access: { ...empty.mobility.access, availability: 'incomplete' } } }
}

function factFromReading(key: string, unit: unknown, value: unknown, status: unknown,
                         provenance: unknown): NumericFact {
  const sources = apiSources(provenance)
  const available = status === 'measured'
  if (!text(unit) || (available && !finite(value))) throw new Error(`Lecture SQL invalide : ${key}`)
  return { key, detail: null, value: available ? value as number : null, unit,
    availability: available ? 'complete' : 'incomplete', provenance: sources[0] ?? null,
    comparison: null, comparisonBasis: 'territory-median', reason: available ? null : String(status) }
}

/** Build Variant E's entire reachable numeric fact model from one theme-facts response. */
export function mobilityFactsFromThemeApi(
  payload: Payload,
  territoryId: string,
  response: unknown,
  context?: TerritoryComparisonContext,
): TerritoryFacts {
  if (response === null) {
    return loadingFacts(payload, territoryId, context)
  }
  const target = payload.territoires.find((territory) => territory.territoire === territoryId)
  if (!target || !isRecord(response) || !Array.isArray(response.resource_reads)) {
    throw new Error('Lectures sémantiques Mobilité invalides')
  }
  const normalized = themeFactsEnvelopeFromSemantic('mobilite', response as ThemeResponse,
    { territoire: target.territoire, type: target.type })
  const projected = payloadFromSql(payload, normalized)
  let facts = territoryFactsFor(projected, territoryId, context)
  if (!facts) throw new Error('Territoire inconnu')
  const curveDescriptor = rows(normalized.indicator_metadata, 'indicator_metadata')
    .find((row) => row.indicator_id === 'raccordement_courbe')
  let trajectoryContract: MobilityTrajectoryContract | null = null
  if (curveDescriptor && isRecord(curveDescriptor.comparison_contract)) {
    if (curveDescriptor.comparison_contract.statistic !== 'mean' ||
        curveDescriptor.comparison_contract.scope !== 'selected_group') {
      throw new Error('Contrat de comparaison de trajectoire Mobilité non pris en charge')
    }
    const axes = curveDescriptor.axis_values
    if (curveDescriptor.axis_kind !== 'duration_minute' || !Array.isArray(axes) || axes.length < 2 ||
        axes.some((axis) => !text(axis)) || !text(curveDescriptor.comparison_point) ||
        !Array.isArray(curveDescriptor.axis_numeric_values) ||
        curveDescriptor.axis_numeric_values.length !== axes.length ||
        curveDescriptor.axis_numeric_values.some((value) => !finite(value)) ||
        new Set(axes).size !== axes.length ||
        curveDescriptor.axis_numeric_values.some((value, index, values) => index > 0 && value <= values[index - 1]!)) {
      throw new Error('Descripteur de trajectoire Mobilité invalide')
    }
    const axisValues = axes as string[]
    const axisNumericValues = curveDescriptor.axis_numeric_values as number[]
    const focalAxes = facts.mobility.indicators.filter((fact) => fact.key === 'raccordement_courbe')
      .map((fact) => fact.detail)
    const rawCurveRows = rows(normalized.indicators, 'indicators')
      .filter((row) => row.indicator_id === 'raccordement_courbe')
    if (curveDescriptor.completeness !== 'dense_complete' ||
        !axisValues.includes(curveDescriptor.comparison_point) ||
        focalAxes.length !== axisValues.length ||
        focalAxes.some((axis, index) => axis !== axisValues[index]) ||
        rawCurveRows.length !== axisValues.length ||
        rawCurveRows.some((row, index) => !isRecord(row.dimensions) ||
          row.dimensions.axis !== axisValues[index] ||
          row.dimensions.numeric_axis_value !== axisNumericValues[index])) {
      throw new Error('Grille de trajectoire Mobilité incomplète ou désordonnée')
    }
    trajectoryContract = { axisKind: 'duration_minute', axisValues, axisNumericValues,
      comparisonPoint: curveDescriptor.comparison_point, comparisonStatistic: 'mean', comparisonScope: 'selected_group' }
    const numericByAxis = new Map(axisValues.map((axis, index) => [axis, axisNumericValues[index]!]))
    facts = { ...facts, mobility: { ...facts.mobility,
      indicators: facts.mobility.indicators.map((fact) => fact.key === 'raccordement_courbe'
        ? { ...fact, axisValue: numericByAxis.get(fact.detail ?? '') } : fact) } }
  }
  const namedTrajectoryReferences: NamedTrajectoryReference[] = rows(normalized.named_reference_evidence,
    'named_reference_evidence').filter((row) => row.indicator_id === 'raccordement_courbe').map((reference) => {
    if (!text(reference.id) || !text(reference.label) || !text(reference.role) ||
        !text(reference.statistic) || !text(reference.unit)) throw new Error('Référence nommée Mobilité invalide')
    const points = rows(reference.points, 'named_reference_evidence.points').map((point) => {
      if (!text(point.axis) || !text(point.observation_period) ||
          !['measured', 'missing'].includes(String(point.status)) ||
          !(point.status === 'measured' ? finite(point.value) : point.value === null)) {
        throw new Error('Point de référence nommée Mobilité invalide')
      }
      const provenance = apiSources(rows(point.provenance, 'named_reference_evidence.provenance').map((source) => {
        if (!text(source.source_id) || !text(source.source_name) || !text(source.version) ||
            !(source.reference_date === null || text(source.reference_date)) ||
            !(source.publication_date === null || text(source.publication_date))) {
          throw new Error('Provenance de référence nommée Mobilité invalide')
        }
        return { source_id: source.source_id, name: source.source_name, version: source.version,
          reference_date: source.reference_date, publication_date: source.publication_date }
      }))
      const source = provenance[0] ?? null
      return { key: reference.indicator_id as string, detail: point.axis,
        axisValue: trajectoryContract?.axisNumericValues[trajectoryContract.axisValues.indexOf(point.axis as string)],
        value: point.status === 'measured' ? point.value as number : null, unit: reference.unit as string,
        availability: point.status === 'measured' ? 'complete' as const : 'incomplete' as const,
        provenance: source, sourceLineage: provenance, comparison: null, comparisonBasis: 'territory-median' as const,
        reason: point.status === 'measured' ? null : String(point.status) }
    })
    return { indicatorId: 'raccordement_courbe', id: reference.id as string, label: reference.label as string,
      role: reference.role as string, statistic: reference.statistic as string, unit: reference.unit as string, points }
  })
  // Retirement-frontier adapter only: Mobility has no selected-reading resource
  // in the actual native catalogue, so this legacy metadata lookup must not be
  // represented as an acquired API reading path.
  const subgroup = payload.themeMetadata?.mobilite?.subgroups.find((item) =>
    item.reading?.params.includes('div_loss_t'))
  const reading = (normalized.readings as Row[]).find((item) => item.groupe === subgroup?.key)
  const loss = reading ? { diversityWalkTransit: factFromReading('div_loss_t', reading.unit,
    reading.div_loss_t, reading.status, isRecord(reading.provenance) ? [{
      source_id: reading.provenance.source_id, name: reading.provenance.source_name,
      version: reading.provenance.source_version, reference_date: reading.provenance.source_reference_date,
      publication_date: reading.provenance.source_publication_date,
    }] : []), diversityBike: factFromReading('div_loss_b', reading.unit, reading.div_loss_b,
    reading.status, isRecord(reading.provenance) ? [{
      source_id: reading.provenance.source_id, name: reading.provenance.source_name,
      version: reading.provenance.source_version, reference_date: reading.provenance.source_reference_date,
      publication_date: reading.provenance.source_publication_date,
    }] : []) } : facts.mobility.losses
  return { ...facts, mobility: { ...facts.mobility, losses: loss, namedTrajectoryReferences, trajectoryContract } }
}

function selectedTrajectoryComparison(
  facts: TerritoryFacts,
  resultRows: readonly Row[],
  context?: TerritoryComparisonContext,
  envelope?: Row,
  expectedSelection?: readonly { territory_type: string; territory_id: string }[],
): SelectedTrajectoryComparison | null {
  const contract = facts.mobility.trajectoryContract
  if (!contract) return null
  const result = resultRows.find((candidate) => candidate.indicator_id === 'raccordement_courbe')
  if (!result) throw new Error('Comparaison moyenne de trajectoire Mobilité absente')
  if (result.status !== 'available') return null
  if (result.statistic !== contract.comparisonStatistic || result.source_facet !== contract.comparisonPoint ||
      !finite(result.mean) || !finite(result.selected_member_count) || !finite(result.eligible_count) ||
      result.selected_member_count < 2 || result.eligible_count !== result.selected_member_count ||
      !Array.isArray(result.comparison_sources) || result.comparison_sources.length === 0 ||
      !context?.scope.label) throw new Error('Comparaison moyenne de trajectoire Mobilité invalide')
  const meanCurve = result.mean_curve
  const sourceScope = isRecord(meanCurve) && isRecord(meanCurve.scope) ? meanCurve.scope : null
  const envelopeScope = envelope && isRecord(envelope.scope) ? envelope.scope : null
  const sourceSelection = envelope?.selection
  const expectedKeys = (expectedSelection ?? []).map((item) => `${item.territory_type}/${item.territory_id}`).sort()
  const actualSelection = Array.isArray(sourceSelection) ? sourceSelection.filter(isRecord)
    .map((item) => `${String(item.territory_type)}/${String(item.territory_id)}`).sort() : []
  const modeMatches = context?.mode === 'densite'
    ? envelopeScope?.kind === 'density_class' && sourceScope?.kind === 'density_class' &&
      sourceScope.territory_type === facts.territory.type &&
      text(sourceScope.density_class_code) && sourceScope.density_class_code === facts.territory.densityClassCode &&
      envelopeScope.density_class_code === sourceScope.density_class_code
    : (context?.mode === 'epci' || context?.mode === 'bretagne')
      ? envelopeScope?.kind === 'explicit_selection' && sourceScope?.kind === 'explicit_selection' &&
        expectedKeys.length >= 2 && actualSelection.length === expectedKeys.length &&
        actualSelection.every((key, index) => key === expectedKeys[index]) &&
        finite(envelopeScope.member_count) && envelopeScope.member_count === result.selected_member_count
      : false
  if (!sourceScope || !envelopeScope || !modeMatches ||
      envelopeScope.member_count !== result.selected_member_count ||
      (expectedSelection === undefined && sourceSelection != null) ||
      (expectedSelection !== undefined && (!Array.isArray(sourceSelection) ||
        sourceSelection.length !== expectedSelection.length || actualSelection.some((key, index) => key !== expectedKeys[index])))) {
    throw new Error('Portée réelle de la courbe moyenne Mobilité invalide')
  }
  if (!isRecord(meanCurve) || meanCurve.statistic !== contract.comparisonStatistic ||
      meanCurve.axis_kind !== contract.axisKind || !Array.isArray(meanCurve.points) ||
      meanCurve.selected_member_count !== result.selected_member_count ||
      meanCurve.eligible_count !== result.eligible_count ||
      !sourceScope || !envelopeScope) {
    throw new Error('Courbe moyenne de comparaison Mobilité invalide')
  }
  const points = rows(meanCurve.points, 'mean_curve.points')
  if (points.length !== contract.axisValues.length || points.some((point, index) =>
    point.axis !== contract.axisValues[index] || point.status !== 'measured' || !finite(point.value))) {
    throw new Error('Courbe moyenne Mobilité partielle, non mesurée ou désordonnée')
  }
  const facetPoint = points.find((point) => point.axis === contract.comparisonPoint)
  if (!facetPoint || Math.abs((facetPoint.value as number) - result.mean as number) > 1e-12) {
    throw new Error('Facette de comparaison Mobilité incohérente avec sa moyenne')
  }
  const reasons = meanCurve.model_zero_reason_counts
  if (!isRecord(reasons) || Object.values(reasons).some((count) => !finite(count) || count < 0)) {
    throw new Error('Motifs de zéros du modèle Mobilité invalides')
  }
  const lineage = apiSources(rows(result.comparison_sources, 'comparison_sources').map((source) => ({
    source_id: source.source_id, name: source.source_name, version: source.version,
    reference_date: source.reference_date, publication_date: source.publication_date,
  })))
  return { statistic: 'mean', scope: context.scope,
    selectedMemberCount: result.selected_member_count, eligibleCount: result.eligible_count,
    modelZeroReasonCounts: reasons as Record<string, number>, sourceLineage: lineage,
    points: points.map((point) => ({ key: 'raccordement_courbe', detail: point.axis as string,
      axisValue: contract.axisNumericValues[contract.axisValues.indexOf(point.axis as string)],
      value: point.value as number, unit: facts.mobility.indicators.find((fact) => fact.key === 'raccordement_courbe')?.unit ?? '%',
      availability: 'complete', provenance: lineage[0] ?? null, sourceLineage: lineage,
      comparison: null, comparisonBasis: 'territory-mean', reason: null })) }
}

/** Replace only comparison references; focal SQL facts and provenance remain untouched. */
export function applyThemeComparisonApiFacts(
  facts: TerritoryFacts,
  response: unknown,
  context?: TerritoryComparisonContext,
  expectedSelection?: readonly { territory_type: string; territory_id: string }[],
): TerritoryFacts {
  if (isRecord(response) && Array.isArray(response.comparison_reads)) {
    response = semanticComparisonForTheme(response, undefined, undefined,
      { type: facts.territory.type, id: facts.territory.code })
  }
  if (!isRecord(response) || (response.contract !== 'theme-comparison-v1' &&
      response.contract !== 'indicator-comparison-v1' && response.contract !== undefined) ||
      (response.theme_id !== 'mobilite' && response.theme_id !== undefined)) {
    throw new Error('Réponse de comparaison Mobilité invalide')
  }
  const resultRows = Array.isArray(response.results) ? rows(response.results, 'results')
    : isRecord(response.result) ? [response.result] : rows(response.results, 'results')
  const profileRows = response.profile_comparisons === undefined ? [] : rows(response.profile_comparisons, 'profile_comparisons')
  const comparisons = new Map<string, Row>()
  for (const result of resultRows) {
    if (text(result.indicator_id)) comparisons.set(result.indicator_id, result)
    else if (text(result.indicator)) comparisons.set(result.indicator, result)
  }
  const comparisonFor = (fact: NumericFact, detail: unknown = null, sex: unknown = null): NumericFact => {
    const result = comparisons.get(fact.key) ?? profileRows.find((candidate) =>
      candidate.indicator === fact.key && isRecord(candidate.facet) &&
      candidate.facet.detail === detail && candidate.facet.sex === sex)
    if (!result || result.status !== 'available' ||
        (result.direction !== 'high' && result.direction !== 'low')) return { ...fact, comparison: null }
    const meanValue = finite(result.mean) ? result.mean : null
    const medianValue = finite(result.median) ? result.median : null
    const reference = meanValue !== null ? { kind: 'mean' as const, value: meanValue }
      : medianValue !== null ? { kind: 'median' as const, value: medianValue } : null
    const rank = finite(result.rank) && finite(result.rank_size)
      ? { position: result.rank, size: result.rank_size } : null
    const mode = context?.mode
    const kind = context?.scope.kind
    if (!mode || !kind || !text(context?.scope.label)) return { ...fact, comparison: null }
    return { ...fact, comparison: { direction: result.direction === 'low' ? 'moins-est-mieux' : 'plus-est-mieux',
      scope: { mode, kind, label: context.scope.label }, rank, reference } }
  }
  const indicators = facts.mobility.indicators.map((fact) => comparisonFor(fact, fact.detail, fact.sex ?? null))
  const updateModeFacts = <T>(source: T): T =>
    Object.fromEntries(Object.entries(source as Record<string, unknown>)
      .map(([mode, fact]) => [mode, comparisonFor(fact as NumericFact)])) as unknown as T
  const summary = { ...facts.mobility.access.summary,
    accessibleEquipment: updateModeFacts(facts.mobility.access.summary.accessibleEquipment),
    accessibleTypes: updateModeFacts(facts.mobility.access.summary.accessibleTypes),
    // Symmetric with clearThemeComparisonApiFacts : sans cette mise à jour,
    // les pertes moyennes gardent une comparaison dérivée du modèle statique
    // (portée EPCI sans observations) qui fuit dans la présentation API.
    averageLosses: {
      diversity: updateModeFacts(facts.mobility.access.summary.averageLosses.diversity),
      total: updateModeFacts(facts.mobility.access.summary.averageLosses.total),
    },
  }
  const bpeAccess = { ...facts.mobility.bpeAccess, profiles: facts.mobility.bpeAccess.profiles.map((profile) => {
    const result = resultRows.find((candidate) => candidate.indicator_id === 'bpe_access_profile' &&
      candidate.detail === profile.profile)
    if (!result || result.status !== 'available' || !context ||
        (result.direction !== 'high' && result.direction !== 'low')) return { ...profile, comparison: null }
    return { ...profile, comparison: { scope: { mode: context.mode, kind: context.scope.kind,
      label: context.scope.label }, direction: (result.direction === 'low' ? 'moins-est-mieux' : 'plus-est-mieux') as 'moins-est-mieux' | 'plus-est-mieux',
      rank: finite(result.rank) && finite(result.rank_size)
        ? { position: result.rank, size: result.rank_size } : null,
      reference: finite(result.mean) ? { kind: 'mean' as const, value: result.mean } : null } }
  }) }
  const access = { ...facts.mobility.access,
    byService: Object.fromEntries(Object.entries(facts.mobility.access.byService).map(([service, modes]) => {
      const apiService = service as keyof typeof ACCESS_INDICATOR_KEYS
      const indicators = ACCESS_INDICATOR_KEYS[apiService]
      return [service, Object.fromEntries(Object.entries(modes).map(([mode, fact]) => {
        const sourceMode = mode === 'car' ? 'c' : mode === 'bike' ? 'b' : 't'
        const result = comparisons.get(indicators[sourceMode])
        if (!result || result.status !== 'available' || !context ||
            (result.direction !== 'high' && result.direction !== 'low')) return [mode, { ...fact, comparison: null }]
        return [mode, { ...fact, comparison: { direction: result.direction === 'low' ? 'moins-est-mieux' : 'plus-est-mieux',
          scope: { mode: context.mode, kind: context.scope.kind, label: context.scope.label },
          rank: finite(result.rank) && finite(result.rank_size)
            ? { position: result.rank, size: result.rank_size } : null,
          reference: finite(result.median) ? { kind: 'median' as const, value: result.median } : null } }]
      }))]
    })) as unknown as TerritoryFacts['mobility']['access']['byService'],
    summary,
  } as TerritoryFacts['mobility']['access']
  return { ...facts, mobility: { ...facts.mobility, indicators, access, bpeAccess,
    selectedTrajectoryComparison: selectedTrajectoryComparison(facts, resultRows, context, response, expectedSelection) } }
}

export function clearThemeComparisonApiFacts(facts: TerritoryFacts): TerritoryFacts {
  facts = clearBuildingApiPeers(facts)
  const clear = (fact: NumericFact): NumericFact => ({ ...fact, comparison: null })
  return { ...facts, mobility: { ...facts.mobility,
    indicators: facts.mobility.indicators.map(clear),
    selectedTrajectoryComparison: null,
    access: { ...facts.mobility.access,
      byService: Object.fromEntries(Object.entries(facts.mobility.access.byService).map(([service, modes]) =>
        [service, Object.fromEntries(Object.entries(modes).map(([mode, fact]) => [mode, clear(fact)]))])) as unknown as TerritoryFacts['mobility']['access']['byService'],
      summary: { ...facts.mobility.access.summary,
        accessibleEquipment: Object.fromEntries(Object.entries(facts.mobility.access.summary.accessibleEquipment).map(([mode, fact]) => [mode, clear(fact)])) as unknown as TerritoryFacts['mobility']['access']['summary']['accessibleEquipment'],
        accessibleTypes: Object.fromEntries(Object.entries(facts.mobility.access.summary.accessibleTypes).map(([mode, fact]) => [mode, clear(fact)])) as unknown as TerritoryFacts['mobility']['access']['summary']['accessibleTypes'],
        averageLosses: { diversity: Object.fromEntries(Object.entries(facts.mobility.access.summary.averageLosses.diversity).map(([mode, fact]) => [mode, clear(fact)])) as typeof facts.mobility.access.summary.averageLosses.diversity,
          total: Object.fromEntries(Object.entries(facts.mobility.access.summary.averageLosses.total).map(([mode, fact]) => [mode, clear(fact)])) as typeof facts.mobility.access.summary.averageLosses.total } },
    },
    bpeAccess: { ...facts.mobility.bpeAccess, profiles: facts.mobility.bpeAccess.profiles.map((profile) => ({ ...profile, comparison: null })) },
  } }
}

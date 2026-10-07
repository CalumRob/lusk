/** Shared Mobilité theme-facts API stub builders — consumed by both the
 * territoire-view mounted suite and the route/read-model suite (a spec cannot
 * import a spec without double-registering its tests).
 *
 * `reponseThemeMobiliteApi` projects a published read model into the REAL
 * theme-facts-v1 contract the E flow's POST consumes — scalars and profile
 * cells as dimensioned indicator rows (no « profiles »/« series »), the typed
 * reading, BPE profile evidence, the access and building members, and the
 * nested comparison. The `kind`/`label` parameters carry the published fixed
 * comparison's scope so the served comparison matches the focal's declared
 * context (contract-driven, never hardcoded). */
import { payloadDepuisModeleTerritoire } from '../../payload/territoryReadModel'
import { territoryFactsFor } from '../../fiche/content/territoryFacts'

export function reponseAccesApi(type: string, code: string, kind: string | null, label?: string) {
  return {
    publication_id: 'api-access-v1',
    territory: { id: code, name: 'Territoire', type },
    scope: kind ? { kind, label, member_count: 38 } : null,
    services: ['admin', 'food', 'health', 'bank', 'school'].map((id) => ({
      id,
      modes: Object.fromEntries(['car', 'bike', 'walk_transit'].map((mode) => [mode, {
        value: mode === 'walk_transit' ? 0.42 : 0.8,
        median: kind ? 0.3 : null,
        rank: kind ? { position: 19, size: 38 } : null,
        direction: 'high', indicator_label: `${id}-${mode}`,
        source_id: 'mobilite_snapshot', source_name: 'Source API', source_version: 'api-v1',
        reference_date: null, source_publication_date: null,
      }])),
      peer_median_car_gap: kind ? 0.3 : null,
      peer_median_bike_gain: kind ? 0.2 : null,
    })),
  }
}

export function reponseThemeMobiliteApi(model: any, type: string, code: string, kind: string | null, label?: string) {
  const theme = model.themes.mobilite
  const payload = payloadDepuisModeleTerritoire(model)
  const facts = territoryFactsFor(payload, code)!
  const ramp = facts.mobility.accessRamp!
  const grid = facts.mobility.buildingDistribution!
  const displayModes = { c: 'car', b: 'bike', t: 'walkTransit' } as const
  const sourceRows = (rows: any[]) => rows.map((row) => ({ source_id: row.vintage_source === 'Source API' ? 'api' : 'mobilite_snapshot',
    name: row.vintage_source, version: row.vintage_version, reference_date: row.vintage_date_reference,
    publication_date: row.vintage_date_publication }))
  const density = theme.comparisons?.densite
  const defaultResults = density?.facts.map((fact: any) => ({ indicator_id: fact.key, label: fact.key,
    unit: 'types', direction: fact.direction === 'plus-est-mieux' ? 'high' : 'low', statistic: 'median',
    status: fact.reference ? 'available' : 'unavailable', median: fact.reference?.value ?? null,
    rank: fact.rank?.position ?? null, rank_size: fact.rank?.size ?? null })) ?? []
  const bpeRows = theme.bpeAccess ?? []
  const universe = bpeRows.reduce((sum: number, row: any) => sum + row.nombre_typequ, 0)
  const history = theme.histories?.find((row: any) => row.territoire === code)
  const buildingSources = [{ source_id: 'mobilite_snapshot', name: ramp.provenance?.source ?? 'Source SQL',
    version: ramp.provenance?.version ?? 'sql-v1', reference_date: ramp.provenance?.referenceDate ?? null,
    publication_date: ramp.provenance?.publicationDate ?? null }]
  const indicateurSql = (row: any, detail: string | null = null, sex: string | null = null) => ({
    indicator_id: row.key, label: row.key, unit: row.unit,
    value: row.key === 'iso_alimentation' ? 0.87 : row.value,
    status: row.value === null ? 'unavailable' : 'measured',
    dimensions: detail ? { detail, sex } : {},
    sources: sourceRows([row]),
  })
  return {
    contract: 'theme-facts-v1', complete_theme: false, theme_id: 'mobilite',
    territory: { territory_id: code, territory_type: type },
    content_version: 'mobilite-v1', reference_content_version: 'territories-v1',
    // La publication réelle expose scalaires et cellules de profil comme lignes
    // d'indicateurs dimensionnées ; « profiles »/« series » n'existent pas.
    indicators: [
      ...theme.indicators.filter((row: any) => !row.detail).map((row: any) => indicateurSql(row)),
      ...theme.indicators.filter((row: any) => row.detail)
        .map((row: any) => indicateurSql(row, row.detail, row.sex ?? null)),
    ],
    indicator_metadata: [],
    named_reference_evidence: [],
    readings: history ? [{ groupe: history.groupe, story_key: history.story_key,
      salience_reason: history.salience_reason, classification_saillance: history.classification_saillance ?? null,
      div_loss_t: history.div_loss_t, div_loss_b: history.div_loss_b, status: 'measured', unit: 'types de services',
      provenance: { source_id: 'mobilite_snapshot', source_name: history.vintage_source,
        source_version: history.vintage_version, source_reference_date: history.vintage_date_reference,
        source_publication_date: history.vintage_date_publication } }] : [],
    bpe_profile_evidence: bpeRows.length ? { classes: bpeRows.map((row: any) => ({ class_key: row.profil,
      label: row.profil_libelle, count: row.nombre_typequ, universe_count: universe,
      exemplar: row.exemplar_typequ ? { typequ: row.exemplar_typequ, label: row.exemplar_libelle,
        access: { car: row.exemplar_c, bike: row.exemplar_b, walk_transit: row.exemplar_t } } : null })),
      sources: buildingSources } : null,
    comparison: { contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'mobilite',
      content_version: 'mobilite-v1', reference_content_version: 'territories-v1',
      scope: { kind: 'density_class', territory_type: 'commune', member_count: 38 },
      results: defaultResults, profile_comparisons: [] },
    essential_service_access: reponseAccesApi(type, code, kind, label),
    building_access: {
      publication_id: 'building-v1', availability: 'complete',
      territory: { id: code, type },
      scope: kind ? { comparison_mode: kind === 'communes-densite' ? 'densite' :
        kind === 'communes-epci' ? 'epci' : 'bretagne', kind } : null,
      sources: buildingSources,
      presentation: {
        building_grid: { mode_label: grid.modeLabel, breadth_axis_label: grid.breadthAxisLabel,
          depth_axis_label: grid.depthAxisLabel,
          breadth: grid.breadthBins.map((bin) => ({ key: bin.key, min_value: bin.min, max_value: bin.max, label: bin.label })),
          depth: grid.depthBins.map((bin) => ({ key: bin.key, min_value: bin.min, max_value: bin.max, label: bin.label })) },
        building_ramp: { modes: Object.fromEntries(Object.entries(displayModes).map(([code, display]) => [code, ramp.curves[display].modeLabel])),
          quantile_labels: ramp.curves.car.points.map((point) => point.quantileLabel),
          x_axis_label: ramp.xAxisLabel, y_axis_label: ramp.yAxisLabel },
      },
      ramp: (['c', 'b', 't'] as const).flatMap((mode) =>
        ramp.curves[displayModes[mode]].points.map((point, quantile_index) => ({
          mode, quantile_index, quantile: quantile_index / 10,
          accessible_types: point.accessibleTypes + 1, total_buildings: ramp.totalBuildings,
        }))),
      peer_ramp: kind ? { statistic: 'mean', member_count: 2, total_buildings: ramp.totalBuildings,
        points: (['c', 'b', 't'] as const).flatMap((mode) =>
          ramp.curves[displayModes[mode]].points.map((_point, index) => ({
            mode, quantile: index / 10, accessible_types: index + 2,
          }))) } : null,
      distribution: grid.cells.map((cell) => ({ breadth_bucket: cell.breadthBucket,
        depth_bucket: cell.depthBucket, building_count: cell.buildingCount, share: cell.share,
        total_buildings: grid.totalBuildings })),
      peer_distribution: kind ? { statistic: 'mean', member_count: 2,
        total_buildings: grid.totalBuildings, cells: grid.cells.map((cell) => ({
          breadth_bucket: cell.breadthBucket, depth_bucket: cell.depthBucket,
          building_count: cell.buildingCount, share: cell.buildingCount / grid.totalBuildings,
      })) } : null,
    },
  }
}

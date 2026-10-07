import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TerritoireView from '../views/TerritoireView.vue'
import GraphiqueDistributionMobilite from '../components/fiche/GraphiqueDistributionMobilite.vue'
import GraphiqueQuadrantMilieux from '../components/fiche/GraphiqueQuadrantMilieux.vue'
import FigureTrajectoire from '../components/fiche/FigureTrajectoire.vue'
import PuceRang from '../components/fiche/PuceRang.vue'
import { varianteDeUrl } from '../fiche/prototype/variantes'
import { histoiresDemographieNuage } from '../payload/themeFactsAdapter'
import {
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '../payload/fixtures'
import type { Histoire, Indicateur, Theme } from '../payload/types'
import {
  chargerModeleTerritoire,
  TERRITORY_READ_MODEL_CHARGER_KEY,
  validerModeleTerritoire,
} from '../payload/territoryReadModel'
import type { ChargerModeleTerritoire } from '../payload/territoryReadModel'
import { PayloadError } from '../payload/validate'
import { payloadDepuisModeleTerritoire } from '../payload/territoryReadModel'
import { territoryFactsFor } from '../fiche/content/territoryFacts'
import { directionIndicateur } from '../fiche/figureGrammaire'
import { routes } from '../router'

const indicateurs: Indicateur[] = [
  ...indicateursProgrammesFixture,
  ...indicateursDemographieFixture,
  ...indicateursHabitatFixture,
]
const histoires: Histoire[] = [...histoiresDemographieFixture, ...histoiresHabitatFixture]

const modelePublie22001 = JSON.parse(readFileSync(
  resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/22001.json'),
  'utf8',
)) as Record<string, any>

function modeleAvecContextesComparaison() {
  const model = structuredClone(modelePublie22001)
  const validated = validerModeleTerritoire(
    model,
    'territoires/commune/22001.json',
    { type: 'commune', territoire: '22001' },
  )
  validated.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
  return validated
}

function reponseAccesApi(type: string, code: string, kind: string | null, label?: string) {
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

function reponseThemeMobiliteApi(model: any, type: string, code: string, kind: string | null, label?: string, withDensity = false) {
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
    ...(withDensity ? { density_distribution: { status: 'measured',
      range: { minimum: 20, maximum: 47, status: 'measured' },
      points: Array.from({ length: 10 }, (_, ordinal) => ({ ordinal,
        density: ordinal === 0 ? 0.006 : 0.01, density_status: 'measured',
        decile: 20 + ordinal, decile_status: 'measured' })) } } : {}),
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

/** Projette le thème Habitat publié dans le contrat réel theme-facts-v1 servi par
 * le POST sélectionné (#627) — scalaires, cellules de profil et points de série
 * possédée en lignes d'indicateurs dimensionnées — en remplaçant trois valeurs
 * par des valeurs distinctes du modèle statique pour prouver la consommation. */
export function reponseThemeHabitatApi(model: any, type = 'commune', code = '35238') {
  const theme = model.themes.habitat
  const payload = payloadDepuisModeleTerritoire(model)
  const target = payload.territoires.find((item: any) => item.territoire === code)
  const rows: any[] = theme.indicators.filter((row: any) => row.territoire === code)
  const sources = () => [{
    source_id: 'habitat_api', name: 'Source API habitat', vintage_id: 'api-v1', version: 'api-v1',
    reference_date: null, publication_date: null,
  }]
  const indicatorSql = (row: any) => ({
    indicator_id: row.key, label: row.key, unit: row.unit,
    value: row.key === 'part_passoires' ? 0.42
      : row.key === 'prix_m2' && row.detail === '2025' ? 4242 : row.value,
    // Les millésimes supprimés (ventes < 10) restent déclarés et manquants.
    status: row.key === 'part_passoires' || (row.key === 'prix_m2' && row.detail === '2025')
      ? 'measured'
      : row.value === null ? 'suppressed' : 'measured',
    dimensions: row.key === 'prix_m2' && row.detail
      ? { axis: row.detail }
      : row.detail ? { detail: row.detail } : {},
    sources: sources(),
  })
  const prixFaits = rows.filter((row) => row.key === 'prix_m2' && row.detail)
  // La serie annuelle prix_m2 est servie comme owned_series (le contrat reel :
  // cf. test_theme_facts_habitat_http.py) - les lignes annuelles ne figurent
  // PAS dans indicators, seule la valeur poolee y reste.
  const seriePrix = {
    indicator_id: 'prix_m2', theme_id: 'habitat', unit: '€/m²',
    axis_kind: 'year', axis_values: prixFaits.map((row) => row.detail),
    points: prixFaits.map((row) => ({
      axis: row.detail, observation_period: row.detail,
      value: row.detail === '2025' ? 4242 : row.value === null ? null : row.value,
      status: row.detail === '2025' ? 'measured' : row.value === null ? 'not_available' : 'measured',
      missing_reason: row.value === null && row.detail !== '2025' ? 'ventes insuffisantes' : null,
      provenance: [{ source_id: 'habitat_api', source_name: 'Source API habitat',
        version: 'api-v1', reference_date: null, publication_date: null }],
    })),
  }
  const histoire = theme.histories.find((row: any) => row.territoire === code)
  return {
    contract: 'theme-facts-v1', complete_theme: false, theme_id: 'habitat',
    territory: { territory_id: code, name: target?.nom, territory_type: type },
    content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
    profile_content_version: 'habitat-profile-v1', reading_content_version: 'habitat-reading-v1',
    reading_descriptor_version: 'habitat-reading-v1', reading_availability: 'available',
    owned_series_content_versions: ['dvf_prix_m2@series-v1'],
    indicator_metadata: ['mix_logements', 'statut', 'type', 'age_du_bati', 'distribution_dpe']
      .map((key) => ({
        indicator_id: key, kind: 'declared_dimensions', label: key, unit: '%',
        descriptor_version: 'v1', allowed_levels: ['commune'],
        axes: [...new Set(rows.filter((row) => row.key === key && row.detail).map((row) => row.detail))]
          .map((detail) => ({ name: 'detail', key: detail })),
        comparison_point: null, comparison_scalar: null,
      })),
    named_reference_evidence: [], bpe_profile_evidence: null, collections: [],
    indicators: rows.filter((row) => !(row.key === 'prix_m2' && row.detail)).map(indicatorSql),
    owned_series: [seriePrix],
    readings: [{
      groupe: histoire.groupe, story_key: histoire.story_key, salience_reason: histoire.salience_reason,
      classification: 'parc-performant', part_passoires: 0.42, part_abc: 0.62, n_dpe: histoire.n_dpe,
      status: 'measured', source_id: 'habitat_api', vintage_id: 'api-v1',
      provenance: { source_id: 'habitat_api', source_name: 'Source API habitat', vintage_id: 'api-v1',
        source_version: 'api-v1', source_reference_date: null, source_publication_date: null },
    }],
    comparison: {
      contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'habitat',
      content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
      selection: null, scope: { kind: 'density_class', density_class_code: 'C', territory_type: 'commune', member_count: 14 },
      results: [{ indicator_id: 'part_passoires', label: 'part_passoires', unit: '%', direction: 'low',
        statistic: 'median', status: 'available', reason: null, selected_member_count: 14,
        eligible_count: 14, missing_count: 0, median: 0.21, rank: 3, rank_size: 14, comparison_sources: [] }],
      profile_comparisons: [], reading_content_version: 'habitat-reading-v1', reading_cloud: null,
    },
  }
}

export function reponseThemeProgrammesApi(type = 'commune', code = '22001') {
  const source = [{ source_id: 'programme-api', name: 'Source API programmes', vintage_id: 'programme-v1',
    version: 'programme-v1', reference_date: '2026-01-01', publication_date: '2026-02-01' }]
  return {
    contract: 'theme-facts-v1', complete_theme: false, theme_id: 'programmes',
    territory: { territory_id: code, territory_type: type, name: 'Territoire API' },
    content_version: 'programmes-v1', reference_content_version: 'territories-v1',
    indicators: [], indicator_metadata: [], named_reference_evidence: [], readings: [],
    collections: [
      { indicator_id: 'programme_membership', theme_id: 'programmes', kind: 'anchored_membership',
        completeness: 'observed_sparse', availability: 'observed',
        entries: [{ detail: 'ACV', label: 'Action Cœur de Ville', rider: 'Aid rider', sources: source }],
        relationships: [{ detail: 'CRTE', label: 'Contrat', rider: null, sources: source,
          anchor: { id: '222222222', type: 'epci', name: 'EPCI API' }, relation: 'covering_parent' }], summaries: [] },
      { indicator_id: 'subventions_par_domaine', theme_id: 'programmes', kind: 'period_detail',
        unit: '€', availability: 'observed', entries: [{ detail: 'mobilite', label: 'Mobilité API',
          observation_period: '2025', value: 9876, status: 'measured', sources: source }], relationships: [] },
    ],
    owned_series: [{ indicator_id: 'subventions_annuelles', theme_id: 'programmes', unit: '€',
      points: [{ axis: '2025', observation_period: '2025', value: 45678, status: 'measured', provenance: source }] }],
    comparison: { contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'programmes',
      content_version: 'programmes-v1', reference_content_version: 'territories-v1', selection: null,
      scope: null, results: [], profile_comparisons: [],
      collection_content_versions: { programme_membership: 'membership-v1' } },
  }
}
function reponseThemeDemographieApi(model: any, type = 'commune', code = '22001', rates = [1.25, -0.75]) {
  const theme = model.themes.demographie
  const indicators = theme.indicators.filter((row: any) => row.territoire === code)
  const reading = theme.histories.find((row: any) => row.territoire === code)
  const source = { source_id: 'demo_api', name: 'Source API démographie', version: '2026', reference_date: null, publication_date: null }
  const comparison = { contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'demographie',
    content_version: 'demo-v1', reference_content_version: 'territories-v1', selection: null,
    scope: { kind: 'density_class', member_count: 1 }, results: [], profile_comparisons: [],
    reading_content_version: 'demo-v1', reading_cloud: { status: 'available', reason: null,
      groupe: reading.groupe, story_key: 'trajectoire-demographique', scope: { kind: 'density_class' }, rate_unit: '‰',
      source, content_version: 'demo-v1', points: [{ territory: { territory_id: '22002', territory_type: 'commune', name: 'Peer Demo' },
        periode: '2020', taux_solde_naturel: rates[0], taux_solde_migratoire: rates[1] }] } }
  return { contract: 'theme-facts-v1', complete_theme: false, theme_id: 'demographie',
    content_version: 'demo-v1', reference_content_version: 'territories-v1', reading_content_version: 'demo-v1',
    territory: { territory_id: code, territory_type: type }, indicator_metadata: [...new Set(indicators.map((row: any) => row.key))].map((key) => ({
      indicator_id: key, axes: key === 'structure_age' ? [
        ...[...new Set(indicators.filter((row: any) => row.key === key).map((row: any) => row.detail))].map((value) => ({ name: 'detail', key: value })),
        ...[...new Set(indicators.filter((row: any) => row.key === key).map((row: any) => row.sex))].map((value) => ({ name: 'sex', key: value })),
      ] : [],
    })), named_reference_evidence: [],
    indicators: indicators.map((row: any) => ({ indicator_id: row.key, label: row.key, unit: row.unit,
      value: row.key === 'densite' ? 4321 : row.value, status: row.value === null ? 'suppressed' : 'measured',
      dimensions: row.detail ? { detail: row.detail, ...(row.sex ? { sex: row.sex } : {}) } : {}, sources: [source] })),
    readings: [{ groupe: reading.groupe, story_key: 'trajectoire-demographique', salience_reason: 'defaut',
      periode: '2020', solde_naturel: reading.solde_naturel, solde_migratoire: reading.solde_migratoire,
      taux_solde_naturel: 0.5, taux_solde_migratoire: -0.25, classification: reading.classification,
      status: 'measured', rate_unit: '‰', provenance: { source_id: 'demo_api', source_name: source.name,
        source_version: source.version, source_reference_date: null, source_publication_date: null } }], comparison }
}

/** Sert les POST faits/comparaison Mobilité comme la fiche montée les consomme :
 * faits complets sur /facts, comparaison sélectionnée répercutée sur /comparison. */
export function stubApiThemeMobilite(model: any, type = 'commune', code = '22001') {
  const contexts = model.themes.mobilite!.comparisons
  return vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/facts')) {
      return { ok: true, json: async () =>
        reponseThemeMobiliteApi(model, type, code, contexts.densite!.scope.kind, contexts.densite!.scope.label) }
    }
    if (url.endsWith('/comparison')) {
      const selection = JSON.parse(String(options?.body)).selection as { territory_type: string; territory_id: string }[]
      return { ok: true, json: async () => ({
        contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'mobilite',
        selection,
        scope: { kind: 'explicit_selection', member_count: selection.length },
        results: ['admin', 'food', 'health', 'bank', 'school'].flatMap((service) =>
          ['c', 'b', 't'].map((mode) => ({ indicator_id: `share_${service}_${mode}`,
            status: 'available', direction: 'high', median: 0.3, rank: 19, rank_size: 38 }))),
        profile_comparisons: [], building_access: null,
      }) }
    }
    throw new Error(`Requête inattendue : ${url}`)
  })
}

function reponseThemeMilieuxApi(model: any, type = 'commune', code = '22001', peerId?: string) {
  const theme = model.themes.milieux
  const history = theme.histories.find((row: any) => row.territoire === code)
  const indicators = theme.indicators.filter((row: any) => row.territoire === code)
  const peer = peerId ?? model.cohortTerritories?.find((item: any) => item.type === 'commune' &&
    item.epci === model.territory.epci && item.territoire !== code)?.territoire ?? '22002'
  const source = { source_id: 'milieux_api', name: 'Source API milieux', version: '2026', reference_date: null, publication_date: null }
  const comparison = { contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'milieux',
    content_version: 'milieux-v1', reference_content_version: 'territories-v1', reading_content_version: 'milieux-v1',
    selection: null, scope: { kind: 'density_class', member_count: 1 }, results: [], profile_comparisons: [],
    reading_cloud: { status: 'available', reason: null, groupe: history.groupe,
      scope: { kind: 'density_class' }, selected_member_count: 1, plotted_member_count: 1,
      points: [{ territory: { territory_id: peer, territory_type: 'commune', name: 'Peer Milieux' },
        periode_pop: '2017-2023', periode_artif: '2021-2025', taux_variation_population: 2.75,
        artif_m2_par_habitant: 100, artif_m3_par_habitant: 125 }] } }
  return { contract: 'theme-facts-v1', complete_theme: false, theme_id: 'milieux',
    content_version: 'milieux-v1', reference_content_version: 'territories-v1', reading_content_version: 'milieux-v1',
    territory: { territory_id: code, territory_type: type }, indicator_metadata: [], named_reference_evidence: [],
    indicators: indicators.map((row: any) => ({ indicator_id: row.key, label: row.key, unit: row.unit,
      value: row.key === 'artif_par_habitant' && row.detail === 'M3' ? 777 : row.value,
      status: row.value === null ? 'unavailable' : 'measured', dimensions: row.detail ? { axis: row.detail } : {}, sources: [source] })),
    readings: [{ groupe: history.groupe, story_key: history.story_key, salience_reason: history.salience_reason,
      periode_pop: history.periode_pop, periode_artif: history.periode_artif,
      delta_population: history.delta_population, taux_variation_population: 2.75,
      artif_m2_par_habitant: history.artif_m2_par_habitant, artif_m3_par_habitant: history.artif_m3_par_habitant,
      trajectoire_artif_par_habitant: history.trajectoire_artif_par_habitant, classification: 'grandir-en-se-densifiant',
      status: 'measured', provenance: { source_id: source.source_id, source_name: source.name,
        source_version: source.version, source_reference_date: null, source_publication_date: null } }], comparison }
}

function modeleMilieux() {
  const model = modeleAvecContextesComparaison()
  model.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
  return model
}

export function reponseThemeEconomieApi(model: any, type = 'commune', code = '22001') {
  const theme = model.themes.economie; const h = theme.histories.find((x: any) => x.territoire === code)
  const source = { source_id: 'economy_api', name: 'Source API économie', version: 'api-v1', reference_date: null, publication_date: null }
  const activities = [1].flatMap(rank => h?.[`top${rank}_activity_label`] ? [{rank,activity_code:h[`top${rank}_activity_code`],activity_label:'Activité API distinctive',lq:99.25,n:h[`top${rank}_n`],part_parc:h[`top${rank}_part_parc`]}] : [])
  return { contract:'theme-facts-v1', complete_theme:false, theme_id:'economie', content_version:'economie-api-v1', reference_content_version:'territories-v1', reading_content_version:'economie-api-v1', territory:{territory_id:code,territory_type:type}, indicator_metadata:[], named_reference_evidence:[], indicators:theme.indicators.filter((x:any)=>x.territoire===code&&['chomage','effectifs_salaries','eco_activites'].includes(x.key)).map((x:any)=>({indicator_id:x.key,label:x.label,unit:x.unit,value:x.key==='chomage'?0.2345:x.value,status:'measured',dimensions:{},sources:[source]})), readings:h?[{groupe:h.groupe,story_key:h.story_key,salience_reason:h.salience_reason,status:'measured',activities,provenance:{source_id:source.source_id,source_name:source.name,source_version:source.version,source_reference_date:null,source_publication_date:null}}]:[], comparison:{contract:'theme-comparison-v1',theme_id:'economie',content_version:'economie-api-v1',reference_content_version:'territories-v1',reading_content_version:'economie-api-v1',selection:null,scope:{kind:'density_class'},results:[],profile_comparisons:[]} }
}

function modelFor(territoire: string) {
  const target = territoiresFixture.find((candidate) => candidate.territoire === territoire)!
  const themes = Object.fromEntries(
    (['programmes', 'demographie', 'habitat'] as Theme[]).map((theme) => [theme, {
      theme,
      indicateurs: indicateurs.filter((row) => row.theme === theme),
      histoires: histoires.filter((row) => row.theme === theme),
      theme_metadata: metadonneesThemesFixtures[theme],
      profils_acces_bpe: null,
      distribution_acces_batiments: null,
      rampe_acces_batiments: null,
    }]),
  )
  return validerModeleTerritoire({
    schema_version: '1',
    snapshot_id: '2026-09-15',
    territory: target,
    territoires: territoiresFixture,
    themes,
  }, `territoires/${target.type}/${territoire}.json`, {
    type: target.type,
    territoire,
  })
}

async function monter(
  chemin: string,
  charger: ChargerModeleTerritoire = vi.fn(async (_type, territoire) => modelFor(territoire)),
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(TerritoireView, {
    global: {
      plugins: [router],
      provide: { [TERRITORY_READ_MODEL_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return { router, wrapper, charger }
}

describe('TerritoireView — modèle atomique par territoire', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('API not configured in tests'))))
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  it.skipIf(!process.env.LUSK_MOUNTED_E_HTTP_FIXTURE)('consumes real PostgreSQL HTTP responses in mounted E', async () => {
    const evidence = JSON.parse(readFileSync(process.env.LUSK_MOUNTED_E_HTTP_FIXTURE!, 'utf8'))
    const model = validerModeleTerritoire(evidence.model, 'gate/22001.json', { type: 'commune', territoire: '22001' })
    model.cohortTerritories = evidence.cohort
    // The companion Python test executes the real HTTP reads while its SQL schema is live.
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/facts')) return { ok: true, json: async () => evidence.focal }
      if (url.endsWith('/comparison')) {
        expect(JSON.parse(String(options?.body)).selection).toEqual(evidence.comparison.selection)
        return { ok: true, json: async () => evidence.comparison }
      }
      throw new Error(`Not a product-data request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E', vi.fn(async () => model))
    const rendered = () => wrapper.findComponent({ name: 'VarianteCahierLibre' }).props('content') as any
    const section = (key: string) => rendered().units.flatMap((unit: any) => unit.sections).find((item: any) => item.key === key)
    expect(wrapper.find('[data-section="distribution-acces-par-batiment"] .bivariate-evidence').exists()).toBe(true)
    expect(wrapper.text()).toContain('SQL gate breadth')
    expect(JSON.stringify(section('reseaux'))).toContain('456')
    expect(JSON.stringify(section('offre-cyclable'))).toContain('456')
    expect(JSON.stringify(section('stationnement'))).toContain('123')
    expect(section('stationnement').evidence.carSpaces.fact.value).toBeNull()
    expect(section('stationnement').evidence.carSpaces.fact.availability).toBe('incomplete')
    expect(JSON.stringify(section('profils-acces-par-mode'))).toContain('SQL vélo class')
    expect(section('services-essentiels').evidence.totalBuildings.fact.value).toBe(120)
    expect(section('services-essentiels').evidence.totalBrittanyBuildings.fact.value).toBe(9876)
    expect(section('resume').evidence.losses.diversity.walkTransit.fact.value).toBe(8)
    expect(section('resume').evidence.losses.diversity.bike.fact.value).toBe(7)
    expect(rendered().sourceRegister.some((source: any) => JSON.stringify(source).includes('SQL gate source'))).toBe(true)
    expect(rendered().sourceRegister.filter((source: any) => source.source === 'SQL gate source')
      .every((source: any) => source.referenceDate === null && source.publicationDate === null)).toBe(true)
    const focalFigures = wrapper.findAll('.access-foot-summary').map((figure) => figure.text())
    expect(focalFigures).toHaveLength(5)
    expect(focalFigures.every((text) => text.includes('42'))).toBe(true)
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/facts'))).toHaveLength(1)
    await router.replace({ query: { theme: 'mobilite', variant: 'E', comparaison: 'epci' } })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/comparison'))).toHaveLength(1)
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/facts'))).toHaveLength(1)
    expect(wrapper.findAll('.access-foot-summary').map((figure) => figure.text())).toEqual(focalFigures)
    await router.replace({ query: { theme: 'habitat', variant: 'E', comparaison: 'epci' } })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => url.includes('/api/'))).toHaveLength(2)
    wrapper.unmount()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: evidence.unavailable_status,
      json: async () => evidence.unavailable })))
    const { wrapper: failed } = await monter('/territoire/commune/22001?theme=mobilite&variant=E', vi.fn(async () => model))
    expect(failed.find('[data-section="distribution-acces-par-batiment"] .bivariate-evidence').exists()).toBe(false)
    expect(failed.findAll('.access-figure')).toHaveLength(0)
    expect(failed.find('[role="alert"]').exists()).toBe(true)
    failed.unmount()
  })
  it('keeps the building figures without exposing an interactive peer selector', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E',
      vi.fn(async () => modeleAvecContextesComparaison()))
    await flushPromises()
    expect(wrapper.find('#building-peer-search').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Choisir les territoires du groupe comparé')
    wrapper.unmount()
  })
  it('requests the assembled Mobility product once and never displays static JSON figures when the API fails', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const fetchApi = vi.fn().mockRejectedValue(new Error('API indisponible'))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E',
      vi.fn(async () => modeleAvecContextesComparaison()))
    await flushPromises()
    expect(fetchApi.mock.calls.some(([url]) => String(url) ===
      '/api/territories/commune/22001/themes/mobilite/facts')).toBe(true)
    const section = wrapper.get('[data-section="distribution-acces-par-batiment"]')
    expect(section.find('.access-ramp-evidence').exists()).toBe(false)
    expect(section.find('.bivariate-evidence').exists()).toBe(false)
    expect(section.get('[role="alert"]').text()).toContain('Impossible de charger')
    await section.get('button').trigger('click')
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).includes('/themes/mobilite/facts'))).toHaveLength(2)
    wrapper.unmount()
  })
  it('renders both initial building figures from the API with the default mean label', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const model = modeleAvecContextesComparaison()
    const context = model.themes.mobilite!.comparisons.densite!
    const initial = territoryFactsFor(payloadDepuisModeleTerritoire(model), '22001', context)!
    const ramp = initial.mobility.accessRamp!
    const grid = initial.mobility.buildingDistribution!
    const displayModes = { c: 'car', b: 'bike', t: 'walkTransit' } as const
    const figure = {
      publication_id: 'building-v1', availability: 'complete', territory: { id: '22001', type: 'commune' },
      scope: { comparison_mode: 'densite', kind: context.scope.kind, label: context.scope.label },
      ramp: (['c', 'b', 't'] as const).flatMap((mode) =>
        ramp.curves[displayModes[mode]].points.map((p, quantile_index) => ({
          mode, quantile_index, quantile: quantile_index / 10, accessible_types: p.accessibleTypes + 1,
          total_buildings: ramp.totalBuildings,
        }))),
      peer_ramp: { statistic: 'mean', member_count: 2, total_buildings: grid.totalBuildings,
        points: (['c', 'b', 't'] as const).flatMap((mode) =>
          ramp.curves[displayModes[mode]].points.map((p, index) => ({
            mode, quantile: index / 10, accessible_types: p.accessibleTypes + 2,
          }))) },
      distribution: grid.cells.map((cell) => ({ breadth_bucket: cell.breadthBucket,
        depth_bucket: cell.depthBucket, building_count: cell.buildingCount, share: cell.share,
        total_buildings: grid.totalBuildings })),
      peer_distribution: { statistic: 'mean', member_count: 2, total_buildings: grid.totalBuildings,
        cells: grid.cells.map((cell) => ({ breadth_bucket: cell.breadthBucket,
          depth_bucket: cell.depthBucket, building_count: cell.buildingCount,
          share: cell.buildingCount / grid.totalBuildings })) },
    }
    const assembled = reponseThemeMobiliteApi(model, 'commune', '22001', context.scope.kind, context.scope.label)
    assembled.building_access = { ...assembled.building_access, ...figure }
    assembled.building_access.presentation.building_grid.breadth_axis_label = 'Axe fourni par le producteur'
    const fetchApi = vi.fn(async () => ({ ok: true, json: async () => assembled }))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E', vi.fn(async () => model))
    await flushPromises()
    const section = wrapper.get('[data-section="distribution-acces-par-batiment"]')
    expect(section.find('.access-ramp-evidence').exists()).toBe(true)
    expect(section.find('.bivariate-evidence').exists()).toBe(true)
    expect(section.text()).toContain('Axe fourni par le producteur')
    expect(section.text()).toContain('moyenne des')
    expect(section.text()).not.toContain('territoires sélectionnés')
    wrapper.unmount()
  })
  it.each([
    ['epci', '242200715'], ['departement', '22'], ['region', '53'],
  ] as const)('requests initial %s Mobility facts without a static fallback', async (type, code) => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      `../public/data/modeles-lecture/territoires/${type}/${code}.json`), 'utf8'))
    const model = validerModeleTerritoire(published, `${type}/${code}.json`, { type, territoire: code })
    const fetchApi = vi.fn().mockRejectedValue(new Error('API indisponible'))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter(`/territoire/${type}/${code}?theme=mobilite&variant=E`, vi.fn(async () => model))
    expect(fetchApi.mock.calls.some(([url]) => String(url) ===
      `/api/territories/${type}/${code}/themes/mobilite/facts`)).toBe(true)
    const section = wrapper.get('[data-section="distribution-acces-par-batiment"]')
    expect(section.find('.access-ramp-evidence').exists()).toBe(false)
    expect(section.find('.bivariate-evidence').exists()).toBe(false)
    expect(section.get('[role="alert"]').text()).toContain('Impossible de charger')
    wrapper.unmount()
  })
  it('alimente les anneaux Variant E depuis l’API sans changer les autres sections', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const scope = modeleAvecContextesComparaison().themes.mobilite!.comparisons.densite!.scope
    const model = modeleAvecContextesComparaison()
    const fetchApi = vi.fn(async (_url: string, _options?: RequestInit) => ({ ok: true, json: async () =>
      reponseThemeMobiliteApi(model, 'commune', '22001', scope.kind, scope.label) }))
    vi.stubGlobal('fetch', fetchApi)
    try {
      const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E',
        vi.fn(async () => modeleAvecContextesComparaison()))
      await flushPromises()
      expect(fetchApi.mock.calls.filter(([url]) => String(url).includes('/themes/mobilite/facts'))).toHaveLength(1)
      expect(fetchApi).toHaveBeenCalledWith('/api/territories/commune/22001/themes/mobilite/facts', expect.anything())
      expect(wrapper.findAll('[data-section="services-essentiels"] .access-foot-summary')[0]?.text()).toContain('42')
      expect(wrapper.get('[data-section="services-essentiels"] .cahier-comparison-note').text()).toContain(scope.label)
      expect(wrapper.text()).toContain('Source API · api-v1')
      expect(wrapper.find('[data-section="resume"]').exists()).toBe(true)
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ne déclenche pas le fan-out scalaire avec un registre Mobilité actif sur la variante E', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const catalogue = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const model = modeleAvecContextesComparaison()
    model.themes.mobilite!.metadata.scalar_contracts = catalogue.scalar_contracts
    model.themes.mobilite!.metadata.indicator_pages = catalogue.indicator_pages
    model.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const baseFetch = stubApiThemeMobilite(model)
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/indicator-cohorts/')) throw new Error('cohort fan-out must not fire on the E path')
      return baseFetch(url, options)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E', vi.fn(async () => model))
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/themes/mobilite/facts'))).toHaveLength(1)
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/comparison'))).toHaveLength(0)
    await router.replace({ query: { theme: 'mobilite', variant: 'E', comparaison: 'epci' } })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/themes/mobilite/facts'))).toHaveLength(1)
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/comparison'))).toHaveLength(1)
    expect(fetchApi.mock.calls.some(([url]) => url.includes('/indicator-cohorts/'))).toBe(false)
    expect(wrapper.findAll('[data-section="services-essentiels"] .access-foot-summary')).toHaveLength(5)
    wrapper.unmount()
  })

  it('n’affiche jamais les anneaux statiques si l’API échoue, et réessaie', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const scope = modeleAvecContextesComparaison().themes.mobilite!.comparisons.epci!.scope
    let accessCalls = 0
    const model = modeleAvecContextesComparaison()
    const fetchApi = vi.fn((_url: string) => ++accessCalls === 1
        ? Promise.reject(new Error('API indisponible'))
        : Promise.resolve({ ok: true, json: async () => reponseThemeMobiliteApi(model, 'commune', '22001', scope.kind, scope.label) }))
    vi.stubGlobal('fetch', fetchApi)
    try {
      const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E&comparaison=epci',
        vi.fn(async () => modeleAvecContextesComparaison()))
      await flushPromises()
      const section = wrapper.get('[data-section="services-essentiels"]')
      expect(section.findAll('.access-figure')).toHaveLength(0)
      expect(section.get('[role="alert"]').text()).toContain('Impossible de charger')
      await section.get('button').trigger('click')
      await flushPromises()
      expect(section.findAll('.access-figure')).toHaveLength(5)
      expect(fetchApi.mock.calls.filter(([url]) => String(url).includes('/themes/mobilite/facts'))).toHaveLength(2)
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders registered scalar API values in the mounted fiche instead of the static model value', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const registered = Object.keys(metadata.scalar_contracts) as string[]
    const referenceTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    const peer = referenceTerritories.find((territory: any) => territory.type === 'commune' &&
      territory.epci === published.territory.epci && territory.territoire !== published.territory.territoire)
    expect(published.themes.mobilite.theme_metadata.scalar_contracts).toBeUndefined()
    const pending: Array<() => void> = []
    const requestedIndicators: string[] = []
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/modeles-lecture/territoires/commune/22001.json') return new Response(JSON.stringify(published), { status: 200 })
      if (url === '/data/territoires.json') return new Response(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'), { status: 200 })
      if (url.startsWith('/data/theme_') && url.endsWith('.json')) {
        const themeMetadata = url === '/data/theme_mobilite.json' ? metadata : JSON.parse(readFileSync(
          resolve(process.cwd(), `../public/data/${url.slice('/data/'.length)}`), 'utf8'))
        return new Response(JSON.stringify(themeMetadata), { status: 200 })
      }
      if (url.startsWith('/api/territories/commune/22001/indicator-cohorts/')) {
        const indicator = url.split('/').at(-1)!.split('?')[0]!
        requestedIndicators.push(indicator)
        const page = metadata.indicator_pages[indicator]
        const response = new Response(JSON.stringify({ indicator_id: indicator, territory_type: 'commune',
          label: page.label, unit: page.unit, direction: page.direction,
          comparison_facet: page.comparison?.indicator ?? indicator, completeness: 'sparse', content_version: 'fiche-v1',
          observations: [{ territory_id: '22001', name: published.territory.nom, value: 987654321, status: 'measured',
            rang_epci: 1, rang_epci_n: 38, rang_dep: 1, rang_dep_n: 50, rang_reg: 1, rang_reg_n: 100,
            sources: [{ source_id: page.sources[0], name: 'Source API fiche', vintage_id: 'api-v1', version: '2026',
              reference_date: null, publication_date: null }] },
          { territory_id: peer.territoire, name: peer.nom, value: 123, status: 'measured',
            rang_epci: 2, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
            sources: [{ source_id: page.sources[0], name: 'Source API fiche', vintage_id: 'api-v1', version: '2026',
              reference_date: null, publication_date: null }] }] }), { status: 200 })
        return new Promise<Response>((resolve) => pending.push(() => resolve(response)))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=A&comparaison=epci', chargerModeleTerritoire)
    expect(requestedIndicators).toEqual(registered)
    expect(pending).toHaveLength(registered.length)
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('987 654 321')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('0,92')
    pending.forEach((resolve) => resolve())
    await flushPromises()
    const text = wrapper.get('[role="tabpanel"]').text()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).includes('/indicator-cohorts/'))).toHaveLength(registered.length)
    expect(fetchApi).toHaveBeenCalledWith('/data/theme_mobilite.json')
    const cohortUrls = fetchApi.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'))
      .filter((url) => url.pathname.includes('/indicator-cohorts/'))
    expect(cohortUrls.every((url) => url.searchParams.get('epci_id') === published.territory.epci &&
      !url.searchParams.has('department_id'))).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(text).toContain('987')
    expect(text).toContain('98 765 432')
    expect(text).not.toContain('0,92')
    wrapper.unmount()
  })

  it('Habitat scalar cohort replaces only the scalar page and preserves the price trajectory', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_habitat.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/35238.json'), 'utf8'))
    const page = metadata.indicator_pages.part_passoires
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/theme_habitat.json') return new Response(JSON.stringify(metadata), { status: 200 })
      if (url !== '/api/territories/commune/35238/indicator-cohorts/part_passoires?scope_level=commune') {
        throw new Error(`Unexpected request: ${url}`)
      }
      return new Response(JSON.stringify({ indicator_id: 'part_passoires', territory_type: 'commune',
        label: page.label, unit: page.unit, direction: page.direction,
        comparison_facet: page.comparison?.indicator ?? 'part_passoires', completeness: 'sparse',
        content_version: 'habitat-fiche-v1', territory_reference_version: 'territories-v1',
        observations: [{ territory_id: '35238', name: published.territory.nom, value: 0.123, status: 'measured',
          rang_epci: 1, rang_epci_n: 43, rang_dep: 1, rang_dep_n: 333, rang_reg: 1, rang_reg_n: 1200,
          sources: [{ source_id: page.sources[0], name: 'ADEME — Observatoire DPE, logements existants',
            vintage_id: '2026-08-11/NA', version: '2026-08-11', reference_date: null,
            publication_date: '2026-08-11' }] }] }), { status: 200 })
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    published.themes.habitat.theme_metadata.scalar_contracts = metadata.scalar_contracts
    published.themes.habitat.theme_metadata.indicator_pages = metadata.indicator_pages
    const model = validerModeleTerritoire(published, 'territoires/commune/35238.json',
      { type: 'commune', territoire: '35238' })
    model.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const { wrapper } = await monter('/territoire/commune/35238?theme=habitat', vi.fn(async () => model))
    await flushPromises()
    const cohortUrls = fetchApi.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/indicator-cohorts/'))
    expect(cohortUrls.some((url) => url.includes('/part_passoires'))).toBe(true)
    expect(cohortUrls.some((url) => url.includes('/prix_m2'))).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const habitatText = wrapper.get('[role="tabpanel"]').text()
    expect(habitatText).toContain('12%Part de passoires thermiques')
    expect(habitatText).toContain('Médiane prix au m²')
    expect(habitatText).toContain('3 777,78 €/m²')
    wrapper.unmount()
  })

  it('acquiert Habitat par la seule requête de faits du thème actif quand l’API d’acquisition est activée', async () => {
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/35238.json'), 'utf8'))
    const model = validerModeleTerritoire(published, 'territoires/commune/35238.json',
      { type: 'commune', territoire: '35238' })
    model.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const fetchApi = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
      const url = String(input)
      if (url === '/api/territories/commune/35238/themes/habitat/facts') {
        return { ok: true, json: async () => reponseThemeHabitatApi(model, 'commune', '35238') }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/35238?theme=habitat', vi.fn(async () => model))
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/habitat/facts'))).toHaveLength(1)
    expect(JSON.parse(String(fetchApi.mock.calls[0]![1]!.body))).toEqual({ theme_id: 'habitat' })
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(true)
    const text = wrapper.get('[role="tabpanel"]').text()
    expect(text).toContain('42%Part de passoires thermiques')
    expect(text).toContain('Source API habitat')
    expect(text).toContain('performant')
    expect(text).toContain('4 242')
    expect(text).not.toContain('3 777,78')
    expect(text).not.toContain('intermédiaire')
    // La trajectoire prix_m2 rend depuis la SERIE servie (owned_series), pas
    // depuis des lignes annuelles d'indicators : le contrat réel épinglé par
    // test_theme_facts_habitat_http.py.
    const trajectoire = wrapper.findAllComponents(FigureTrajectoire)
      .find((figure) => figure.props('clef') === 'prix_m2')
    expect(trajectoire, 'la figure trajectoire prix_m2 rend depuis la série servie').toBeDefined()
    const lignesPrix = trajectoire!.props('lignes') as Indicateur[]
    expect(lignesPrix.some((ligne) => ligne.detail === '2025' && ligne.value === 4242)).toBe(true)
    expect(lignesPrix.filter((ligne) => ligne.detail !== null).length).toBeGreaterThanOrEqual(2)
    wrapper.unmount()
  })

  it('réchauffe les autres thèmes après Programmes et revisite Habitat sans nouvelle requête', async () => {
    const model = modelFor('22001')
    const programmes = reponseThemeProgrammesApi()
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/themes/programmes/facts')) return { ok: true, json: async () => programmes }
      if (url === '/api/territories/commune/22001/themes/habitat/facts') {
        return { ok: true, json: async () => reponseThemeHabitatApi(model, 'commune', '22001') }
      }
      if (url === '/api/territories/commune/22001/themes/demographie/facts') {
        return { ok: true, json: async () => reponseThemeDemographieApi(model, 'commune', '22001') }
      }
      const theme = url.match(/\/themes\/([^/]+)\/facts$/)?.[1]
      if (theme) return { ok: true, json: async () => ({ ...reponseThemeProgrammesApi(), theme_id: theme,
        indicators: [], readings: [], comparison: { contract: 'theme-comparison-v1', theme_id: theme,
          content_version: 'v1', reference_content_version: 'v1', selection: null, results: [], profile_comparisons: [] } }) }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))
    await flushPromises()
    // Le POST actif est prioritaire puis le registre complet est réchauffé.
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/programmes/facts'))).toHaveLength(1)
    expect(String(fetchApi.mock.calls[0]![0])).toContain('/themes/programmes/facts')
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/facts'))).toHaveLength(6)
    await router.replace({ query: { theme: 'habitat' } })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/habitat/facts'))).toHaveLength(1)
    // Démographie acquiert désormais ses faits à la sélection explicite.
    await router.replace({ query: { theme: 'demographie' } })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/demographie/facts'))).toHaveLength(1)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Densité de population')
    // Revisite du thème acquis : le cache détient l'entrée, aucune nouvelle requête.
    await router.replace({ query: { theme: 'habitat' } })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/facts'))).toHaveLength(6)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('42%Part de passoires thermiques')
    wrapper.unmount()
  })

  it('n’expose aucun numérique statique du thème migré pendant que les faits API pendent', async () => {
    const model = modelFor('22001')
    let resoudreFaits: ((value: unknown) => void) | undefined
    const requeteFacts = new Promise((resolve) => { resoudreFaits = resolve })
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/territories/commune/22001/themes/habitat/facts') return requeteFacts
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat', vi.fn(async () => model))
    await flushPromises()
    const pendant = wrapper.get('[role="tabpanel"]').text()
    expect(pendant).not.toContain('13%Part de passoires thermiques')
    expect(pendant).not.toContain('2 450')
    resoudreFaits?.({ ok: true, json: async () => reponseThemeHabitatApi(model, 'commune', '22001') })
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('42%Part de passoires thermiques')
    wrapper.unmount()
  })

  it('échoue fermé sans repli statique, puis réessaie la requête de faits', async () => {
    const model = modelFor('22001')
    let echecs = 0
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/territories/commune/22001/themes/habitat/facts') {
        if (++echecs === 1) throw new Error('API indisponible')
        return { ok: true, json: async () => reponseThemeHabitatApi(model, 'commune', '22001') }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat', vi.fn(async () => model))
    await flushPromises()
    const alerte = wrapper.get('[role="alert"]')
    expect(alerte.text()).toContain('Les indicateurs de ce thème ne sont pas disponibles.')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('13%Part de passoires thermiques')
    await alerte.get('button').trigger('click')
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/habitat/facts'))).toHaveLength(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('42%Part de passoires thermiques')
    wrapper.unmount()
  })

  it('acquiert une seule comparaison par changement de sélection et garde les faits focaux', async () => {
    const model = modeleAvecContextesComparaison()
    const epciAttendu = model.cohortTerritories!.filter((item: any) =>
      item.type === 'commune' && item.epci === model.territory.epci)
      .map((item: any) => ({ territory_type: item.type, territory_id: item.territoire }))
    const bretagneAttendue = model.cohortTerritories!.filter((item: any) => item.type === 'commune')
      .map((item: any) => ({ territory_type: item.type, territory_id: item.territoire }))
    expect(epciAttendu.length).toBeGreaterThan(0)
    const fetchApi = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input)
      if (url === '/api/territories/commune/22001/themes/habitat/facts') {
        return { ok: true, json: async () => reponseThemeHabitatApi(model, 'commune', '22001') }
      }
      if (url === '/api/territories/commune/22001/themes/habitat/comparison') {
        const demandee = JSON.parse(String(options?.body)).selection as { territory_type: string; territory_id: string }[]
        return { ok: true, json: async () => ({
          contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'habitat',
          content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
          selection: demandee, scope: { kind: 'explicit_selection', member_count: demandee.length },
          results: [], profile_comparisons: [], reading_content_version: 'habitat-reading-v1', reading_cloud: null,
        }) }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=habitat', vi.fn(async () => model))
    await flushPromises()
    // Le défaut déclaré (densité) est servi par la comparaison imbriquée des faits.
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/comparison'))).toHaveLength(0)
    await router.replace({ query: { theme: 'habitat', comparaison: 'epci' } })
    await flushPromises()
    const comparaisons = fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/habitat/comparison'))
    expect(comparaisons).toHaveLength(1)
    expect(JSON.parse(String(comparaisons[0]![1]!.body))).toEqual({ theme_id: 'habitat', selection: epciAttendu })
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('42%Part de passoires thermiques')
    await router.replace({ query: { theme: 'habitat', comparaison: 'bretagne' } })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/habitat/comparison'))).toHaveLength(2)
    expect(JSON.parse(String(fetchApi.mock.calls.at(-1)![1]!.body))).toEqual({ theme_id: 'habitat', selection: bretagneAttendue })
    // Revisite de la comparaison déjà acquise : aucune nouvelle requête.
    await router.replace({ query: { theme: 'habitat', comparaison: 'epci' } })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/habitat/comparison'))).toHaveLength(2)
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/habitat/facts'))).toHaveLength(1)
    wrapper.unmount()
  })

  it('échoue fermé sur des tokens de comparaison incompatibles, puis réessaie', async () => {
    const model = modeleAvecContextesComparaison()
    let comparaisons = 0
    const fetchApi = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input)
      if (url === '/api/territories/commune/22001/themes/habitat/facts') {
        return { ok: true, json: async () => reponseThemeHabitatApi(model, 'commune', '22001') }
      }
      if (url === '/api/territories/commune/22001/themes/habitat/comparison') {
        comparaisons += 1
        const demandee = JSON.parse(String(options?.body)).selection as { territory_type: string; territory_id: string }[]
        return { ok: true, json: async () => ({
          contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'habitat',
          content_version: 'habitat-scalar-v1',
          reference_content_version: comparaisons === 1 ? 'jetons-périmés' : 'territories-v1',
          selection: demandee, scope: { kind: 'explicit_selection', member_count: demandee.length },
          results: [], profile_comparisons: [], reading_content_version: 'habitat-reading-v1', reading_cloud: null,
        }) }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat&comparaison=bretagne',
      vi.fn(async () => model))
    await flushPromises()
    const alerte = wrapper.get('[role="alert"]')
    expect(alerte.text()).toContain('Les comparaisons de ce thème ne sont pas disponibles.')
    // Échec fermé : les faits focaux restent rendus, aucun état partiel.
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('42%Part de passoires thermiques')
    await alerte.get('button').trigger('click')
    await flushPromises()
    expect(comparaisons).toBe(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('42%Part de passoires thermiques')
    wrapper.unmount()
  })

  it('ignore une réponse de comparaison périmée après un changement de sélection', async () => {
    const model = modeleAvecContextesComparaison()
    let resoudreEpici: ((value: unknown) => void) | undefined
    const requeteEpici = new Promise((resolve) => { resoudreEpici = resolve })
    const fetchApi = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input)
      if (url === '/api/territories/commune/22001/themes/habitat/facts') {
        return { ok: true, json: async () => reponseThemeHabitatApi(model, 'commune', '22001') }
      }
      if (url === '/api/territories/commune/22001/themes/habitat/comparison') {
        const demandee = JSON.parse(String(options?.body)).selection as { territory_type: string; territory_id: string }[]
        if (demandee.length > 100) return requeteEpici
        return { ok: true, json: async () => ({
          contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'habitat',
          content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
          selection: demandee, scope: { kind: 'explicit_selection', member_count: demandee.length },
          results: [], profile_comparisons: [], reading_content_version: 'habitat-reading-v1', reading_cloud: null,
        }) }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=habitat', vi.fn(async () => model))
    await router.replace({ query: { theme: 'habitat', comparaison: 'bretagne' } })
    await flushPromises()
    await router.replace({ query: { theme: 'habitat', comparaison: 'epci' } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('42%Part de passoires thermiques')
    // La réponse bretagne périmée arrive TARD avec un écho incohérent : rejetée,
    // aucun état ni bandeau corrompu.
    resoudreEpici?.({ ok: true, json: async () => ({
      contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'habitat',
      content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
      selection: [], scope: { kind: 'explicit_selection', member_count: 0 },
      results: [], profile_comparisons: [], reading_content_version: 'habitat-reading-v1', reading_cloud: null,
    }) })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/habitat/comparison'))).toHaveLength(2)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('42%Part de passoires thermiques')
    wrapper.unmount()
  })

  it('acquiert Programmes sur l’atterrissage par défaut, consomme les collections et réutilise le cache', async () => {
    const model = modeleAvecContextesComparaison()
    const programmes = reponseThemeProgrammesApi()
    const target = model.territories.find((item: any) => item.territoire === '22001')!
    const parent = model.territories.find((item: any) => item.territoire === target.epci)!
    programmes.owned_series[0]!.points[0]!.value = 71395030.98
    programmes.indicator_metadata = [{ indicator_id: 'subventions_annuelles', unit: '€', context: {
      parent: { id: target.epci, type: 'epci', name: parent.nom },
      points: [{ axis: '2025', observation_period: '2025', value: 91260697.91, status: 'measured', provenance: [
        { source_id: 'programme-api', source_name: 'Source API programmes', version: 'programme-v1', reference_date: '2026-01-01', publication_date: '2026-02-01' },
      ] }],
    } }] as any
    programmes.collections[0]!.relationships[0]!.anchor.id = target.epci!
    programmes.collections[0]!.relationships[0]!.anchor.name = parent.nom
    const fetchApi = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      void options
      const url = String(input)
      if (url.endsWith('/themes/programmes/facts')) return { ok: true, json: async () => programmes }
      if (url.endsWith('/themes/habitat/facts')) return { ok: true, json: async () => reponseThemeHabitatApi(model, 'commune', '22001') }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/programmes/facts'))).toHaveLength(1)
    expect(JSON.parse(String(fetchApi.mock.calls[0]![1]?.body))).toEqual({ theme_id: 'programmes' })
    const rendered = wrapper.get('[role="tabpanel"]').text()
    expect(rendered).toContain('ACV')
    expect(rendered).toContain('lauréate')
    expect(rendered).toContain('CRTE')
    expect(rendered).toContain('Territoire couvert par le contrat')
    expect(rendered).toContain('convention valant ORT')
    expect(rendered).toContain('Source API programmes')
    expect(rendered).toContain('71,40 M€')
    expect(rendered).toContain('Mobilité API')
    expect(rendered).toContain('78,23 % du total de l\'EPCI')
    await router.replace({ query: { theme: 'habitat' } })
    await flushPromises()
    await router.replace({ query: {} })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/programmes/facts'))).toHaveLength(1)
    wrapper.unmount()
  })

  it('rend une absence de subventions sans section ni total nul', async () => {
    const model = modeleAvecContextesComparaison()
    const response = reponseThemeProgrammesApi()
    response.collections = response.collections.filter((collection: any) => collection.kind === 'anchored_membership')
    response.owned_series = []
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })))
    const { wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))
    expect(wrapper.text()).not.toContain('0 €')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('Subventions attribuées')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('du total de l’EPCI')
    wrapper.unmount()
  })

  it('acquiert Démographie à la demande et alimente le soldes cloud depuis les faits', async () => {
    const published = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json', { type: 'commune', territoire: '22001' })
    model.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const api = reponseThemeDemographieApi(model)
    expect(histoiresDemographieNuage(api.comparison)).toHaveLength(1)
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => {
      if (url.endsWith('/facts')) return api
      const selection = JSON.parse(String(options?.body)).selection
      return { ...api.comparison, selection, reading_cloud: { ...api.comparison.reading_cloud,
        points: [{ ...api.comparison.reading_cloud.points[0], taux_solde_naturel: 8.5, taux_solde_migratoire: -9.5 }] } }
    } }))
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=demographie', vi.fn(async () => model))
    await flushPromises()
    expect(fetchApi).toHaveBeenCalledWith('/api/territories/commune/22001/themes/demographie/facts', expect.objectContaining({ method: 'POST', body: JSON.stringify({ theme_id: 'demographie' }) }))
    const chart = wrapper.findComponent({ name: 'GraphiqueSoldes' })
    expect(chart.exists()).toBe(true)
    expect(chart.props('nuage')).toContainEqual(expect.objectContaining({ territoire: '22002', tauxNaturel: 1.25, tauxMigratoire: -0.75 }))
    expect(chart.props('tauxNaturel')).toBe(0.5)
    await router.replace({ query: { theme: 'demographie', comparaison: 'epci' } })
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/comparison'))).toHaveLength(1)
    expect(chart.props('tauxNaturel')).toBe(0.5)
    expect(chart.props('nuage')).toContainEqual(expect.objectContaining({ territoire: '22002', tauxNaturel: 8.5, tauxMigratoire: -9.5 }))
    wrapper.unmount()
  })

  const economieModel = () => {
    const published = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json', { type: 'commune', territoire: '22001' })
    model.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    return model
  }
  it('Economie mounted: landing consumes API scalar and activity reading, while absent list ranks stay absent', async () => {
    const model = economieModel(); const api = reponseThemeEconomieApi(model)
    const fetchApi = vi.fn(async (_url: string, _options?: RequestInit) => ({ ok: true, json: async () => api }))
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=economie', vi.fn(async () => model))
    await flushPromises()
    const text = wrapper.get('[role="tabpanel"]').text()
    // Le POST actif part en premier, puis le registre entier se réchauffe.
    expect(String(fetchApi.mock.calls[0]![0])).toContain('/themes/economie/facts')
    expect(JSON.parse(String(fetchApi.mock.calls[0]![1]?.body))).toEqual({ theme_id: 'economie' })
    expect(fetchApi.mock.calls.filter((x: any[]) => String(x[0]).endsWith('/facts'))).toHaveLength(6)
    const ecoActivites = model.themes.economie!.indicators.find((row: any) => row.territoire === '22001' && row.key === 'eco_activites')!
    expect(api.indicators).toContainEqual(expect.objectContaining({ indicator_id: 'eco_activites', value: ecoActivites.value }))
    expect(text).toContain(`${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(ecoActivites.value) * 100)}%`)
    expect(text).toContain('23%'); expect(text).toContain('Activit\u00e9 API distinctive'); expect(text).toContain('99,3')
    expect(text).not.toContain('7,1%'); expect(text).not.toContain('Agriculture, sylviculture et p?che')
    expect(text).not.toContain('LQ 0'); wrapper.unmount()
  })
  it('Economie mounted: le registre se réchauffe après Programmes et une bascule réchauffée n’acquiert rien', async () => {
    const model = economieModel()
    const fetchApi = vi.fn(async (url: string) => {
      if (String(url).endsWith('/themes/programmes/facts')) return { ok: true, json: async () => reponseThemeProgrammesApi() }
      if (String(url).endsWith('/themes/economie/facts')) return { ok: true, json: async () => reponseThemeEconomieApi(model) }
      const theme = String(url).match(/\/themes\/([^/]+)\/facts$/)?.[1]
      if (theme) return { ok: true, json: async () => ({ ...reponseThemeProgrammesApi(), theme_id: theme,
        indicators: [], readings: [], comparison: { contract: 'theme-comparison-v1', theme_id: theme,
          content_version: 'v1', reference_content_version: 'v1', selection: null, results: [], profile_comparisons: [] } }) }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))
    await flushPromises()
    // L'atterrissage acquiert Programmes en priorité puis réchauffe le registre
    // entier — Économie comprise — en arrière-plan.
    expect(String(fetchApi.mock.calls[0]![0])).toContain('/themes/programmes/facts')
    expect(fetchApi.mock.calls.filter((x: any[]) => String(x[0]).endsWith('/themes/economie/facts'))).toHaveLength(1)
    expect(fetchApi.mock.calls.filter((x: any[]) => String(x[0]).endsWith('/facts'))).toHaveLength(6)
    await router.replace({ query: { theme: 'economie' } }); await flushPromises()
    // La bascule vers un thème réchauffé n'acquiert rien : le cache détient l'entrée.
    expect(fetchApi.mock.calls.filter((x: any[]) => String(x[0]).endsWith('/themes/economie/facts'))).toHaveLength(1)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Activité API distinctive')
    await router.replace({ query: { theme: 'habitat' } }); await flushPromises(); await router.replace({ query: { theme: 'economie' } }); await flushPromises()
    expect(fetchApi.mock.calls.filter((x:any[])=>String(x[0]).endsWith('/themes/economie/facts'))).toHaveLength(1)
    wrapper.unmount()
  })
  it('Economie mounted: pending facts never expose incumbent numeric values', async () => {
    const model = economieModel(); let resolve!: (v: any) => void; const pending = new Promise(r => { resolve = r })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', vi.fn(() => pending))
    const { wrapper } = await monter('/territoire/commune/22001?theme=economie', vi.fn(async () => model))
    const text = wrapper.get('[role="tabpanel"]').text(); expect(text).not.toContain('7,1%'); expect(text).not.toContain('Agriculture, sylviculture et p?che')
    resolve({ ok: true, json: async () => reponseThemeEconomieApi(model) }); await flushPromises(); expect(wrapper.get('[role="tabpanel"]').text()).toContain('23%'); wrapper.unmount()
  })
  it('Economie mounted: failed facts show retry and recover', async () => {
    const model = economieModel(); let n = 0
    const fetchApi = vi.fn(async (url: string) => {
      if (String(url).endsWith('/themes/economie/facts')) {
        if (++n === 1) throw new Error('offline')
        return { ok: true, json: async () => reponseThemeEconomieApi(model) }
      }
      const theme = String(url).match(/\/themes\/([^/]+)\/facts$/)?.[1]
      if (theme) return { ok: true, json: async () => ({ ...reponseThemeProgrammesApi(), theme_id: theme,
        indicators: [], readings: [], comparison: { contract: 'theme-comparison-v1', theme_id: theme,
          content_version: 'v1', reference_content_version: 'v1', selection: null, results: [], profile_comparisons: [] } }) }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=economie', vi.fn(async () => model)); expect(wrapper.get('[role="alert"]').text()).toContain('Les indicateurs')
    await flushPromises()
    // L'échec du thème actif ne suspend pas le réchauffage d'arrière-plan.
    expect(fetchApi.mock.calls.filter((x: any[]) => String(x[0]).endsWith('/facts'))).toHaveLength(6)
    await wrapper.get('[role="alert"] button').trigger('click'); await flushPromises()
    expect(fetchApi.mock.calls.filter((x: any[]) => String(x[0]).endsWith('/themes/economie/facts'))).toHaveLength(2)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Activit\u00e9 API distinctive'); wrapper.unmount()
  })
  it('Economie mounted: un échec de réchauffage d’arrière-plan n’entache pas le thème actif et devient réessayable à sa visite', async () => {
    const model = economieModel(); let milieuxDown = true
    const fetchApi = vi.fn(async (url: string) => {
      if (String(url).endsWith('/themes/economie/facts')) return { ok: true, json: async () => reponseThemeEconomieApi(model) }
      if (String(url).endsWith('/themes/milieux/facts')) {
        if (milieuxDown) throw new Error('milieux down')
        return { ok: true, json: async () => ({ ...reponseThemeProgrammesApi(), theme_id: 'milieux', territory: { territory_id: '22001', territory_type: 'commune', name: '22001' },
          indicators: [], readings: [], comparison: { contract: 'theme-comparison-v1', theme_id: 'milieux',
            content_version: 'v1', reference_content_version: 'v1', selection: null, results: [], profile_comparisons: [] } }) }
      }
      const theme = String(url).match(/\/themes\/([^/]+)\/facts$/)?.[1]
      if (theme) return { ok: true, json: async () => ({ ...reponseThemeProgrammesApi(), theme_id: theme,
        indicators: [], readings: [], comparison: { contract: 'theme-comparison-v1', theme_id: theme,
          content_version: 'v1', reference_content_version: 'v1', selection: null, results: [], profile_comparisons: [] } }) }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=economie', vi.fn(async () => model))
    await flushPromises()
    // Le thème actif rend normalement ; l'échec d'arrière-plan ne s'affiche pas.
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('23%')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await router.replace({ query: { theme: 'milieux' } }); await flushPromises()
    // La visite du thème défaillant expose SA propre erreur réessayable.
    expect(wrapper.get('[role="alert"]').text()).toContain('ne sont pas disponibles')
    milieuxDown = false
    await wrapper.get('[role="alert"] button').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('Economie mounted: selected comparisons POST exact members, cache revisits, and retain focal facts', async () => {
    const model = economieModel(); const expected = model.cohortTerritories!.filter((x: any) => x.type === 'commune' && x.epci === model.territory.epci).map((x: any) => ({ territory_type: x.type, territory_id: x.territoire }))
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => url.endsWith('/facts') ? ({ ok: true, json: async () => reponseThemeEconomieApi(model) }) : ({ ok: true, json: async () => ({ contract:'theme-comparison-v1', theme_id:'economie', content_version:'economie-api-v1', reference_content_version:'territories-v1', reading_content_version:'economie-api-v1', selection:JSON.parse(String(options?.body)).selection, results:[], profile_comparisons:[] }) }))
    vi.stubEnv('VITE_THEME_ACQUISITION_API','1'); vi.stubGlobal('fetch',fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=economie',vi.fn(async()=>model)); expect(fetchApi.mock.calls.filter(x=>String(x[0]).endsWith('/comparison'))).toHaveLength(0)
    await router.replace({query:{theme:'economie',comparaison:'epci'}}); await flushPromises(); const compCall=fetchApi.mock.calls.find((x:any[])=>String(x[0]).endsWith('/comparison'))!; expect(JSON.parse(String(compCall[1]?.body))).toEqual({theme_id:'economie',selection:expected})
    await router.replace({query:{theme:'economie',comparaison:'bretagne'}}); await flushPromises(); await router.replace({query:{theme:'economie',comparaison:'epci'}}); await flushPromises()
    expect(fetchApi.mock.calls.filter(x=>String(x[0]).endsWith('/comparison'))).toHaveLength(2); expect(wrapper.get('[role="tabpanel"]').text()).toContain('Activit\u00e9 API distinctive'); wrapper.unmount()
  })
  it('Economie mounted: incompatible comparison tokens fail closed and retry without losing focal reading', async () => {
    const model=economieModel(); let count=0; const fetchApi=vi.fn(async(url:string,options?:RequestInit)=>url.endsWith('/facts')?({ok:true,json:async()=>reponseThemeEconomieApi(model)}):({ok:true,json:async()=>({contract:'theme-comparison-v1',theme_id:'economie',content_version:'economie-api-v1',reference_content_version:++count===1?'stale':'territories-v1',reading_content_version:'economie-api-v1',selection:JSON.parse(String(options?.body)).selection,results:[],profile_comparisons:[]})}))
    vi.stubEnv('VITE_THEME_ACQUISITION_API','1');vi.stubGlobal('fetch',fetchApi);const {wrapper}=await monter('/territoire/commune/22001?theme=economie&comparaison=bretagne',vi.fn(async()=>model));await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Les comparaisons');expect(wrapper.get('[role="tabpanel"]').text()).toContain('Activit\u00e9 API distinctive');await wrapper.get('[role="alert"] button').trigger('click');await flushPromises();expect(count).toBe(2);expect(wrapper.find('[role="alert"]').exists()).toBe(false);wrapper.unmount()
  })
  it('Economie mounted: ignores late stale comparison response after selection changes', async () => {
    const model=economieModel();let resolve!: (v:any)=>void;const pending=new Promise(r=>resolve=r);const fetchApi=vi.fn(async(url:string,options?:RequestInit)=>url.endsWith('/facts')?({ok:true,json:async()=>reponseThemeEconomieApi(model)}):JSON.parse(String(options?.body)).selection.length>100?pending:({ok:true,json:async()=>({contract:'theme-comparison-v1',theme_id:'economie',content_version:'economie-api-v1',reference_content_version:'territories-v1',reading_content_version:'economie-api-v1',selection:JSON.parse(String(options?.body)).selection,results:[],profile_comparisons:[]})}))
    vi.stubEnv('VITE_THEME_ACQUISITION_API','1');vi.stubGlobal('fetch',fetchApi);const {router,wrapper}=await monter('/territoire/commune/22001?theme=economie',vi.fn(async()=>model));await router.replace({query:{theme:'economie',comparaison:'bretagne'}});await flushPromises();await router.replace({query:{theme:'economie',comparaison:'epci'}});await flushPromises();resolve({contract:'theme-comparison-v1',theme_id:'economie',content_version:'economie-api-v1',reference_content_version:'territories-v1',reading_content_version:'economie-api-v1',selection:[],results:[],profile_comparisons:[]});await flushPromises();expect(wrapper.find('[role="alert"]').exists()).toBe(false);expect(wrapper.get('[role="tabpanel"]').text()).toContain('Activit\u00e9 API distinctive');wrapper.unmount()
  })

  it('keeps the incumbent fiche path when registration is absent or the cutover flag is off', async () => {    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const requests = vi.fn().mockRejectedValue(new Error('scalar API must stay off'))
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', requests)
    const { wrapper: unregistered } = await monter('/territoire/commune/29002?theme=demographie')
    expect(unregistered.text()).toContain('Densité de population')
    expect(requests.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    unregistered.unmount()

    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.mobilite.theme_metadata.scalar_contracts = metadata.scalar_contracts
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '0')
    const { wrapper: disabled } = await monter('/territoire/commune/22001?theme=mobilite&variant=A', vi.fn(async () => model))
    expect(requests.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    expect(disabled.text()).toContain('0,92')
    disabled.unmount()
  })

  it('keeps unregistered facts when a valid registration has no eligible pages at this level', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.mobilite.theme_metadata.scalar_contracts = Object.fromEntries(
      Object.keys(metadata.scalar_contracts).map((key) => [key, { allowed_levels: ['epci'] }]),
    )
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    const fetchApi = vi.fn()
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=A', vi.fn(async () => model))
    expect(fetchApi).not.toHaveBeenCalled()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('0,92')
    wrapper.unmount()
  })

  it('reloads scalar facts when comparison scope changes and ignores the previous response', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.mobilite.theme_metadata.scalar_contracts = metadata.scalar_contracts
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    const oldResponses: Array<() => void> = []
    const newResponses: Array<() => void> = []
    const oldIndicators: string[] = []
    const newIndicators: string[] = []
    const fetchApi = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const indicator = url.pathname.split('/').at(-1)!
       const page = metadata.indicator_pages[indicator]
      const value = url.searchParams.has('epci_id') ? 111111111 : 222222222
      const response = new Response(JSON.stringify({ indicator_id: indicator, territory_type: 'commune',
        label: page.label, unit: page.unit, direction: page.direction,
        comparison_facet: page.comparison?.indicator ?? indicator, completeness: 'sparse',
        content_version: url.searchParams.has('epci_id') ? 'epci-v1' : 'bretagne-v1',
        territory_reference_version: 'territories-v1',
        observations: [{ territory_id: '22001', name: published.territory.nom, value, status: 'measured',
          rang_epci: 1, rang_epci_n: 38, rang_dep: 1, rang_dep_n: 50, rang_reg: 1, rang_reg_n: 100,
          sources: [{ source_id: page.sources[0], name: 'Source API fiche', vintage_id: 'api-v1', version: '2026',
            reference_date: null, publication_date: null }] }] }), { status: 200 })
      return new Promise<Response>((resolve) => {
        const old = url.searchParams.has('epci_id')
        ;(old ? oldIndicators : newIndicators).push(indicator)
        ;(old ? oldResponses : newResponses).push(() => resolve(response))
      })
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=A&comparaison=epci', vi.fn(async () => model))
    // nb_buildings is invariant to the commune peer selection and is served
    // without an epci_id; the other 21 scoped scalar contracts use that group.
    expect(oldResponses, JSON.stringify({ oldIndicators, missing: Object.keys(metadata.scalar_contracts).filter((id) => !oldIndicators.includes(id)) })).toHaveLength(Object.keys(metadata.scalar_contracts).length - 1)
    await router.push('/territoire/commune/22001?theme=mobilite&variant=A&comparaison=bretagne')
    await flushPromises()
    expect(newResponses, JSON.stringify({ newIndicators })).toHaveLength(Object.keys(metadata.scalar_contracts).length - 1)
    expect(new URL(String(fetchApi.mock.calls.at(-1)![0]), 'http://localhost').searchParams.has('epci_id')).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('111 111 111')
    newResponses.forEach((resolve) => resolve())
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('222 222 222')
    oldResponses.forEach((resolve) => resolve())
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('222 222 222')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('111 111 111')
    wrapper.unmount()
  })

  it('renders a retryable error for malformed registration and recovers without showing static facts', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.mobilite.theme_metadata.scalar_contracts = { avg_tot_t: { allowed_levels: 'commune' } }
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const indicator = String(input).split('/').at(-1)!.split('?')[0]!
       const page = metadata.indicator_pages[indicator]
      return new Response(JSON.stringify({ indicator_id: indicator, territory_type: 'commune', label: page.label,
        unit: page.unit, direction: page.direction, comparison_facet: page.comparison?.indicator ?? indicator,
        completeness: 'sparse', content_version: 'retry-v1', territory_reference_version: 'territories-v1',
        observations: [{ territory_id: '22001', name: published.territory.nom, value: 987654321, status: 'measured',
          rang_epci: 1, rang_epci_n: 38, rang_dep: 1, rang_dep_n: 50, rang_reg: 1, rang_reg_n: 100,
          sources: [{ source_id: page.sources[0], name: 'Source API fiche', vintage_id: 'api-v1', version: '2026',
            reference_date: null, publication_date: null }] }] }), { status: 200 })
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=A', vi.fn(async () => model))
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toContain('pas disponibles')
    expect(wrapper.text()).not.toContain('0,92')
    expect(fetchApi).not.toHaveBeenCalled()

    model.themes.mobilite!.metadata.scalar_contracts = metadata.scalar_contracts
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(fetchApi).toHaveBeenCalled()
    expect(wrapper.text()).toContain('987 654 321')
    expect(wrapper.text()).not.toContain('0,92')
    wrapper.unmount()
  })

  it.each([
    ['epci', '242200715', 'epcis-bretagne'],
    ['departement', '22', 'departements-bretagne'],
    ['region', '53', null],
  ] as const)('branche les parts API de %s sans nouveau sélecteur', async (type, code, kind) => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const published = JSON.parse(readFileSync(resolve(process.cwd(), `../public/data/modeles-lecture/territoires/${type}/${code}.json`), 'utf8'))
    const model = validerModeleTerritoire(published, `${type}/${code}.json`, { type, territoire: code })
    const label = model.themes.mobilite?.comparisons.bretagne?.scope.label
    const fetchApi = vi.fn(async (_url: string) => ({ ok: true, json: async () =>
      reponseThemeMobiliteApi(model, type, code, kind, label) }))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter(`/territoire/${type}/${code}?theme=mobilite&variant=E`, vi.fn(async () => model))
    await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).includes(`/api/territories/${type}/${code}/themes/mobilite/facts`))).toHaveLength(1)
    expect(wrapper.findAll('[data-section="services-essentiels"] .access-figure')).toHaveLength(5)
    expect(wrapper.findAll('[data-section="services-essentiels"] .access-foot-summary')[0]?.text()).toContain('42')
    wrapper.unmount()
  })

  it('ignore une réponse API périmée après changement du contexte de comparaison', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const contexts = modeleAvecContextesComparaison().themes.mobilite!.comparisons
    const model = modeleAvecContextesComparaison()
    let resolveOld: ((value: unknown) => void) | undefined
    const oldRequest = new Promise((resolve) => { resolveOld = resolve })
    const fetchApi = vi.fn((url: string, options?: RequestInit) => {
      if (url.endsWith('/facts')) return Promise.resolve({ ok: true, json: async () =>
        reponseThemeMobiliteApi(model, 'commune', '22001', contexts.densite!.scope.kind, contexts.densite!.scope.label) })
      if (url.endsWith('/comparison')) {
        const selected = JSON.parse(String(options?.body)).selection
        if (selected.length > 100) return oldRequest
        return Promise.resolve({ ok: true, json: async () => ({
          contract: 'theme-comparison-v1', theme_id: 'mobilite', selection: selected,
          results: ['admin', 'food', 'health', 'bank', 'school'].flatMap((service) =>
            ['c', 'b', 't'].map((mode) => ({ indicator_id: `share_${service}_${mode}`,
              status: 'available', direction: 'high', median: 0.3, rank: 19, rank_size: 38 }))),
          profile_comparisons: [], building_access: null,
        }) })
      }
      return Promise.reject(new Error('Not part of access API'))
    })
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E',
      vi.fn(async () => modeleAvecContextesComparaison()))
    await router.replace({ query: { theme: 'mobilite', variant: 'E', comparaison: 'bretagne' } })
    await flushPromises()
    await router.replace({ query: { theme: 'mobilite', variant: 'E', comparaison: 'epci' } })
    await flushPromises()
    const section = wrapper.get('[data-section="services-essentiels"]')
    expect(section.findAll('.access-figure')).toHaveLength(5)
    expect(section.findAll('.access-foot-summary')[0]?.text()).toContain('42')
    expect(section.get('.cahier-comparison-note').text()).toContain(contexts.epci!.scope.label)
    resolveOld?.({ ok: true, json: async () => ({ contract: 'theme-comparison-v1', theme_id: 'mobilite',
      selection: [], results: [], profile_comparisons: [] }) })
    await flushPromises()
    expect(section.findAll('.access-foot-summary')[0]?.text()).toContain('42')
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/facts'))).toHaveLength(1)
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/comparison'))).toHaveLength(2)
    wrapper.unmount()
  })
  it('affiche les six onglets pendant que l’unique modèle charge', async () => {
    const charger = vi.fn(() => new Promise<never>(() => {}))
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    expect(wrapper.find('.squelette').exists()).toBe(true)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('rend l’identité et le contexte depuis la même réponse', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')

    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(wrapper.find('.puce-type').text()).toBe('Commune')
    expect(wrapper.find('.fiche-actions .contexte-switcher').exists()).toBe(true)
    const breadcrumb = wrapper.find('.fil-ariane')
    expect(breadcrumb.text()).toContain('Accueil')
    expect(breadcrumb.text()).toContain('Les communes')
    expect(breadcrumb.find('a[href="/"]').exists()).toBe(true)
    expect(breadcrumb.find('a[href="/communes"]').exists()).toBe(true)
    expect(wrapper.find('.contexte-switcher').text()).toContain('EPCI Y')
    expect(wrapper.find('.contexte-switcher').text()).toContain('Département 29')
    expect(wrapper.find('.contexte-switcher').text()).toContain('Bretagne')
  })

  it('présente toujours les six thèmes dans l’ordre produit', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text().trim())).toEqual([
      'Programmes et subventions',
      'Mobilité',
      'Démographie',
      'Habitat',
      'Économie',
      'Milieux',
    ])
  })

  it('ouvre Programmes et subventions par défaut', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-programmes')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et contrats')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Aucun programme référencé.')
  })

  it('sélectionne un thème depuis l’URL sans nouvelle requête', async () => {
    const charger = vi.fn<ChargerModeleTerritoire>(async (_type, territoire) => modelFor(territoire))
    const { wrapper } = await monter('/territoire/commune/29002?theme=demographie', charger)
    expect(wrapper.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-demographie')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Densité de population')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain(
      'la population de Commune C se vide et se meurt : -1,04 par an (naturel)',
    )
    expect(wrapper.find('.fiche').classes()).toContain('fiche--theme-demographie')
    expect(wrapper.find('.filigrane-fiche').attributes('style')).toContain(
      '--filigrane-accent: var(--theme-demographie-line)',
    )
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('change d’onglet sans recharger le modèle', async () => {
    const charger = vi.fn<ChargerModeleTerritoire>(async (_type, territoire) => modelFor(territoire))
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('normalise un thème inconnu vers le défaut', async () => {
    const { wrapper, router } = await monter('/territoire/commune/29002?theme=bidule')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
  })

  it('canonicalise un mode de comparaison inconnu sans perdre le thème ni la variante', async () => {
    const { router } = await monter(
      '/territoire/commune/29002?theme=mobilite&comparaison=inconnu&variant=E',
    )
    expect(router.currentRoute.value.query).toEqual({ theme: 'mobilite', variant: 'E' })
  })

  it.each(['densite', 'epci', 'bretagne'] as const)(
    'applique le contexte %s à la fiche rendue', async (mode) => {
    const label = modeleAvecContextesComparaison().themes.mobilite?.comparisons[mode]?.scope.label
    const varianteE = varianteDeUrl('E')
    expect(varianteE?.clef).toBe('E')
    await (varianteE?.composant as any).__asyncLoader?.()
    const model = modeleAvecContextesComparaison()
    vi.stubGlobal('fetch', stubApiThemeMobilite(model))
    const charger = vi.fn(async () => model)
    const { router, wrapper } = await monter(
      `/territoire/commune/22001?theme=mobilite&variant=E&comparaison=${mode}`,
      charger,
    )

    expect(router.currentRoute.value.query.comparaison).toBe(mode)
    await flushPromises()
    expect(wrapper.find('.cahier-comparison-note').text()).toContain(label)
    wrapper.unmount()
  })

  it('expose le contexte sélectionné comme une divulgation synchronisable', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const model = modeleAvecContextesComparaison()
    vi.stubGlobal('fetch', stubApiThemeMobilite(model))
    const charger = vi.fn(async () => model)
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&variant=E&comparaison=densite',
      charger,
    )

    const selector = wrapper.get('.cahier-comparison-note')
    const trigger = selector.get('button[aria-haspopup="listbox"]')

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-current')).toBe('true')
    const contexts = modeleAvecContextesComparaison().themes.mobilite!.comparisons
    expect(trigger.text()).toContain(contexts.densite!.scope.label)
    expect(selector.get('.cahier-comparison-note__scope').text()).toBe(contexts.densite!.scope.label)
    expect(selector.get('.cahier-comparison-note__arrow').text()).toBe('←')
    expect(selector.get('.cahier-comparison-note__arrow').classes()).not.toContain('is-open')

    await trigger.trigger('click')

    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(selector.get('.cahier-comparison-note__arrow').classes()).toContain('is-open')
    const options = selector.findAll('[role="option"][aria-selected="false"]')
    expect(options.map((option) => option.text())).toEqual([
      contexts.epci!.scope.label,
      contexts.bretagne!.scope.label,
    ])
    expect(options[0]!.attributes('title')).toBeUndefined()

    await selector
      .get('[role="option"][aria-selected="false"]')
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.comparaison).toBe('epci')
    expect(wrapper.get('.cahier-comparison-note button').text()).toContain(
      contexts.epci!.scope.label,
    )
    const comparisonNotes = wrapper.findAll('.cahier-comparison-note')
    // La réponse de faits sert les deux figures bâtiments : leurs notes
    // viennent de l'API (puis effacées par la comparaison epci), pas du JSON
    // statique ; la note des services porte le contexte sélectionné.
    expect(comparisonNotes).toHaveLength(3)
    expect(comparisonNotes.every((note) => note.find('button[aria-haspopup="listbox"]').exists())).toBe(true)
    wrapper.unmount()
  })

  it('ne branche pas le sélecteur de comparaison sur la variante D', async () => {
    const varianteD = varianteDeUrl('D')
    expect(varianteD?.clef).toBe('D')
    await (varianteD?.composant as any).__asyncLoader?.()
    const charger = vi.fn(async () => modeleAvecContextesComparaison())
    const { wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&variant=D&comparaison=epci',
      charger,
    )

    await flushPromises()
    const comparisonNotes = wrapper.findAll('.cahier-comparison-note')
    expect(comparisonNotes.length).toBeGreaterThan(0)
    expect(comparisonNotes.every((note) => !note.find('button[aria-haspopup="listbox"]').exists())).toBe(true)
    wrapper.unmount()
  })

  it('permet de changer de contexte au clavier et expose l’aide de la densité', async () => {
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    const model = modeleAvecContextesComparaison()
    vi.stubGlobal('fetch', stubApiThemeMobilite(model))
    const charger = vi.fn(async () => model)
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&variant=E&comparaison=epci',
      charger,
    )

    const selector = wrapper.get('.cahier-comparison-note')
    const trigger = selector.get('button[aria-haspopup="listbox"]')
    await trigger.trigger('keydown', { key: 'Enter' })

    expect(trigger.attributes('aria-expanded')).toBe('true')
    const densityLabel = modeleAvecContextesComparaison().themes.mobilite!.comparisons.densite!.scope.label
    const density = selector.findAll('[role="option"][aria-selected="false"]').find((option) => option.find('.cahier-comparison-note__option-label').text() === densityLabel)
    expect(density).toBeDefined()
    expect(density!.attributes('title')).toBe(
      'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
    )
    const descriptionId = density!.attributes('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(selector.get(`#${descriptionId}`).text()).toContain('Classe définie par l’Insee')

    await density!.trigger('focus')
    await density!.trigger('keydown', { key: 'Escape' })
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('keydown', { key: 'Enter' })
    const reopenedDensity = selector.findAll('[role="option"][aria-selected="false"]').find((option) => option.find('.cahier-comparison-note__option-label').text() === densityLabel)
    expect(reopenedDensity).toBeDefined()
    await reopenedDensity!.trigger('focus')
    await reopenedDensity!.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(router.currentRoute.value.query.comparaison).toBeUndefined()
    wrapper.unmount()
  })

  it('affiche l’erreur typée et réessaie le même endpoint', async () => {
    const charger = vi
      .fn()
      .mockRejectedValueOnce(new PayloadError('fetch', 'territoires/commune/29002.json', 'panne'))
      .mockResolvedValueOnce(modelFor('29002'))
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.find('.etat-erreur').exists()).toBe(true)
    expect(wrapper.text()).toContain('Impossible de charger les données')
    expect(wrapper.text()).not.toContain('territoires/commune/29002.json')
    expect(wrapper.text()).not.toContain('panne')
    await wrapper.get('.bouton-reessayer').trigger('click')
    await flushPromises()
    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(charger).toHaveBeenCalledTimes(2)
  })
  it('acquiert Milieux paresseusement, consomme la lecture API et rend son nuage imbriqué', async () => {
    const model = modeleMilieux()
    const fetchApi = vi.fn(async (_url: string, _options?: RequestInit) => ({ ok: true, json: async () => reponseThemeMilieuxApi(model) }))
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=milieux', vi.fn(async () => model))
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/milieux/facts'))).toHaveLength(1)
    expect(JSON.parse(String(fetchApi.mock.calls[0]![1]?.body))).toEqual({ theme_id: 'milieux' })
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Source API milieux')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('se vide, et consomme quand même')
    const graph = wrapper.findComponent(GraphiqueQuadrantMilieux)
    expect(graph.exists()).toBe(true)
    expect(graph.props('tauxVariationPopulation')).toBe(2.75)
    expect(graph.props('classification')).toContain('grandit')
    expect(graph.props('nuage')).toContainEqual(expect.objectContaining({ territoire: '22033', tauxVariationPopulation: 2.75, deltaM2ParHabitant: 25 }))
    wrapper.unmount()
  })

  it('réchauffe le registre après Programmes et garde l’acquisition Milieux en cache à la revisite', async () => {
    const model = modeleMilieux()
    const fetchApi = vi.fn(async (url: string, _options?: RequestInit) => {
      if (String(url).endsWith('/themes/programmes/facts')) {
        return { ok: true, json: async () => reponseThemeProgrammesApi() }
      }
      if (String(url).endsWith('/themes/milieux/facts')) {
        return { ok: true, json: async () => reponseThemeMilieuxApi(model) }
      }
      const theme = String(url).match(/\/themes\/([^/]+)\/facts$/)?.[1]
      if (theme) return { ok: true, json: async () => ({ ...reponseThemeProgrammesApi(), theme_id: theme,
        indicators: [], readings: [], comparison: { contract: 'theme-comparison-v1', theme_id: theme,
          content_version: 'v1', reference_content_version: 'v1', selection: null, results: [], profile_comparisons: [] } }) }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))
    await flushPromises()
    // Programmes part en priorité ; Milieux se réchauffe en arrière-plan.
    expect(String(fetchApi.mock.calls[0]![0])).toContain('/themes/programmes/facts')
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/programmes/facts'))).toHaveLength(1)
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/milieux/facts'))).toHaveLength(1)
    await router.replace({ query: { theme: 'milieux' } }); await flushPromises()
    await router.replace({ query: { theme: 'habitat' } }); await flushPromises()
    await router.replace({ query: { theme: 'milieux' } }); await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/milieux/facts'))).toHaveLength(1)
    wrapper.unmount()
  })

  it('masque les valeurs statiques pendant l’acquisition Milieux en attente', async () => {
    const model = modeleMilieux()
    let resolveFacts!: (value: unknown) => void
    const pending = new Promise((resolve) => { resolveFacts = resolve })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', vi.fn(() => pending))
    const { wrapper } = await monter('/territoire/commune/22001?theme=milieux', vi.fn(async () => model))
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('Source API milieux')
    resolveFacts({ ok: true, json: async () => reponseThemeMilieuxApi(model) }); await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Source API milieux')
    wrapper.unmount()
  })

  it('échoue fermé sur les faits Milieux puis réessaie', async () => {
    const model = modeleMilieux()
    let calls = 0
    const fetchApi = vi.fn(async (url: string) => {
      if (String(url).endsWith('/themes/milieux/facts')) {
        if (++calls === 1) throw new Error('offline')
        return { ok: true, json: async () => reponseThemeMilieuxApi(model) }
      }
      const theme = String(url).match(/\/themes\/([^/]+)\/facts$/)?.[1]
      if (theme) return { ok: true, json: async () => ({ ...reponseThemeProgrammesApi(), theme_id: theme,
        indicators: [], readings: [], comparison: { contract: 'theme-comparison-v1', theme_id: theme,
          content_version: 'v1', reference_content_version: 'v1', selection: null, results: [], profile_comparisons: [] } }) }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=milieux', vi.fn(async () => model))
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('indicateurs de ce thème ne sont pas disponibles')
    await flushPromises()
    // Le réchauffage d'arrière-plan part malgré l'échec du thème actif.
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/facts'))).toHaveLength(6)
    await alert.get('button').trigger('click'); await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/milieux/facts'))).toHaveLength(2)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Source API milieux')
    wrapper.unmount()
  })

  it('n’écrase pas la lecture focale lors des comparaisons et réutilise le cache de sélection', async () => {
    const model = modeleMilieux()
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => url.endsWith('/facts')
      ? reponseThemeMilieuxApi(model) : { contract: 'theme-comparison-v1', theme_id: 'milieux', selection: JSON.parse(String(options?.body)).selection,
        reference_content_version: 'territories-v1', content_version: 'milieux-v1', reading_content_version: 'milieux-v1',
        results: [], profile_comparisons: [], reading_cloud: reponseThemeMilieuxApi(model).comparison.reading_cloud } }))
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=milieux', vi.fn(async () => model))
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/comparison'))).toHaveLength(0)
    await router.replace({ query: { theme: 'milieux', comparaison: 'epci' } }); await flushPromises()
    const call = fetchApi.mock.calls.find(([url]) => url.endsWith('/comparison'))!
    const expected = model.cohortTerritories!.filter((t: any) => t.type === 'commune' && t.epci === model.territory.epci)
      .map((t: any) => ({ territory_type: t.type, territory_id: t.territoire }))
    expect(JSON.parse(String(call[1]?.body))).toEqual({ theme_id: 'milieux', selection: expected })
    expect(wrapper.findComponent(GraphiqueQuadrantMilieux).props('tauxVariationPopulation')).toBe(2.75)
    await router.replace({ query: { theme: 'milieux', comparaison: 'bretagne' } }); await flushPromises()
    const allCommunes = model.cohortTerritories!.filter((t: any) => t.type === 'commune')
      .map((t: any) => ({ territory_type: t.type, territory_id: t.territoire }))
    const comparisons = fetchApi.mock.calls.filter(([url]) => url.endsWith('/comparison'))
    expect(comparisons).toHaveLength(2)
    expect(JSON.parse(String(comparisons[1]![1]?.body))).toEqual({ theme_id: 'milieux', selection: allCommunes })
    await router.replace({ query: { theme: 'milieux', comparaison: 'epci' } }); await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => url.endsWith('/comparison'))).toHaveLength(2)
    wrapper.unmount()
  })

  it('refuse les jetons de comparaison incompatibles et réessaie la comparaison', async () => {
    const model = modeleMilieux()
    let comparison = 0
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => url.endsWith('/facts')
      ? reponseThemeMilieuxApi(model) : { contract: 'theme-comparison-v1', theme_id: 'milieux', selection: JSON.parse(String(options?.body)).selection,
        reference_content_version: ++comparison === 1 ? 'bad' : 'territories-v1', content_version: 'milieux-v1',
        reading_content_version: 'milieux-v1', results: [], profile_comparisons: [], reading_cloud: null } }))
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=milieux&comparaison=bretagne', vi.fn(async () => model))
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('comparaisons de ce thème ne sont pas disponibles')
    await alert.get('button').trigger('click'); await flushPromises()
    expect(comparison).toBe(2)
    wrapper.unmount()
  })

  it('ignore une réponse de faits Milieux tardive après avoir quitté le thème', async () => {
    const model = modeleMilieux()
    let resolveFacts!: (value: unknown) => void
    const pending = new Promise((resolve) => { resolveFacts = resolve })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', vi.fn(() => pending))
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=milieux', vi.fn(async () => model))
    await router.replace({ query: { theme: 'habitat' } }); await flushPromises()
    resolveFacts({ ok: true, json: async () => reponseThemeMilieuxApi(model) }); await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('Source API milieux')
    wrapper.unmount()
  })

  it('rend le rang de comparaison API sur la fiche Habitat puis actualise la portée sélectionnée', async () => {
    expect(directionIndicateur('habitat', 'part_passoires')).toBe('moins-est-mieux')
    const model = modeleAvecContextesComparaison()
    const densite = model.themes.mobilite!.comparisons.densite!.scope.label
    const epci = model.themes.mobilite!.comparisons.epci!.scope.label
    let selectedRank = 8
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => {
      if (url.endsWith('/facts')) return reponseThemeHabitatApi(model, 'commune', '22001')
      const selection = JSON.parse(String(options?.body)).selection
      return { contract: 'theme-comparison-v1', theme_id: 'habitat', selection,
        content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
        scope: { kind: 'explicit_selection' }, results: [{ indicator_id: 'part_passoires', status: 'available',
          direction: 'low', rank: selectedRank, rank_size: 20 }], profile_comparisons: [] }
    } }))
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=habitat', vi.fn(async () => model))
    const chip = () => wrapper.findComponent(PuceRang)
    expect(chip().exists()).toBe(true)
    expect(chip().props('puce').rang).toContain('3e/14')
    expect(chip().props('puce').rang).toContain(densite)
    expect(directionIndicateur('habitat', 'part_passoires')).toBeTruthy()
    selectedRank = 8
    await router.replace({ query: { theme: 'habitat', comparaison: 'epci' } }); await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/comparison'))).toHaveLength(1)
    expect(chip().props('puce').rang).toContain('8e/20')
    expect(chip().props('puce').rang).toContain(epci)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('42')
    wrapper.unmount()
  })

  it('retire le chip si le résultat est indisponible et efface le chip après échec de comparaison', async () => {
    const model = modeleAvecContextesComparaison()
    let invalid = false
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => {
      if (url.endsWith('/facts')) {
        const facts = reponseThemeHabitatApi(model, 'commune', '22001')
        if (invalid) facts.comparison.results[0].status = 'unavailable'
        return facts
      }
      const selection = JSON.parse(String(options?.body)).selection
      return { contract: 'theme-comparison-v1', theme_id: 'habitat', selection,
        content_version: 'habitat-scalar-v1', reference_content_version: 'wrong-token',
        results: [], profile_comparisons: [] }
    } }))
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    invalid = true
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat', vi.fn(async () => model))
    expect(wrapper.findComponent(PuceRang).exists()).toBe(false)
    wrapper.unmount()
    invalid = false
    const mounted = await monter('/territoire/commune/22001?theme=habitat', vi.fn(async () => model))
    expect(mounted.wrapper.findComponent(PuceRang).exists()).toBe(true)
    await mounted.router.replace({ query: { theme: 'habitat', comparaison: 'epci' } }); await flushPromises()
    expect(mounted.wrapper.findComponent(PuceRang).exists()).toBe(false)
    expect(mounted.wrapper.get('[role="alert"]').text()).toContain('Les comparaisons de ce thème ne sont pas disponibles')
    expect(mounted.wrapper.get('[role="tabpanel"]').text()).toContain('42')
    mounted.wrapper.unmount()
  })

  it('laisse à la variante E la propriété de son unique POST Mobilité, sans acquisition en doublon', async () => {
    const model = modeleAvecContextesComparaison()
    await (varianteDeUrl('E')?.composant as any).__asyncLoader?.()
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    const fetchApi = vi.fn(async (_url: string, _options?: RequestInit) => ({ ok: true, json: async () => reponseThemeMobiliteApi(model, 'commune', '22001', null) }))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite&variant=E', vi.fn(async () => model))
    const facts = fetchApi.mock.calls.filter(([url]) => String(url).includes('/themes/mobilite/facts'))
    expect(facts).toHaveLength(1)
    expect(String(facts[0]![0])).toBe('/api/territories/commune/22001/themes/mobilite/facts')
    wrapper.unmount()
  })

  it('acquiert Mobilité pour l’onglet normal sans variante', async () => {
    const model = modeleAvecContextesComparaison()
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    const response = reponseThemeMobiliteApi(model, 'commune', '22001', null)
    const fetchApi = vi.fn(async (_url: string, _options?: RequestInit) => ({ ok: true, json: async () => response }))
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', vi.fn(async () => model))
    const facts = fetchApi.mock.calls.filter(([url]) => String(url).includes('/themes/mobilite/facts'))
    expect(facts).toHaveLength(1)
    expect(JSON.parse(String(facts[0]![1]?.body))).toEqual({ theme_id: 'mobilite' })
    wrapper.unmount()
  })

  it('rend Mobilité et sa figure depuis les bins servis, mais garde la figure absente sans bins', async () => {
    const model = modeleAvecContextesComparaison()
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => reponseThemeMobiliteApi(model, 'commune', '22001', null, undefined, true) })))
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', vi.fn(async () => model))
    await flushPromises()
    const texte = wrapper.get('[role="tabpanel"]').text()
    // La valeur API (0,87 → 87) rend ; la valeur statique (1 → 100) est absente.
    expect(texte).toContain('87')
    expect(texte).not.toContain('100%Alimentation')
    // La lecture rend ses paramètres servis (le texte porte 38)…
    const lecture = wrapper.get('[data-groupe="acces-aux-services"]')
    expect(lecture.text()).toContain('38')
    expect(wrapper.findComponent(GraphiqueDistributionMobilite).exists()).toBe(true)
    wrapper.unmount()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => reponseThemeMobiliteApi(model, 'commune', '22001', null) })))
    const absent = await monter('/territoire/commune/22001?theme=mobilite', vi.fn(async () => model))
    await flushPromises()
    expect(absent.wrapper.findComponent(GraphiqueDistributionMobilite).exists()).toBe(false)
    absent.wrapper.unmount()
  })

  it('Mobilité : réchauffée en arrière-plan après Programmes, aucune nouvelle requête à la revisite', async () => {
    const model = modeleAvecContextesComparaison()
    const fetchApi = vi.fn(async (url: string) => {
      if (String(url).endsWith('/themes/programmes/facts')) return { ok: true, json: async () => reponseThemeProgrammesApi() }
      if (String(url).endsWith('/themes/mobilite/facts')) return { ok: true, json: async () => reponseThemeMobiliteApi(model, 'commune', '22001', null) }
      const theme = String(url).match(/\/themes\/([^/]+)\/facts$/)?.[1]
      if (theme) return { ok: true, json: async () => ({ ...reponseThemeProgrammesApi(), theme_id: theme,
        indicators: [], readings: [], comparison: { contract: 'theme-comparison-v1', theme_id: theme,
          content_version: 'v1', reference_content_version: 'v1', selection: null, results: [], profile_comparisons: [] } }) }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router } = await monter('/territoire/commune/22001', vi.fn(async () => model))
    await flushPromises()
    // Programmes prioritaire ; Mobilité se réchauffe avec le reste du registre.
    expect(String(fetchApi.mock.calls[0]![0])).toContain('/themes/programmes/facts')
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/mobilite/facts'))).toHaveLength(1)
    await router.replace({ query: { theme: 'mobilite' } }); await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/mobilite/facts'))).toHaveLength(1)
    await router.replace({ query: { theme: 'habitat' } }); await flushPromises()
    await router.replace({ query: { theme: 'mobilite' } }); await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/mobilite/facts'))).toHaveLength(1)
  })

  it('un changement de territoire réchauffe pour le nouveau et une réponse tardive de l’ancien ne se fond jamais', async () => {
    // Programmes actif sur 22001 ; le réchauffage Habitat de 22001 pends.
    let resolveHabitat22001!: (value: unknown) => void
    const pending = new Promise((resolve) => { resolveHabitat22001 = resolve })
    const generique = (type: string, code: string, theme: string) => ({ ...reponseThemeProgrammesApi(), theme_id: theme,
      territory: { territory_id: code, territory_type: type, name: code },
      indicators: [], readings: [],
      comparison: { contract: 'theme-comparison-v1', theme_id: theme, content_version: 'v1',
        reference_content_version: 'v1', selection: null, results: [], profile_comparisons: [] } })
    const fetchApi = vi.fn(async (url: string) => {
      const m = String(url).match(/^\/api\/territories\/(commune|epci|departement|region)\/([^/]+)\/themes\/([^/]+)\/facts$/)
      if (!m) throw new Error(`Unexpected request: ${url}`)
      if (m[2] === '22001' && m[3] === 'habitat') return pending
      return { ok: true, json: async () => generique(m[1]!, m[2]!, m[3]!) }
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001', vi.fn(async (_type, territoire) => modelFor(territoire)))
    await flushPromises()
    expect(String(fetchApi.mock.calls[0]![0])).toContain('/themes/programmes/facts')
    // 22001 : Programmes résolu + quatre réchauffages résolus + Habitat pendants.
    expect(fetchApi.mock.calls.filter(([url]) => String(url).startsWith('/api/territories/commune/22001/themes/'))).toHaveLength(6)
    // Navigation vers 22002 pendant que le réchauffage 22001/Habitat pends.
    await router.push('/territoire/commune/22002'); await flushPromises()
    // Le nouveau territoire acquiert son actif puis réchauffe SON registre.
    expect(fetchApi.mock.calls.filter(([url]) => String(url).startsWith('/api/territories/commune/22002/themes/'))).toHaveLength(6)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    // La réponse tardive de 22001/Habitat arrive APRÈS la navigation : elle ne
    // peut peupler que sa propre clé de cache.
    resolveHabitat22001({ ok: true, json: async () => generique('commune', '22001', 'habitat') })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    // Retour sur 22001 : tout est en cache — aucune nouvelle requête de faits.
    await router.push('/territoire/commune/22001'); await flushPromises()
    await router.replace({ query: { theme: 'habitat' } }); await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/facts'))).toHaveLength(12)
    wrapper.unmount()
  })

  it('Mobilité : les faits en attente n’exposent aucune valeur statique, puis rendent', async () => {
    const model = modeleAvecContextesComparaison()
    let resolveFacts!: (value: unknown) => void
    const pending = new Promise((resolve) => { resolveFacts = resolve })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', vi.fn(() => pending))
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', vi.fn(async () => model))
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('100%Alimentation')
    resolveFacts({ ok: true, json: async () => reponseThemeMobiliteApi(model, 'commune', '22001', null) })
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('87')
    wrapper.unmount()
  })

  it('Mobilité : échec fermé sans repli statique, puis réessai', async () => {
    const model = modeleAvecContextesComparaison()
    let echecs = 0
    const fetchApi = vi.fn(async () => {
      if (++echecs === 1) throw new Error('API indisponible')
      return { ok: true, json: async () => reponseThemeMobiliteApi(model, 'commune', '22001', null) }
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', vi.fn(async () => model))
    await flushPromises()
    const alerte = wrapper.get('[role="alert"]')
    expect(alerte.text()).toContain('Les indicateurs de ce thème ne sont pas disponibles.')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('100%Alimentation')
    await alerte.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('87')
    wrapper.unmount()
  })

  it('Mobilité : une seule comparaison par changement de sélection, écho exact, faits focaux gardés', async () => {
    const model = modeleAvecContextesComparaison()
    const epciAttendu = model.cohortTerritories!.filter((item: any) =>
      item.type === 'commune' && item.epci === model.territory.epci)
      .map((item: any) => ({ territory_type: item.type, territory_id: item.territoire }))
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).endsWith('/facts')) return { ok: true, json: async () => reponseThemeMobiliteApi(model, 'commune', '22001', null) }
      const demandee = JSON.parse(String(options?.body)).selection as { territory_type: string; territory_id: string }[]
      return { ok: true, json: async () => ({ contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'mobilite',
        content_version: 'mobilite-v1', reference_content_version: 'territories-v1',
        selection: demandee, scope: { kind: 'explicit_selection', member_count: demandee.length },
        results: [], profile_comparisons: [], reading_content_version: 'mobilite-v1', reading_cloud: null }) }
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubEnv('VITE_SCALAR_COHORT_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite', vi.fn(async () => model))
    await flushPromises()
    // Le défaut déclaré est servi par la comparaison imbriquée : aucun POST de comparaison.
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/comparison'))).toHaveLength(0)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('87')
    await router.replace({ query: { theme: 'mobilite', comparaison: 'epci' } }); await flushPromises()
    const comparaisons = fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/mobilite/comparison'))
    expect(comparaisons).toHaveLength(1)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    expect(JSON.parse(String(comparaisons[0]![1]!.body))).toEqual({ theme_id: 'mobilite', selection: epciAttendu })
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('87')
    // Revisite de la comparaison acquise : aucune nouvelle requête, faits inchangés.
    await router.replace({ query: { theme: 'mobilite', comparaison: 'bretagne' } }); await flushPromises()
    await router.replace({ query: { theme: 'mobilite', comparaison: 'epci' } }); await flushPromises()
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/mobilite/comparison'))).toHaveLength(2)
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/mobilite/facts'))).toHaveLength(1)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    wrapper.unmount()
  })

  it('Mobilité : tokens de comparaison incompatibles → échec fermé réessayable, puis réponse périmée ignorée', async () => {
    const model = modeleAvecContextesComparaison()
    let comparaisons = 0
    let resolveBretagne: ((value: unknown) => void) | undefined
    const bretagne = new Promise((resolve) => { resolveBretagne = resolve })
    const reponseComparaison = (selection: unknown, tokens = 'territories-v1') => ({
      contract: 'theme-comparison-v1', complete_theme: false, theme_id: 'mobilite',
      content_version: 'mobilite-v1', reference_content_version: tokens,
      selection, scope: { kind: 'explicit_selection', member_count: (Array.isArray(selection) ? selection.length : 0) },
      results: [], profile_comparisons: [], reading_content_version: 'mobilite-v1', reading_cloud: null })
    const fetchApi = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).endsWith('/facts')) return { ok: true, json: async () => reponseThemeMobiliteApi(model, 'commune', '22001', null) }
      const demandee = JSON.parse(String(options?.body)).selection
      comparaisons += 1
      if (demandee.length > 100) return bretagne
      return { ok: true, json: async () => reponseComparaison(demandee, comparaisons === 1 ? 'jetons-périmés' : 'territories-v1') }
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1'); vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite&comparaison=epci', vi.fn(async () => model))
    await flushPromises()
    // Le premier POST échoue sur tokens incompatibles : bandeau, faits focaux intacts, réessayable.
    expect(wrapper.get('[role="alert"]').text()).toContain('Les comparaisons de ce thème ne sont pas disponibles.')
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('87')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    // La sélection bretagne lance une requête qui traîne ; on REPART vers epci
    // (la comparaison acquise en cache, aucune nouvelle requête) — puis la
    // réponse bretagne arrive TARD avec un écho vide : requête périmée, rejetée
    // sans corrompre l'état ni lever de bandeau.
    await router.replace({ query: { theme: 'mobilite', comparaison: 'bretagne' } }); await flushPromises()
    await router.replace({ query: { theme: 'mobilite', comparaison: 'epci' } }); await flushPromises()
    // Trois POST de comparaison ont eu lieu : épci (jetons périmés), son réessai, bretagne —
    // le retour à épci est servi par le cache, aucune nouvelle requête.
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/mobilite/comparison'))).toHaveLength(3)
    resolveBretagne?.(reponseComparaison([]))
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('87')
    expect(fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/themes/mobilite/facts'))).toHaveLength(1)
    wrapper.unmount()
  })
})

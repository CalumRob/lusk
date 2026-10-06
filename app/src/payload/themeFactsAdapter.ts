import type { Histoire, HistoireHabitat, HistoireMilieux, Indicateur, TerritoireType, VintageStamp } from './types'
import { RAISONS_SAILLANCE } from './types'
import type { ThemeKey, ThemeSelectionMember } from './themeAcquisition'

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
    if (!isRecord(source) || !texteNonVide(source.source_id) || !texteNonVide(source.name) ||
        !texteNonVide(source.version) ||
        !(source.reference_date === null || text(source.reference_date)) ||
        !(source.publication_date === null || text(source.publication_date))) {
      throw new Error(`Provenance SQL du thème invalide : ${contexte}`)
    }
    return { sourceId: source.source_id, source: source.name, version: source.version,
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
  const provenance = apiSources(fact.sources, String(fact.indicator_id))
  const measured = fact.status === 'measured'
  if (measured && !finite(fact.value)) throw new Error(`Valeur mesurée absente : ${String(fact.indicator_id)}`)
  const detail = text(dimensions.detail) ? dimensions.detail : text(dimensions.axis) ? dimensions.axis : null
  return {
    territoire: target.territoire, type: target.type, theme, key: fact.indicator_id,
    detail, sex: text(dimensions.sex) ? dimensions.sex as Indicateur['sex'] : null, dimension: null,
    value: measured ? fact.value as number : null, unit: fact.unit,
    rider: measured ? null : fact.status,
    observation_status: measured ? 'measured' : 'missing',
    observation_period: text(dimensions.observation_period) ? dimensions.observation_period : null,
    vintage_source: provenance[0]?.source ?? '', vintage_version: provenance[0]?.version ?? '',
    vintage_date_reference: provenance[0]?.referenceDate ?? null,
    vintage_date_publication: provenance[0]?.publicationDate ?? null,
    rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
    fact_sources: provenance.map((source) => ({ ...source, sourceId: source.sourceId ?? '' })),
  }
}

/** La lecture Habitat typée (classification, parts, n_dpe) — les nulls restent
 * nulls : la suppression se rend par l'état indisponible honnête, jamais par
 * un nombre inventé. La provenance portée par la réponse devient l'estampille
 * de la lecture (le modèle statique n'en portait pas). */
function histoireHabitatDeSql(
  target: { territoire: string; type: TerritoireType },
  reading: Row,
): Histoire {
  for (const key of ['groupe', 'story_key', 'salience_reason', 'status']) {
    if (!texteNonVide(reading[key])) throw new Error(`Lecture SQL Habitat invalide : ${key}`)
  }
  if (reading.story_key !== 'etat-energetique-du-parc' ||
      !RAISONS_SAILLANCE.includes(reading.salience_reason as (typeof RAISONS_SAILLANCE)[number])) {
    throw new Error('Lecture SQL Habitat non déclarée')
  }
  if (!(reading.classification === null || text(reading.classification)) ||
      !(reading.part_passoires === null || finite(reading.part_passoires)) ||
      !(reading.part_abc === null || finite(reading.part_abc)) ||
      !finite(reading.n_dpe)) {
    throw new Error('Valeurs de lecture SQL Habitat invalides')
  }
  const provenance = isRecord(reading.provenance)
    ? apiSources([{ source_id: reading.provenance.source_id, name: reading.provenance.source_name,
        version: reading.provenance.source_version,
        reference_date: reading.provenance.source_reference_date,
        publication_date: reading.provenance.source_publication_date }], 'lecture habitat')
    : []
  const lecture: HistoireHabitat & VintageStamp = {
    territoire: target.territoire, type: target.type, theme: 'habitat',
    groupe: reading.groupe as string, story_key: 'etat-energetique-du-parc',
    salience_reason: reading.salience_reason as 'defaut',
    classification: (reading.classification as string | null),
    part_passoires: (reading.part_passoires as number | null),
    part_abc: (reading.part_abc as number | null),
    n_dpe: reading.n_dpe as number,
    vintage_source: provenance[0]?.source ?? '', vintage_version: provenance[0]?.version ?? '',
    vintage_date_reference: provenance[0]?.referenceDate ?? null,
    vintage_date_publication: provenance[0]?.publicationDate ?? null,
  }
  return lecture
}

/** Lecture Milieux typed: keep every source-absent coordinate null and stamp
 * the reading with the population provenance supplied by the API. */
function histoireMilieuxDeSql(target: { territoire: string; type: TerritoireType }, reading: Row): Histoire {
  for (const key of ['groupe', 'story_key', 'salience_reason', 'status']) {
    if (!texteNonVide(reading[key])) throw new Error(`Lecture SQL Milieux invalide : ${key}`)
  }
  if (reading.story_key !== 'se-densifier-setaler-ou-sen-aller' ||
      !RAISONS_SAILLANCE.includes(reading.salience_reason as (typeof RAISONS_SAILLANCE)[number])) {
    throw new Error('Lecture SQL Milieux non déclarée')
  }
  const nullableText = (key: string) => reading[key] === null || text(reading[key])
  const nullableNumber = (key: string) => reading[key] === null || finite(reading[key])
  if (!nullableText('periode_pop') || !nullableText('periode_artif') || !finite(reading.delta_population) ||
      !nullableNumber('taux_variation_population') || !nullableNumber('artif_m2_par_habitant') ||
      !nullableNumber('artif_m3_par_habitant') || !nullableNumber('trajectoire_artif_par_habitant') ||
      !nullableText('classification')) throw new Error('Valeurs de lecture SQL Milieux invalides')
  const provenance = isRecord(reading.provenance)
    ? apiSources([{ source_id: reading.provenance.source_id, name: reading.provenance.source_name,
        version: reading.provenance.source_version, reference_date: reading.provenance.source_reference_date,
        publication_date: reading.provenance.source_publication_date }], 'lecture milieux') : []
  const lecture: HistoireMilieux & VintageStamp = {
    territoire: target.territoire, type: target.type, theme: 'milieux', groupe: reading.groupe as string,
    story_key: 'se-densifier-setaler-ou-sen-aller', salience_reason: reading.salience_reason as HistoireMilieux['salience_reason'],
    periode_pop: reading.periode_pop as string, periode_artif: reading.periode_artif as string | null,
    delta_population: reading.delta_population as number, taux_variation_population: reading.taux_variation_population as number | null,
    artif_m2: null, artif_m3: null, artif_m2_par_habitant: reading.artif_m2_par_habitant as number | null,
    artif_m3_par_habitant: reading.artif_m3_par_habitant as number | null,
    trajectoire_artif_par_habitant: reading.trajectoire_artif_par_habitant as number | null,
    classification: reading.classification as string | null,
    vintage_source: provenance[0]?.source ?? '', vintage_version: provenance[0]?.version ?? '',
    vintage_date_reference: provenance[0]?.referenceDate ?? null, vintage_date_publication: provenance[0]?.publicationDate ?? null,
  }
  return lecture
}

/** The comparison API deliberately returns only plotted peer coordinates. */
export function histoiresMilieuxDuNuage(response: unknown): HistoireMilieux[] {
  if (!isRecord(response) || !isRecord(response.reading_cloud) || !Array.isArray(response.reading_cloud.points)) return []
  return response.reading_cloud.points.flatMap((point): HistoireMilieux[] => {
    if (!isRecord(point) || !isRecord(point.territory) ||
        !texteNonVide(point.territory.territory_id) || !texteNonVide(point.territory.territory_type) ||
        !(point.territory.territory_type === 'commune' || point.territory.territory_type === 'epci' ||
          point.territory.territory_type === 'departement' || point.territory.territory_type === 'region') ||
        !(point.periode_pop === null || text(point.periode_pop)) || !(point.periode_artif === null || text(point.periode_artif)) ||
        !finite(point.taux_variation_population) || !finite(point.artif_m2_par_habitant) || !finite(point.artif_m3_par_habitant)) return []
    return [{ territoire: point.territory.territory_id, type: point.territory.territory_type, theme: 'milieux',
      groupe: 'land', story_key: 'se-densifier-setaler-ou-sen-aller', salience_reason: 'defaut',
      periode_pop: point.periode_pop as string, periode_artif: point.periode_artif as string | null,
      delta_population: 0, taux_variation_population: point.taux_variation_population as number,
      artif_m2: null, artif_m3: null, artif_m2_par_habitant: point.artif_m2_par_habitant as number,
      artif_m3_par_habitant: point.artif_m3_par_habitant as number,
      trajectoire_artif_par_habitant: null, classification: null }]
  })
}

export interface ThemeFactsRows {
  indicateurs: Indicateur[]
  histoires: Histoire[]
}

/** Projette une réponse `theme-facts-v1` en lignes consommables par la fiche. */
export function themeFactsRowsFromApi(
  theme: ThemeKey,
  response: unknown,
  target: { territoire: string; type: TerritoireType },
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
  const indicateurs = rows(response.indicators, 'indicators')
    .map((fact) => indicateurDeSql(theme, target, fact, metadata))
  let histoires: Histoire[] = []
  if (theme === 'habitat') {
    histoires = rows(response.readings, 'readings').map((row) => histoireHabitatDeSql(target, row))
  } else if (theme === 'milieux') {
    histoires = rows(response.readings, 'readings').map((row) => histoireMilieuxDeSql(target, row))
  } else if (response.readings.length > 0) {
    // Un thème non migré ne doit jamais franchir cette frontière : perdre une
    // lecture en silence serait un fait caché, pas une migration.
    throw new Error(`Thème non migré vers l’acquisition paresseuse : ${theme}`)
  }
  return { indicateurs, histoires }
}

/** Valide la réponse comparison-only d'un thème contre la sélection demandée —
 * l'écho doit être la liste du demandeur, dans son ordre (le serveur retient
 * la liste d'origine, jamais une liste résolue différente). */
export function validerReponseComparaisonTheme(
  theme: ThemeKey,
  response: unknown,
  selectionAttendue: readonly ThemeSelectionMember[],
): void {
  if (!isRecord(response) || response.contract !== 'theme-comparison-v1' || response.theme_id !== theme ||
      !Array.isArray(response.profile_comparisons)) {
    throw new Error('Réponse de comparaison du thème invalide')
  }
  rows(response.results, 'results')
  const echo = Array.isArray(response.selection) ? response.selection : []
  if (echo.length !== selectionAttendue.length || echo.some((item, index) => !isRecord(item) ||
      String(item.territory_type) !== selectionAttendue[index]!.territory_type ||
      String(item.territory_id) !== selectionAttendue[index]!.territory_id)) {
    throw new Error('La comparaison du thème ne reflète pas la sélection demandée')
  }
}

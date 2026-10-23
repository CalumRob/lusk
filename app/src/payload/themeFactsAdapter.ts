import type { Histoire, HistoireDemographie, HistoireEconomie, HistoireHabitat, HistoireMilieux, HistoireMobilite, Indicateur, TerritoireType, VintageStamp } from './types'
import { RAISONS_SAILLANCE } from './types'
import type { ThemeKey, ThemeResponse, ThemeSelectionMember } from './themeAcquisition'

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

function histoireDemographieDeSql(target: { territoire: string; type: TerritoireType }, reading: Row): Histoire {
  for (const key of ['groupe', 'story_key', 'salience_reason', 'status', 'classification', 'rate_unit']) {
    if (!texteNonVide(reading[key])) throw new Error(`Lecture SQL Démographie invalide : ${key}`)
  }
  if (reading.story_key !== 'trajectoire-demographique' || reading.salience_reason !== 'defaut' ||
      reading.rate_unit !== '‰' || !(reading.periode === null || text(reading.periode))) {
    throw new Error('Lecture SQL Démographie non déclarée')
  }
  for (const key of ['solde_naturel', 'solde_migratoire', 'taux_solde_naturel', 'taux_solde_migratoire']) {
    if (!finite(reading[key])) throw new Error(`Valeur SQL Démographie invalide : ${key}`)
  }
  if (!isRecord(reading.provenance)) throw new Error('Provenance SQL Démographie absente')
  const source = apiSources([{ source_id: reading.provenance.source_id, name: reading.provenance.source_name,
    version: reading.provenance.source_version, reference_date: reading.provenance.source_reference_date,
    publication_date: reading.provenance.source_publication_date }], 'lecture démographie')[0]!
  const row: HistoireDemographie & VintageStamp = {
    territoire: target.territoire, type: target.type, theme: 'demographie', groupe: reading.groupe as string,
    story_key: 'trajectoire-demographique', salience_reason: 'defaut', periode: reading.periode as string | null,
    solde_naturel: reading.solde_naturel as number, solde_migratoire: reading.solde_migratoire as number,
    taux_solde_naturel: reading.taux_solde_naturel as number, taux_solde_migratoire: reading.taux_solde_migratoire as number,
    classification: reading.classification as string, vintage_source: source.source, vintage_version: source.version,
    vintage_date_reference: source.referenceDate, vintage_date_publication: source.publicationDate,
  }
  return row
}

/** Maps only complete peer coordinate records; incomplete clouds remain honestly empty. */
export function histoiresDemographieNuage(response: unknown): HistoireDemographie[] {
  if (!isRecord(response) || !isRecord(response.reading_cloud)) return []
  const cloud = response.reading_cloud
  if (cloud.status !== 'available' || cloud.story_key !== 'trajectoire-demographique' ||
      !texteNonVide(cloud.groupe) || !Array.isArray(cloud.points)) return []
  return cloud.points.flatMap((point): HistoireDemographie[] => {
    if (!isRecord(point) || !isRecord(point.territory) || !texteNonVide(point.territory.territory_id) ||
        !['commune', 'epci', 'departement', 'region'].includes(String(point.territory.territory_type)) ||
        !finite(point.taux_solde_naturel) || !finite(point.taux_solde_migratoire) ||
        !(point.periode === null || text(point.periode))) return []
    return [{ territoire: point.territory.territory_id, type: point.territory.territory_type as TerritoireType,
      theme: 'demographie', groupe: cloud.groupe, story_key: 'trajectoire-demographique', salience_reason: 'defaut',
      periode: point.periode as string | null, solde_naturel: 0, solde_migratoire: 0,
      taux_solde_naturel: point.taux_solde_naturel, taux_solde_migratoire: point.taux_solde_migratoire,
      classification: '', vintage_source: '', vintage_version: '', vintage_date_reference: null,
      vintage_date_publication: null, nom: point.territory.name, nuageDemographieApi: true } as HistoireDemographie]
  })
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

function histoireMobiliteDeSql(target: { territoire: string; type: TerritoireType }, reading: Row, distribution?: unknown): Histoire {
  for (const key of ['groupe', 'story_key', 'salience_reason', 'status']) {
    if (!texteNonVide(reading[key])) throw new Error(`Lecture SQL Mobilité invalide : ${key}`)
  }
  if (!['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve'].includes(String(reading.story_key)) ||
      !RAISONS_SAILLANCE.includes(reading.salience_reason as (typeof RAISONS_SAILLANCE)[number])) {
    throw new Error('Lecture SQL Mobilité non déclarée')
  }
  if (reading.status !== 'measured' || !finite(reading.div_loss_t) || !finite(reading.div_loss_b) ||
      !(reading.classification_saillance === null || text(reading.classification_saillance)) ||
      !texteNonVide(reading.unit) || !isRecord(reading.provenance)) throw new Error('Valeurs de lecture SQL Mobilité invalides')
  const provenance = apiSources([{ source_id: reading.provenance.source_id, name: reading.provenance.source_name,
    version: reading.provenance.source_version, reference_date: reading.provenance.source_reference_date,
    publication_date: reading.provenance.source_publication_date }], 'lecture mobilité')[0]!
  const bins: Record<string, number | null> = Object.fromEntries([...Array(10)].flatMap((_, i) => [[`dens_${i + 1}`, null], [`dec_${i + 1}`, null]]))
  let minimum: number | null = null
  let maximum: number | null = null
  if (isRecord(distribution) && isRecord(distribution.range) && Array.isArray(distribution.points) &&
      distribution.range.status === 'measured' && finite(distribution.range.minimum) && finite(distribution.range.maximum)) {
    minimum = distribution.range.minimum
    maximum = distribution.range.maximum
    for (const point of distribution.points) {
      if (!isRecord(point) || !Number.isInteger(point.ordinal) || (point.ordinal as number) < 0) throw new Error('Distribution Mobilité invalide')
      const n = (point.ordinal as number) + 1
      bins[`dens_${n}`] = point.density_status === 'measured' && finite(point.density) ? point.density : null
      bins[`dec_${n}`] = point.decile_status === 'measured' && finite(point.decile) ? point.decile : null
    }
  }
  return { territoire: target.territoire, type: target.type, theme: 'mobilite', groupe: reading.groupe as string,
    story_key: reading.story_key as HistoireMobilite['story_key'],
    salience_reason: reading.salience_reason as HistoireMobilite['salience_reason'],
    div_loss_t: reading.div_loss_t as number, div_loss_b: reading.div_loss_b as number,
    delta: (reading.div_loss_t as number) - (reading.div_loss_b as number),
     pct_iso_full_t: null, dens_min: minimum, dens_max: maximum,
     ...bins,
    classification_saillance: reading.classification_saillance as string ?? '',
    vintage_source: provenance.source, vintage_version: provenance.version,
    vintage_date_reference: provenance.referenceDate, vintage_date_publication: provenance.publicationDate,
  } as HistoireMobilite
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

/** Lecture Économie typée : les membres d'activité PUBLIÉS deviennent les
 * lignes top-N du modèle incumbent ; un membre absent reste absent. */
function histoireEconomieDeSql(target: { territoire: string; type: TerritoireType }, reading: Row): Histoire {
  for (const key of ['groupe', 'story_key', 'salience_reason', 'status']) {
    if (!texteNonVide(reading[key])) throw new Error(`Lecture SQL Économie invalide : ${key}`)
  }
  if (reading.story_key !== 'ce-que-la-commune-abrite' ||
      !RAISONS_SAILLANCE.includes(reading.salience_reason as (typeof RAISONS_SAILLANCE)[number])) {
    throw new Error('Lecture SQL Économie non déclarée')
  }
  const provenance = isRecord(reading.provenance)
    ? apiSources([{ source_id: reading.provenance.source_id, name: reading.provenance.source_name,
        version: reading.provenance.source_version, reference_date: reading.provenance.source_reference_date,
        publication_date: reading.provenance.source_publication_date }], 'lecture economie')
    : []
  const history: Record<string, unknown> = { territoire: target.territoire, type: target.type, theme: 'economie',
    groupe: reading.groupe, story_key: reading.story_key, salience_reason: reading.salience_reason,
    vintage_source: provenance[0]?.source ?? '', vintage_version: provenance[0]?.version ?? '',
    vintage_date_reference: provenance[0]?.referenceDate ?? null, vintage_date_publication: provenance[0]?.publicationDate ?? null }
  if (!Array.isArray(reading.activities)) throw new Error('Membres d’activité SQL Économie invalides')
  reading.activities.forEach((activity, index) => {
    if (!isRecord(activity) || !texteNonVide(activity.activity_code) || !texteNonVide(activity.activity_label) ||
        !(activity.lq === null || finite(activity.lq)) || !finite(activity.n) || !(activity.part_parc === null || finite(activity.part_parc))) throw new Error('Membre d’activité SQL Économie invalide')
    const rank = index + 1
    // Le contrat sert « jusqu'à cinq identités d'activité ordonnées et
    // réellement peuplées » (spéc #627 — preuves requises, Économie) ; le
    // rang suit l'ordre du producteur, la limite est validée, jamais choisie.
    if (rank > 5) throw new Error('Trop de membres d’activité SQL Économie')
    Object.assign(history, { [`top${rank}_activity_code`]: activity.activity_code,
      [`top${rank}_activity_label`]: activity.activity_label, [`top${rank}_lq`]: activity.lq,
      [`top${rank}_n`]: activity.n, [`top${rank}_part_parc`]: activity.part_parc })
  })
  return history as unknown as HistoireEconomie
}

export interface ThemeFactsRows {
  indicateurs: Indicateur[]
  histoires: Histoire[]
}

function sourceName(source: Row): unknown { return source.name ?? source.source_name }

function normalizeNativeSources(value: unknown): Row[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((source) => ({ ...source, name: sourceName(source) }))
}

function provenanceIdentity(source: Row): string {
  return `${String(source.source_id ?? '')}\u0000${String(source.vintage_id ?? '')}`
}

/**
 * Adapt the producer's declared native resource envelopes to the fiche's
 * existing fact grammar. This is a consumer projection only: resource
 * membership, shapes, axes, units, statuses and lineage stay API-owned.
 */
function normaliserRessourcesNatives(theme: ThemeKey, acquired: ThemeResponse,
  target: { territoire: string; type: TerritoireType }): Row {
  if (!Array.isArray(acquired.resource_reads)) throw new Error('Lectures sémantiques du thème absentes')
  const indicators: Row[] = []
  const indicatorMetadata: Row[] = []
  const collections: Row[] = []
  const ownedSeries: Row[] = []
  const readings: Row[] = []
  const namedReferences: Row[] = []
  const provenanceByIdentity = new Map<string, Row>()
  const reads = acquired.resource_reads

  for (const read of reads) {
    if (!isRecord(read) || !texteNonVide(read.resource) || !isRecord(read.data) ||
        read.data.resource !== read.resource || !isRecord(read.data.target) ||
        read.data.target.kind !== 'territory' || read.data.target.id !== target.territoire || read.data.target.type !== target.type) {
      throw new Error('Identité de lecture sémantique du thème invalide')
    }
    const data = read.data
    const sources: Row[] = [
      ...normalizeNativeSources(data.sources),
      ...(Array.isArray(data.observations) ? data.observations.flatMap((cell) => isRecord(cell) ? normalizeNativeSources(cell.sources) : []) : []),
      ...(Array.isArray(data.points) ? data.points.flatMap((point) => isRecord(point) ? normalizeNativeSources(point.provenance) : []) : []),
      ...(Array.isArray(data.entries) ? data.entries.flatMap((entry) => isRecord(entry) ? normalizeNativeSources(entry.sources) : []) : []),
      ...(Array.isArray(data.source_bindings) ? normalizeNativeSources(data.source_bindings).map((source) => ({
        ...source, version: source.source_version, reference_date: source.reference_date ?? source.source_reference_date,
        publication_date: source.publication_date ?? source.source_publication_date,
      })) : []),
    ]
    for (const source of sources) {
      if (texteNonVide(source.source_id) && texteNonVide(source.vintage_id)) {
        provenanceByIdentity.set(provenanceIdentity(source), source)
      }
    }
  }

  for (const read of reads) {
    const data = read.data
    const resource = read.resource
    const shapes = Array.isArray(read.shapes) ? read.shapes : []
    if (shapes.includes('typed_reading')) {
      if (!Array.isArray(data.facts)) throw new Error(`Lecture typée sémantique invalide : ${resource}`)
      for (const candidate of rows(data.facts, 'typed_reading.facts')) {
        if (!texteNonVide(candidate.groupe)) throw new Error('Groupe de lecture typée absent')
        const source = provenanceByIdentity.get(provenanceIdentity(candidate))
        const binding = rows(data.source_bindings ?? [], 'typed_reading.source_bindings')
          .find((row) => row.source_id === candidate.source_id && row.vintage_id === candidate.vintage_id)
        const actualSource = source ?? (binding ? {
          source_id: binding.source_id, name: binding.source_name, version: binding.source_version,
          reference_date: binding.reference_date ?? binding.source_reference_date,
          publication_date: binding.publication_date ?? binding.source_publication_date,
        } : null)
        if (candidate.source_id && (!actualSource || !texteNonVide(sourceName(actualSource)) || !texteNonVide(actualSource.version))) {
          throw new Error(`Provenance de lecture typée non résolue : ${String(candidate.source_id)}`)
        }
        const reading: Row = { ...candidate, provenance: actualSource ? {
          source_id: actualSource.source_id, source_name: sourceName(actualSource), source_version: actualSource.version,
          source_reference_date: actualSource.reference_date ?? null,
          source_publication_date: actualSource.publication_date ?? null,
        } : null }
        if (Array.isArray(data.ranked_activities)) {
          reading.activities = rows(data.ranked_activities, 'ranked_activities')
            .filter((item) => item.groupe === candidate.groupe)
            .map((item) => ({ activity_code: item.activity_code, activity_label: item.activity_label,
              lq: item.lq, n: item.establishment_count, part_parc: item.park_share }))
        }
        readings.push(reading)
      }
      continue
    }
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
      const series: Row = { ...data, indicator_id: resource,
        points: points.map((point) => ({ ...point, provenance: normalizeNativeSources(point.provenance) })) }
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
      if (data.axis_kind && Array.isArray(data.axis_values)) {
        indicatorMetadata.push({ indicator_id: resource, axis_kind: data.axis_kind,
          axis_values: data.axis_values, axis_numeric_values: data.axis_numeric_values,
          comparison_point: data.comparison_point, completeness: data.completeness,
          comparison_contract: data.comparison_contract })
      }
      for (const reference of rows(data.named_references ?? [], 'series.named_references')) {
        namedReferences.push({ ...reference, indicator_id: resource,
          points: rows(reference.points, 'series.reference.points').map((point) => ({ ...point,
            provenance: normalizeNativeSources(point.provenance).map((source) => ({ ...source, source_name: source.name })) })) })
      }
      if (isRecord(data.context)) indicatorMetadata.push({ indicator_id: resource, unit: data.unit, context: data.context })
      continue
    }
    if ('value' in data || 'status' in data) {
      indicators.push({ indicator_id: resource, unit: data.unit, value: data.value, status: data.status,
        dimensions: {}, sources: normalizeNativeSources(data.sources) })
    }
  }

  const territory = acquired.target
  if (isRecord(territory) && (territory.id !== target.territoire || territory.type !== target.type)) {
    throw new Error('Cible de la fiche différente des lectures sémantiques')
  }
  return { contract: 'theme-facts-v1', theme_id: theme,
    territory: { territory_id: target.territoire, territory_type: target.type },
    indicators, indicator_metadata: indicatorMetadata, named_reference_evidence: namedReferences,
    readings, collections, owned_series: ownedSeries }
}

export function semanticComparisonForTheme(response: unknown): Row | null {
  if (!isRecord(response) || !Array.isArray(response.comparison_reads)) return null
  const results: Row[] = []
  const profiles: Row[] = []
  for (const item of response.comparison_reads) {
    if (!isRecord(item) || !texteNonVide(item.resource) || !isRecord(item.data) || !isRecord(item.data.result)) {
      throw new Error('Résultat de comparaison sémantique invalide')
    }
    const result = item.data.result
    const shape = item.data.shape
    if (shape === 'declared_profile' || (Array.isArray(item.shapes) && item.shapes.includes('declared_profile'))) {
      profiles.push({ ...result, indicator: item.data.indicator_id ?? item.resource,
        facet: result.source_facet ?? result.facet })
    } else results.push({ ...result, indicator_id: item.data.indicator_id ?? item.resource })
  }
  return { results, profile_comparisons: profiles,
    selection: response.selection, scope: undefined }
}

export function themeFactsRowsFromSemantic(
  theme: ThemeKey,
  response: ThemeResponse,
  target: { territoire: string; type: TerritoireType },
  referential: { epci?: string | null; region?: string | null } = {},
): ThemeFactsRows {
  const normalized = normaliserRessourcesNatives(theme, response, target)
  return themeFactsRowsFromApi(theme, normalized, target, referential)
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
    const match = results.find((item) => item.indicator_id === row.key) ?? profiles.find((item) => {
      if (item.indicator !== row.key) return false
      const facet = isRecord(item.facet) ? item.facet : {}
      return (facet.detail ?? null) === (row.detail ?? null) && (facet.sex ?? null) === (row.sex ?? null)
    })
    if (!match || match.status !== 'available' || !['high', 'low'].includes(String(match.direction)) || !finite(match.rank)) return row
    if (!(match.rank_size === null || finite(match.rank_size))) throw new Error('Taille de rang API invalide')
    return { ...row, comparaisonApi: { rang: match.rank, taille: match.rank_size as number | null, portee } }
  })
}

function vintageSql(sources: unknown, context: string) {
  const provenance = apiSources(sources, context)
  const source = provenance[0]!
  if (source.referenceDate === null) throw new Error(`Date de référence absente : ${context}`)
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
      if (collection.availability === 'no_record') continue
      const add = (territory: { id: unknown; type: unknown }, entry: Row) => {
        if (!texteNonVide(territory.id) || !['commune', 'epci', 'departement', 'region'].includes(String(territory.type)) ||
            !texteNonVide(entry.detail) || !(entry.rider === null || text(entry.rider))) throw new Error('Adhésion Programmes invalide')
        // La grammaire incumbent lit le rider par correspondance exacte
        // (programmesPourTerritoire : `ligne.rider === 'convention valant ORT'`)
        // — le libellé produit est booléen dans cette collection (rider_label
        // servi seulement quand convention_valant_ort), la clé sémantique est
        // donc la constante requise par le contrat de la ligne.
        result.push({ territoire: territory.id, type: territory.type as TerritoireType, theme: 'programmes',
          key: 'couverture_programmes', detail: entry.detail, value: null, unit: 'count',
          rider: entry.rider ? 'convention valant ORT' : null, ...vintageSql(entry.sources, entry.detail),
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
      if (!texteNonVide(point.axis) || !(point.status === 'measured' ? finite(point.value) : point.value === null)) throw new Error('Point annuel Programmes invalide')
      result.push({ territoire: target.territoire, type: target.type, theme: 'programmes', key: 'subventions_annuelles',
        detail: null, dimension: point.axis, value: point.status === 'measured' ? point.value as number : null,
        unit: series.unit, rider: point.status === 'measured' ? null : text(point.missing_reason) ? point.missing_reason : String(point.status),
        ...vintageSql(point.provenance, point.axis), rang_epci: null, rang_epci_n: null,
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
  const indicateurs = rows(response.indicators, 'indicators')
    .map((fact) => indicateurDeSql(theme, target, fact, metadata))
  if (theme === 'programmes') indicateurs.push(...programmesRows(response, target, referential))
  if (theme === 'habitat') {
    for (const series of rows(response.owned_series ?? [], 'owned_series')) {
      if (series.indicator_id !== 'prix_m2') continue
      if (!texteNonVide(series.unit)) throw new Error('Unité de série Habitat absente')
      for (const point of rows(series.points, 'series.points')) {
        if (!texteNonVide(point.axis) || !(point.status === 'measured' ? finite(point.value) : point.value === null)) {
          throw new Error('Point annuel Habitat invalide')
        }
        const provenance = rows(point.provenance, 'series provenance')
        const converted = apiSources(provenance.map((source) => ({ source_id: source.source_id,
          name: source.source_name, version: source.version, reference_date: source.reference_date,
          publication_date: source.publication_date })), 'prix_m2')
        indicateurs.push({ territoire: target.territoire, type: target.type, theme, key: series.indicator_id,
          detail: point.axis, sex: null, dimension: null, value: point.status === 'measured' ? point.value as number : null,
          unit: series.unit as string, rider: point.status === 'measured' ? null : text(point.missing_reason) ? point.missing_reason as string : point.status as string,
          observation_status: point.status === 'measured' ? 'measured' : 'missing', observation_period: text(point.observation_period) ? point.observation_period : null,
          vintage_source: converted[0]?.source ?? '', vintage_version: converted[0]?.version ?? '',
          vintage_date_reference: converted[0]?.referenceDate ?? null, vintage_date_publication: converted[0]?.publicationDate ?? null,
          rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
          fact_sources: converted.map((source) => ({ ...source, sourceId: source.sourceId ?? '' })) })
      }
    }
  }
  let histoires: Histoire[] = []
  if (theme === 'habitat') {
    histoires = rows(response.readings, 'readings').map((row) => histoireHabitatDeSql(target, row))
  } else if (theme === 'demographie') {
    histoires = rows(response.readings, 'readings').map((row) => histoireDemographieDeSql(target, row))
  } else if (theme === 'milieux') {
    histoires = rows(response.readings, 'readings').map((row) => histoireMilieuxDeSql(target, row))
  } else if (theme === 'economie') {
    histoires = rows(response.readings, 'readings').map((row) => histoireEconomieDeSql(target, row))
  } else if (theme === 'mobilite') {
    const readings = rows(response.readings, 'readings')
    if (readings.length && readings.some((row) => row.story_key !== 'vingt-minutes-sans-voiture' && row.story_key !== 'ce-que-le-velo-preserve')) {
      throw new Error(`Thème non migré vers l’acquisition paresseuse : ${theme}`)
    }
    histoires = readings.map((row) => histoireMobiliteDeSql(target, row, response.density_distribution))
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
  selectionAttendue: readonly ThemeSelectionMember[] | undefined,
): void {
  if (isRecord(response) && Array.isArray(response.comparison_reads)) {
    if (response.theme_id !== theme ||
        (selectionAttendue === undefined ? response.selection !== undefined : !Array.isArray(response.selection))) {
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

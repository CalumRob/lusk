/**
 * PROTOTYPE ONLY — production must receive these coordinates declared by the
 * producer, never parse them from keys.
 *
 * This is the ONE module that reads `GET /api/resources` and turns it into
 * addressable Cellules. Everything the discovery payload does not say in
 * structured form is reconstructed here, loudly:
 *   - AEDAR `measure_facets` keys (`count_15_bike_lts2_share`, `walk20Diversity`)
 *     are split by regex into mode × minutes × statistic coordinates;
 *   - the TYPEQU universe comes from the pinned CSV registry (not discovery);
 *   - human labels for coordinate values (modes, sexes, bands…) are a hand map;
 *   - the BPE domain grouping of TYPEQU codes is guessed from the first letter.
 */
import { AEDAR_TYPEQU_REGISTRY } from '@/fiche/content/aedarTypequRegistry'

export type Level = 'commune' | 'epci' | 'departement'
export const LEVELS: readonly { id: Level; label: string }[] = [
  { id: 'commune', label: 'Commune' },
  { id: 'epci', label: 'EPCI' },
  { id: 'departement', label: 'Département' },
]

export interface AxisValue {
  value: string
  /** Select / token form: « Médecin généraliste », « À vélo (LTS 2) ». */
  label: string
  /** Sentence form, used by the Phrase variant: « à vélo (LTS 2) », « 15 min ». */
  phrase?: string
  /** Optional group for long lists (TYPEQU domains). */
  group?: string
}

export interface AxisDef {
  key: string
  label: string
  values: AxisValue[]
  /** Sentence connector placed before the slot (Phrase variant): ' — ', ' en ', ' à '. */
  join: string
  /** A "lead" axis opens the sentence (« Part des adresses accédant à »). */
  lead?: boolean
  defaultValue: string
}

export type Coordinates = Record<string, string>

export type Family = 'scalaire' | 'profil' | 'serie' | 'aedar'

export interface ResourceDef {
  id: string
  label: string
  themeId: string
  themeLabel: string
  group?: string
  unit: string
  family: Family
  axes: AxisDef[]
  /** Which coordinate combinations are declared (AEDAR keys). */
  isValid?: (coordinates: Coordinates) => boolean
  /** Unit may depend on a coordinate (AEDAR share is a %, mean is a count). */
  unitFor?: (coordinates: Coordinates) => string
  keywords: string
  order: number
}

export const THEME_LABELS: Record<string, string> = {
  demographie: 'Démographie',
  economie: 'Économie',
  habitat: 'Habitat',
  milieux: 'Milieux',
  mobilite: 'Mobilité',
  programmes: 'Programmes',
}
const THEME_ORDER = ['mobilite', 'demographie', 'habitat', 'economie', 'milieux', 'programmes']

/* ------------------------------------------------------------------ discovery */

interface RawResource {
  resource_id: string
  theme_id: string
  label: string
  unit: string
  shapes: string[]
  axes: string[]
  axis_values: [string, string[]][]
  allowed_levels: string[]
  resource_kind: string
  measure_facets: Record<string, { facet: string }>
}

const IGNORED_SHAPES = new Set(['typed_reading', 'named_reference', 'anchored_membership', 'period_detail'])
const IGNORED_IDS = new Set(['subventions_annuelles'])

let cataloguePromise: Promise<ResourceDef[]> | null = null
export function loadCatalogue(): Promise<ResourceDef[]> {
  cataloguePromise ??= fetch('/api/resources')
    .then((response) => {
      if (!response.ok) throw new Error(`GET /api/resources → ${response.status}`)
      return response.json() as Promise<{ resources: RawResource[] }>
    })
    .then(({ resources }) => buildCatalogue(resources))
    .catch((error) => {
      cataloguePromise = null
      throw error
    })
  return cataloguePromise
}

/* ----------------------------------------------------------------- label maps */

const sentenceCase = (text: string) => {
  const lower = text.toLocaleLowerCase('fr-FR')
  return lower.charAt(0).toLocaleUpperCase('fr-FR') + lower.slice(1)
}

const MODE_LABELS: Record<string, { label: string; phrase: string }> = {
  walk: { label: 'À pied', phrase: 'à pied' },
  bike_lts2: { label: 'À vélo (LTS 2)', phrase: 'à vélo (LTS 2)' },
  bike_lts4: { label: 'À vélo (LTS 4)', phrase: 'à vélo (LTS 4)' },
  transit: { label: 'En transports en commun', phrase: 'en transports en commun' },
  transit_gain: { label: 'Gain des transports en commun', phrase: 'avec le gain des transports en commun' },
  car: { label: 'En voiture', phrase: 'en voiture' },
  mean: { label: 'Tous modes (moyenne)', phrase: 'tous modes confondus' },
}

const STATISTIC_LABELS: Record<string, { label: string; lead: string }> = {
  share: { label: 'Part des adresses', lead: 'Part des adresses accédant à' },
  mean: { label: 'Nombre moyen', lead: 'Nombre moyen d’équipements de type' },
  min: { label: 'Minimum', lead: 'Nombre minimal d’équipements de type' },
  max: { label: 'Maximum', lead: 'Nombre maximal d’équipements de type' },
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`decile${n}`, { label: `Décile ${n}`, lead: `Décile ${n} du nombre d’équipements de type` }]),
  ),
}

/** BPE domain letters — a guess from the code prefix, for grouping a 235-long list. */
const TYPEQU_DOMAINS: Record<string, string> = {
  A: 'Services publics',
  B: 'Commerces et services',
  C: 'Enseignement',
  D: 'Santé et action sociale',
  E: 'Transports',
  F: 'Sports, loisirs, culture',
  G: 'Tourisme',
}

const DETAIL_LABELS: Record<string, Record<string, string>> = {
  structure_age: { '<15': 'moins de 15 ans', '15-24': '15-24 ans', '25-39': '25-39 ans', '40-54': '40-54 ans', '55-64': '55-64 ans', '65-79': '65-79 ans', '80+': '80 ans et plus' },
  age_du_bati: { lt1919: 'avant 1919', '1919_1945': '1919-1945', '1946_1970': '1946-1970', '1971_1990': '1971-1990', '1991_2005': '1991-2005', '2006_plus': '2006 et après' },
  distribution_dpe: Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => [l, `étiquette ${l}`])),
  mix_logements: { principales: 'résidences principales', secondaires: 'résidences secondaires', vacants: 'logements vacants' },
  statut: { proprietaire: 'propriétaires', hlm: 'locataires HLM', locataire_prive: 'locataires du parc privé', loge_gratuit: 'logés gratuitement' },
  type: { maison: 'maisons', appartement: 'appartements' },
  offre_cyclable: { protege_longueur: 'protégé — longueur', protege_km_1000: 'protégé — km pour 1 000 hab.', partage_longueur: 'partagé — longueur', partage_km_1000: 'partagé — km pour 1 000 hab.', total_longueur: 'total — longueur' },
  reseaux: { t_longueur: 'réseau à pied', b_longueur: 'réseau vélo', c_longueur: 'réseau voiture' },
  reseaux_par_habitant: { t_km_1000: 'à pied', b_km_1000: 'à vélo', c_km_1000: 'en voiture' },
  voitures_menage: { sans_voiture: 'sans voiture', une_voiture: 'une voiture', deux_plus: 'deux voitures ou plus' },
  artif_par_habitant: { M2: 'état M2', M3: 'état M3' },
}

const AXIS_LABELS: Record<string, Record<string, string>> = {
  structure_age: { detail: 'Tranche d’âge', sex: 'Sexe' },
  age_du_bati: { detail: 'Période de construction' },
  distribution_dpe: { detail: 'Étiquette' },
  mix_logements: { detail: 'Catégorie de logement' },
  statut: { detail: 'Statut d’occupation' },
  type: { detail: 'Type' },
  offre_cyclable: { detail: 'Aménagement' },
  reseaux: { detail: 'Réseau' },
  reseaux_par_habitant: { detail: 'Réseau' },
  voitures_menage: { detail: 'Équipement du ménage' },
  artif_par_habitant: { declared_detail: 'Repère' },
  raccordement_courbe: { duration_minute: 'Temps de trajet' },
}
const SEX_LABELS: Record<string, string> = { F: 'femmes', M: 'hommes' }

const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase('fr-FR') + s.slice(1)

/* ------------------------------------------------------------------ AEDAR keys */

// Regexes over producer keys — the shameful part. See header.
const AGGREGATE_KEY = /^count_(\d+)_(walk|bike_lts2|bike_lts4|transit_gain|transit|car)_(share|mean|min|max|decile[1-9])$/
const SUMMARY_KEY = /^(?:(walk|transit|car)(\d+)|(bike_lts[24])(\d+)|(mean))(Diversity|Volume)$/

interface ParsedKeys {
  aggregate: Set<string> // `${mode}|${minutes}|${statistic}`
  summary: Set<string> // `${facet}|${mode}|${minutes}`
  aggregateModes: string[]
  aggregateMinutes: string[]
  aggregateStatistics: string[]
  summaryModes: string[]
  summaryMinutes: string[]
}

function parseAedarKeys(aggregateKeys: string[], summaryKeys: string[]): ParsedKeys {
  const aggregate = new Set<string>()
  const modes = new Set<string>()
  const minutes = new Set<string>()
  const statistics = new Set<string>()
  const summary = new Set<string>()
  const summaryModes = new Set<string>()
  const summaryMinutes = new Set<string>()
  for (const key of aggregateKeys) {
    const match = AGGREGATE_KEY.exec(key)
    if (!match) continue // summary-style keys also leak into the aggregate resource's facets
    aggregate.add(`${match[2]}|${match[1]}|${match[3]}`)
    modes.add(match[2]!)
    minutes.add(match[1]!)
    statistics.add(match[3]!)
  }
  for (const key of summaryKeys) {
    const match = SUMMARY_KEY.exec(key)
    if (!match) continue
    const mode = match[1] ?? match[3] ?? 'mean'
    const duration = match[2] ?? match[4] ?? 'moy'
    summary.add(`${match[6]}|${mode}|${duration}`)
    summaryModes.add(mode)
    summaryMinutes.add(duration)
  }
  const byNumber = (a: string, b: string) => Number(a) - Number(b)
  const statOrder = Object.keys(STATISTIC_LABELS)
  return {
    aggregate,
    summary,
    aggregateModes: ['walk', 'bike_lts2', 'bike_lts4', 'transit', 'transit_gain', 'car'].filter((m) => modes.has(m)),
    aggregateMinutes: [...minutes].sort(byNumber),
    aggregateStatistics: statOrder.filter((s) => statistics.has(s)),
    summaryModes: ['walk', 'bike_lts2', 'bike_lts4', 'transit', 'car', 'mean'].filter((m) => summaryModes.has(m)),
    summaryMinutes: [...summaryMinutes].sort(byNumber),
  }
}

/* ------------------------------------------------------------------- catalogue */

function minutesValues(values: string[]): AxisValue[] {
  return values.map((value) => (value === 'moy' ? { value, label: 'Toutes durées', phrase: 'toutes durées' } : { value, label: `${value} min`, phrase: `${value} min` }))
}

export function buildCatalogue(raw: RawResource[]): ResourceDef[] {
  const resources: ResourceDef[] = []
  let order = 0

  for (const r of raw) {
    if (r.resource_id.startsWith('aedar_')) continue
    if (r.shapes.some((shape) => IGNORED_SHAPES.has(shape)) || IGNORED_IDS.has(r.resource_id)) continue
    const themeId = r.theme_id || 'mobilite'
    const axisValues = new Map(r.axis_values)
    const hasSeries = r.shapes.includes('ordered_series')
    const hasProfile = r.shapes.includes('declared_profile')
    const axes: AxisDef[] = []
    for (const axis of r.axes) {
      const values = axisValues.get(axis) ?? (axis === 'sex' ? ['F', 'M'] : [])
      if (!values.length) continue
      const isYear = axis === 'year'
      const isMinute = axis === 'duration_minute'
      const values_: AxisValue[] = values.map((value) => {
        if (axis === 'sex') return { value, label: capitalise(SEX_LABELS[value] ?? value), phrase: SEX_LABELS[value] ?? value }
        if (isMinute) return { value, label: `${value} min`, phrase: `${value} min` }
        if (isYear) return { value, label: value, phrase: value }
        const text = DETAIL_LABELS[r.resource_id]?.[value] ?? value
        return { value, label: capitalise(text), phrase: text }
      })
      axes.push({
        key: axis,
        label: AXIS_LABELS[r.resource_id]?.[axis] ?? (isYear ? 'Année' : axis === 'sex' ? 'Sexe' : 'Détail'),
        values: values_,
        join: isYear ? ' en ' : isMinute ? ' à ' : ' — ',
        // Series default to the latest year / a mid duration; profiles to their first band.
        defaultValue: isYear ? values[values.length - 1]! : isMinute ? (values.includes('60') ? '60' : values[0]!) : values[0]!,
      })
    }
    const family: Family = hasProfile ? 'profil' : hasSeries ? 'serie' : 'scalaire'
    resources.push({
      id: r.resource_id,
      label: r.label,
      themeId,
      themeLabel: THEME_LABELS[themeId] ?? themeId,
      unit: r.unit,
      family,
      axes,
      keywords: '',
      order: order++,
    })
  }

  // AEDAR — two resources synthesised from facet keys.
  const aggregate = raw.find((r) => r.resource_id === 'aedar_territorial_aggregate')
  const summary = raw.find((r) => r.resource_id === 'aedar_territory_summary')
  if (aggregate && summary) {
    const keys = parseAedarKeys(Object.keys(aggregate.measure_facets), Object.keys(summary.measure_facets))
    const typequ: AxisValue[] = AEDAR_TYPEQU_REGISTRY.map(({ code, label }) => ({
      value: code,
      label: sentenceCase(label),
      phrase: sentenceCase(label),
      group: `${code.charAt(0)} · ${TYPEQU_DOMAINS[code.charAt(0)] ?? 'Autres'}`,
    }))
    resources.push({
      id: 'aedar_territorial_aggregate',
      label: 'Accès aux équipements — par type d’équipement',
      themeId: 'mobilite',
      themeLabel: THEME_LABELS.mobilite!,
      group: 'Accès aux équipements',
      unit: '%',
      family: 'aedar',
      keywords: 'aedar bpe equipement acces temps de trajet adresses',
      order: order++,
      axes: [
        {
          key: 'statistic',
          label: 'Statistique',
          lead: true,
          join: '',
          defaultValue: 'share',
          values: keys.aggregateStatistics.map((s) => ({ value: s, label: STATISTIC_LABELS[s]!.label, phrase: STATISTIC_LABELS[s]!.lead })),
        },
        { key: 'typequ', label: 'Équipement (TYPEQU)', join: ' ', defaultValue: 'D265', values: typequ },
        {
          key: 'mode',
          label: 'Mode',
          join: ' ',
          defaultValue: 'bike_lts2',
          values: keys.aggregateModes.map((m) => ({ value: m, ...MODE_LABELS[m]! })),
        },
        { key: 'minutes', label: 'Durée', join: ' en ', defaultValue: '15', values: minutesValues(keys.aggregateMinutes) },
      ],
      isValid: (c) => keys.aggregate.has(`${c.mode}|${c.minutes}|${c.statistic}`),
      unitFor: (c) => (c.statistic === 'share' ? '%' : 'équipements'),
    })
    resources.push({
      id: 'aedar_territory_summary',
      label: 'Accès aux équipements — diversité et volume',
      themeId: 'mobilite',
      themeLabel: THEME_LABELS.mobilite!,
      group: 'Accès aux équipements',
      unit: 'types d’équipements',
      family: 'aedar',
      keywords: 'aedar bpe equipement synthese diversite volume acces',
      order: order++,
      axes: [
        {
          key: 'facet',
          label: 'Mesure',
          lead: true,
          join: '',
          defaultValue: 'Diversity',
          values: [
            { value: 'Diversity', label: 'Diversité', phrase: 'Diversité de l’offre accessible' },
            { value: 'Volume', label: 'Volume', phrase: 'Volume de l’offre accessible' },
          ],
        },
        { key: 'mode', label: 'Mode', join: ' ', defaultValue: 'car', values: keys.summaryModes.map((m) => ({ value: m, ...MODE_LABELS[m]! })) },
        { key: 'minutes', label: 'Durée', join: ' en ', defaultValue: '15', values: minutesValues(keys.summaryMinutes) },
      ],
      isValid: (c) => keys.summary.has(`${c.facet}|${c.mode}|${c.minutes}`),
      unitFor: (c) => (c.facet === 'Volume' ? 'équipements' : 'types d’équipements'),
    })
  }

  return resources.sort(
    (a, b) => THEME_ORDER.indexOf(a.themeId) - THEME_ORDER.indexOf(b.themeId) || (a.group ? 1 : 0) - (b.group ? 1 : 0) || a.order - b.order,
  )
}

/* --------------------------------------------------------------- addressing */

export function defaultCoordinates(resource: ResourceDef): Coordinates {
  const coordinates: Coordinates = {}
  for (const axis of resource.axes) coordinates[axis.key] = axis.defaultValue
  return normaliseCoordinates(resource, coordinates)
}

/** Options of one axis that remain declared given the other current coordinates. */
export function axisOptions(resource: ResourceDef, axisKey: string, coordinates: Coordinates): AxisValue[] {
  const axis = resource.axes.find((a) => a.key === axisKey)
  if (!axis) return []
  if (!resource.isValid) return axis.values
  return axis.values.filter((v) => resource.isValid!({ ...coordinates, [axisKey]: v.value }))
}

/** Snap undeclared combinations (e.g. a mode with no 5-minute key) to the nearest declared one. */
export function normaliseCoordinates(resource: ResourceDef, coordinates: Coordinates, changed?: string): Coordinates {
  let next = { ...coordinates }
  if (!resource.isValid || resource.isValid(next)) return next
  // Keep the axis the reader just touched; repair the others in declaration order.
  for (const axis of resource.axes) {
    if (axis.key === changed || resource.isValid(next)) continue
    const options = axisOptions(resource, axis.key, next)
    if (options.length && !options.some((o) => o.value === next[axis.key])) next = { ...next, [axis.key]: options[0]!.value }
  }
  return next
}

export function axisValueLabel(resource: ResourceDef, axisKey: string, value: string, form: 'label' | 'phrase' = 'label'): string {
  const entry = resource.axes.find((a) => a.key === axisKey)?.values.find((v) => v.value === value)
  if (!entry) return value
  return form === 'phrase' ? (entry.phrase ?? entry.label) : entry.label
}

export function cellUnit(resource: ResourceDef, coordinates: Coordinates): string {
  return resource.unitFor?.(coordinates) ?? resource.unit
}

/** « Médecin généraliste · à vélo (LTS 2) · 15 min · part des adresses » */
export function coordinateSummary(resource: ResourceDef, coordinates: Coordinates): string[] {
  return resource.axes.map((axis) => axisValueLabel(resource, axis.key, coordinates[axis.key] ?? axis.defaultValue, 'label'))
}

export function cellShortLabel(resource: ResourceDef, coordinates: Coordinates): string {
  const parts = coordinateSummary(resource, coordinates)
  if (resource.family === 'aedar') {
    const typequ = coordinates.typequ
    const head = typequ ? axisValueLabel(resource, 'typequ', typequ) : resource.label
    const rest = resource.axes.filter((a) => a.key !== 'typequ').map((a) => axisValueLabel(resource, a.key, coordinates[a.key]!, 'label'))
    return [head, ...rest].join(' · ')
  }
  return [resource.label, ...parts].join(' · ')
}

/* -------------------------------------------------------------------- search */

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[’']/g, ' ')

const words = (text: string) => fold(text).split(/[^a-z0-9<+\-]+/).filter(Boolean)

/** Colloquial synonyms per coordinate value — prototype-only, search recall. */
const SYNONYMS: Record<string, string> = {
  walk: 'marche pieton pied',
  bike_lts2: 'velo cyclable cycliste',
  bike_lts4: 'velo cyclable cycliste',
  transit: 'tc bus tram metro train collectif',
  car: 'auto voiture',
  F: 'femme femmes feminin',
  M: 'homme hommes masculin',
  share: 'part pourcentage taux',
  mean: 'moyenne moyen',
  Diversity: 'diversite varietes',
  Volume: 'volume nombre',
}

export interface Candidate {
  resource: ResourceDef
  coordinates: Coordinates
  score: number
  key: string
}

function tokenHits(token: string, hayWords: string[]): boolean {
  return hayWords.some((word) => (/^\d+$/.test(token) ? word === token : word.startsWith(token)))
}

export function searchCellules(catalogue: ResourceDef[], query: string, limit = 8): Candidate[] {
  const tokens = words(query)
  if (!tokens.length) return []
  const out: Candidate[] = []
  for (const resource of catalogue) {
    const labelWords = words(`${resource.label} ${resource.themeLabel} ${resource.group ?? ''} ${resource.keywords}`)
    const consumed = new Set<string>()
    let score = 0
    for (const token of tokens) {
      if (tokenHits(token, labelWords)) {
        consumed.add(token)
        score += 3
      }
    }
    const perAxis: { value: AxisValue; s: number }[][] = []
    for (const axis of resource.axes) {
      const scored: { value: AxisValue; s: number }[] = []
      for (const value of axis.values) {
        const hay = words(`${value.label} ${value.phrase ?? ''} ${SYNONYMS[value.value] ?? ''}`)
        let s = 0
        for (const token of tokens) {
          // numeric tokens only address numeric coordinate values (minutes, years)
          if (/^\d+$/.test(token) && !/^\d+$/.test(value.value)) continue
          if (hay.includes(token)) s += 2 // whole word
          else if (tokenHits(token, hay)) s += 1 // prefix
        }
        if (s) scored.push({ value, s: s - value.label.length / 1000 })
      }
      scored.sort((a, b) => b.s - a.s)
      for (const match of scored) {
        const hay = words(`${match.value.label} ${match.value.phrase ?? ''} ${SYNONYMS[match.value.value] ?? ''}`)
        for (const token of tokens) if (tokenHits(token, hay)) consumed.add(token)
      }
      score += scored.length ? 2 : 0
      perAxis.push(
        scored.length
          ? scored.slice(0, 3)
          : [{ value: axis.values.find((v) => v.value === axis.defaultValue) ?? axis.values[0]!, s: 0 }],
      )
    }
    if (!consumed.size) continue
    score += consumed.size * 2 - (tokens.length - consumed.size) * 4
    if (score <= 0) continue
    // cross product, capped
    let combos: { coordinates: Coordinates; s: number }[] = [{ coordinates: {}, s: 0 }]
    resource.axes.forEach((axis, index) => {
      const next: typeof combos = []
      for (const base of combos) for (const { value, s } of perAxis[index]!) next.push({ coordinates: { ...base.coordinates, [axis.key]: value.value }, s: base.s + s })
      combos = next.sort((a, b) => b.s - a.s).slice(0, 24)
    })
    let kept = 0
    for (const combo of combos) {
      if (resource.isValid && !resource.isValid(combo.coordinates)) continue
      if (kept++ >= 4) break
      out.push({ resource, coordinates: combo.coordinates, score: score + combo.s, key: `${resource.id}|${JSON.stringify(combo.coordinates)}` })
    }
  }
  return out.sort((a, b) => b.score - a.score || a.resource.order - b.resource.order).slice(0, limit)
}

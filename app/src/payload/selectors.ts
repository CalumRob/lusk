/**
 * The payload selectors — pure functions, the ONLY logic worth locking in
 * the payload layer (component tests come later). Raw payload in, French
 * product strings out. No DOM, no network, no fetch layer here.
 *
 * Vocabulary from CONTEXT.md: territoire, thème, indicateur, rang, vintage,
 * Aperçu, Story. Outputs are French — the product language.
 */

import type {
  ApercuRow,
  ColonneRang,
  Histoire,
  HistoireEconomie,
  HistoireMobilite,
  Indicateur,
  MembreProgramme,
  Payload,
  SigleProgramme,
  Territoire,
  TerritoireType,
  Theme,
} from './types'
import { THEMES_CANONIQUES } from './types'
import { SOURCES_METHODES } from '@/methodes/sources'

/**
 * Which themes exist in the payload, in canonical order (ADR-0007: Aperçu
 * always first, then the themes present in the payload — dead tabs never
 * render). Presence is read from the facts tables: a theme exists as soon as
 * it contributes rows.
 */
export function themesPresent(payload: Payload): Theme[] {
  const presents = new Set<Theme>()
  for (const ligne of payload.indicateurs) presents.add(ligne.theme)
  for (const ligne of payload.histoires) presents.add(ligne.theme)
  return THEMES_CANONIQUES.filter((theme) => presents.has(theme))
}

/**
 * The Aperçu tab's basic stats for a territory (ADR-0007): the rows of the
 * apercu table for that territory, NA-gated — a null value (non calculable
 * pour ce territoire) is skipped, never rendered. Payload order preserved.
 * An absent apercu table (404 → null, issue #122) reads as no rows — the
 * tab renders the honest empty state, never an error.
 */
export function apercuPourTerritoire(payload: Payload, territoire: string): ApercuRow[] {
  return (payload.apercu ?? []).filter(
    (ligne) => ligne.territoire === territoire && ligne.value !== null,
  )
}

/** The comparison group label for each rank column (the chip's suffix). */
const SUFFIXE_RANG: Record<ColonneRang, string> = {
  rang_epci: "de l'EPCI",
  rang_dep: 'du département',
  rang_reg: 'de la région',
}

/**
 * The rank-in-context chip: fraction × 100 → "P25 de l'EPCI". A null rank
 * means no comparison group at that level — no chip (null).
 */
export function formaterRang(rang: number | null, colonne: ColonneRang): string | null {
  if (rang === null) return null
  const centile = Math.round(rang * 100)
  return `P${centile} ${SUFFIXE_RANG[colonne]}`
}

const MOIS_FRANCAIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/** ISO timestamp → "3 août 2026" (UTC — the pipeline stamps UTC, CONTEXT.md §Run report). */
export function formaterDateFrancaise(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getUTCDate()} ${MOIS_FRANCAIS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/**
 * The freshness line, from the run report (CONTEXT.md §Run report): the run
 * timestamp in French, with the per-source status — a failed source or a
 * source left for manual handling is flagged, never hidden. Without a run
 * report, the honest static-rhythm claim stands (no pretend freshness).
 */
export function ligneFraicheur(payload: Payload): string {
  const rapport = payload.runReport
  if (!rapport) return 'Données actualisées chaque semaine'

  const date = formaterDateFrancaise(rapport.timestamp)
  const enEchec = rapport.statuts.filter((s) => s.status === 'échec').length
  const aTraiter = rapport.statuts.filter((s) => s.status === 'à traiter à la main').length

  if (enEchec > 0) {
    return `Actualisation incomplète du ${date} — ${enEchec} source${enEchec > 1 ? 's' : ''} en échec`
  }
  if (aTraiter > 0) {
    return `Actualisation partielle du ${date} — ${aTraiter} source${aTraiter > 1 ? 's' : ''} à traiter à la main`
  }
  return `Données actualisées le ${date}`
}

/** The reference lookup: id → territoire (the names live here, joined by everything else). */
export function trouverTerritoire(payload: Payload, id: string): Territoire | null {
  return payload.territoires.find((t) => t.territoire === id) ?? null
}

/**
 * The canonical order of the standard indicators per theme — the fiche
 * contract (docs/themes/<theme>.md, INDICATEURS_<theme> côté R). Keys absent
 * from the map keep their payload order (later themes extend the map when
 * their block lands).
 */
const ORDRE_INDICATEURS: Partial<Record<Theme, readonly string[]>> = {
  demographie: ['densite', 'structure_age', 'evolution_1968', 'taille_menages'],
  // Économie (issue #120) : « Taille » → « santé » → « verdure » — l'ordre du
  // contrat R (INDICATEURS_ECONOMIE), pas celui du JSON.
  economie: ['effectifs_salaries', 'chomage', 'eco_activites'],
  // Mobilité (issue #142, ADR-0012) : la « Taille » → la grille d'isolation
  // (les 5 parts) → l'étage demande/réseaux → le sous-bloc — l'ordre du bloc,
  // pas celui d'INDICATEURS_MOBILITE (nb_buildings → voitures → reseaux → …).
  mobilite: [
    'nb_buildings',
    'iso_alimentation',
    'iso_sante',
    'iso_administration',
    'iso_ecole',
    'iso_banque',
    'voitures_menage',
    'reseaux',
    'offre_tc',
    'bornes_recharge',
    'places_stationnement_velo_1000',
  ],
  // Milieux (spec #225, ADR-0017) : « Intensité état · Série annuelle » —
  // l'état par habitant (artif_par_habitant) puis la série annuelle
  // CONSOENAF (conso_enaf_annuel) — l'ordre du bloc, pas celui du JSON.
  milieux: ['artif_par_habitant', 'conso_enaf_annuel'],
}

/** The standard indicator rows for a territoire + theme, in the contract's order. */
export function indicateursPourTerritoire(
  payload: Payload,
  theme: Theme,
  territoire: string,
): Indicateur[] {
  const lignes = payload.indicateurs.filter(
    (ligne) => ligne.theme === theme && ligne.territoire === territoire,
  )
  const ordre = ORDRE_INDICATEURS[theme]
  if (!ordre) return lignes
  return [...lignes].sort((a, b) => {
    const ia = ordre.indexOf(a.key)
    const ib = ordre.indexOf(b.key)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

/** One indicator figure of the block: a key and its rows (multi-detail keys group). */
export interface GroupeIndicateur {
  key: string
  lignes: Indicateur[]
}

/**
 * The block's figures, grouped by key — the multi-detail indicators
 * (structure_age = one row per tranche) become ONE figure with a breakdown.
 * Group order follows the contract's indicator order; detail rows keep their
 * payload order within the group.
 */
export function indicateursGroupeesPourTerritoire(
  payload: Payload,
  theme: Theme,
  territoire: string,
): GroupeIndicateur[] {
  const groupes = new Map<string, Indicateur[]>()
  for (const ligne of indicateursPourTerritoire(payload, theme, territoire)) {
    const groupe = groupes.get(ligne.key)
    if (groupe) groupe.push(ligne)
    else groupes.set(ligne.key, [ligne])
  }
  return [...groupes.entries()].map(([key, lignes]) => ({ key, lignes }))
}

/** The Story row for a territoire + theme, or null (no story — handled honestly). */
export function histoirePourTerritoire(
  payload: Payload,
  theme: Theme,
  territoire: string,
): Histoire | null {
  return payload.histoires.find(
    (histoire) => histoire.theme === theme && histoire.territoire === territoire,
  ) ?? null
}

/**
 * The Économie Story rows of a territoire (issue #120) — the top-5 grouped by
 * (territoire × story_key), sorted by rang (ascending): the specialisation
 * reading for communes/EPCIs/départements, the presence reading for the région
 * (53, story_key ce-que-la-bretagne-abrite). A territoire has exactly one Story
 * — the five lines are the reading, never a sample. Null for a territory
 * without an Économie Story (handled honestly, no invented reading).
 */
export function histoiresEconomiePourTerritoire(
  payload: Payload,
  territoire: string,
): HistoireEconomie[] | null {
  const lignes = payload.histoires
    .filter(
      (h): h is HistoireEconomie => h.theme === 'economie' && h.territoire === territoire,
    )
    .sort((a, b) => a.rang - b.rang || a.activity_code.localeCompare(b.activity_code))
  return lignes.length > 0 ? lignes : null
}

/**
 * The Mobilité Story rows of a territoire (issue #142, ADR-0012) — AT MOST TWO:
 * the always-on default « vingt-minutes-sans-voiture » and, where the bike
 * delta is real (classification « saillant »), the salience candidate
 * « ce-que-le-velo-preserve ». Null for a territory without a Mobilité Story
 * (handled honestly, no invented reading).
 */
export function histoiresMobilitePourTerritoire(
  payload: Payload,
  territoire: string,
): HistoireMobilite[] | null {
  const lignes = payload.histoires.filter(
    (h): h is HistoireMobilite => h.theme === 'mobilite' && h.territoire === territoire,
  )
  return lignes.length > 0 ? lignes : null
}

/** One point of the Mobilité story chart's context cloud — a peer's div_loss_t (ADR-0011). */
export interface PointNuageMobilite {
  territoire: string
  type: TerritoireType
  nom: string
  /** La lecture du pair — le nombre de types de services qu'il perd à pied ou en transports en commun. */
  divLoss: number
}

/**
 * The Mobilité story chart's context cloud (ADR-0011) — the SAME comparison
 * scope as the Démographie nuage (codesComparaison) but reading each peer's
 * default Story row (its div_loss_t — every territory carries its own). The
 * nuage is derivable app-side from the peers' lines, never a downloaded list
 * (theme_mobilite.R — le même pattern que la Story Démographie).
 */
export function nuageMobilite(payload: Payload, territoire: string): PointNuageMobilite[] | null {
  const ref = trouverTerritoire(payload, territoire)
  if (!ref) return null

  const codes = codesComparaison(payload, ref)
  const nuage: PointNuageMobilite[] = []
  for (const code of codes) {
    const histoire = payload.histoires.find(
      (h) =>
        h.theme === 'mobilite' &&
        h.story_key === 'vingt-minutes-sans-voiture' &&
        h.territoire === code,
    )
    if (histoire?.theme !== 'mobilite') continue
    const t = trouverTerritoire(payload, code)
    if (!t) continue
    nuage.push({ territoire: code, type: t.type, nom: t.nom, divLoss: histoire.div_loss_t })
  }
  return nuage
}

/**
 * The flagship's snapshot stamp (ADR-0012) — the Mobilité block's freshness
 * promise, distinct from the light themes' weekly vintage chips: "Analyse
 * calculée le [date] — se rafraîchit sur un rythme lent". The date is the
 * snapshot's publication date (the run that computed the analysis); it is read
 * from the shared vintages table (mobilite_snapshot) and, in its absence, from
 * any Mobilité Story row's own stamp. Null only when the payload carries no
 * Mobilité at all — the block never invents a stamp.
 */
export function estampilleSnapshot(payload: Payload): string | null {
  const snap = payload.vintages?.find((v) => v.id === 'mobilite_snapshot')
  if (snap?.date_publication) {
    return `Analyse calculée le ${formaterDateFrancaise(snap.date_publication)} — se rafraîchit sur un rythme lent`
  }
  const histoire = payload.histoires.find((h) => h.theme === 'mobilite')
  if (histoire?.theme === 'mobilite') {
    return `Analyse calculée le ${formaterDateFrancaise(histoire.vintage_date_publication)} — se rafraîchit sur un rythme lent`
  }
  return null
}

/** One point of the story chart's context cloud (ADR-0011). */
export interface PointNuage {
  territoire: string
  type: TerritoireType
  nom: string
  tauxNaturel: number
  tauxMigratoire: number
}

/**
 * The Démographie story chart's context cloud — the territory's comparison
 * group at the SAME scale (ADR-0011): a commune sees its EPCI's communes
 * (or, when it belongs to no EPCI, its département's communes); an EPCI sees
 * the other EPCIs of the region; a département the other départements; the
 * région all its communes. Every point is a peer the territory's dot sits
 * among — and a click navigates to that point's own fiche (territoire/type).
 */
export function nuageComparaison(payload: Payload, territoire: string): PointNuage[] | null {
  const ref = trouverTerritoire(payload, territoire)
  if (!ref) return null

  const codes = codesComparaison(payload, ref)
  const nuage: PointNuage[] = []
  for (const code of codes) {
    const histoire = payload.histoires.find(
      (h) => h.theme === 'demographie' && h.territoire === code,
    )
    if (histoire?.theme !== 'demographie') continue
    const t = trouverTerritoire(payload, code)
    if (!t) continue
    nuage.push({
      territoire: code,
      type: t.type,
      nom: t.nom,
      tauxNaturel: histoire.taux_solde_naturel,
      tauxMigratoire: histoire.taux_solde_migratoire,
    })
  }
  return nuage
}

/** One point of the Milieux story chart's context cloud (issue #241, ADR-0017). */
export interface PointNuageMilieux {
  territoire: string
  type: TerritoireType
  nom: string
  /** La fenêtre des états OCS-GE du pair — le span multi-dépt porté tel quel (le rider du millésime). */
  periodeArtif: string | null
  /** x — Δpopulation (signé), la première force de la lecture. */
  deltaPopulation: number
  /** y — Δ(m²/hab) = artif_m3_par_habitant − artif_m2_par_habitant (signé), la trajectoire par habitant. */
  deltaM2ParHabitant: number
}

/**
 * The Milieux story chart's context cloud (issue #241) — the SAME comparison
 * scope as the Démographie nuage (codesComparaison, ADR-0011) but reading
 * each peer's Milieux Story row (ADR-0017): x = Δpopulation, y = Δ(m²/hab) =
 * artif_m3_par_habitant − artif_m2_par_habitant. Every point carries its
 * OCS-GE state window, so a cross-département peer's millésime span
 * (periode_artif with per-dépt dates) is stated, never hidden. The nuage is
 * derivable app-side from the peers' lines, never a downloaded list — the
 * same pattern as nuageComparaison / nuageMobilite.
 */
export function nuageMilieux(payload: Payload, territoire: string): PointNuageMilieux[] | null {
  const ref = trouverTerritoire(payload, territoire)
  if (!ref) return null

  const codes = codesComparaison(payload, ref)
  const nuage: PointNuageMilieux[] = []
  for (const code of codes) {
    const histoire = payload.histoires.find((h) => h.theme === 'milieux' && h.territoire === code)
    if (histoire?.theme !== 'milieux') continue
    // un pair aux états absents (le trou NA honnête) n'a pas de point à
    // tracer — le delta Δ(m²/hab) n'existe pas, le nuage ne l'invente pas
    if (histoire.artif_m2_par_habitant === null || histoire.artif_m3_par_habitant === null) {
      continue
    }
    const t = trouverTerritoire(payload, code)
    if (!t) continue
    nuage.push({
      territoire: code,
      type: t.type,
      nom: t.nom,
      periodeArtif: histoire.periode_artif,
      deltaPopulation: histoire.delta_population,
      deltaM2ParHabitant:
        histoire.artif_m3_par_habitant - histoire.artif_m2_par_habitant,
    })
  }
  return nuage
}

/** The comparison container the nuage groups come from — the subtitle names it and links to its fiche. */
export interface ConteneurComparaison {
  code: string
  nom: string
  type: TerritoireType
}

/** The story card's subtitle descriptor: who is compared against whom, at the same scale. */
export interface DescriptionNuage {
  /** The preposition before the current territory: "de" (Rennes) or "de la" (Bretagne). */
  prepositionCourant: string
  /** The current territory's display name ("Rennes", "Rennes Métropole", "Bretagne"). */
  nomCourant: string
  /**
   * The comparison phrase: "des communes de", "des autres EPCIs de",
   * "des autres départements de" — or, for the région, the final
   * "de ses communes" (no container to append).
   */
  groupe: string
  /** The container the group belongs to (EPCI / département / région), or null for the région. */
  conteneur: ConteneurComparaison | null
}

/**
 * The comparison the chart draws — what the subtitle states: the current
 * territory vs its comparison group at the same scale (ADR-0011, the SAME
 * scope nuageComparaison uses): a commune sees its EPCI's communes (or its
 * département's when it belongs to no EPCI); an EPCI the other EPCIs of the
 * region; a département the other départements; the région its communes.
 * Returns null for an unknown territory — never invents a comparison.
 */
export function descriptionNuage(payload: Payload, territoire: string): DescriptionNuage | null {
  const ref = trouverTerritoire(payload, territoire)
  if (!ref) return null
  const region = payload.territoires.find((t) => t.type === 'region')

  if (ref.type === 'commune') {
    if (ref.epci) {
      const epci = trouverTerritoire(payload, ref.epci)
      return {
        prepositionCourant: 'de',
        nomCourant: ref.nom,
        groupe: 'des communes de',
        conteneur: epci ? { code: epci.territoire, nom: epci.nom, type: 'epci' } : null,
      }
    }
    const departement = ref.departement ? trouverTerritoire(payload, ref.departement) : null
    return {
      prepositionCourant: 'de',
      nomCourant: ref.nom,
      groupe: 'des communes de',
      conteneur: departement
        ? { code: departement.territoire, nom: departement.nom, type: 'departement' }
        : null,
    }
  }
  if (ref.type === 'epci') {
    return {
      prepositionCourant: 'de',
      nomCourant: ref.nom,
      groupe: 'des autres EPCIs de',
      conteneur: region ? { code: region.territoire, nom: region.nom, type: 'region' } : null,
    }
  }
  if (ref.type === 'departement') {
    return {
      prepositionCourant: 'de',
      nomCourant: ref.nom,
      groupe: 'des autres départements de',
      conteneur: region ? { code: region.territoire, nom: region.nom, type: 'region' } : null,
    }
  }
  // région → all communes, its own scale: "de la Bretagne et de ses communes"
  return {
    prepositionCourant: 'de la',
    nomCourant: ref.nom,
    groupe: 'de ses communes',
    conteneur: null,
  }
}

function codesComparaison(payload: Payload, ref: Territoire): string[] {
  const codesDe = (type: TerritoireType) =>
    payload.territoires.filter((t) => t.type === type).map((t) => t.territoire)

  if (ref.type === 'commune') {
    // une commune de l'EPCI voit les communes de SON EPCI ; sans EPCI, les
    // communes de son département (il en existe trois en Bretagne réelle —
    // les îles 22016/29083/29155, fix « Sans objet », issue #131)
    if (ref.epci) {
      return payload.territoires
        .filter((t) => t.type === 'commune' && t.epci === ref.epci)
        .map((t) => t.territoire)
    }
    return payload.territoires
      .filter((t) => t.type === 'commune' && t.departement === ref.departement)
      .map((t) => t.territoire)
  }
  if (ref.type === 'epci') {
    // les AUTRES EPCIs de la région — le territoire courant est le point mis
    // en évidence, pas un membre de son propre nuage
    return codesDe('epci').filter((code) => code !== ref.territoire)
  }
  if (ref.type === 'departement') {
    return codesDe('departement').filter((code) => code !== ref.territoire)
  }
  return codesDe('commune')
}

/** The rank columns, nearest comparison group first (EPCI → département → région). */
const COLONNES_RANG: readonly ColonneRang[] = ['rang_epci', 'rang_dep', 'rang_reg']

/**
 * The rank-in-context chip of the nearest available comparison group: a
 * commune shows its EPCI rank, an EPCI its département rank, the région none.
 * A null rank at every level → null (no chip).
 */
export function rangEnContexte(indicateur: Indicateur): string | null {
  for (const colonne of COLONNES_RANG) {
    const libelle = formaterRang(indicateur[colonne], colonne)
    if (libelle !== null) return libelle
  }
  return null
}

/** French number: comma decimal separator, thin-space thousands, zeros trimmed. */
export function formaterNombreFR(x: number, decimalesMax: number): string {
  const fixe = x.toFixed(decimalesMax)
  const [entiers, decPart = ''] = fixe.split('.')
  const decs = decPart.replace(/0+$/, '')
  const groupes = entiers.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return decs ? `${groupes},${decs}` : groupes
}

/**
 * The indicator's display value, French. A "%" unit means the payload value
 * is a fraction in [0,1] (0.3 → "30"). Null → null (non calculable pour ce
 * territoire — the figure shows an honest "—", never a made-up number).
 */
export function formaterValeur(indicateur: Indicateur): string | null {
  if (indicateur.value === null) return null
  const estPourcent = indicateur.unit === '%'
  const brut = estPourcent ? indicateur.value * 100 : indicateur.value
  return formaterNombreFR(brut, estPourcent ? 0 : 2)
}

/** A signed integer — the Démographie story's soldes ("+70", "-380", "0"). */
export function formaterSolde(x: number): string {
  const signe = x > 0 ? '+' : ''
  return `${signe}${formaterNombreFR(x, 0)}`
}

const MOIS_COURTS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
]

function formaterDateCourt(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getUTCDate()} ${MOIS_COURTS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/**
 * The vintage stamp — source · version · the two dates (reference AND
 * publication). The "alive" promise: always present, never optional
 * (ui-elements.md §Indicator/KPI figure). Works on any vintage-stamped row of
 * the payload — the indicateurs AND the Économie Stories, which carry their
 * own stamp (issue #74: the Story cites its source, never an invented one). A
 * rolling base (DPE — ADR-0009) has no reference date: the stamp shows the
 * publication date only, honestly ("publ." alone) — never a fabricated
 * reference. The ORT membership rows (ADR-0013) carry NO publication by
 * contract (the stale page metadata is never cited): the stamp shows the
 * per-row reference only — never a phantom "publ.".
 */
export function formaterVintage(vintage: {
  vintage_source: string
  vintage_version: string
  vintage_date_reference: string | null
  vintage_date_publication: string | null
}): string {
  const reference = vintage.vintage_date_reference
    ? `réf. ${formaterDateCourt(vintage.vintage_date_reference)} · `
    : ''
  const publication = vintage.vintage_date_publication
    ? `publ. ${formaterDateCourt(vintage.vintage_date_publication)}`
    : ''
  return (
    `${vintage.vintage_source} · ${vintage.vintage_version} · ` +
    `${reference}${publication}`
  )
}

/** The known licence codes → their French names (the vintages table's `licence` column). */
const LICENCES: Record<string, string> = {
  lov2: 'Licence Ouverte 2.0',
  odbl: 'Licence ODbL — attribution « © OpenStreetMap contributors »',
}

/** The licence's display name — the raw code when the map doesn't know it (never invented). */
export function formaterLicence(code: string): string {
  return LICENCES[code] ?? code
}

/** One Méthodes source row — the registry's editorial facts joined to the live freshness facts. */
export interface LigneSourceMethodes {
  /** The source id — the registry × vintages join key (ancreSource derives the anchor). */
  id: string
  /** The source name (the registry's editorial fact — the degraded fallback). */
  nom: string
  editeur: string
  url: string | null
  themes: Theme[]
  /** Live freshness — null when the source has no vintage row in the payload (never invented). */
  version: string | null
  licence: string | null
  dateReference: string | null
  datePublication: string | null
}

/** The Méthodes sources table — every registered source, one row, freshness joined live. */
export interface MethodesSources {
  /** true when vintages.json was absent (404) — the freshness columns show the honest empty state. */
  vintagesAbsents: boolean
  lignes: LigneSourceMethodes[]
}

/**
 * The Méthodes sources table (docs/themes/README.md §The Méthodes contract):
 * the registry's editorial facts (nom, éditeur, URL, thèmes) joined by id to
 * the vintages table's freshness facts (version, licence, dates). Registry
 * order is the table order; a registered source with no live vintage row
 * degrades gracefully — its editorial facts render, its freshness stays null
 * (no invented dates). Absent vintages (404 → null) render every registered
 * source with null freshness — the page never breaks.
 */
export function sourcesMethodes(payload: Payload): MethodesSources {
  const vintagesAbsents = payload.vintages === null
  const parId = new Map((payload.vintages ?? []).map((v) => [v.id, v]))

  const lignes: LigneSourceMethodes[] = []
  for (const [id, source] of Object.entries(SOURCES_METHODES)) {
    const vintage = parId.get(id) ?? null
    lignes.push({
      id,
      nom: source.nom,
      editeur: source.editeur,
      url: source.url,
      themes: source.themes,
      version: vintage?.version ?? null,
      licence: vintage ? formaterLicence(vintage.licence) : null,
      dateReference: vintage?.date_reference ? formaterDateFrancaise(vintage.date_reference) : null,
      datePublication: vintage?.date_publication
        ? formaterDateFrancaise(vintage.date_publication)
        : null,
    })
  }
  return { vintagesAbsents, lignes }
}

/** Les deux labels communaux (ancrés à la commune, listes lauréates ANCT). */
const SIGLES_LABELS: readonly SigleProgramme[] = ['ACV', 'PVD']

/** Les deux contrats EPCI-anchored (l'intercommunalité signataire). */
const SIGLES_CONTRATS: readonly SigleProgramme[] = ['CRTE', "Territoires d'industrie"]

/**
 * La voix d'un badge — le verbe honnête de l'ancrage (PRD #162-13, les verbes
 * ne sur-réclament jamais) : « lauréate » (la commune, ses propres labels),
 * « couverte » (les contrats couvrent le territoire — commune par son EPCI,
 * EPCI par son propre contrat), « porte » (l'EPCI porte les labels de ses
 * communes membres, portage nommé), « compte » (l'agrégat au département /
 * région), « ort » (le badge-outil dans un périmètre de convention signée).
 */
export type VoixProgramme = 'laureate' | 'couverte' | 'porte' | 'compte' | 'ort'

/** Un badge dérivé de l'élément — une ligne d'adhésion rendue à SON échelle. */
export interface BadgeProgramme {
  sigle: SigleProgramme
  voix: VoixProgramme
  /**
   * Les territoires nommés du badge — le portage (les communes labellisées),
   * l'agrégat (les EPCIs/communes comptés), la couverture (l'EPCI signataire),
   * l'ORT d'un EPCI (ses communes en périmètre). Liste COMPLÈTE, jamais
   * tronquée (rendue scrollable par l'onglet).
   */
  noms: string[]
  /** Le rider « convention valant ORT » sur une ligne de label — le fait accessible. */
  conventionValantOrt: boolean
  /** L'estampille vintage formatée de la source du badge (formaterVintage). */
  vintage: string
}

/** Un domaine de la ventilation communale des subventions. */
export interface AxeSubvention {
  libelle: string
  montant: number
}

/**
 * Les faits de subventions d'une fiche — le total annuel de l'année de
 * référence, ventilé par domaine sur les fiches communales (le top-N +
 * « autres » PRÉCALCULÉ par le pipeline, jamais re-dérivé ici — ADR-0013), le
 * total unique ailleurs. Null quand le payload ne porte aucune ligne pour le
 * territoire (l'état vide honnête, jamais un zéro inventé).
 */
export interface SubventionsFiche {
  annee: number
  /** La ventilation par domaine — non-null sur les fiches communales seulement. */
  axes: AxeSubvention[] | null
  total: number
  vintage: string
}

/** Le rendu de l'élément Programmes & financements pour une fiche. */
export interface RenderingProgrammes {
  badges: BadgeProgramme[]
  subventions: SubventionsFiche | null
}

/** Le nom réel d'un territoire de la référence — l'id brut en dernier recours. */
function nomDe(payload: Payload, id: string): string {
  return trouverTerritoire(payload, id)?.nom ?? id
}

/**
 * L'échelle d'un niveau agrégé (département / région) : les EPCIs du niveau =
 * les `epci` DISTINCTS des communes du niveau (PRD #162 — jamais le champ
 * `departement` de la ligne EPCI, qui ne porte que le département « maison »).
 * C'est CETTE dérivation qui fait compter un EPCI transversal (Redon
 * Agglomération, 35+56) dans les DEUX départements de ses communes.
 */
function epcisDuNiveau(payload: Payload, ref: Territoire): Set<string> {
  const communes = payload.territoires.filter(
    (t) => t.type === 'commune' && (ref.type === 'region' || t.departement === ref.territoire),
  )
  const epcis = new Set<string>()
  for (const commune of communes) {
    if (commune.epci !== null) epcis.add(commune.epci)
  }
  return epcis
}

/** Les lignes d'adhésion d'un sigle — au niveau donné (commune ou EPCI). */
function membresSigle(
  membres: MembreProgramme[],
  sigle: SigleProgramme,
  type: 'commune' | 'epci',
  territoire: string,
): MembreProgramme[] {
  return membres.filter((m) => m.sigle === sigle && m.type === type && m.territoire === territoire)
}

/** Les communes d'un EPCI — l'appartenance du référentiel (jamais la ligne EPCI). */
function communesDe(payload: Payload, epci: string): Territoire[] {
  return payload.territoires.filter((t) => t.type === 'commune' && t.epci === epci)
}

/**
 * LA DÉRIVATION EN ÉCHELLE (issue #181, ADR-0013) — le rendu de l'élément
 * Programmes & financements d'une fiche, depuis les lignes d'adhésion du
 * payload + le référentiel `territoires` (la jointure relationnelle que le
 * contexte switcher fait déjà — les jointures sont l'affaire de l'app). Les
 * trois voix :
 *   - COMMUNE : ses labels (lauréate, le rider « convention valant ORT » comme
 *     fait accessible — jamais un badge ORT en plus), la couverture descendante
 *     des contrats de SON EPCI (l'EPCI nommé), et l'ORT d'une commune NON
 *     labellisée dans un périmètre signé (sa propre ligne ORT) ;
 *   - EPCI : ses contrats, le PORTAGE NOMÉ de chaque commune labellisée membre
 *     (liste complète, jamais tronquée), et l'ORT autonome quand il n'est pas
 *     porté par un label (ses communes en périmètre nommées) ;
 *   - DÉPARTEMENT / RÉGION : l'agrégat — des comptes de contrats avec les EPCIs
 *     nommés, des labels et de l'ORT avec les communes nommées, jamais un badge
 *     plat que le niveau n'a pas signé ; un EPCI transversal compte dans les
 *     deux départements.
 * Les subventions : la ventilation par domaine sur les fiches communales (telle
 * quelle — le top-N + « autres » est précalculé), le total annuel unique
 * ailleurs. Chaque badge et chaque figure portent leur estampille vintage. Un
 * payload absent (404 → null) ou un territoire inconnu rendent l'état vide.
 */
export function programmesPourTerritoire(payload: Payload, territoire: string): RenderingProgrammes {
  const programmes = payload.programmes
  if (!programmes) return { badges: [], subventions: null }

  const ref = trouverTerritoire(payload, territoire)
  if (!ref) return { badges: [], subventions: null }

  const membres = programmes.membres
  const badges: BadgeProgramme[] = []
  const subventions = programmes.subventions.filter((s) => s.territoire === territoire)

  let subventionsFiche: SubventionsFiche | null = null
  if (subventions.length > 0) {
    const axes = ref.type === 'commune'
      ? subventions.map((s) => ({ libelle: s.programme_libl ?? '', montant: s.montant }))
      : null
    subventionsFiche = {
      annee: subventions[0].annee,
      axes,
      total: subventions.reduce((somme, s) => somme + s.montant, 0),
      vintage: formaterVintage(subventions[0]),
    }
  }

  if (ref.type === 'commune') {
    // les labels de la commune elle-même — le rider comme fait accessible
    for (const sigle of SIGLES_LABELS) {
      const ligne = membresSigle(membres, sigle, 'commune', territoire)[0]
      if (!ligne) continue
      badges.push({
        sigle,
        voix: 'laureate',
        noms: [],
        conventionValantOrt: ligne.convention_valant_ort,
        vintage: formaterVintage(ligne),
      })
    }
    // la couverture descendante : les contrats signés par SON EPCI, l'EPCI nommé
    if (ref.epci) {
      const epci = nomDe(payload, ref.epci)
      for (const sigle of SIGLES_CONTRATS) {
        const ligne = membresSigle(membres, sigle, 'epci', ref.epci)[0]
        if (!ligne) continue
        badges.push({
          sigle,
          voix: 'couverte',
          noms: [epci],
          conventionValantOrt: false,
          vintage: formaterVintage(ligne),
        })
      }
    }
    // l'ORT d'une commune NON labellisée dans un périmètre signé (sa propre
    // ligne — le double badge est interdit par le contrat, le rider fait foi)
    const ort = membresSigle(membres, 'ORT', 'commune', territoire)[0]
    if (ort) {
      badges.push({
        sigle: 'ORT',
        voix: 'ort',
        noms: [],
        conventionValantOrt: false,
        vintage: formaterVintage(ort),
      })
    }
  } else if (ref.type === 'epci') {
    // les contrats signés par l'EPCI — son territoire est couvert
    for (const sigle of SIGLES_CONTRATS) {
      const ligne = membresSigle(membres, sigle, 'epci', territoire)[0]
      if (!ligne) continue
      badges.push({
        sigle,
        voix: 'couverte',
        noms: [],
        conventionValantOrt: false,
        vintage: formaterVintage(ligne),
      })
    }
    // le portage nomé : chaque commune labellisée membre, liste complète
    const communes = communesDe(payload, territoire)
    for (const sigle of SIGLES_LABELS) {
      const lignes = membres.filter(
        (m) => m.sigle === sigle && m.type === 'commune' && communes.some((c) => c.territoire === m.territoire),
      )
      if (lignes.length === 0) continue
      badges.push({
        sigle,
        voix: 'porte',
        noms: communes.filter((c) => lignes.some((l) => l.territoire === c.territoire)).map((c) => c.nom),
        conventionValantOrt: false,
        vintage: formaterVintage(lignes[0]),
      })
    }
    // l'ORT autonome : l'EPCI dont l'ORT n'est pas porté par un label — ses
    // communes en périmètre nommées (dérivées des lignes ORT communales)
    const ort = membresSigle(membres, 'ORT', 'epci', territoire)[0]
    if (ort) {
      const communesOrt = communes.filter((c) =>
        membresSigle(membres, 'ORT', 'commune', c.territoire).length > 0,
      )
      badges.push({
        sigle: 'ORT',
        voix: 'ort',
        noms: communesOrt.map((c) => c.nom),
        conventionValantOrt: false,
        vintage: formaterVintage(ort),
      })
    }
  } else {
    // l'agrégat (département / région) : des comptes, jamais un badge plat —
    // les EPCIs du niveau par l'appartenance de SES communes (transversal inclus)
    const epcis = epcisDuNiveau(payload, ref)
    for (const sigle of SIGLES_CONTRATS) {
      const lignes = membres.filter(
        (m) => m.sigle === sigle && m.type === 'epci' && epcis.has(m.territoire),
      )
      if (lignes.length === 0) continue
      badges.push({
        sigle,
        voix: 'compte',
        noms: [...epcis].filter((id) => lignes.some((l) => l.territoire === id)).map((id) => nomDe(payload, id)),
        conventionValantOrt: false,
        vintage: formaterVintage(lignes[0]),
      })
    }
    const communes = payload.territoires.filter(
      (t) => t.type === 'commune' && (ref.type === 'region' || t.departement === ref.territoire),
    )
    for (const sigle of SIGLES_LABELS) {
      const lignes = membres.filter(
        (m) => m.sigle === sigle && m.type === 'commune' && communes.some((c) => c.territoire === m.territoire),
      )
      if (lignes.length === 0) continue
      badges.push({
        sigle,
        voix: 'compte',
        noms: communes.filter((c) => lignes.some((l) => l.territoire === c.territoire)).map((c) => c.nom),
        conventionValantOrt: false,
        vintage: formaterVintage(lignes[0]),
      })
    }
    const ortLignes = membres.filter(
      (m) => m.sigle === 'ORT' && m.type === 'commune' && communes.some((c) => c.territoire === m.territoire),
    )
    if (ortLignes.length > 0) {
      badges.push({
        sigle: 'ORT',
        voix: 'compte',
        noms: communes.filter((c) => ortLignes.some((l) => l.territoire === c.territoire)).map((c) => c.nom),
        conventionValantOrt: false,
        vintage: formaterVintage(ortLignes[0]),
      })
    }
  }

  return { badges, subventions: subventionsFiche }
}

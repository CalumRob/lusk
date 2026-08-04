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
  Indicateur,
  Payload,
  Territoire,
  Theme,
} from './types'
import { THEMES_CANONIQUES } from './types'

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
 */
export function apercuPourTerritoire(payload: Payload, territoire: string): ApercuRow[] {
  return payload.apercu.filter(
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
function formaterDateFrancaise(iso: string): string {
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
 * contract (docs/themes/<theme>.md). Keys absent from the map keep their
 * payload order (later themes extend the map when their block lands).
 */
const ORDRE_INDICATEURS: Partial<Record<Theme, readonly string[]>> = {
  demographie: ['densite', 'structure_age', 'evolution_1968', 'taille_menages'],
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
function formaterNombreFR(x: number, decimalesMax: number): string {
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
 * (ui-elements.md §Indicator/KPI figure). A rolling base (DPE — ADR-0009)
 * has no reference date: the stamp shows the publication date only, honestly
 * ("publ." alone) — never a fabricated reference.
 */
export function formaterVintage(indicateur: Indicateur): string {
  const reference = indicateur.vintage_date_reference
    ? `réf. ${formaterDateCourt(indicateur.vintage_date_reference)} · `
    : ''
  return (
    `${indicateur.vintage_source} · ${indicateur.vintage_version} · ` +
    `${reference}publ. ${formaterDateCourt(indicateur.vintage_date_publication)}`
  )
}

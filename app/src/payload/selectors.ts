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

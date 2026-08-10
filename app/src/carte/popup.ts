/**
 * The popup's KPI rows (ui-elements.md §Map shell): name + 2–3 KPIs from the
 * payload, joined by territoire code. Pure logic — the popup builder just
 * renders what this returns. A KPI the payload cannot compute (null value /
 * absent row) is skipped, never invented: a territory with no data gets a
 * popup with fewer rows, and the figure shows an honest « — ».
 *
 * The rows resolve from the ACTIVE layer (ADR-0019 — the couche the view
 * passed down): an indicateur layer reads its clef + detail rows, a story
 * layer its histoire scalar. The popup keeps its KPI-wall behaviour — the
 * rank-in-context re-join is ticket #281.
 *
 * The hover tooltip (audit #208 item 57) reads the same seam:
 * `contenuTooltip` returns the territory name + the active layer's value —
 * what the cursor sits on, before the click opens the full popup.
 */

import type { ApercuRow, Payload, Theme } from '../payload/types'
import { apercuPourTerritoire, formaterValeur, trouverTerritoire } from '../payload/selectors'
import type { Couche } from './coucheModel'
import { indicateurParTerritoire, valeurHistoireParTerritoire } from './fusion'

export interface KpiPopup {
  libelle: string
  valeur: string
  unite: string
}

/** The display value of an Aperçu row, French (« 2 000 », « 30 » for a % unit). */
export function formaterValeurApercu(ligne: ApercuRow): string | null {
  if (ligne.value === null) return null
  const estPourcent = ligne.unit === '%'
  const brut = estPourcent ? ligne.value * 100 : ligne.value
  const fixe = brut.toFixed(estPourcent ? 0 : 2)
  const [entiers, decPart = ''] = fixe.split('.')
  const decs = decPart.replace(/0+$/, '')
  const groupes = entiers.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return decs ? `${groupes},${decs}` : groupes
}

const LIBELLES_APERCU: Record<string, string> = {
  population: 'Population',
  densite: 'Densité',
  part_65_plus: 'Part des 65 ans et plus',
}

/** The Aperçu KPIs, in display order (population → densité → part 65+). */
const APERCU_EN_ORDRE = ['population', 'densite', 'part_65_plus'] as const

function kpiApercu(ligne: ApercuRow): KpiPopup {
  return {
    libelle: LIBELLES_APERCU[ligne.key] ?? ligne.key,
    valeur: formaterValeurApercu(ligne) ?? '—',
    unite: ligne.unit,
  }
}

/** The active layer's row for a territory — the valeur + unit the KPI wall
 *  and the tooltip read. Resolved by the couche's source (indicateur rows by
 *  clef + detail, the histoire scalar otherwise); null when the payload has no
 *  row — the KPI is skipped, never invented. */
function ligneDeLaCouche(
  payload: Payload,
  territoire: string,
  theme: Theme,
  couche: Couche,
): { valeur: number | null; unite: string; valeurFormatee: string | null } | null {
  if (couche.source === 'indicateur') {
    const ligne = indicateurParTerritoire(
      payload.indicateurs,
      theme,
      couche.clef,
      couche.detail,
    ).get(territoire)
    if (!ligne) return null
    return { valeur: ligne.value, unite: ligne.unit, valeurFormatee: formaterValeur(ligne) }
  }
  const ligne = valeurHistoireParTerritoire(payload, theme, couche.clef).get(territoire)
  if (!ligne) return null
  return { valeur: ligne.value, unite: ligne.unit, valeurFormatee: formaterValeur(ligne) }
}

/**
 * The popup's 2–3 KPI rows for a territory: the active layer's value first
 * (when a layer drives the map), then the Aperçu basics, capped at 3.
 * Rows the payload cannot compute are skipped — never « 0 » or a made-up
 * number.
 */
export function kpisPourPopup(
  payload: Payload,
  territoire: string,
  theme: Theme | null,
  couche: Couche | null,
): KpiPopup[] {
  const kpis: KpiPopup[] = []
  const clesApercuUtilisees = new Set<string>()

  if (couche && theme) {
    const ligne = ligneDeLaCouche(payload, territoire, theme, couche)
    if (ligne) {
      kpis.push({
        libelle: couche.libelle,
        valeur: ligne.valeurFormatee ?? '—',
        unite: ligne.unite,
      })
      // l'indicateur de thème a son jumeau Aperçu (ex. densité) — pas de doublon.
      clesApercuUtilisees.add(couche.clef)
    }
  }

  const apercu = new Map(apercuPourTerritoire(payload, territoire).map((l) => [l.key, l]))
  for (const cle of APERCU_EN_ORDRE) {
    if (kpis.length >= 3) break
    const ligne = apercu.get(cle)
    if (!ligne || clesApercuUtilisees.has(cle)) continue
    kpis.push(kpiApercu(ligne))
  }

  return kpis
}

/** The hover tooltip's content — the territory name + the active layer's
 *  value (audit #208 item 57). No layer (Aperçu) or a missing value →
 *  `valeur` null (the tooltip shows the name only, honest). */
export interface ContenuTooltip {
  nom: string
  valeur: string | null
}

export function contenuTooltip(
  payload: Payload,
  territoire: string,
  theme: Theme | null,
  couche: Couche | null,
): ContenuTooltip {
  let valeur: string | null = null
  if (couche && theme) {
    valeur = ligneDeLaCouche(payload, territoire, theme, couche)?.valeurFormatee ?? null
  }
  return {
    nom: trouverTerritoire(payload, territoire)?.nom ?? territoire,
    valeur,
  }
}

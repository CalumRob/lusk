/**
 * The popup's rows (ui-elements.md §Map shell): the ACTIVE layer's value +
 * its rank-in-context, then « Voir la fiche » (ADR-0019 — the popup answers
 * "how does this territory sit on THIS variable", never the theme's KPI
 * wall). Ranks live on the indicateurs table only (CONTEXT.md §Rang) : a
 * story-scalar layer (source 'histoire') shows the value without an invented
 * rank. Without a layer (the neutral first load) the popup has no KPI rows;
 * the map shell keeps only territory identity and its fiche link. A row the payload cannot compute (null value / absent row) is
 * skipped or shown as an honest « — », never invented. Pure logic — the popup
 * builder just renders what this returns.
 *
 * The hover tooltip (audit #208 item 57) reads the same seam:
 * `contenuTooltip` returns the territory name + the active layer's value —
 * what the cursor sits on, before the click opens the full popup.
 */

import type { ApercuRow, Payload, Theme } from '../payload/types'
import {
  formaterValeur,
  rangEnContexte,
  trouverTerritoire,
} from '../payload/selectors'
import type { Couche } from './coucheModel'
import { indicateurParTerritoire, valeurHistoireParTerritoire } from './fusion'

export interface KpiPopup {
  libelle: string
  valeur: string
  unite: string
  /** The rank-in-context chip (« Xᵉ / Y dans l'EPCI », ADR-0015) — carried by
   *  the indicateur rows only; null for story scalars and the Aperçu rows
   *  (CONTEXT.md §Rang : les rangs vivent sur les indicateurs du thème). */
  rang: string | null
  provenance?: string
}

/** French display utility retained for other Aperçu consumers. */
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

/** The active layer's row for a territory — the valeur + unit + rank-in-context
 *  the popup reads. Resolved by the couche's source (indicateur rows by clef +
 *  detail, the histoire scalar otherwise); null when the payload has no row.
 *  The rank comes from the indicateur row only (CONTEXT.md §Rang) — a story
 *  scalar carries none, never invented. */
function ligneDeLaCouche(
  payload: Payload,
  territoire: string,
  theme: Theme,
  couche: Couche,
): { valeur: number | null; unite: string; valeurFormatee: string | null; rang: string | null; provenance: string | null } | null {
  if (couche.source === 'indicateur') {
    const ligne = indicateurParTerritoire(
      payload.indicateurs,
      theme,
      couche.clef,
      couche.detail,
    ).get(territoire)
    if (!ligne) return null
    return {
      valeur: ligne.value,
      unite: ligne.unit,
      valeurFormatee: formaterValeur(ligne),
      rang: rangEnContexte(ligne),
      provenance: ligne.nativeContract && ligne.vintage_source && ligne.vintage_version
        ? `${ligne.vintage_source} · ${ligne.vintage_version}` : null,
    }
  }
  const ligne = valeurHistoireParTerritoire(payload, theme, couche.clef).get(territoire)
  if (!ligne) return null
  const history = payload.histoires.find((item) => item.territoire === territoire && item.theme === theme &&
    item.story_key === couche.storyKey) as (typeof payload.histoires[number] & {
      mapApiFact?: boolean; vintage_source?: string; vintage_version?: string
    }) | undefined
  const provenance = history?.mapApiFact && history.vintage_source && history.vintage_version
    ? `${history.vintage_source} · ${history.vintage_version}` : null
  return { valeur: ligne.value, unite: ligne.unit, valeurFormatee: formaterValeur(ligne), rang: null, provenance }
}

/**
 * The popup's rows for a territory. The ACTIVE layer leads (ADR-0019 — the
 * popup answers "how does this territory sit on THIS variable", never the
 * theme's KPI wall): its value + its rank-in-context for an indicateur layer,
 * the value alone for a story scalar. The neutral first load has no KPI rows;
 * only territory identity and its fiche link remain in the map shell.
 */
export function kpisPourPopup(
  payload: Payload,
  territoire: string,
  theme: Theme | null,
  couche: Couche | null,
): KpiPopup[] {
  if (couche && theme) {
    const ligne = ligneDeLaCouche(payload, territoire, theme, couche)
    if (!ligne) return []
    return [
      {
        libelle: couche.libelle,
        valeur: ligne.valeurFormatee ?? '—',
        unite: ligne.unite,
        rang: ligne.rang,
        ...(ligne.provenance ? { provenance: ligne.provenance } : {}),
      },
    ]
  }

  return []
}

/** The hover tooltip's content — the territory name + the active layer's
 *  value (audit #208 item 57). No layer or a missing value →
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

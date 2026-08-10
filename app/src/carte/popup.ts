/**
 * The popup's rows (ui-elements.md §Map shell): the ACTIVE layer's value +
 * its rank-in-context, then « Voir la fiche » (ADR-0019 — the popup answers
 * "how does this territory sit on THIS variable", never the theme's KPI
 * wall). Ranks live on the indicateurs table only (CONTEXT.md §Rang) : a
 * story-scalar layer (source 'histoire') shows the value without an invented
 * rank. Without a layer (the neutral first load) the Aperçu basics fill the
 * popup. A row the payload cannot compute (null value / absent row) is
 * skipped or shown as an honest « — », never invented. Pure logic — the popup
 * builder just renders what this returns.
 *
 * The hover tooltip (audit #208 item 57) reads the same seam:
 * `contenuTooltip` returns the territory name + the active layer's value —
 * what the cursor sits on, before the click opens the full popup.
 */

import type { ApercuRow, Payload, Theme } from '../payload/types'
import {
  apercuPourTerritoire,
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
    rang: null,
  }
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
): { valeur: number | null; unite: string; valeurFormatee: string | null; rang: string | null } | null {
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
    }
  }
  const ligne = valeurHistoireParTerritoire(payload, theme, couche.clef).get(territoire)
  if (!ligne) return null
  return { valeur: ligne.value, unite: ligne.unit, valeurFormatee: formaterValeur(ligne), rang: null }
}

/**
 * The popup's rows for a territory. The ACTIVE layer leads (ADR-0019 — the
 * popup answers "how does this territory sit on THIS variable", never the
 * theme's KPI wall): its value + its rank-in-context for an indicateur layer,
 * the value alone for a story scalar. Without a layer (the neutral first
 * load), the Aperçu basics fill the popup. Rows the payload cannot compute
 * are skipped — never « 0 » or a made-up number.
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
      },
    ]
  }

  const kpis: KpiPopup[] = []
  const apercu = new Map(apercuPourTerritoire(payload, territoire).map((l) => [l.key, l]))
  for (const cle of APERCU_EN_ORDRE) {
    if (kpis.length >= 3) break
    const ligne = apercu.get(cle)
    if (!ligne) continue
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

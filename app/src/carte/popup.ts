/**
 * The popup's KPI rows (ui-elements.md §Map shell): name + 2–3 KPIs from the
 * payload, joined by territoire code. Pure logic — the popup builder just
 * renders what this returns. A KPI the payload cannot compute (null value /
 * absent row) is skipped, never invented: a territory with no data gets a
 * popup with fewer rows, and the figure shows an honest « — ».
 */

import type { ApercuRow, Payload, Theme } from '../payload/types'
import { apercuPourTerritoire, formaterValeur } from '../payload/selectors'
import { configCoucheTheme } from './configCouche'

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

/**
 * The popup's 2–3 KPI rows for a territory: the selected theme's indicator
 * first (when a theme drives the map), then the Aperçu basics, capped at 3.
 * Rows the payload cannot compute are skipped — never « 0 » or a made-up
 * number.
 */
export function kpisPourPopup(payload: Payload, territoire: string, theme: Theme | null): KpiPopup[] {
  const kpis: KpiPopup[] = []
  const clesApercuUtilisees = new Set<string>()

  const config = theme ? configCoucheTheme(theme) : null
  if (config) {
    const ligne = payload.indicateurs.find(
      (l) =>
        l.territoire === territoire &&
        l.theme === theme &&
        l.key === config.indicateur &&
        l.detail === null,
    )
    if (ligne) {
      kpis.push({
        libelle: config.libelle,
        valeur: formaterValeur(ligne) ?? '—',
        unite: ligne.unit,
      })
      // l'indicateur de thème a son jumeau Aperçu (ex. densité) — pas de doublon.
      clesApercuUtilisees.add(config.indicateur)
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

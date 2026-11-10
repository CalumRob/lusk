import type { TerritoryComparisonMode } from '@/fiche/comparisonContext'

export const COMPARISON_MODE_DESCRIPTIONS: Readonly<Partial<Record<TerritoryComparisonMode, string>>> = {
  densite: 'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
}

/**
 * App-owned, stable wording for comparison states. The producer owns the
 * facts and scope identities; these sentences only present an unresolved
 * identity or a missing reading cloud in the interface.
 */
export const COMPARAISON_INDISPONIBLE_TITRE = 'Comparaison non disponible'
export const COMPARAISON_INDISPONIBLE_RAISON = 'l’identité du groupe comparé n’a pas pu être résolue.'
export const NUAGE_COMPARAISON_INDISPONIBLE_TITRE = 'Nuage du groupe comparé indisponible'
export const NUAGE_COMPARAISON_INDISPONIBLE_RAISON = 'la lecture du groupe comparé n’a pas fourni son nuage.'

/** Owner wording for a compared figure reading: bare, no colon and no repeated scope. */
export const GROUPE_COMPARE_LABEL = 'Groupe comparé'

/** Complete accessible phrase for a compared reading; the resolved scope stays in the accessible name only. */
export function groupeCompareAria(value: string, rank?: string | null, scope?: string | null): string {
  const reading = scope ? `${GROUPE_COMPARE_LABEL} : ${scope} : ${value}` : `${GROUPE_COMPARE_LABEL} : ${value}`
  return `${reading}${rank ? `, rang ${rank}` : ''}`
}

const BUILDING_SCOPE_PREFIX = 'bâtiments des '

export function buildingScopeLabel(label: string): string {
  return label.startsWith(BUILDING_SCOPE_PREFIX) ? label : `${BUILDING_SCOPE_PREFIX}${label}`
}

export function buildingScopeParts(label: string): { fixed: string; scope: string } {
  return { fixed: BUILDING_SCOPE_PREFIX, scope: label }
}

/**
 * Copy partagée de la note de portée des rangs publiés par l'API (#892) :
 * la portée DÉCLARÉE par le producteur + la cohorte de comparaison
 * (member_count). Le nombre de territoires CLASSÉS (rank_size = éligibles)
 * n'est PAS repris ici — il vit dans chaque cellule de rang, et cohorte ≠
 * éligibles (ex. 4 membres, 3 mesurés).
 */
export function rangScopeNoteCopy(label: string, cohortCount: number | null): string {
  const cohorte = cohortCount !== null
    ? ` · cohorte de comparaison : ${cohortCount} territoire${cohortCount > 1 ? 's' : ''}`
    : ''
  return `Rangs publiés par l’API — portée : ${label}${cohorte}`
}

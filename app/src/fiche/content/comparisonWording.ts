import type { TerritoryComparisonMode } from '@/fiche/comparisonContext'

export const COMPARISON_MODE_DESCRIPTIONS: Readonly<Partial<Record<TerritoryComparisonMode, string>>> = {
  densite: 'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
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

import type { TerritoryComparisonMode } from '@/payload/territoryReadModel'

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

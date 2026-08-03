/**
 * The context switcher's ladder (site-map.md §Fiche — internal navigation):
 * commune → son EPCI → son département → la région — the rank-in-context
 * ladder, powered by `territoires.epci`. Steps that don't apply are omitted:
 * an EPCI has no EPCI parent (its ladder starts at itself → département →
 * région), the région has no parents (only itself). Pure — payload in,
 * ordered echelons out.
 */

import { trouverTerritoire } from '@/payload/selectors'
import type { Payload, Territoire } from '@/payload/types'

/** The ordered context ladder for a territory (itself first, then its parents). */
export function echelleContexte(payload: Payload, id: string): Territoire[] {
  const depart = trouverTerritoire(payload, id)
  if (!depart) return []

  const echelons: Territoire[] = [depart]
  const dejaVus = new Set([depart.territoire])
  let courant = depart

  // commune → son EPCI (le SIREN porté par la référence)
  if (courant.type === 'commune' && courant.epci) {
    const epci = trouverTerritoire(payload, courant.epci)
    if (epci && !dejaVus.has(epci.territoire)) {
      echelons.push(epci)
      dejaVus.add(epci.territoire)
      courant = epci
    }
  }

  // tout échelon (hors département/région) → son département
  if (courant.type !== 'departement' && courant.type !== 'region' && courant.departement) {
    const departement = trouverTerritoire(payload, courant.departement)
    if (departement && !dejaVus.has(departement.territoire)) {
      echelons.push(departement)
      dejaVus.add(departement.territoire)
      courant = departement
    }
  }

  // tout échelon (hors région) → la région
  if (courant.type !== 'region') {
    const region = payload.territoires.find((t) => t.type === 'region')
    if (region && !dejaVus.has(region.territoire)) {
      echelons.push(region)
    }
  }

  return echelons
}

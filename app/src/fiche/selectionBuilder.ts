import type { Territoire } from '@/payload/types'
import type { MembreSelection, SelectionComparaison } from './comparisonContext'

export function membreTerritoire(territoire: Territoire): MembreSelection {
  return { territory_type: territoire.type, territory_id: territoire.territoire }
}

export function memeMembre(a: MembreSelection, b: MembreSelection): boolean {
  return a.territory_type === b.territory_type && a.territory_id === b.territory_id
}

/** Le focal n'est inséré qu'au démarrage, jamais après un retrait ou un vide explicite. */
export function membresConstructeur(
  selection: SelectionComparaison, focal: Territoire, reference: readonly Territoire[],
): readonly MembreSelection[] {
  if (selection.etat === 'membres') return selection.membres
  if (selection.etat === 'vide') return []
  if (selection.etat === 'preset') {
    return reference.filter((item) => item.type === focal.type && (
      selection.preset === 'bretagne' ||
      (selection.preset === 'epci' && Boolean(focal.epci) && item.epci === focal.epci) ||
      (selection.preset === 'densite' && Boolean(focal.classe_densite_code) && item.classe_densite_code === focal.classe_densite_code)
    )).map(membreTerritoire)
  }
  return [membreTerritoire(focal)]
}

/** Recherche locale sur la référence validée, pas de nouvelle source d'identités. */
export function rechercherMembres(
  demande: string, focal: Territoire, reference: readonly Territoire[], membres: readonly MembreSelection[],
): Territoire[] {
  const normaliser = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').trim()
  const recherche = normaliser(demande)
  if (!recherche) return []
  return reference.filter((item) => item.type === focal.type &&
    !membres.some((membre) => memeMembre(membre, membreTerritoire(item))) &&
    (normaliser(item.nom).includes(recherche) || item.territoire.includes(recherche)))
}

export function modifierMembres(
  membres: readonly MembreSelection[], membre: MembreSelection, action: 'ajouter' | 'retirer',
): SelectionComparaison {
  const autres = membres.filter((item) => !memeMembre(item, membre))
  const resultat = action === 'ajouter' ? [...autres, membre] : autres
  return resultat.length ? { etat: 'membres', membres: resultat } : { etat: 'vide' }
}

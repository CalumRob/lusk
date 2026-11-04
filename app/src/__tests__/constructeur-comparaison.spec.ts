import { describe, expect, it } from 'vitest'
import { membresConstructeur, rechercherMembres, modifierMembres } from '../fiche/selectionBuilder'
import { lireSelectionBrute, serialiserSelection } from '../fiche/comparisonContext'
import type { Territoire } from '../payload/types'

const focal = { type: 'commune', territoire: '1', nom: 'Étel', epci: 'E', classe_densite_code: '3' } as Territoire
const voisin = { ...focal, territoire: '2', nom: 'Erdeven' }
const autre = { ...focal, territoire: '3', nom: 'Vannes', epci: 'F' }
const epci = { type: 'epci', territoire: 'E', nom: 'Étel communauté' } as Territoire
const reference = [focal, voisin, autre, epci]
const membre = (id: string) => ({ territory_type: 'commune' as const, territory_id: id })

describe('Constructeur de comparaison — membres explicites', () => {
  it('remplace les membres par ceux du preset au même niveau, focal compris', () => {
    expect(membresConstructeur({ etat: 'preset', preset: 'epci' }, focal, reference))
      .toEqual([membre('1'), membre('2')])
    expect(membresConstructeur({ etat: 'preset', preset: 'bretagne' }, focal, reference))
      .toEqual([membre('1'), membre('2'), membre('3')])
  })
  it('cherche par nom sans accents ou identifiant, seulement au niveau focal, sans les membres présents', () => {
    expect(rechercherMembres('etel', focal, reference, [])).toEqual([focal])
    expect(rechercherMembres('2', focal, reference, [])).toEqual([voisin])
    expect(rechercherMembres('e', focal, reference, [membre('1')])).toEqual([voisin, autre])
    expect(rechercherMembres('   ', focal, reference, [])).toEqual([])
  })
  it('pré-ajoute le focal, le retire, préserve le vide et partage les membres sans réinsérer le focal', () => {
    const initial = membresConstructeur({ etat: 'defaut' }, focal, reference)
    expect(initial).toEqual([membre('1')])
    const vide = modifierMembres(initial, membre('1'), 'retirer')
    expect(vide).toEqual({ etat: 'vide' })
    expect(membresConstructeur(vide, focal, reference)).toEqual([])
    const custom = modifierMembres([], membre('2'), 'ajouter')
    expect(lireSelectionBrute(serialiserSelection(custom))).toEqual({ etat: 'membres', membres: [membre('2')] })
  })
})

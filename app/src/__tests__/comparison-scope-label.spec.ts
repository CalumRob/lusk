import { describe, expect, it } from 'vitest'

import { apiComparisonScopeLabel } from '../fiche/content/comparisonScopeLabel'
import { rangScopeNoteCopy } from '../fiche/content/comparisonWording'
import type { Territoire } from '../payload/types'

/**
 * Audit du helper de portée déclarée par l'API (#892 recheck) : référence
 * nulle/manquante, codes de densité différents, portées same_level — aucun
 * libellé spatial inventé (CONTEXT.md « Partie bretonne d'un EPCI »), le label
 * publié par le producteur gagne toujours.
 */

const communeFocal = {
  type: 'commune' as const,
  classe_densite_code: '7',
  classe_densite_libelle_public: 'communes rurales à habitat très dispersé en Bretagne',
} as Pick<Territoire, 'type' | 'classe_densite_code' | 'classe_densite_libelle_public'>

describe('apiComparisonScopeLabel — portée déclarée par la lecture API', () => {
  it('le label publié par le producteur gagne, même sans cible résoluble', () => {
    expect(apiComparisonScopeLabel({ kind: 'same_level', territory_type: 'epci', label: 'Tous les EPCI' }, null, 'Bretagne'))
      .toBe('Tous les EPCI')
    expect(apiComparisonScopeLabel({ kind: 'density_class', label: 'Classe publiée' }, null, 'Bretagne'))
      .toBe('Classe publiée')
  })

  it('explicit_selection = l’univers listé de l’URL (fallback passé par l’appelant)', () => {
    expect(apiComparisonScopeLabel({ kind: 'explicit_selection', member_count: 4 }, communeFocal, 'Département 22 · EPCI 200000001'))
      .toBe('Département 22 · EPCI 200000001')
  })

  it('density_class : le label public de la référence UNIQUEMENT si les codes correspondent au focal acquis', () => {
    expect(apiComparisonScopeLabel({ kind: 'density_class', territory_type: 'commune', density_class_code: '7' }, communeFocal, 'Bretagne'))
      .toBe('communes rurales à habitat très dispersé en Bretagne')
    // codes différents : JAMAIS le label de la classe du focal (revue : pas de
    // revendication fausse) — le rejet a lieu au seam d'acquisition ; ici null
    expect(apiComparisonScopeLabel({ kind: 'density_class', territory_type: 'commune', density_class_code: '5' }, communeFocal, 'Bretagne'))
      .toBeNull()
  })

  it('référence nulle ou classe absente : pas de label de classe fabriqué', () => {
    expect(apiComparisonScopeLabel({ kind: 'density_class', territory_type: 'commune', density_class_code: '7' }, null, 'Bretagne')).toBeNull()
    const sansClasse = { type: 'commune' as const, classe_densite_code: null, classe_densite_libelle_public: null }
    expect(apiComparisonScopeLabel({ kind: 'density_class', territory_type: 'commune', density_class_code: '7' }, sansClasse, 'Bretagne')).toBeNull()
  })

  it('same_level : libellé neutre de la portée déclarée, JAMAIS « EPCI bretons » (CONTEXT évite toute revendication spatiale)', () => {
    expect(apiComparisonScopeLabel({ kind: 'same_level', territory_type: 'epci' }, { type: 'epci' }, 'Bretagne'))
      .toBe('même niveau territorial (EPCI)')
    expect(apiComparisonScopeLabel({ kind: 'same_level', territory_type: 'departement' }, { type: 'departement' }, 'Bretagne'))
      .toBe('même niveau territorial (départements)')
    expect(apiComparisonScopeLabel({ kind: 'same_level', territory_type: 'commune' }, communeFocal, 'Bretagne'))
      .toBe('même niveau territorial (communes)')
    // type incohérent avec la cible : rien
    expect(apiComparisonScopeLabel({ kind: 'same_level', territory_type: 'epci' }, communeFocal, 'Bretagne')).toBeNull()
  })

  it('scope nul/absent ou kind inconnu : null, jamais de fallback inventé', () => {
    expect(apiComparisonScopeLabel(null, communeFocal, 'Bretagne')).toBeNull()
    expect(apiComparisonScopeLabel(undefined, communeFocal, 'Bretagne')).toBeNull()
    expect(apiComparisonScopeLabel({ kind: 'autre' }, communeFocal, 'Bretagne')).toBeNull()
  })
})

describe('rangScopeNoteCopy — copie partagée de la note de portée du rang', () => {
  it('nomme la portée déclarée et la cohorte de comparaison (member_count), sans confondre avec le nombre classé (rank_size des cellules)', () => {
    expect(rangScopeNoteCopy('bourgs ruraux bretons', 4))
      .toBe('Rangs publiés par l’API — portée : bourgs ruraux bretons · cohorte de comparaison : 4 territoires')
    expect(rangScopeNoteCopy('bourgs ruraux bretons', 1))
      .toBe('Rangs publiés par l’API — portée : bourgs ruraux bretons · cohorte de comparaison : 1 territoire')
    expect(rangScopeNoteCopy('classe X', null))
      .toBe('Rangs publiés par l’API — portée : classe X')
  })
})

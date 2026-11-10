import { describe, expect, it } from 'vitest'
import { aedarComparisonIntent } from '@/fiche/content/aedarComparisonClient'
import type { SelectionComparaison } from '@/fiche/comparisonContext'

const choix = (preset: 'epci' | 'bretagne' | 'densite'): SelectionComparaison => ({ etat: 'preset', preset })

describe('comparaison AEDAR — intention typée selon le niveau focal', () => {
  it.each([
    ['commune', choix('epci'), null, { kind: 'fixed_comparison', context: 'epci' }],
    ['commune', choix('bretagne'), null, { kind: 'fixed_comparison', context: 'bretagne' }],
    ['commune', choix('densite'), null, { kind: 'fixed_comparison', context: 'density_class' }],
    ['commune', { etat: 'defaut' }, 'epci', { kind: 'fixed_comparison', context: 'epci' }],
    ['epci', choix('bretagne'), null, { kind: 'fixed_comparison', context: 'same_level' }],
    ['departement', choix('bretagne'), null, { kind: 'fixed_comparison', context: 'same_level' }],
    ['epci', { etat: 'defaut' }, 'bretagne', { kind: 'fixed_comparison', context: 'same_level' }],
  ] as const)('résout %s + %j vers la portée déclarée par le contrat', (territoryType, selection, presetDefaut, expected) => {
    expect(aedarComparisonIntent({ territoryType, selection, presetDefaut })).toEqual(expected)
  })

  it('réserve le contexte density_class aux communes et n’invente aucune comparaison pour la Région', () => {
    expect(aedarComparisonIntent({ territoryType: 'epci', selection: choix('densite'), presetDefaut: 'bretagne' })).toBeNull()
    expect(aedarComparisonIntent({ territoryType: 'departement', selection: choix('epci'), presetDefaut: 'bretagne' })).toBeNull()
    expect(aedarComparisonIntent({ territoryType: 'region', selection: choix('bretagne'), presetDefaut: 'bretagne' })).toBeNull()
    expect(aedarComparisonIntent({ territoryType: 'region', selection: { etat: 'defaut' }, presetDefaut: null })).toBeNull()
    expect(aedarComparisonIntent({ territoryType: 'commune', selection: { etat: 'vide' }, presetDefaut: 'epci' })).toBeNull()
    expect(aedarComparisonIntent({ territoryType: 'commune', selection: { etat: 'membres', membres: [] }, presetDefaut: 'epci' })).toBeNull()
    expect(aedarComparisonIntent({ territoryType: 'commune', selection: null, presetDefaut: 'epci' })).toBeNull()
  })

  it('préserve les membres typés personnalisés sans les réétiqueter en portée fixe', () => {
    const membres = [
      { territory_type: 'commune' as const, territory_id: '22001' },
      { territory_type: 'commune' as const, territory_id: '22106' },
    ]
    expect(aedarComparisonIntent({ territoryType: 'commune', selection: { etat: 'membres', membres },
      presetDefaut: 'epci' })).toEqual({ kind: 'selected_comparison', members: membres })
  })
})

import { describe, expect, it } from 'vitest'

import {
  libelleOptionComparaison,
  optionsContexteComparaison,
  queryTerritoireAvecComparaison,
  resoudreContexteComparaison,
  territoireReferencePourComparaison,
} from '@/fiche/comparisonContext'
import type {
  TerritoryComparisonContext,
  TerritoryComparisonMode,
} from '@/payload/territoryReadModel'
import { territoiresFixture } from '@/payload/fixtures'

function contexte(mode: TerritoryComparisonMode): TerritoryComparisonContext {
  const kinds: Record<TerritoryComparisonMode, TerritoryComparisonContext['scope']['kind']> = {
    densite: 'communes-densite',
    epci: 'communes-epci',
    bretagne: 'communes-bretagne',
  }
  return {
    mode,
    scope: { kind: kinds[mode], label: mode },
    facts: [],
    buildingDistribution: null,
    accessRamp: null,
  }
}

const contextes = {
  densite: contexte('densite'),
  epci: contexte('epci'),
  bretagne: contexte('bretagne'),
}

describe('contexte de comparaison communal piloté par l’URL', () => {
  const commune = territoiresFixture.find((territoire) => territoire.territoire === '22001')!

  it('résout la densité canonique quand le paramètre est absent', () => {
    expect(resoudreContexteComparaison({
      territoire: commune,
      demande: undefined,
      contextes: contextes,
    })).toEqual({
      mode: 'densite',
      contexte: contextes.densite,
      canonicaliser: false,
    })
  })

  it.each(['densite', 'epci', 'bretagne'] as const)(
    'résout le mode publié %s',
    (demande) => {
      expect(resoudreContexteComparaison({
        territoire: commune,
        demande,
        contextes: contextes,
      })).toEqual({ mode: demande, contexte: contextes[demande], canonicaliser: false })
    },
  )

  it.each(['mystere', ['epci', 'bretagne'], null])(
    'ramène une demande inconnue (%s) à la densité et demande une URL canonique',
    (demande) => {
      expect(resoudreContexteComparaison({
        territoire: commune,
        demande,
        contextes: contextes,
      })).toEqual({
        mode: 'densite',
        contexte: contextes.densite,
        canonicaliser: true,
      })
    },
  )

  it('retire le mode EPCI indisponible et revient à la densité', () => {
    expect(resoudreContexteComparaison({
      territoire: { ...commune, epci: null },
      demande: 'epci',
      contextes: contextes,
    })).toEqual({
      mode: 'densite',
      contexte: contextes.densite,
      canonicaliser: true,
    })

    expect(resoudreContexteComparaison({
      territoire: commune,
      demande: 'epci',
      contextes: { densite: contextes.densite },
    })).toEqual({
      mode: 'densite',
      contexte: contextes.densite,
      canonicaliser: true,
    })
  })

  it.each([
    {
      territoire: territoiresFixture.find((territoire) => territoire.type === 'epci')!,
      kind: 'epcis-bretagne' as const,
      label: 'EPCI bretons',
    },
    {
      territoire: territoiresFixture.find((territoire) => territoire.type === 'departement')!,
      kind: 'departements-bretagne' as const,
      label: 'départements bretons',
    },
  ])('uses the fixed Bretagne context for $label without a communal URL mode', ({ territoire, kind, label }) => {
    const contexteFixe = {
      ...contextes.bretagne,
      scope: { kind, label },
    }
    expect(resoudreContexteComparaison({
      territoire,
      demande: undefined,
      contextes: { bretagne: contexteFixe },
    })).toEqual({ mode: null, contexte: contexteFixe, canonicaliser: false })
    expect(resoudreContexteComparaison({
      territoire,
      demande: 'bretagne',
      contextes: { bretagne: contexteFixe },
    })).toEqual({ mode: null, contexte: contexteFixe, canonicaliser: true })
  })

  it('conserve le mode dans les liens vers une autre fiche communale', () => {
    expect(queryTerritoireAvecComparaison({ comparaison: 'epci', variant: 'E' }, 'mobilite'))
      .toEqual({ theme: 'mobilite', comparaison: 'epci' })
    expect(queryTerritoireAvecComparaison({ variant: 'E' }, 'mobilite'))
      .toEqual({ theme: 'mobilite' })
  })

  it('publie les options disponibles dans l’ordre produit avec l’aide de la densité', () => {
    expect(optionsContexteComparaison({
      territoire: commune,
      contextes,
    })).toEqual([
      {
        mode: 'densite',
        label: 'densite',
        description: 'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
      },
      { mode: 'epci', label: 'epci', description: null },
      { mode: 'bretagne', label: 'bretagne', description: null },
    ])
  })

  it('ne publie jamais l’option EPCI pour une commune sans EPCI', () => {
    expect(optionsContexteComparaison({
      territoire: { ...commune, epci: null },
      contextes,
    }).map((option) => option.mode)).toEqual(['densite', 'bretagne'])
  })

  it('conserve la grammaire des comparaisons groupées par bâtiments', () => {
    const option = { mode: 'epci' as const, label: 'communes de EPCI X', description: null }
    expect(libelleOptionComparaison(option, 'bâtiments')).toBe('bâtiments des communes de EPCI X')
    expect(libelleOptionComparaison({ ...option, label: 'communes bretonnes' }, 'bâtiments'))
      .toBe('bâtiments des communes bretonnes')
  })
})

describe('territoire de référence AEDAR', () => {
  const commune = territoiresFixture.find((territoire) => territoire.territoire === '22001')!
  const epci = territoiresFixture.find((territoire) => territoire.type === 'epci')!
  const departement = territoiresFixture.find((territoire) => territoire.type === 'departement')!
  const region = territoiresFixture.find((territoire) => territoire.type === 'region')!
  const bretagne = { type: 'region' as const, id: '53', nom: 'Bretagne' }

  it('résout l’EPCI de la commune pour le mode epci', () => {
    expect(territoireReferencePourComparaison({
      territoire: commune,
      mode: 'epci',
      territoires: territoiresFixture,
    })).toEqual({ type: 'epci', id: '200000001', nom: 'EPCI X' })
  })

  it('résout la région Bretagne pour le mode bretagne', () => {
    expect(territoireReferencePourComparaison({
      territoire: commune,
      mode: 'bretagne',
      territoires: territoiresFixture,
    })).toEqual(bretagne)
  })

  it('ne résout aucun territoire de référence pour une cohorte de densité', () => {
    expect(territoireReferencePourComparaison({
      territoire: commune,
      mode: 'densite',
      territoires: territoiresFixture,
    })).toBeNull()
  })

  it('résout la région Bretagne pour les niveaux EPCI et département', () => {
    for (const territoire of [epci, departement]) {
      expect(territoireReferencePourComparaison({
        territoire,
        mode: null,
        territoires: territoiresFixture,
      })).toEqual(bretagne)
    }
  })

  it('ne résout aucune référence pour la région ou sans territoire', () => {
    expect(territoireReferencePourComparaison({
      territoire: region,
      mode: null,
      territoires: territoiresFixture,
    })).toBeNull()
    expect(territoireReferencePourComparaison({
      territoire: null,
      mode: 'epci',
      territoires: territoiresFixture,
    })).toBeNull()
  })

  it('ne résout pas une EPCI absente du référentiel', () => {
    expect(territoireReferencePourComparaison({
      territoire: { ...commune, epci: null },
      mode: 'epci',
      territoires: territoiresFixture,
    })).toBeNull()
    expect(territoireReferencePourComparaison({
      territoire: commune,
      mode: 'epci',
      territoires: territoiresFixture.filter((item) => item.type !== 'epci'),
    })).toBeNull()
  })
})

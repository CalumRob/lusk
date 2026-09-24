import { describe, expect, it } from 'vitest'

import {
  queryTerritoireAvecComparaison,
  resoudreContexteComparaison,
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

  it('ne propage pas le mode communal aux autres niveaux', () => {
    const epci = territoiresFixture.find((territoire) => territoire.type === 'epci')!
    expect(resoudreContexteComparaison({
      territoire: epci,
      demande: 'bretagne',
      contextes: contextes,
    })).toEqual({ mode: null, contexte: null, canonicaliser: true })
  })

  it('conserve le mode dans les liens vers une autre fiche communale', () => {
    expect(queryTerritoireAvecComparaison({ comparaison: 'epci', variant: 'E' }, 'mobilite'))
      .toEqual({ theme: 'mobilite', comparaison: 'epci' })
    expect(queryTerritoireAvecComparaison({ variant: 'E' }, 'mobilite'))
      .toEqual({ theme: 'mobilite' })
  })
})

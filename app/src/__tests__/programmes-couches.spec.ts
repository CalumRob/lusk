import { describe, expect, it } from 'vitest'

import { COULEUR_NEUTRE } from '../carte/couleurs'
import {
  collectionAvecMembres,
  expressionMembres,
  membresParTerritoire,
  subventionsParTerritoire,
} from '../carte/fusion'
import {
  coucheParDefautProgrammes,
  couchesProgrammes,
  siglesMembresDuNiveau,
  typeAdhesionDuNiveau,
} from '../carte/programmesCouches'
import { programmesFixture, programmesVideFixture, territoiresFixture } from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * Le modèle de couches de l'onglet « Programmes & financements » de la carte
 * (ADR-0019 #282) — level-native depuis programmes.json (ADR-0013) : les
 * couches d'adhésion par sigle (highlight catégoriel in/out) n'existent qu'à
 * leur niveau d'ancrage (ACV/PVD/ORT à la commune, CRTE/Territoires
 * d'industrie/ORT à l'EPCI — AUCUNE au département, l'absence honnête), la
 * couche subventions (le total € par territoire, somme des lignes d'agrégat)
 * existe à TOUS les niveaux. Les jointures et la peinture catégorielle
 * (expressionMembres) vivent dans fusion.ts, à côté de la choroplèthe.
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: [],
  histoires: [],
  apercu: [],
  runReport: null,
  vintages: null,
  programmes: programmesFixture,
}

describe('typeAdhesionDuNiveau — l’ancrage des lignes d’adhésion par niveau de masque', () => {
  it('ancre les communes aux lignes communales, les EPCIs aux lignes EPCI', () => {
    expect(typeAdhesionDuNiveau('communes')).toBe('commune')
    expect(typeAdhesionDuNiveau('epcis')).toBe('epci')
  })

  it('rend null au département — AUCUNE ligne d’adhésion à ce niveau, jamais inventée', () => {
    expect(typeAdhesionDuNiveau('departements')).toBeNull()
  })
})

describe('siglesMembresDuNiveau — les programmes d’adhésion level-native', () => {
  it('offre ACV · PVD · ORT au niveau commune (l’ordre canonique du contrat)', () => {
    expect(siglesMembresDuNiveau(payload, 'communes')).toEqual(['ACV', 'PVD', 'ORT'])
  })

  it('offre CRTE · Territoires d’industrie · ORT au niveau EPCI', () => {
    expect(siglesMembresDuNiveau(payload, 'epcis')).toEqual(['CRTE', "Territoires d'industrie", 'ORT'])
  })

  it('n’offre AUCUN programme d’adhésion au département — l’absence honnête, pas un inventé', () => {
    expect(siglesMembresDuNiveau(payload, 'departements')).toEqual([])
  })

  it('ne liste que les sigles qui ont des lignes dans le payload (jamais un sigle mort)', () => {
    const sansCrte: Payload = {
      ...payload,
      programmes: {
        ...programmesFixture,
        membres: programmesFixture.membres.filter((m) => m.sigle !== 'CRTE'),
      },
    }
    expect(siglesMembresDuNiveau(sansCrte, 'epcis')).toEqual(["Territoires d'industrie", 'ORT'])
  })
})

describe('couchesProgrammes — le jeu de couches de l’onglet', () => {
  it('liste les couches d’adhésion du niveau puis la couche subventions (commune)', () => {
    const couches = couchesProgrammes(payload, 'communes')

    expect(couches).toEqual([
      { source: 'membre', sigle: 'ACV', libelle: 'ACV', niveau: 'communes' },
      { source: 'membre', sigle: 'PVD', libelle: 'PVD', niveau: 'communes' },
      { source: 'membre', sigle: 'ORT', libelle: 'ORT', niveau: 'communes' },
      { source: 'subvention', libelle: 'Subventions totales' },
    ])
  })

  it('liste CRTE · Territoires d’industrie · ORT puis les subventions au niveau EPCI', () => {
    const couches = couchesProgrammes(payload, 'epcis')

    expect(couches.map((c) => (c.source === 'membre' ? c.sigle : 'subventions'))).toEqual([
      'CRTE',
      "Territoires d'industrie",
      'ORT',
      'subventions',
    ])
  })

  it('ne garde que la couche subventions au département — aucune adhésion à inventer', () => {
    const couches = couchesProgrammes(payload, 'departements')

    expect(couches).toEqual([{ source: 'subvention', libelle: 'Subventions totales' }])
  })

  it('ne propose pas la couche subventions à un niveau sans ligne d’agrégat', () => {
    const sansEpci: Payload = {
      ...payload,
      programmes: {
        membres: programmesFixture.membres,
        subventions: programmesFixture.subventions.filter((s) => s.type !== 'epci'),
      },
    }

    const couches = couchesProgrammes(sansEpci, 'epcis')
    expect(couches.some((c) => c.source === 'subvention')).toBe(false)
  })

  it('rend le jeu vide quand le payload programmes est absent (404 = élément absent)', () => {
    expect(couchesProgrammes({ ...payload, programmes: null }, 'communes')).toEqual([])
  })

  it('rend le jeu vide pour des tables présentes mais sans aucune ligne', () => {
    expect(couchesProgrammes({ ...payload, programmes: programmesVideFixture }, 'communes')).toEqual([])
  })
})

describe('coucheParDefautProgrammes — la couche par défaut de l’onglet', () => {
  it('préfère la couche subventions à chaque niveau (le total € existe partout)', () => {
    for (const niveau of ['communes', 'epcis', 'departements'] as const) {
      expect(coucheParDefautProgrammes(payload, niveau)).toEqual({
        source: 'subvention',
        libelle: 'Subventions totales',
      })
    }
  })

  it('retombe sur la première couche d’adhésion quand les subventions manquent', () => {
    const sansSubventions: Payload = {
      ...payload,
      programmes: { membres: programmesFixture.membres, subventions: [] },
    }

    expect(coucheParDefautProgrammes(sansSubventions, 'communes')).toEqual({
      source: 'membre',
      sigle: 'ACV',
      libelle: 'ACV',
      niveau: 'communes',
    })
  })

  it('rend null sans aucun programme', () => {
    expect(coucheParDefautProgrammes({ ...payload, programmes: null }, 'communes')).toBeNull()
  })
})

describe('membresParTerritoire — la jointure d’adhésion (in/out)', () => {
  it('marque les seuls territoires d’adhésion du sigle au niveau donné (ACV — commune)', () => {
    const parTerritoire = membresParTerritoire(payload, 'ACV', 'communes')

    expect(parTerritoire.get('22001')).toBe(true)
    expect(parTerritoire.has('22002')).toBe(false) // PVD, pas ACV
    expect(parTerritoire.has('29001')).toBe(false)
  })

  it('lit l’ORT à SON ancrage — la commune 29001 au niveau commune, son EPCI au niveau EPCI', () => {
    const communes = membresParTerritoire(payload, 'ORT', 'communes')
    const epcis = membresParTerritoire(payload, 'ORT', 'epcis')

    expect(communes.get('29001')).toBe(true)
    expect(communes.has('22001')).toBe(false)
    expect(epcis.get('200000002')).toBe(true)
    expect(epcis.has('200000001')).toBe(false)
  })

  it('ne joint aucune ligne pour un sigle non ancré au niveau (CRTE n’a pas de ligne commune)', () => {
    expect(membresParTerritoire(payload, 'CRTE', 'communes').size).toBe(0)
  })

  it('ne joint rien au département — aucune adhésion à ce niveau', () => {
    expect(membresParTerritoire(payload, 'ACV', 'departements').size).toBe(0)
  })
})

describe('subventionsParTerritoire — la jointure du total €', () => {
  it('SOMME les lignes du territoire (la ventilation par domaine du niveau commune)', () => {
    const parTerritoire = subventionsParTerritoire(payload, 'communes')

    // 22001 : deux lignes de domaine (30000 + 15000) → le total annuel
    expect(parTerritoire.get('22001')).toEqual({ value: 45000, unit: '€' })
    expect(parTerritoire.size).toBe(1)
  })

  it('lit le total annuel unique des niveaux agrégés', () => {
    const epcis = subventionsParTerritoire(payload, 'epcis')
    const departements = subventionsParTerritoire(payload, 'departements')

    expect(epcis.get('200000001')).toEqual({ value: 45000, unit: '€' })
    expect(departements.get('22')).toEqual({ value: 300000, unit: '€' })
    expect(departements.get('29')).toBeUndefined() // aucune ligne — jamais un zéro inventé
  })

  it('rend la carte vide quand le payload programmes est absent', () => {
    expect(subventionsParTerritoire({ ...payload, programmes: null }, 'communes').size).toBe(0)
  })
})

describe('collectionAvecMembres + expressionMembres — la peinture catégorielle (in/out)', () => {
  it('bake le booléen membre dans les propriétés des features (jamais un nombre)', () => {
    const collection = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: { territoire: '22001', nom: 'Commune A1', type: 'commune' as const },
          geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [0, 0]]] },
        },
        {
          type: 'Feature' as const,
          properties: { territoire: '22002', nom: 'Commune D', type: 'commune' as const },
          geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [0, 0]]] },
        },
      ],
    }
    const parTerritoire = membresParTerritoire(payload, 'ACV', 'communes')

    const avecMembres = collectionAvecMembres(collection, parTerritoire)
    expect(avecMembres.features[0].properties.membre).toBe(true)
    expect(avecMembres.features[1].properties.membre).toBe(false)
  })

  it('peint le membre dans la couleur d’highlight, le non-membre dans le neutre — deux classes, jamais une rampe', () => {
    const expression = expressionMembres('#123456')

    expect(expression).toEqual([
      'case',
      ['==', ['get', 'membre'], true],
      '#123456',
      COULEUR_NEUTRE,
    ])
  })
})

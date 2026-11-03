import { describe, expect, it } from 'vitest'

import { COULEUR_NEUTRE } from '../carte/couleurs'
import {
  collectionAvecMembres,
  expressionMembres,
  membresParTerritoire,
  subventionsParTerritoire,
} from '../carte/fusion'
import { echelleValeurs } from '../carte/seuils'
import {
  coucheParDefautProgrammes,
  couchesProgrammes,
  siglesMembresDuNiveau,
  typeAdhesionDuNiveau,
} from '../carte/programmesCouches'
import {
  mapGrantFactsProgrammesFixture,
  mapMembershipsProgrammesFixture,
  territoiresFixture,
} from '../payload/fixtures'
import type { Payload, ProgrammesPayload } from '../payload/types'

/**
 * Le modèle de couches de l'onglet « Programmes & financements » de la carte
 * (ADR-0019 #282) — piloté EXCLUSIVEMENT par le cohort NATIF de l'API
 * (mapMemberships / mapGrantFacts) depuis #893 : la projection statique
 * programmes.json est retirée, aucun repli n'existe. Level-native : les
 * couches d'adhésion par sigle (highlight catégoriel in/out) n'existent qu'à
 * leur niveau d'ancrage (ACV/PVD/ORT à la commune, CRTE/Territoires
 * d'industrie/ORT à l'EPCI — AUCUNE au département, l'absence honnête), la
 * couche subventions (le total € par territoire, faits natifs de subvention)
 * existe à TOUS les niveaux. Les jointures et la peinture catégorielle
 * (expressionMembres) vivent dans fusion.ts, à côté de la choroplèthe.
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: [],
  histoires: [],
  runReport: null,
  vintages: null,
  programmes: { mapMemberships: mapMembershipsProgrammesFixture },
  mapGrantFacts: mapGrantFactsProgrammesFixture,
}

/** Aucun fait natif acquis (API pas encore prête / échec) — jamais de repli. */
const payloadSansNatif: Payload = { ...payload, programmes: null, mapGrantFacts: undefined }

describe('typeAdhesionDuNiveau — l’ancrage des lignes d’adhésion par niveau de masque', () => {
  it('ancre les communes aux lignes communales, les EPCIs aux lignes EPCI', () => {
    expect(typeAdhesionDuNiveau('communes')).toBe('commune')
    expect(typeAdhesionDuNiveau('epcis')).toBe('epci')
  })

  it('rend null au département — AUCUNE ligne d’adhésion à ce niveau, jamais inventée', () => {
    expect(typeAdhesionDuNiveau('departements')).toBeNull()
  })
})

describe('siglesMembresDuNiveau — les programmes d’adhésion level-native (cohort API)', () => {
  it('offre ACV · PVD · ORT au niveau commune (l’ordre canonique du contrat)', () => {
    expect(siglesMembresDuNiveau(payload, 'communes')).toEqual(['ACV', 'PVD', 'ORT'])
  })

  it('offre CRTE · Territoires d’industrie · ORT au niveau EPCI', () => {
    expect(siglesMembresDuNiveau(payload, 'epcis')).toEqual(['CRTE', "Territoires d'industrie", 'ORT'])
  })

  it('n’offre AUCUN programme d’adhésion au département — l’absence honnête, pas un inventé', () => {
    expect(siglesMembresDuNiveau(payload, 'departements')).toEqual([])
  })

  it('ne liste que les sigles avec un membre natif au niveau (jamais un sigle mort)', () => {
    const sansCrte: Payload = {
      ...payload,
      programmes: {
        mapMemberships: mapMembershipsProgrammesFixture.filter((m) => m.sigle !== 'CRTE'),
      },
    }
    expect(siglesMembresDuNiveau(sansCrte, 'epcis')).toEqual(["Territoires d'industrie", 'ORT'])
  })

  it('un no_record natif ne compte pas comme membre (absence distincte de false)', () => {
    // 29002 a une entrée ACV en no_record (member null) : ACV reste offert
    // grâce à 22001, mais 29002 ne sera jamais peint membre.
    const avecNoRecord: Payload = {
      ...payload,
      programmes: {
        mapMemberships: mapMembershipsProgrammesFixture.filter(
          (m) => !(m.territoire === '22001' && m.sigle === 'ACV'),
        ),
      },
    }
    expect(siglesMembresDuNiveau(avecNoRecord, 'communes')).toEqual(['PVD', 'ORT'])
  })
})

describe('couchesProgrammes — le jeu de couches de l’onglet (faits natifs seuls)', () => {
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

  it('ne propose pas la couche subventions à un niveau sans fait natif de subvention', () => {
    const sansEpci: Payload = {
      ...payload,
      mapGrantFacts: mapGrantFactsProgrammesFixture.filter((f) => f.type !== 'epci'),
    }

    const couches = couchesProgrammes(sansEpci, 'epcis')
    expect(couches.some((c) => c.source === 'subvention')).toBe(false)
  })

  it('rend le jeu vide quand aucun fait natif n’est acquis (pas de repli statique, #893)', () => {
    expect(couchesProgrammes(payloadSansNatif, 'communes')).toEqual([])
  })

  it('ignore complètement d’anciens tableaux membres/subventions — ils ne peuvent alimenter aucune couche (#893)', () => {
    const legacy = {
      membres: [
        { territoire: '22001', type: 'commune', sigle: 'ACV', convention_valant_ort: true },
      ],
      subventions: [
        { territoire: '22001', type: 'commune', annee: 2025, programme_libl: 'X', montant: 45000 },
      ],
    } as unknown as ProgrammesPayload
    const p: Payload = { ...payload, programmes: legacy, mapGrantFacts: undefined }

    expect(couchesProgrammes(p, 'communes')).toEqual([])
    expect(membresParTerritoire(p, 'ACV', 'communes').size).toBe(0)
    expect(subventionsParTerritoire(p, 'communes').size).toBe(0)
  })
})

describe('coucheParDefautProgrammes — la couche par défaut de l’onglet', () => {
  it('préfère la couche subventions à chaque niveau (le total € natif existe partout où il y a des faits)', () => {
    for (const niveau of ['communes', 'epcis', 'departements'] as const) {
      expect(coucheParDefautProgrammes(payload, niveau)).toEqual({
        source: 'subvention',
        libelle: 'Subventions totales',
      })
    }
  })

  it('retombe sur la première couche d’adhésion quand les subventions natives manquent', () => {
    const sansSubventions: Payload = { ...payload, mapGrantFacts: [] }

    expect(coucheParDefautProgrammes(sansSubventions, 'communes')).toEqual({
      source: 'membre',
      sigle: 'ACV',
      libelle: 'ACV',
      niveau: 'communes',
    })
  })

  it('rend null sans aucun fait natif', () => {
    expect(coucheParDefautProgrammes(payloadSansNatif, 'communes')).toBeNull()
  })
})

describe('membresParTerritoire — la jointure d’adhésion native (in/out)', () => {
  it('marque les seuls territoires couverts du sigle au niveau donné (ACV — commune)', () => {
    const parTerritoire = membresParTerritoire(payload, 'ACV', 'communes')

    expect(parTerritoire.get('22001')).toBe(true)
    // 22002 (PVD) : semé null par le cohort — ni membre ni false inventé
    expect(parTerritoire.get('22002')).toBeNull()
    // 29002 : no_record natif — null, DISTINCT de false
    expect(parTerritoire.get('29002')).toBeNull()
  })

  it('lit l’ORT à SON ancrage — la commune 29001 au niveau commune, son EPCI au niveau EPCI', () => {
    const communes = membresParTerritoire(payload, 'ORT', 'communes')
    const epcis = membresParTerritoire(payload, 'ORT', 'epcis')

    expect(communes.get('29001')).toBe(true)
    expect(communes.get('22001')).toBeNull()
    expect(epcis.get('200000002')).toBe(true)
    expect(epcis.get('200000001')).toBeNull()
  })

  it('ne joint aucun membre pour un sigle non ancré au niveau (CRTE n’a pas de ligne commune)', () => {
    const parTerritoire = membresParTerritoire(payload, 'CRTE', 'communes')
    expect([...parTerritoire.values()].every((v) => v !== true)).toBe(true)
  })

  it('ne joint rien au département — aucune adhésion à ce niveau', () => {
    expect(membresParTerritoire(payload, 'ACV', 'departements').size).toBe(0)
  })

  it('rend la carte vide quand le cohort natif n’est pas acquis — aucun repli (#893)', () => {
    expect(membresParTerritoire(payloadSansNatif, 'ACV', 'communes').size).toBe(0)
  })
})

describe('subventionsParTerritoire — la jointure du total € (faits natifs mapGrantFacts)', () => {
  it('joint le total annuel natif du territoire au niveau commune', () => {
    const parTerritoire = subventionsParTerritoire(payload, 'communes')

    expect(parTerritoire.get('22001')).toEqual({ value: 45000, unit: '€' })
    // 22002 a une ligne value: null — ABSENTE de la carte, jamais un zéro inventé
    expect(parTerritoire.has('22002')).toBe(false)
    expect(parTerritoire.size).toBe(1)
  })

  it('lit le total annuel unique des niveaux agrégés', () => {
    const epcis = subventionsParTerritoire(payload, 'epcis')
    const departements = subventionsParTerritoire(payload, 'departements')

    expect(epcis.get('200000001')).toEqual({ value: 45000, unit: '€' })
    expect(departements.get('22')).toEqual({ value: 300000, unit: '€' })
    expect(departements.get('29')).toBeUndefined() // aucun fait — jamais un zéro inventé
  })

  it('rend la carte vide quand aucun fait natif de subvention n’est acquis — aucun repli (#893)', () => {
    expect(subventionsParTerritoire(payloadSansNatif, 'communes').size).toBe(0)
  })
})

describe('subventionsParTerritoire — la règle de trois de l’échelle (ADR-0019 #282)', () => {
  it('les totaux € sont à queue lourde → l’échelle les espace en log, jamais en linéaire', () => {
    const valeurs = mapGrantFactsProgrammesFixture
      .map((ligne) => ligne.value)
      .filter((v): v is number => v !== null)

    expect(echelleValeurs(valeurs).type).toBe('log')
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
    // non-membre / no_record : null (neutre), jamais false inventé côté jointure
    expect(avecMembres.features[1].properties.membre).toBeNull()
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

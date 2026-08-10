import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  programmesFixture,
  programmesLadderFixture,
  programmesVideFixture,
  runReportFraisFixture,
  territoiresFixture,
  territoiresLadderFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { programmesPourTerritoire } from '../payload/selectors'
import type { Payload } from '../payload/types'

/**
 * La DÉRIVATION EN ÉCHELLE (issue #181, ADR-0013) — le sélecteur qui produit le
 * rendu de l'élément Programmes & financements de chaque fiche depuis les
 * lignes d'adhésion du payload + le référentiel `territoires` (la jointure
 * relationnelle que le contexte switcher fait déjà — les jointures sont
 * l'affaire de l'app, jamais le pipeline). Les TROIS VOIX :
 *   - couverture vers le bas : une commune montre le badge CRTE/Territoires
 *     d'industrie quand SON EPCI a signé/adhéré ;
 *   - portage nommé vers le haut : la fiche EPCI porte et nomme chaque commune
 *     labellisée ACV/PVD (liste complète, jamais tronquée) ;
 *   - l'agrégat au département/région : des comptes avec les EPCIs/communes
 *     nommés en entier — un EPCI transversal (EPCI Z, 22+29) compte dans les
 *     DEUX départements (dérivé de l'appartenance des communes, jamais du
 *     champ `departement` de la ligne EPCI).
 * Les subventions (contrat révisé #305) : la ventilation COMPLÈTE par domaine
 * sur les fiches communales — le pipeline publie chaque domaine (jamais une
 * ligne « autres »), l'app trie par montant décroissant (libellé en départage)
 * et le composant plie le top-5 + la révélation. Le total annuel unique
 * ailleurs, avec la part de contexte (commune → son EPCI, EPCI/département →
 * la région) et la provenance (la somme des communes, niveau agrégé seulement).
 * Chaque badge et chaque figure portent leur estampille vintage.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: programmesFixture,
}

/** Le payload de l'échelle — le fixture partagé + l'EPCI Z transversal. */
const payloadEchelle: Payload = {
  ...payloadDemographie,
  territoires: territoiresLadderFixture,
  programmes: programmesLadderFixture,
}

describe('programmesPourTerritoire — la fiche COMMUNE (les trois voix)', () => {
  it('montre ses labels ACV/PVD (lauréate) avec le rider « convention valant ORT » sur le label', () => {
    // 22001 (Commune A1) : lauréate ACV avec convention valant ORT
    const rendu = programmesPourTerritoire(payloadDemographie, '22001')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(['ACV', 'CRTE'])
    const acv = rendu.badges[0]
    expect(acv).toMatchObject({
      sigle: 'ACV',
      voix: 'laureate',
      conventionValantOrt: true,
      noms: [],
    })
    expect(acv.vintage).toContain('Action cœur de ville')
  })

  it('couvre la commune des contrats signés par SON EPCI (la voix descendante), l’EPCI nommé', () => {
    // 22002 (Commune D) : PVD lauréate + CRTE de son EPCI X
    const rendu = programmesPourTerritoire(payloadDemographie, '22002')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(['PVD', 'CRTE'])
    const crte = rendu.badges[1]
    expect(crte.voix).toBe('couverte')
    expect(crte.noms).toEqual(['EPCI X'])
    expect(crte.vintage).toContain('Contrat de relance')
  })

  it('ne badge JAMAIS l’ORT sur une commune labellisée (le rider est le fait accessible)', () => {
    // 22001 porte le rider ACV — aucune ligne ORT ne doit apparaître
    const rendu = programmesPourTerritoire(payloadDemographie, '22001')

    expect(rendu.badges.map((b) => b.sigle)).not.toContain('ORT')
  })

  it('badge l’ORT d’une commune NON labellisée dans un périmètre signé, et la couvre des contrats de son EPCI', () => {
    // 29001 (Commune B) : non labellisée, convention ORT signée + TI de son EPCI Y
    const rendu = programmesPourTerritoire(payloadDemographie, '29001')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(["Territoires d'industrie", 'ORT'])
    expect(rendu.badges[0]).toMatchObject({ voix: 'couverte', noms: ['EPCI Y'] })
    expect(rendu.badges[1]).toMatchObject({ sigle: 'ORT', voix: 'ort', noms: [] })
  })

  it('ne montre PAS l’ORT à une commune de l’EPCI hors périmètre (le badge ORT est une ligne commune propre)', () => {
    // 29002 (Commune C) : membre d’EPCI Y (TI + ORT au niveau EPCI) mais sans
    // ligne ORT communale — la seule couverture est le contrat TI
    const rendu = programmesPourTerritoire(payloadDemographie, '29002')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(["Territoires d'industrie"])
  })

  it('retourne le rendu vide pour un territoire inconnu — jamais un badge inventé', () => {
    expect(programmesPourTerritoire(payloadDemographie, '99999')).toEqual({
      badges: [],
      subventions: null,
    })
  })
})

describe('programmesPourTerritoire — la fiche EPCI (portage nommé vers le haut)', () => {
  it('montre ses contrats signés puis le portage nommé de chaque commune labellisée membre', () => {
    // EPCI X : CRTE signé + porte ACV (Commune A1) et PVD (Commune D)
    const rendu = programmesPourTerritoire(payloadDemographie, '200000001')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(['CRTE', 'ACV', 'PVD'])
    expect(rendu.badges[0]).toMatchObject({ voix: 'couverte', noms: [] })
    expect(rendu.badges[1]).toMatchObject({ sigle: 'ACV', voix: 'porte', noms: ['Commune A1'] })
    expect(rendu.badges[2]).toMatchObject({ sigle: 'PVD', voix: 'porte', noms: ['Commune D'] })
  })

  it('nomme TOUTES les communes labellisées du portage — la liste complète, jamais tronquée', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '200000001')

    expect(rendu.badges[1].noms).toEqual(['Commune A1'])
    expect(rendu.badges[2].noms).toEqual(['Commune D'])
  })

  it('montre le badge ORT AUTONOME quand l’ORT de l’EPCI n’est pas porté par un label, avec ses communes nommées', () => {
    // EPCI Y : TI + ORT autonome (sa commune 29001 n’est pas labellisée)
    const rendu = programmesPourTerritoire(payloadDemographie, '200000002')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(["Territoires d'industrie", 'ORT'])
    expect(rendu.badges[1]).toMatchObject({ sigle: 'ORT', voix: 'ort', noms: ['Commune B'] })
  })

  it('n’invente pas de portage sans commune labellisée membre', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '200000002')

    expect(rendu.badges.map((b) => b.sigle)).not.toContain('ACV')
    expect(rendu.badges.map((b) => b.sigle)).not.toContain('PVD')
  })
})

describe('programmesPourTerritoire — l’agrégat au DÉPARTEMENT / RÉGION (la voix qui compte)', () => {
  it('compte les contrats avec les EPCIs nommés et les labels avec les communes nommées — jamais un badge plat', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '22')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(['CRTE', 'ACV', 'PVD'])
    expect(rendu.badges[0]).toMatchObject({ sigle: 'CRTE', voix: 'compte', noms: ['EPCI X'] })
    expect(rendu.badges[1]).toMatchObject({ sigle: 'ACV', voix: 'compte', noms: ['Commune A1'] })
    expect(rendu.badges[2]).toMatchObject({ sigle: 'PVD', voix: 'compte', noms: ['Commune D'] })
  })

  it('compte l’ORT par les communes en périmètre du département', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '29')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(["Territoires d'industrie", 'ORT'])
    expect(rendu.badges[1]).toMatchObject({ sigle: 'ORT', voix: 'compte', noms: ['Commune B'] })
  })

  it('résume la région — les contrats, les labels et l’ORT avec toutes les listes nommées', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '53')

    expect(rendu.badges.map((b) => b.sigle)).toEqual([
      'CRTE',
      "Territoires d'industrie",
      'ACV',
      'PVD',
      'ORT',
    ])
    expect(rendu.badges[0]).toMatchObject({ voix: 'compte', noms: ['EPCI X'] })
    expect(rendu.badges[4]).toMatchObject({ sigle: 'ORT', voix: 'compte', noms: ['Commune B'] })
  })

  it('UN EPCI TRANSVERSAL compte dans les DEUX départements (dérivé de l’appartenance, jamais du champ département)', () => {
    const dep22 = programmesPourTerritoire(payloadEchelle, '22')
    const dep29 = programmesPourTerritoire(payloadEchelle, '29')

    // EPCI Z (200000003) : communes dans 22 (22003) ET 29 (29003) — son CRTE
    // compte dans les deux agrégats
    const crte22 = dep22.badges.find((b) => b.sigle === 'CRTE')
    const crte29 = dep29.badges.find((b) => b.sigle === 'CRTE')
    expect(crte22?.noms).toEqual(['EPCI X', 'EPCI Z'])
    expect(crte29?.noms).toEqual(['EPCI Z'])

    // l’ORT aussi : 22003 (dans 22) et 29003 (dans 29)
    expect(dep22.badges.find((b) => b.sigle === 'ORT')?.noms).toEqual(['Commune E'])
    expect(dep29.badges.find((b) => b.sigle === 'ORT')?.noms).toEqual(['Commune B', 'Commune F'])
  })

  it('la fiche de l’EPCI transversal porte ses propres badges (CRTE + ORT)', () => {
    const rendu = programmesPourTerritoire(payloadEchelle, '200000003')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(['CRTE', 'ORT'])
    expect(rendu.badges[1]).toMatchObject({
      sigle: 'ORT',
      voix: 'ort',
      noms: ['Commune E', 'Commune F'],
    })
  })
})

describe('programmesPourTerritoire — les subventions', () => {
  it('ventile le total annuel par domaine sur une fiche communale (la somme des axes = le total, triés par montant décroissant)', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '22001')

    // le fixture porte les axes NON triés (Agriculture avant Développement
    // économique) — le sélecteur les rend par montant décroissant
    expect(rendu.subventions).toEqual({
      annee: 2025,
      axes: [
        { libelle: 'Développement économique', montant: 30000 },
        { libelle: 'Agriculture', montant: 15000 },
      ],
      total: 45000,
      vintage: expect.stringContaining('SCDL'),
      partContexte: { part: 1, parent: 'epci' },
      provenance: null,
    })
  })

  it('tri les axes par montant DÉCROISSANT, le libellé en départage — la ventilation COMPLÈTE, jamais une ligne « autres »', () => {
    const rendu = programmesPourTerritoire(payloadEchelle, '29003')

    expect(rendu.subventions?.axes?.map((a) => a.libelle)).toEqual([
      'Développement économique', // 50 000 €
      'Agriculture', // 40 000 €
      'Culture', // 30 000 €
      'Sport', // 20 000 €
      'Environnement', // 10 000 €
      'Enseignement', // 6 000 € — le départage alphabétique du montant égal
      'Tourisme', // 6 000 €
    ])
    expect(rendu.subventions?.axes?.map((a) => a.montant)).toEqual([
      50000, 40000, 30000, 20000, 10000, 6000, 6000,
    ])
    expect(rendu.subventions?.axes).not.toContainEqual({ libelle: '« autres »', montant: 7000 })
    expect(rendu.subventions?.total).toBe(162000)
  })

  it('montre le total annuel UNIQUE (sans ventilation) sur les fiches EPCI / département / région', () => {
    const epci = programmesPourTerritoire(payloadDemographie, '200000001').subventions
    const departement = programmesPourTerritoire(payloadDemographie, '22').subventions
    const region = programmesPourTerritoire(payloadDemographie, '53').subventions

    expect(epci).toMatchObject({ annee: 2025, axes: null, total: 45000 })
    expect(departement).toMatchObject({ axes: null, total: 300000 })
    expect(region).toMatchObject({ axes: null, total: 2000000 })
  })

  it('n’invente pas de figure sans ligne d’agrégat — l’état vide honnête', () => {
    // EPCI Y (200000002) et le département 29 n’ont aucune ligne de subvention
    expect(programmesPourTerritoire(payloadDemographie, '200000002').subventions).toBeNull()
    expect(programmesPourTerritoire(payloadDemographie, '29').subventions).toBeNull()
    // une commune avec des badges mais sans subventions : la figure est absente
    expect(programmesPourTerritoire(payloadDemographie, '29002').subventions).toBeNull()
  })

  it('calcule la part de contexte d’une commune — son total dans celui de SON EPCI (même année de référence)', () => {
    const rendu = programmesPourTerritoire(payloadEchelle, '29003')

    expect(rendu.subventions?.partContexte).toMatchObject({ parent: 'epci' })
    expect(rendu.subventions?.partContexte?.part).toBeCloseTo(162000 / 172000, 4)
  })

  it('calcule la part de contexte d’un EPCI (transversal compris) et d’un département dans le total de la RÉGION', () => {
    const epci = programmesPourTerritoire(payloadEchelle, '200000003') // EPCI Z, 22+29
    expect(epci.subventions?.partContexte).toMatchObject({ parent: 'region' })
    expect(epci.subventions?.partContexte?.part).toBeCloseTo(172000 / 2000000, 4)

    const departement = programmesPourTerritoire(payloadDemographie, '22')
    expect(departement.subventions?.partContexte).toMatchObject({ parent: 'region' })
    expect(departement.subventions?.partContexte?.part).toBeCloseTo(300000 / 2000000, 4)
  })

  it('ne lit AUCUNE part de contexte sur la région — elle n’a pas de parent', () => {
    const region = programmesPourTerritoire(payloadDemographie, '53')

    expect(region.subventions?.partContexte).toBeNull()
  })

  it('garde la part silencieuse — une commune dont le parent n’a pas de total agrégé (ou sans aucune ligne)', () => {
    // 29001 a une ligne de subvention mais SON EPCI (Y) n’a pas de total agrégé
    const commune = programmesPourTerritoire(payloadEchelle, '29001')
    expect(commune.subventions).not.toBeNull()
    expect(commune.subventions?.partContexte).toBeNull()
    // 29002 n’a aucune ligne — pas de figure, pas de part
    expect(programmesPourTerritoire(payloadDemographie, '29002').subventions).toBeNull()
  })

  it('lit la provenance d’une fiche agrégée — la somme des communes, avec la cible du lien', () => {
    const epci = programmesPourTerritoire(payloadDemographie, '200000001')
    const departement = programmesPourTerritoire(payloadDemographie, '22')
    const region = programmesPourTerritoire(payloadDemographie, '53')

    expect(epci.subventions?.provenance).toEqual({ niveau: 'epci', code: '200000001' })
    expect(departement.subventions?.provenance).toEqual({ niveau: 'departement', code: '22' })
    expect(region.subventions?.provenance).toEqual({ niveau: 'region' })
  })

  it('ne lit AUCUNE provenance sur une fiche communale — la somme n’a pas de sens à l’échelle de la commune', () => {
    const rendu = programmesPourTerritoire(payloadEchelle, '29003')

    expect(rendu.subventions?.provenance).toBeNull()
  })
})

describe('programmesPourTerritoire — les estampilles vintage et l’état vide', () => {
  it('estampe chaque badge du vintage de SA source (l’actualisation PAR LIGNE pour l’ORT, sans publication)', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '29001')

    const ti = rendu.badges.find((b) => b.sigle === "Territoires d'industrie")
    expect(ti?.vintage).toContain('Banque des Territoires')
    const ort = rendu.badges.find((b) => b.sigle === 'ORT')
    expect(ort?.vintage).toContain('DGALN/ANCT')
    expect(ort?.vintage).toContain('réf. 15 juil. 2026')
    // la publication source de l’ORT est null par contrat — jamais un « publ. »
    expect(ort?.vintage).not.toContain('publ.')
  })

  it('retourne le rendu vide quand le payload programmes est absent (404 = élément absent)', () => {
    const sansProgrammes: Payload = { ...payloadDemographie, programmes: null }

    expect(programmesPourTerritoire(sansProgrammes, '22001')).toEqual({
      badges: [],
      subventions: null,
    })
  })

  it('retourne le rendu vide pour des tables présentes mais sans aucune ligne', () => {
    const vides: Payload = { ...payloadDemographie, programmes: programmesVideFixture }

    expect(programmesPourTerritoire(vides, '22001')).toEqual({
      badges: [],
      subventions: null,
    })
  })
})

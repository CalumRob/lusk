import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  indicateursProgrammesFixture,
  membresProgrammesFixture,
  runReportFraisFixture as runReportFrais,
  subventionsProgrammesFixture,
  territoiresFixture,
  territoiresLadderFixture,
  vintagesFixture as vintagesFrais,
} from '../payload/fixtures'
import { programmesPourTerritoire } from '../payload/selectors'
import type { Indicateur, MembreProgramme, Payload, SubventionProgramme } from '../payload/types'

/**
 * La DÉRIVATION EN ÉCHELLE (issue #181, ADR-0013 ; re-sourcée par #408) — le
 * sélecteur qui produit le rendu du bloc Programmes et subventions de chaque
 * fiche depuis LES FAITS HERMÉTIQUES DU SIXIÈME THÈME
 * (indicateurs_programmes.json : la couverture catégorielle + les deux clés
 * numériques des subventions) + le référentiel `territoires` (la jointure
 * relationnelle que le contexte switcher fait déjà — les jointures sont
 * l'affaire de l'app, jamais le pipeline). La table partagée programmes.json
 * n'est PLUS l'entrée du bloc fiche : elle reste celle de la carte jusqu'à la
 * bascule (#410).
 *
 * Les TROIS VOIX :
 *   - couverture vers le bas : une commune montre le badge CRTE/Territoires
 *     d'industrie quand SON EPCI a signé/adhéré ;
 *   - portage nommé vers le haut : la fiche EPCI porte et nomme chaque commune
 *     labellisée ACV/PVD (liste complète, jamais tronquée) ;
 *   - l'agrégat au département/région : des comptes avec les EPCIs/communes
 *     nommés en entier — un EPCI transversal (EPCI Z, 22+29) compte dans les
 *     DEUX départements (dérivé de l'appartenance des communes, jamais du
 *     champ `departement` de la ligne EPCI).
 *
 * Les subventions (contrat révisé #305 ; total poolé CALCULÉ côté pipeline
 * depuis #408) : la ventilation COMPLÈTE par domaine sur les fiches
 * communales, l'app trie par montant décroissant (libellé en départage) et le
 * composant plie le top-5 + la révélation. Le total annuel unique ailleurs,
 * avec la part de contexte (commune → son EPCI, EPCI/département → la région)
 * et la provenance (la somme des communes, niveau agrégé seulement). Chaque
 * badge et chaque figure portent leur estampille vintage.
 */

/**
 * Le miroir TS du builder R (construire_indicateurs_programmes) : les tables
 * normalisées du fixture en entrée, les FAITS du thème en sortie — la même
 * correspondance 1:1 que la publication (adhésions → couverture_programmes ;
 * agrégats SCDL → subventions_annuelles poolées + subventions_par_domaine).
 */
function lignesCouverture(membres: MembreProgramme[]): Indicateur[] {
  return membres.map((m) => ({
    territoire: m.territoire,
    type: m.type,
    theme: 'programmes',
    key: 'couverture_programmes',
    detail: m.sigle,
    value: 1,
    unit: 'adhésion',
    rider: m.convention_valant_ort ? 'convention valant ORT' : null,
    rang_epci: null,
    rang_epci_n: null,
    rang_dep: null,
    rang_dep_n: null,
    rang_reg: null,
    rang_reg_n: null,
    vintage_source: m.vintage_source,
    vintage_version: m.vintage_version,
    vintage_date_reference: m.vintage_date_reference,
    vintage_date_publication: m.vintage_date_publication,
  }))
}

function lignesSubventions(subventions: SubventionProgramme[]): Indicateur[] {
  const territoires = [...new Set(subventions.map((s) => s.territoire))]
  const lignes: Indicateur[] = []
  for (const territoire of territoires) {
    const lignesTerritoire = subventions.filter((s) => s.territoire === territoire)
    const annee = Math.max(...lignesTerritoire.map((s) => s.annee))
    const anneeRef = lignesTerritoire.filter((s) => s.annee === annee)
    const type = lignesTerritoire[0]!.type
    // le total poolé (dimension = l'année)
    lignes.push({
      territoire,
      type,
      theme: 'programmes',
      key: 'subventions_annuelles',
      detail: null,
      dimension: String(annee),
      value: anneeRef.reduce((somme, s) => somme + s.montant, 0),
      unit: '€',
      rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null,
      rang_reg: null, rang_reg_n: null,
      vintage_source: anneeRef[0]!.vintage_source,
      vintage_version: anneeRef[0]!.vintage_version,
      vintage_date_reference: anneeRef[0]!.vintage_date_reference,
      vintage_date_publication: anneeRef[0]!.vintage_date_publication,
    })
    // la ventilation communale complète
    if (type === 'commune') {
      for (const s of anneeRef) {
        lignes.push({
          territoire,
          type,
          theme: 'programmes',
          key: 'subventions_par_domaine',
          detail: s.programme_libl,
          dimension: String(annee),
          value: s.montant,
          unit: '€',
          rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null,
          rang_reg: null, rang_reg_n: null,
          vintage_source: s.vintage_source,
          vintage_version: s.vintage_version,
          vintage_date_reference: s.vintage_date_reference,
          vintage_date_publication: s.vintage_date_publication,
        })
      }
    }
  }
  return lignes
}

function payloadAvecFaits(
  faits: Indicateur[],
  territoires = territoiresFixture,
): Payload {
  return {
    territoires,
    indicateurs: [...indicateursDemographieFixture, ...faits],
    histoires: histoiresDemographieFixture,
    apercu: apercuAvecNAFixture,
    runReport: runReportFrais,
    vintages: vintagesFrais,
    programmes: null,
  }
}

/** Le payload du fixture partagé : les faits du thème issus de SES tables. */
const payloadDemographie: Payload = payloadAvecFaits([
  ...lignesCouverture(membresProgrammesFixture),
  ...lignesSubventions(subventionsProgrammesFixture),
])

/**
 * Le payload de l'échelle — le fixture partagé + l'EPCI Z transversal (ses
 * trois lignes d'adhésion supplémentaires et ses subventions étendues).
 */
const membresEchelle: MembreProgramme[] = [
  ...membresProgrammesFixture,
  {
    territoire: '200000003', type: 'epci', sigle: 'CRTE', convention_valant_ort: false,
    vintage_source: 'ANCT — Contrat de relance et de transition écologique : suivi du périmètre (COG 2025)',
    vintage_version: '2025', vintage_date_reference: '2025-07-17', vintage_date_publication: '2025-09-24',
  },
  {
    territoire: '22003', type: 'commune', sigle: 'ORT', convention_valant_ort: false,
    vintage_source: 'DGALN/ANCT — ORT', vintage_version: 'en continu',
    vintage_date_reference: '2026-07-20', vintage_date_publication: null,
  },
  {
    territoire: '29003', type: 'commune', sigle: 'ORT', convention_valant_ort: false,
    vintage_source: 'DGALN/ANCT — ORT', vintage_version: 'en continu',
    vintage_date_reference: '2026-07-21', vintage_date_publication: null,
  },
  {
    territoire: '200000003', type: 'epci', sigle: 'ORT', convention_valant_ort: false,
    vintage_source: 'DGALN/ANCT — ORT', vintage_version: 'en continu',
    vintage_date_reference: '2026-07-21', vintage_date_publication: null,
  },
]

const subventionsEchelle: SubventionProgramme[] = [
  ...subventionsProgrammesFixture,
  ...(
    [
      ['29003', 'Culture', 30000],
      ['29003', 'Environnement', 10000],
      ['29003', 'Développement économique', 50000],
      ['29003', 'Tourisme', 6000],
      ['29003', 'Agriculture', 40000],
      ['29003', 'Sport', 20000],
      ['29003', 'Enseignement', 6000],
      ['22003', 'Insertion', 10000],
      ['29001', 'Environnement', 25000],
    ] as const
  ).map(([territoire, domaine, montant]) => ({
    territoire,
    type: 'commune' as const,
    annee: 2025,
    programme_libl: domaine,
    montant,
    vintage_source: 'Région Bretagne — subventions attribuées (SCDL)',
    vintage_version: '2026-08-05',
    vintage_date_reference: '2026-08-05',
    vintage_date_publication: '2026-08-05',
  })),
  {
    territoire: '200000003', type: 'epci' as const, annee: 2025, programme_libl: null,
    montant: 172000, vintage_source: 'Région Bretagne — subventions attribuées (SCDL)',
    vintage_version: '2026-08-05', vintage_date_reference: '2026-08-05',
    vintage_date_publication: '2026-08-05',
  },
]

const payloadEchelle: Payload = payloadAvecFaits(
  [...lignesCouverture(membresEchelle), ...lignesSubventions(subventionsEchelle)],
  territoiresLadderFixture,
)

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

  it('couvre la commune des contrats signés par SON EPCI (la voix descendante), l\u2019EPCI nommé', () => {
    // 22002 (Commune D) : PVD lauréate + CRTE de son EPCI X
    const rendu = programmesPourTerritoire(payloadDemographie, '22002')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(['PVD', 'CRTE'])
    const crte = rendu.badges[1]
    expect(crte.voix).toBe('couverte')
    expect(crte.noms).toEqual(['EPCI X'])
    expect(crte.vintage).toContain('Contrat de relance')
  })

  it('ne badge JAMAIS l\u2019ORT sur une commune labellisée (le rider est le fait accessible)', () => {
    // 22001 porte le rider ACV — aucune ligne ORT ne doit apparaître
    const rendu = programmesPourTerritoire(payloadDemographie, '22001')

    expect(rendu.badges.map((b) => b.sigle)).not.toContain('ORT')
  })

  it('badge l\u2019ORT d\u2019une commune NON labellisée dans un périmètre signé, et la couvre des contrats de son EPCI', () => {
    // 29001 (Commune B) : non labellisée, convention ORT signée + TI de son EPCI Y
    const rendu = programmesPourTerritoire(payloadDemographie, '29001')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(["Territoires d'industrie", 'ORT'])
    expect(rendu.badges[0]).toMatchObject({ voix: 'couverte', noms: ['EPCI Y'] })
    expect(rendu.badges[1]).toMatchObject({ sigle: 'ORT', voix: 'ort', noms: [] })
  })

  it('ne montre PAS l\u2019ORT à une commune de l\u2019EPCI hors périmètre (le badge ORT est une ligne commune propre)', () => {
    // 29002 (Commune C) : membre d\u2019EPCI Y (TI + ORT au niveau EPCI) mais sans
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

  it('montre le badge ORT AUTONOME quand l\u2019ORT de l\u2019EPCI n\u2019est pas porté par un label, avec ses communes nommées', () => {
    // EPCI Y : TI + ORT autonome (sa commune 29001 n\u2019est pas labellisée)
    const rendu = programmesPourTerritoire(payloadDemographie, '200000002')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(["Territoires d'industrie", 'ORT'])
    expect(rendu.badges[1]).toMatchObject({ sigle: 'ORT', voix: 'ort', noms: ['Commune B'] })
  })

  it('n\u2019invente pas de portage sans commune labellisée membre', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '200000002')

    expect(rendu.badges.map((b) => b.sigle)).not.toContain('ACV')
    expect(rendu.badges.map((b) => b.sigle)).not.toContain('PVD')
  })
})

describe('programmesPourTerritoire — l\u2019agrégat au DÉPARTEMENT / RÉGION (la voix qui compte)', () => {
  it('compte les contrats avec les EPCIs nommés et les labels avec les communes nommées — jamais un badge plat', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '22')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(['CRTE', 'ACV', 'PVD'])
    expect(rendu.badges[0]).toMatchObject({ sigle: 'CRTE', voix: 'compte', noms: ['EPCI X'] })
    expect(rendu.badges[1]).toMatchObject({ sigle: 'ACV', voix: 'compte', noms: ['Commune A1'] })
    expect(rendu.badges[2]).toMatchObject({ sigle: 'PVD', voix: 'compte', noms: ['Commune D'] })
  })

  it('compte l\u2019ORT par les communes en périmètre du département', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '29')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(["Territoires d'industrie", 'ORT'])
    expect(rendu.badges[1]).toMatchObject({ sigle: 'ORT', voix: 'compte', noms: ['Commune B'] })
  })

  it('résume la région — les contrats, les labels et l\u2019ORT avec toutes les listes nommées', () => {
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

  it('UN EPCI TRANSVERSAL compte dans les DEUX départements (dérivé de l\u2019appartenance, jamais du champ département)', () => {
    const dep22 = programmesPourTerritoire(payloadEchelle, '22')
    const dep29 = programmesPourTerritoire(payloadEchelle, '29')

    // EPCI Z (200000003) : communes dans 22 (22003) ET 29 (29003) — son CRTE
    // compte dans les deux agrégats
    const crte22 = dep22.badges.find((b) => b.sigle === 'CRTE')
    const crte29 = dep29.badges.find((b) => b.sigle === 'CRTE')
    expect(crte22?.noms).toEqual(['EPCI X', 'EPCI Z'])
    expect(crte29?.noms).toEqual(['EPCI Z'])

    // l\u2019ORT aussi : 22003 (dans 22) et 29003 (dans 29)
    expect(dep22.badges.find((b) => b.sigle === 'ORT')?.noms).toEqual(['Commune E'])
    expect(dep29.badges.find((b) => b.sigle === 'ORT')?.noms).toEqual(['Commune B', 'Commune F'])
  })

  it('la fiche de l\u2019EPCI transversal porte ses propres badges (CRTE + ORT)', () => {
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
  it('ventile le total annuel par domaine sur une fiche communale (le total poolé du thème = la somme des axes, triés par montant décroissant)', () => {
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

  it('n\u2019invente pas de figure sans fait de subvention — l\u2019état vide honnête', () => {
    // EPCI Y (200000002) et le département 29 n\u2019ont aucune ligne de subvention
    expect(programmesPourTerritoire(payloadDemographie, '200000002').subventions).toBeNull()
    expect(programmesPourTerritoire(payloadDemographie, '29').subventions).toBeNull()
    // une commune avec des badges mais sans subventions : la figure est absente
    expect(programmesPourTerritoire(payloadDemographie, '29002').subventions).toBeNull()
  })

  it('calcule la part de contexte d\u2019une commune — son total dans celui de SON EPCI (même année de référence)', () => {
    const rendu = programmesPourTerritoire(payloadEchelle, '29003')

    expect(rendu.subventions?.partContexte).toMatchObject({ parent: 'epci' })
    expect(rendu.subventions?.partContexte?.part).toBeCloseTo(162000 / 172000, 4)
  })

  it('calcule la part de contexte d\u2019un EPCI (transversal compris) et d\u2019un département dans le total de la RÉGION', () => {
    const epci = programmesPourTerritoire(payloadEchelle, '200000003') // EPCI Z, 22+29
    expect(epci.subventions?.partContexte).toMatchObject({ parent: 'region' })
    expect(epci.subventions?.partContexte?.part).toBeCloseTo(172000 / 2000000, 4)

    const departement = programmesPourTerritoire(payloadDemographie, '22')
    expect(departement.subventions?.partContexte).toMatchObject({ parent: 'region' })
    expect(departement.subventions?.partContexte?.part).toBeCloseTo(300000 / 2000000, 4)
  })

  it('ne lit AUCUNE part de contexte sur la région — elle n\u2019a pas de parent', () => {
    const region = programmesPourTerritoire(payloadDemographie, '53')

    expect(region.subventions?.partContexte).toBeNull()
  })

  it('garde la part silencieuse — une commune dont le parent n\u2019a pas de total (ou sans aucun fait)', () => {
    // 29001 a une ligne de subvention mais SON EPCI (Y) n\u2019a pas de total poolé
    const commune = programmesPourTerritoire(payloadEchelle, '29001')
    expect(commune.subventions).not.toBeNull()
    expect(commune.subventions?.partContexte).toBeNull()
    // 29002 n\u2019a aucun fait — pas de figure, pas de part
    expect(programmesPourTerritoire(payloadDemographie, '29002').subventions).toBeNull()
  })

  it('lit la provenance d\u2019une fiche agrégée — la somme des communes, avec la cible du lien', () => {
    const epci = programmesPourTerritoire(payloadDemographie, '200000001')
    const departement = programmesPourTerritoire(payloadDemographie, '22')
    const region = programmesPourTerritoire(payloadDemographie, '53')

    expect(epci.subventions?.provenance).toEqual({ niveau: 'epci', code: '200000001' })
    expect(departement.subventions?.provenance).toEqual({ niveau: 'departement', code: '22' })
    expect(region.subventions?.provenance).toEqual({ niveau: 'region' })
  })

  it('ne lit AUCUNE provenance sur une fiche communale — la somme n\u2019a pas de sens à l\u2019échelle de la commune', () => {
    const rendu = programmesPourTerritoire(payloadEchelle, '29003')

    expect(rendu.subventions?.provenance).toBeNull()
  })

  it('totale UNIQUEMENT l\u2019année de référence — des faits à plusieurs années ne mélangent jamais les millésimes (#305)', () => {
    // 22001 porte son fait poolé 2025 + un fait 2024 (une année antérieure que
    // le payload réel ne publie pas encore) — le total et la ventilation
    // lisent la SEULE année de référence
    const faits2024: Indicateur[] = [
      {
        territoire: '22001', type: 'commune', theme: 'programmes',
        key: 'subventions_annuelles', detail: null, dimension: '2024',
        value: 9000, unit: '€', rang_epci: null, rang_epci_n: null,
        rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
        vintage_source: 'Région Bretagne — subventions attribuées (SCDL)',
        vintage_version: '2025-01-06', vintage_date_reference: '2024-12-31',
        vintage_date_publication: '2025-01-06',
      },
      {
        territoire: '22001', type: 'commune', theme: 'programmes',
        key: 'subventions_par_domaine', detail: 'Enseignement', dimension: '2024',
        value: 9000, unit: '€', rang_epci: null, rang_epci_n: null,
        rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
        vintage_source: 'Région Bretagne — subventions attribuées (SCDL)',
        vintage_version: '2025-01-06', vintage_date_reference: '2024-12-31',
        vintage_date_publication: '2025-01-06',
      },
    ]
    const multiAnnees = payloadAvecFaits([...indicateursProgrammesFixture, ...faits2024])

    const rendu = programmesPourTerritoire(multiAnnees, '22001')

    expect(rendu.subventions?.annee).toBe(2025)
    expect(rendu.subventions?.total).toBe(45000)
    expect(rendu.subventions?.axes).toEqual([
      { libelle: 'Développement économique', montant: 30000 },
      { libelle: 'Agriculture', montant: 15000 },
    ])
    // la part de contexte du même millésime : 45 000 / 45 000 (l'EPCI X 2025)
    expect(rendu.subventions?.partContexte?.part).toBeCloseTo(1, 4)
  })

  it('lit la part de contexte sur la ligne POOLÉE du bon niveau — jamais une ligne d\u2019un autre type sous le même identifiant', () => {
    // Le contrat : le dénominateur est la ligne poolée au TYPE du parent.
    // Une ligne de type commune sous l'id du parent ne doit JAMAIS servir.
    const derive: Indicateur = {
      territoire: '200000001', // le SIREN de l'EPCI X
      type: 'commune', // DÉRIVE : une ligne communale sous l'id du parent
      theme: 'programmes',
      key: 'subventions_annuelles',
      detail: null,
      dimension: '2025',
      value: 999999,
      unit: '€',
      rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null,
      rang_reg: null, rang_reg_n: null,
      vintage_source: 'Région Bretagne — subventions attribuées (SCDL)',
      vintage_version: '2026-08-05',
      vintage_date_reference: '2026-08-05',
      vintage_date_publication: '2026-08-05',
    }
    const derivePayload = payloadAvecFaits([...indicateursProgrammesFixture, derive])

    const rendu = programmesPourTerritoire(derivePayload, '22001')

    // la part reste la commune dans SON EPCI poolé (45 000 €), jamais le
    // montant fantôme de la ligne communale dérivée (999 999 €)
    expect(rendu.subventions?.partContexte?.part).toBeCloseTo(1, 4)
    expect(rendu.subventions?.partContexte?.part).not.toBeCloseTo(45000 / 999999, 4)
  })
})

describe('programmesPourTerritoire — les estampilles vintage et l\u2019état vide', () => {
  it('estampe chaque badge du vintage de SA source (l\u2019actualisation PAR LIGNE pour l\u2019ORT, sans publication)', () => {
    const rendu = programmesPourTerritoire(payloadDemographie, '29001')

    const ti = rendu.badges.find((b) => b.sigle === "Territoires d'industrie")
    expect(ti?.vintage).toContain('Banque des Territoires')
    const ort = rendu.badges.find((b) => b.sigle === 'ORT')
    expect(ort?.vintage).toContain('DGALN/ANCT')
    expect(ort?.vintage).toContain('réf. 15 juil. 2026')
    // la publication source de l\u2019ORT est null par contrat — jamais un « publ. »
    expect(ort?.vintage).not.toContain('publ.')
  })

  it('retourne le rendu vide quand le thème ne porte AUCUN fait (les faits absents = l\u2019élément absent)', () => {
    // le payload sans les faits du sixième thème — la paire hermétique
    // absente (404) se lit exactement comme un thème non publié
    const sansFaits = payloadAvecFaits([])

    expect(programmesPourTerritoire(sansFaits, '22001')).toEqual({
      badges: [],
      subventions: null,
    })
  })
})

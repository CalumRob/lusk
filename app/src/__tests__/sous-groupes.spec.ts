import { describe, expect, it } from 'vitest'

import {
  figureLecturePour,
  lignesLQPour,
  sourceLecture,
  sousGroupesPourTerritoire,
} from '../fiche/sousGroupes'
import type { LectureSousGroupe, SousGroupeRendu } from '../fiche/sousGroupes'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresHabitatFixture,
  histoiresMilieuxFixture,
  histoiresMobiliteFixture,
  indicateursDemographieFixture,
  indicateursEconomieFixture,
  indicateursHabitatFixture,
  indicateursMilieuxFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Histoire, Payload } from '../payload/types'

/**
 * sousGroupesPourTerritoire (issue #314, parent #308) — le mapper partagé de
 * la fiche : les sous-groupes viennent du thèmeMetadata (l'ordre, les labels,
 * les cadrages, les clés d'indicateurs, la famille de figure et le lien
 * d'histoire), JAMAIS de branches codées en dur ni de dictionnaires app-side.
 * La lecture résolue rejoint son sous-groupe par (territoire, groupe) — le
 * lien explicite du contrat (#312) — et se compose depuis le template de
 * lecture de la métadonnée ; une lecture absente ou inconstructible échoue
 * honnêtement (jamais inventée).
 */

function payloadDe(
  indicateurs: Payload['indicateurs'],
  histoires: Histoire[],
  themeMetadata?: Payload['themeMetadata'],
): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs,
    histoires,
    apercu: apercuAvecNAFixture,
    runReport: runReportFraisFixture,
    vintages: vintagesFixture,
    programmes: null,
    themeMetadata,
  }
}

function sousGroupesDe(
  theme: 'demographie' | 'habitat' | 'economie' | 'milieux' | 'mobilite',
  territoire: string,
  histoires: Histoire[],
  indicateurs: Payload['indicateurs'],
): SousGroupeRendu[] {
  return sousGroupesPourTerritoire(
    payloadDe(indicateurs, histoires, { [theme]: metadonneesThemesFixtures[theme] }),
    theme,
    territoire,
  )
}

function lectureDe(groupe: SousGroupeRendu): LectureSousGroupe | null {
  return groupe.lecture
}

describe('sousGroupesPourTerritoire — l’ordre, les labels et les clés viennent de la métadonnée', () => {
  it('rend l’ordre des sous-groupes de la métadonnée (Économie : santé-taille puis structure-verte)', () => {
    const sousGroupes = sousGroupesDe(
      'economie',
      '22001',
      histoiresEconomieFixture,
      indicateursEconomieFixture,
    )

    expect(sousGroupes.map((g) => g.key)).toEqual(['sante-et-taille', 'structure-verte'])
  })

  it('rend les labels et cadrages de la métadonnée (Démographie)', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoiresDemographieFixture,
      indicateursDemographieFixture,
    )

    expect(sousGroupes[0].label).toBe('État et dynamique de la population')
    expect(sousGroupes[0].framing).toContain('la structure de ses ménages')
  })

  it('range les figures par la liste d’indicateurs du sous-groupe — jamais un ordre app-side (Mobilité)', () => {
    const sousGroupes = sousGroupesDe(
      'mobilite',
      '22001',
      histoiresMobiliteFixture,
      indicateursMobiliteFixture,
    )

    expect(sousGroupes[0].figures.map((f) => f.key)).toEqual([
      'voitures_menage',
      'reseaux',
      'offre_tc',
      'bornes_recharge',
      'places_stationnement_velo_1000',
      'offre_cyclable',
      'iso_alimentation',
      'iso_sante',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
    ])
  })

  it('ne rend aucune figure pour une métadonnée absente — jamais un bloc inventé', () => {
    const sousGroupes = sousGroupesPourTerritoire(
      payloadDe(indicateursDemographieFixture, histoiresDemographieFixture),
      'demographie',
      '22001',
    )

    expect(sousGroupes).toEqual([])
  })
})

describe('sousGroupesPourTerritoire — la figure compacte (famille + indicateur de la métadonnée)', () => {
  it('porte la famille et l’indicateur déclarés, avec les lignes du payload (Démographie → composition/structure_age)', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoiresDemographieFixture,
      indicateursDemographieFixture,
    )

    expect(sousGroupes[0].figureCompacte).toEqual({
      famille: 'composition',
      clef: 'structure_age',
      lignes: expect.arrayContaining([expect.objectContaining({ key: 'structure_age' })]),
    })
    expect(sousGroupes[0].figureCompacte?.lignes.length).toBeGreaterThan(0)
  })

  it('rend la figure compacte du Mobilité sur les lignes offre_cyclable (famille scalar)', () => {
    const sousGroupes = sousGroupesDe(
      'mobilite',
      '22001',
      histoiresMobiliteFixture,
      indicateursMobiliteFixture,
    )

    expect(sousGroupes[0].figureCompacte).toMatchObject({
      famille: 'scalar',
      clef: 'offre_cyclable',
    })
    expect(sousGroupes[0].figureCompacte?.lignes).toHaveLength(5)
  })

  it('est null quand l’indicateur de la figure n’a aucune ligne', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoiresDemographieFixture,
      indicateursDemographieFixture.filter((l) => l.key !== 'structure_age'),
    )

    expect(sousGroupes[0].figureCompacte).toBeNull()
  })
})

describe('sousGroupesPourTerritoire — la lecture rejointe par (territoire, groupe)', () => {
  it('joint la lecture résolue sur le groupe du sous-groupe (Économie 22001 → sante-et-taille, jamais structure-verte)', () => {
    const sousGroupes = sousGroupesDe(
      'economie',
      '22001',
      histoiresEconomieFixture,
      indicateursEconomieFixture,
    )

    expect(lectureDe(sousGroupes[0])?.story_key).toBe('ce-que-la-commune-abrite')
    // la commune n’a pas de lecture de présence — le slot structure-verte reste honnête
    expect(lectureDe(sousGroupes[1])).toBeNull()
    expect(sousGroupes[1].lectureIndisponible).toBe(false)
  })

  it('résout les paramètres du template depuis la ligne (Démographie 22001)', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoiresDemographieFixture,
      indicateursDemographieFixture,
    )

    expect(lectureDe(sousGroupes[0])?.parametres).toEqual({
      periode: '2017-2023',
      taux_solde_naturel: '5,98',
      taux_solde_migratoire: '2,56',
      classification: 'attire et se renouvelle',
    })
  })

  it('résout la classification à travers classification_labels — jamais la clé brute (Milieux 22002)', () => {
    // les autres chaînes (periode_pop, periode_artif) passent telles quelles ;
    // seule la classification se résout à travers la carte payload-owned (#362)
    const sousGroupes = sousGroupesDe(
      'milieux',
      '22002',
      histoiresMilieuxFixture,
      indicateursMilieuxFixture,
    )

    expect(lectureDe(sousGroupes[0])?.parametres).toEqual({
      periode_pop: '2017-2023',
      periode_artif: '2021-2025',
      trajectoire_artif_par_habitant: '0,95',
      classification: 'grandit en se densifiant',
    })
  })

  it('rend la lecture indisponible pour une classification inconnue — jamais la clé brute dans le texte (#362)', () => {
    const histoires = histoiresDemographieFixture.map((h) =>
      h.territoire === '22001' ? { ...h, classification: 'quadrant-inconnu' } : h,
    ) as Histoire[]
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoires,
      indicateursDemographieFixture,
    )

    expect(lectureDe(sousGroupes[0])).toBeNull()
    expect(sousGroupes[0].lectureIndisponible).toBe(true)
    // le texte ne contient JAMAIS la clé brute — pas de lecture à composer
    const parametres = lectureDe(sousGroupes[0])?.parametres
    expect(parametres).toBeUndefined()
    expect(JSON.stringify(sousGroupes[0])).not.toContain('quadrant-inconnu')
  })

  it('résout les clés repliées du top-5 Économie (le rang est l’index, jamais une colonne)', () => {
    const sousGroupes = sousGroupesDe(
      'economie',
      '22001',
      histoiresEconomieFixture,
      indicateursEconomieFixture,
    )

    expect(lectureDe(sousGroupes[0])?.parametres).toEqual({
      rang: '1',
      activity_label: 'Élevage de volailles',
    })
  })

  it('résout la lecture de présence de la région (structure-verte, n + part du parc)', () => {
    const sousGroupes = sousGroupesDe(
      'economie',
      '53',
      histoiresEconomieFixture,
      indicateursEconomieFixture,
    )

    expect(lectureDe(sousGroupes[0])).toBeNull()
    expect(lectureDe(sousGroupes[1])?.story_key).toBe('ce-que-la-bretagne-abrite')
    expect(lectureDe(sousGroupes[1])?.parametres).toEqual({
      activity_label: "Location de terrains et d'autres biens immobiliers",
      part_parc: '16,5',
    })
  })

  it('rend une lecture null pour un territoire sans ligne (la donnée absente — jamais inventée)', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '29002',
      histoiresDemographieFixture.filter((h) => h.territoire !== '29002'),
      indicateursDemographieFixture,
    )

    expect(lectureDe(sousGroupes[0])).toBeNull()
    expect(sousGroupes[0].lectureIndisponible).toBe(false)
  })

  it('échoue honnêtement quand un paramètre du template est null (Habitat sous le seuil n < 30)', () => {
    const histoires = histoiresHabitatFixture.map((h) =>
      h.territoire === '22001'
        ? { ...h, classification: null, part_passoires: null }
        : h,
    ) as Histoire[]
    const sousGroupes = sousGroupesDe(
      'habitat',
      '22001',
      histoires,
      indicateursHabitatFixture,
    )

    expect(lectureDe(sousGroupes[0])).toBeNull()
    expect(sousGroupes[0].lectureIndisponible).toBe(true)
  })

  it('ne déclare indisponible que les paramètres RÉFÉRENCÉS par le template (le vélo Mobilité lit sa ligne)', () => {
    // la ligne vélo porte pct_iso_full_t null par contrat — déclaré, jamais
    // référencé par le template : la lecture existe
    const sousGroupes = sousGroupesDe(
      'mobilite',
      '22002',
      histoiresMobiliteFixture,
      indicateursMobiliteFixture,
    )

    expect(lectureDe(sousGroupes[0])?.story_key).toBe('ce-que-le-velo-preserve')
    expect(lectureDe(sousGroupes[0])?.parametres).toEqual({ div_loss_t: '24' })
  })
})

describe('figureLecturePour — la figure compacte de la lecture, par story_key de la métadonnée', () => {
  it('rend la figure Démographie (les deux soldes + le nuage au même échelle)', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoiresDemographieFixture,
      indicateursDemographieFixture,
    )
    const lecture = lectureDe(sousGroupes[0])
    const figure = lecture ? figureLecturePour(payloadDe(indicateursDemographieFixture, histoiresDemographieFixture), '22001', lecture) : null

    expect(figure).toMatchObject({
      genre: 'soldes',
      tauxNaturel: 5.982905982905983,
      tauxMigratoire: 2.564102564102564,
      classification: 'classification indisponible',
      nom: 'Commune A1',
    })
    expect(figure?.nuage).toHaveLength(2)
  })

  it('rend la distribution Mobilité pour la lecture par défaut (la signature + la médiane)', () => {
    const payload = payloadDe(
      indicateursMobiliteFixture,
      histoiresMobiliteFixture,
      { mobilite: metadonneesThemesFixtures.mobilite },
    )
    const sousGroupes = sousGroupesPourTerritoire(payload, 'mobilite', '22001')
    const lecture = lectureDe(sousGroupes[0])
    const figure = lecture ? figureLecturePour(payload, '22001', lecture) : null

    expect(figure).toMatchObject({ genre: 'distribution', mediane: 38 })
    if (figure?.genre !== 'distribution') throw new Error('figure attendue')
    expect(figure.distribution).toMatchObject({ min: 28, max: 47 })
    expect(figure.distribution.dec).toHaveLength(10)
    expect(figure.nuage).toHaveLength(2)
  })

  it('rend la même distribution pour la lecture vélo, avec les deux marques de mode', () => {
    const histoires = histoiresMobiliteFixture
    const payload = payloadDe(
      indicateursMobiliteFixture,
      histoires,
      { mobilite: metadonneesThemesFixtures.mobilite },
    )
    const sousGroupes = sousGroupesPourTerritoire(payload, 'mobilite', '22002')
    const lecture = lectureDe(sousGroupes[0])

    expect(lecture?.story_key).toBe('ce-que-le-velo-preserve')
    const figure = lecture ? figureLecturePour(payload, '22002', lecture) : null
    expect(figure).toMatchObject({
      genre: 'distribution',
      mediane: 24,
      medianeVelo: 13,
      modes: { t: 'à pied ou en transports en commun', b: 'à vélo' },
    })
    if (figure?.genre !== 'distribution') throw new Error('figure attendue')
    expect(figure.distribution.dec.filter((point) => point !== null)).toHaveLength(10)
    expect(figure.distribution.dens.filter((point) => point !== null)).toHaveLength(10)
  })

  it('rend le quadrant Milieux (les deux forces + la fenêtre des états) quand les états existent', () => {
    const payload = payloadDe(
      indicateursMilieuxFixture,
      histoiresMilieuxFixture,
      { milieux: metadonneesThemesFixtures.milieux },
    )
    const sousGroupes = sousGroupesPourTerritoire(payload, 'milieux', '22001')
    const lecture = lectureDe(sousGroupes[0])
    const figure = lecture ? figureLecturePour(payload, '22001', lecture) : null

    expect(figure).toMatchObject({
      genre: 'quadrant',
      tauxVariationPopulation: 14.4927536231884,
      deltaM2ParHabitant: 300,
      classification: "grandit en s'étalant",
      periodePop: '2017-2023',
      periodeArtif: '2021-2025',
      nom: 'Commune A1',
    })
    expect(figure?.nuage).toHaveLength(2)
  })

  it('rend null pour une lecture inconnue — jamais une figure inventée', () => {
    const lecture: LectureSousGroupe = {
      story_key: 'histoire-inconnue',
      histoire: histoiresDemographieFixture[0],
      template: [],
      parametres: {},
    }
    expect(
      figureLecturePour(
        payloadDe(indicateursDemographieFixture, histoiresDemographieFixture),
        '22001',
        lecture,
      ),
    ).toBeNull()
  })
})

describe('lignesLQPour — la liste appartient à la spécialisation communale', () => {
  it('ne fabrique pas de LQ pour la lecture régionale de présence', () => {
    const sousGroupes = sousGroupesDe(
      'economie',
      '53',
      histoiresEconomieFixture,
      indicateursEconomieFixture,
    )
    expect(lignesLQPour(lectureDe(sousGroupes[1])!)).toEqual([])
  })
})

describe('sourceLecture — la ligne de source de la lecture', () => {
  it('cite la table vintages pour la trajectoire démographique (la série + la base des EPCI)', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoiresDemographieFixture,
      indicateursDemographieFixture,
    )
    const lecture = lectureDe(sousGroupes[0])

    const source = lecture ? sourceLecture(payloadDe(indicateursDemographieFixture, histoiresDemographieFixture), lecture) : null
    expect(source).toContain('Série historique')
    expect(source).toContain('Base des EPCI')
  })

  it('porte l’estampille de la ligne pour une lecture à vintage (Mobilité)', () => {
    const payload = payloadDe(
      indicateursMobiliteFixture,
      histoiresMobiliteFixture,
      { mobilite: metadonneesThemesFixtures.mobilite },
    )
    const sousGroupes = sousGroupesPourTerritoire(payload, 'mobilite', '22001')
    const lecture = lectureDe(sousGroupes[0])

    const source = lecture ? sourceLecture(payload, lecture) : null
    expect(source).toContain('Lusk')
    expect(source).toContain('réf.')
  })

  it('rend null sans vintages pour une lecture sans estampille propre', () => {
    const payload = payloadDe(
      indicateursDemographieFixture,
      histoiresDemographieFixture,
      { demographie: metadonneesThemesFixtures.demographie },
    )
    const sousGroupes = sousGroupesPourTerritoire(payload, 'demographie', '22001')
    const lecture = lectureDe(sousGroupes[0])

    expect(sourceLecture({ ...payload, vintages: null }, lecture!)).toBeNull()
  })
})

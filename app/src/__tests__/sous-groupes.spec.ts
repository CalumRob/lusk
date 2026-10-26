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
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Histoire, Payload } from '../payload/types'

/**
 * sousGroupesPourTerritoire (issue #314, parent #308) — le mapper partagé de
 * la fiche : l'ordre, les labels, les cadrages et les présentations viennent
 * de la grammaire app-owned ; les faits et lectures sont uniquement liés depuis
 * les lignes disponibles du payload.
 * La lecture résolue rejoint son sous-groupe par (territoire, groupe) — le
 * lien explicite du contrat (#312) — et se compose depuis le template de
 * lecture app-owned ; une lecture absente ou inconstructible échoue
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

describe('sousGroupesPourTerritoire — l’ordre, les labels et les clés viennent de la grammaire fiche', () => {
  it('rend l’ordre des sous-groupes app-owned (Économie : santé-taille puis structure-verte)', () => {
    const sousGroupes = sousGroupesDe(
      'economie',
      '22001',
      histoiresEconomieFixture,
      indicateursEconomieFixture,
    )

    expect(sousGroupes.map((g) => g.key)).toEqual(['sante-et-taille', 'structure-verte'])
  })

  it('rend les labels et cadrages app-owned (Démographie)', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoiresDemographieFixture,
      indicateursDemographieFixture,
    )

    expect(sousGroupes[0].label).toBe('État de la population')
    expect(sousGroupes[0].framing).toContain('la structure de ses ménages')
    expect(sousGroupes[1].label).toBe('Trajectoire démographique')
  })

  it('range les figures par la liste de présentation du sous-groupe (Mobilité)', () => {
    const sousGroupes = sousGroupesDe(
      'mobilite',
      '22001',
      histoiresMobiliteFixture,
      indicateursMobiliteFixture,
    )

    expect(sousGroupes[0].figures.map((f) => f.key)).toEqual([
      'iso_alimentation',
      'iso_sante',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
      'share_food_t',
      'share_food_b',
      'share_food_c',
      'share_health_t',
      'share_health_b',
      'share_health_c',
      'share_admin_t',
      'share_admin_b',
      'share_admin_c',
      'share_school_t',
      'share_school_b',
      'share_school_c',
      'share_bank_t',
      'share_bank_b',
      'share_bank_c',
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

describe('sousGroupesPourTerritoire — la grammaire éditoriale appartient à la fiche', () => {
  it('keeps all six themes on the app grammar when producer subgroup presentation is stale', () => {
    const cases = [
      {
        theme: 'demographie',
        indicateurs: indicateursDemographieFixture,
        histoires: histoiresDemographieFixture,
        expected: [
          ['etat-de-la-population', 'État de la population', 'La population de la commune : sa taille, sa densité et la structure de ses ménages.'],
          ['trajectoire-demographique', 'Trajectoire démographique', 'L’évolution de la population depuis 1968 et les deux forces qui la portent : le solde naturel et le solde migratoire.'],
        ],
      },
      {
        theme: 'habitat',
        indicateurs: indicateursHabitatFixture,
        histoires: histoiresHabitatFixture,
        expected: [
          ['composition-du-parc', 'La composition du parc', 'La composition du parc de logements de la commune : le mix, le statut d’occupation et le type.'],
          ['etat-energetique-du-parc', 'L’état énergétique du parc', 'L’état énergétique du parc : la distribution des étiquettes DPE, la part de passoires thermiques et l’âge du bâti.'],
          ['marche', 'Le marché', 'Le marché immobilier de la commune : la médiane du prix au m² des ventes.'],
        ],
      },
      {
        theme: 'economie',
        indicateurs: indicateursEconomieFixture,
        histoires: histoiresEconomieFixture,
        expected: [
          ['sante-et-taille', 'Santé et taille du tissu productif', 'La santé du tissu productif local : l’emploi salarié au lieu de travail et le chômage au sens du recensement.'],
          ['structure-verte', 'La structure verte', 'La place des établissements verts dans le tissu productif.'],
        ],
      },
      {
        theme: 'milieux',
        indicateurs: indicateursMilieuxFixture,
        histoires: histoiresMilieuxFixture,
        expected: [
          ['artificialisation', 'L’artificialisation', 'La consommation de la terre par l’urbanisation : l’état artificialisé et le flux annuel.'],
        ],
      },
      {
        theme: 'mobilite',
        indicateurs: indicateursMobiliteFixture,
        histoires: histoiresMobiliteFixture,
        expected: [
          ['acces-aux-services', 'L’accès aux services', 'Ce que les bâtiments de la commune peuvent atteindre à pied ou en transports en commun : les parts de bâtiments sans accès aux services essentiels.'],
          ['partage-de-lespace-public', 'Le partage de l’espace public', 'La place laissée aux vélos et à la voiture dans l’espace public : les réseaux, le stationnement vélo et l’offre cyclable.'],
          ['motorisation', 'La motorisation', 'L’équipement automobile des ménages et les bornes de recharge pour véhicules électriques.'],
          ['offre-transports-commun', 'L’offre de transports en commun', 'La part des bâtiments à moins de 500 mètres d’un arrêt, et le raccordement du territoire au réseau : la population bretonne joignable en 90 minutes en train, en car ou en bus, de mairie à mairie.'],
        ],
      },
      {
        theme: 'programmes',
        indicateurs: indicateursProgrammesFixture,
        histoires: [] as Histoire[],
        expected: [
          ['couverture', 'Programmes et contrats', 'Les programmes de l’État et les outils juridiques qui couvrent le territoire : labels communaux, contrats intercommunaux et convention ORT — des faits d’action publique, jamais des résultats.'],
          ['subventions', 'Subventions attribuées', 'Les subventions attribuées par la Région Bretagne au territoire : le total annuel partout, la ventilation par domaine sur les fiches communales.'],
        ],
      },
    ] as const

    for (const { theme, indicateurs, histoires, expected } of cases) {
      const metadata = structuredClone(metadonneesThemesFixtures[theme])
      metadata.subgroups = [{
        ...metadata.subgroups[0]!,
        key: 'upstream-stale',
        label: 'Libellé amont périmé',
        framing: 'Cadrage amont périmé.',
        indicators: ['resource-amont-perime'],
        figure: { family: 'scalar', indicator: 'resource-amont-perime' },
        reading: undefined,
      }]
      const rendered = sousGroupesPourTerritoire(
        payloadDe(indicateurs, histoires, { [theme]: metadata }),
        theme,
        '22001',
      )

      expect(rendered.map(({ key, label, framing }) => [key, label, framing]), theme).toEqual(expected)
    }
  })

  it('binds each grammar subgroup to the producer rows and resolved reading for its structural key', () => {
    const cases = [
      {
        theme: 'demographie', indicateurs: indicateursDemographieFixture, histoires: histoiresDemographieFixture,
        expected: [
          { key: 'etat-de-la-population', rows: ['densite', 'structure_age', 'taille_menages'], figure: ['pyramid', 'structure_age'], story: null },
          { key: 'trajectoire-demographique', rows: ['evolution_1968'], figure: ['scalar', 'evolution_1968'], story: 'trajectoire-demographique' },
        ],
      },
      {
        theme: 'habitat', indicateurs: indicateursHabitatFixture, histoires: histoiresHabitatFixture,
        expected: [
          { key: 'composition-du-parc', rows: ['mix_logements', 'statut', 'type'], figure: ['composition', 'mix_logements'], story: null },
          { key: 'etat-energetique-du-parc', rows: ['distribution_dpe', 'part_passoires', 'age_du_bati'], figure: ['composition', 'distribution_dpe'], story: 'etat-energetique-du-parc' },
          { key: 'marche', rows: ['prix_m2'], figure: ['trajectory', 'prix_m2'], story: null },
        ],
      },
      {
        theme: 'economie', indicateurs: indicateursEconomieFixture, histoires: histoiresEconomieFixture,
        expected: [
          { key: 'sante-et-taille', rows: ['effectifs_salaries', 'chomage'], figure: ['scalar', 'effectifs_salaries'], story: 'ce-que-la-commune-abrite' },
          { key: 'structure-verte', rows: ['eco_activites'], figure: ['scalar', 'eco_activites'], story: null },
        ],
      },
      {
        theme: 'milieux', indicateurs: indicateursMilieuxFixture, histoires: histoiresMilieuxFixture,
        expected: [
          { key: 'artificialisation', rows: ['artif_par_habitant', 'conso_enaf_annuel'], figure: ['comparison-bars', 'artif_par_habitant'], story: 'se-densifier-setaler-ou-sen-aller' },
        ],
      },
      {
        theme: 'mobilite', indicateurs: indicateursMobiliteFixture, histoires: histoiresMobiliteFixture,
        expected: [
          { key: 'acces-aux-services', rows: ['iso_alimentation', 'iso_sante', 'iso_administration', 'iso_ecole', 'iso_banque', 'share_food_t', 'share_food_b', 'share_food_c', 'share_health_t', 'share_health_b', 'share_health_c', 'share_admin_t', 'share_admin_b', 'share_admin_c', 'share_school_t', 'share_school_b', 'share_school_c', 'share_bank_t', 'share_bank_b', 'share_bank_c'], figure: ['comparison-bars', 'iso_alimentation'], story: 'vingt-minutes-sans-voiture' },
          { key: 'partage-de-lespace-public', rows: ['reseaux', 'reseaux_par_habitant', 'surface_reseaux_routiers', 'places_stationnement_velo_1000', 'offre_cyclable'], figure: ['scalar', 'offre_cyclable'], story: null },
          { key: 'motorisation', rows: ['voitures_menage', 'bornes_recharge'], figure: ['composition', 'voitures_menage'], story: null },
          { key: 'offre-transports-commun', rows: ['offre_tc'], figure: ['scalar', 'offre_tc'], story: null },
        ],
      },
      {
        theme: 'programmes', indicateurs: indicateursProgrammesFixture, histoires: [] as Histoire[],
        expected: [
          { key: 'couverture', rows: ['couverture_programmes'], figure: ['list', 'couverture_programmes'], story: null },
          { key: 'subventions', rows: ['subventions_annuelles', 'subventions_par_domaine'], figure: ['scalar', 'subventions_annuelles'], story: null },
        ],
      },
    ] as const

    for (const { theme, indicateurs, histoires, expected } of cases) {
      const rendered = sousGroupesPourTerritoire(
        payloadDe(indicateurs, histoires, { [theme]: metadonneesThemesFixtures[theme] }),
        theme,
        '22001',
      )
      expect(rendered.map(({ key }) => key), theme).toEqual(expected.map(({ key }) => key))
      for (const [index, binding] of expected.entries()) {
        const subgroup = rendered[index]!
        expect(subgroup.figures.map(({ key }) => key), `${theme}/${binding.key} rows`).toEqual(binding.rows)
        expect(subgroup.figureCompacte, `${theme}/${binding.key} compact figure`).toMatchObject({
          famille: binding.figure[0], clef: binding.figure[1],
        })
        expect(subgroup.lecture?.story_key ?? null, `${theme}/${binding.key} resolved reading`).toBe(binding.story)
      }
    }
  })
})

describe('sousGroupesPourTerritoire — la figure compacte (présentation app-owned)', () => {
  it('porte la famille et l’indicateur app-owned, avec les lignes du payload (Démographie → pyramid/structure_age)', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoiresDemographieFixture,
      indicateursDemographieFixture,
    )

    expect(sousGroupes[0].figureCompacte).toEqual({
      famille: 'pyramid',
      clef: 'structure_age',
      lignes: expect.arrayContaining([expect.objectContaining({ key: 'structure_age' })]),
    })
    expect(sousGroupes[0].figureCompacte?.lignes.length).toBeGreaterThan(0)
  })

  it('rend la figure compacte du sous-groupe Accès sur sa ressource déclarée (comparison-bars)', () => {
    const sousGroupes = sousGroupesDe(
      'mobilite',
      '22001',
      histoiresMobiliteFixture,
      indicateursMobiliteFixture,
    )

    expect(sousGroupes[0].figureCompacte).toMatchObject({
      famille: 'comparison-bars',
      clef: 'iso_alimentation',
    })
    expect(sousGroupes[0].figureCompacte?.lignes).toHaveLength(1)
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
  it('joint la lecture résolue sur le groupe du sous-groupe (Économie 22001 → sante-et-taille)', () => {
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

    expect(lectureDe(sousGroupes[1])?.parametres).toEqual({
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

    expect(lectureDe(sousGroupes[1])).toBeNull()
    expect(sousGroupes[1].lectureIndisponible).toBe(true)
    // le texte ne contient JAMAIS la clé brute — pas de lecture à composer
    const parametres = lectureDe(sousGroupes[1])?.parametres
    expect(parametres).toBeUndefined()
    expect(JSON.stringify(sousGroupes[1])).not.toContain('quadrant-inconnu')
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

  it('la structure verte reste silencieuse quand la métadonnée ne déclare aucune lecture', () => {
    const sousGroupes = sousGroupesDe(
      'economie',
      '53',
      histoiresEconomieFixture,
      indicateursEconomieFixture,
    )

    expect(lectureDe(sousGroupes[0])).toBeNull()
    expect(lectureDe(sousGroupes[1])).toBeNull()
    expect(sousGroupes[1].lectureIndisponible).toBe(false)
  })

  it('rend une lecture null pour un territoire sans ligne (absence distincte d’une indisponibilité explicite)', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '29002',
      histoiresDemographieFixture.filter((h) => h.territoire !== '29002'),
      indicateursDemographieFixture,
    )

    expect(lectureDe(sousGroupes[1])).toBeNull()
    expect(sousGroupes[1].lectureIndisponible).toBe(false)
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

    expect(lectureDe(sousGroupes[1])).toBeNull()
    expect(sousGroupes[1].lectureIndisponible).toBe(true)
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

describe('figureLecturePour — la figure compacte de la lecture, par story_key résolue', () => {
  it('la figure Démographie consomme les taux et l’étiquette résolus', () => {
    const sousGroupes = sousGroupesDe(
      'demographie',
      '22001',
      histoiresDemographieFixture,
      indicateursDemographieFixture,
    )
    const lecture = lectureDe(sousGroupes[1])
    const figure = lecture ? figureLecturePour(payloadDe(indicateursDemographieFixture, histoiresDemographieFixture), '22001', lecture) : null

    expect(figure).toBeNull()
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
      paramsDeclares: [],
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
  it('ne fabrique pas de LQ quand la lecture optionnelle est absente', () => {
    const sousGroupes = sousGroupesDe(
      'economie',
      '53',
      histoiresEconomieFixture,
      indicateursEconomieFixture,
    )
    const lecture = lectureDe(sousGroupes[1])

    expect(lecture).toBeNull()
    expect(lecture ? lignesLQPour(lecture) : []).toEqual([])
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
    const lecture = lectureDe(sousGroupes[1])

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
    const lecture = lectureDe(sousGroupes[1])

    expect(sourceLecture({ ...payload, vintages: null }, lecture!)).toBeNull()
  })
})

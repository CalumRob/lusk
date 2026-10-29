import type { Theme } from '@/payload/types'

/**
 * Stable app-owned display labels for producer resources and their declared
 * detail values (#827). Ordinary presentation strings only: the native
 * semantic contract label stays first priority, and this map is the fallback
 * when a verified catalogue is absent or lagging. It never carries a category
 * domain/order, a unit, eligibility, a classification vocabulary or a source
 * clock — those remain producer-owned facts.
 */
export const LIBELLES_INDICATEURS_APP: Readonly<Record<Theme, Readonly<Record<string, string>>>> = {
  mobilite: {
    iso_alimentation: 'Part des bâtiments sans accès à l’alimentation (à pied ou en transports en commun)',
    iso_sante: 'Part des bâtiments sans accès à la santé (à pied ou en transports en commun)',
    iso_administration: 'Part des bâtiments sans accès aux services administratifs (à pied ou en transports en commun)',
    iso_ecole: 'Part des bâtiments sans accès à l’école (à pied ou en transports en commun)',
    iso_banque: 'Part des bâtiments sans accès à la banque (à pied ou en transports en commun)',
    share_food_t: 'Part des bâtiments avec accès à l’alimentation — à pied ou en transports en commun',
    share_food_b: 'Part des bâtiments avec accès à l’alimentation — à vélo',
    share_food_c: 'Part des bâtiments avec accès à l’alimentation — en voiture',
    share_health_t: 'Part des bâtiments avec accès à la santé — à pied ou en transports en commun',
    share_health_b: 'Part des bâtiments avec accès à la santé — à vélo',
    share_health_c: 'Part des bâtiments avec accès à la santé — en voiture',
    share_admin_t: 'Part des bâtiments avec accès aux services administratifs — à pied ou en transports en commun',
    share_admin_b: 'Part des bâtiments avec accès aux services administratifs — à vélo',
    share_admin_c: 'Part des bâtiments avec accès aux services administratifs — en voiture',
    share_school_t: 'Part des bâtiments avec accès à l’école — à pied ou en transports en commun',
    share_school_b: 'Part des bâtiments avec accès à l’école — à vélo',
    share_school_c: 'Part des bâtiments avec accès à l’école — en voiture',
    share_bank_t: 'Part des bâtiments avec accès à la banque — à pied ou en transports en commun',
    share_bank_b: 'Part des bâtiments avec accès à la banque — à vélo',
    share_bank_c: 'Part des bâtiments avec accès à la banque — en voiture',
    avg_tot_car: 'Nombre moyen d’équipements accessibles — en voiture',
    avg_tot_b: 'Nombre moyen d’équipements accessibles — à vélo',
    avg_tot_t: 'Nombre moyen d’équipements accessibles — à pied ou en transports en commun',
    avg_div_car: 'Nombre moyen de types d’équipements accessibles — en voiture',
    avg_div_b: 'Nombre moyen de types d’équipements accessibles — à vélo',
    avg_div_t: 'Nombre moyen de types d’équipements accessibles — à pied ou en transports en commun',
    nb_buildings: 'Bâtiments résidentiels analysés',
    voitures_menage: 'Voitures par ménage',
    reseaux: 'Réseaux à pied / vélo / voiture',
    reseaux_par_habitant: 'Longueur du réseau par habitant',
    surface_reseaux_routiers: 'Part du territoire consacré aux réseaux routiers',
    offre_tc: 'Part des bâtiments près d’un arrêt (à 500 m)',
    bornes_recharge: 'Bornes de recharge pour véhicules électriques',
    places_stationnement_velo_1000: 'Places de stationnement vélo pour 1 000 hab.',
    places_stationnement_voiture_1000: 'Places de stationnement voiture pour 1 000 hab.',
    bornes_ev_par_station_service: 'Bornes de recharge par station-service',
    stationnement_velo_par_voiture: 'Places de stationnement vélo pour 1 place voiture',
    tot_loss_t: 'Perte totale d’accès — à pied ou en transports en commun',
    tot_loss_b: 'Perte totale d’accès — à vélo',
    offre_cyclable: 'L’offre cyclable',
    raccordement_tc: 'Population bretonne joignable en 90 minutes en TC',
    raccordement_courbe: 'Courbe cumulative — population bretonne joignable en TC',
    raccordement_reference: 'Référence médiane — commune bretonne',
  },
  demographie: {
    densite: 'Densité de population',
    structure_age: 'Structure par âge',
    evolution_1968: 'Évolution de la population depuis 1968',
    taille_menages: 'Taille moyenne des ménages',
  },
  habitat: {
    mix_logements: 'Mix de logements',
    statut: 'Statut d’occupation',
    age_du_bati: 'Âge du bâti',
    type: 'Type de logement',
    prix_m2: 'Médiane prix au m²',
    part_passoires: 'Part de passoires thermiques',
    distribution_dpe: 'Distribution des étiquettes DPE (A à G)',
  },
  economie: {
    effectifs_salaries: 'Effectifs salariés (lieu de travail)',
    chomage: 'Chômage (population active)',
    eco_activites: 'Part des éco-activités',
  },
  milieux: {
    artif_par_habitant: 'Intensité état',
    conso_enaf_annuel: 'Consommation d’ENAF — série annuelle',
  },
  programmes: {
    couverture_programmes: 'Couverture programmatique',
    subventions_annuelles: 'Subventions régionales attribuées (année de référence)',
    subventions_par_domaine: 'Subventions régionales par domaine',
  },
}

/** Stable app-owned detail labels, keyed by the resource then the detail value. */
export const LIBELLES_DETAILS_APP: Readonly<Record<Theme, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  mobilite: {
    reseaux: {
      t_longueur: 'Longueur — à pied ou en transports en commun',
      b_longueur: 'Longueur — à vélo',
      c_longueur: 'Longueur — en voiture',
    },
    reseaux_par_habitant: {
      t_km_1000: 'Longueur — à pied',
      b_km_1000: 'Longueur — à vélo',
      c_km_1000: 'Longueur — en voiture',
    },
    voitures_menage: {
      sans_voiture: 'Ménages sans voiture',
      une_voiture: 'Ménages avec 1 voiture',
      deux_plus: 'Ménages avec 2 voitures ou plus',
    },
    offre_cyclable: {
      protege_longueur: 'Longueur protégée',
      protege_km_1000: 'Protégé',
      partage_longueur: 'Longueur partagée',
      partage_km_1000: 'Partagé',
      total_longueur: 'Longueur totale',
    },
    raccordement_courbe: {
      t0000: '0', t0015: '15', t0030: '30', t0045: '45', t0060: '1 h', t0090: '1 h 30',
      t0120: '2 h', t0180: '3 h', t0240: '4 h', t0300: '5 h', t0360: '6 h',
    },
    raccordement_reference: {
      t0000: '0', t0015: '15', t0030: '30', t0045: '45', t0060: '1 h', t0090: '1 h 30',
      t0120: '2 h', t0180: '3 h', t0240: '4 h', t0300: '5 h', t0360: '6 h',
    },
  },
  demographie: {
    structure_age: {
      '<15': 'Moins de 15 ans',
      '15-24': '15 à 24 ans',
      '25-39': '25 à 39 ans',
      '40-54': '40 à 54 ans',
      '55-64': '55 à 64 ans',
      '65-79': '65 à 79 ans',
      '80+': '80 ans et plus',
    },
  },
  habitat: {
    mix_logements: {
      principales: 'Résidences principales',
      secondaires: 'Résidences secondaires',
      vacants: 'Logements vacants',
    },
    statut: {
      proprietaire: 'Propriétaires',
      hlm: 'Locataires HLM (parc social)',
      locataire_prive: 'Locataires du parc privé',
      loge_gratuit: 'Logés gratuitement',
    },
    age_du_bati: {
      lt1919: 'Avant 1919',
      '1919_1945': 'De 1919 à 1945',
      '1946_1970': 'De 1946 à 1970',
      '1971_1990': 'De 1971 à 1990',
      '1991_2005': 'De 1991 à 2005',
      '2006_plus': 'De 2006 à aujourd’hui',
    },
    type: {
      maison: 'Maisons',
      appartement: 'Appartements',
    },
    prix_m2: {
      '2021': '2021', '2022': '2022', '2023': '2023', '2024': '2024', '2025': '2025',
    },
    distribution_dpe: {
      A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G',
    },
  },
  economie: {},
  milieux: {
    artif_par_habitant: {
      '2020': '2020', '2021': '2021', '2022': '2022', '2023': '2023', '2024': '2024', '2025': '2025',
      M2: 'État initial (M2)',
      M3: 'État final (M3)',
    },
    conso_enaf_annuel: {
      '2011': '2011', '2012': '2012', '2013': '2013', '2014': '2014', '2015': '2015',
      '2016': '2016', '2017': '2017', '2018': '2018', '2019': '2019', '2020': '2020',
      '2021': '2021', '2022': '2022', '2023': '2023', '2024': '2024',
    },
  },
  programmes: {
    couverture_programmes: {
      ACV: 'Action Cœur de Ville',
      PVD: 'Petites Villes de Demain',
      CRTE: 'Contrat de Relance et de Transition Écologique',
      "Territoires d'industrie": "Territoires d'industrie",
      ORT: 'Opération de revitalisation de territoire',
    },
    subventions_par_domaine: {
      'Accompagnement de projets éducatifs des lycées et des initiatives des jeunes':
        'Accompagnement de projets éducatifs des lycées et des initiatives des jeunes',
      'Accompagnement des dynamiques territoriales emploi formation':
        'Accompagnement des dynamiques territoriales emploi formation',
      "Accompagnement des entreprises et de l'emploi": "Accompagnement des entreprises et de l'emploi",
      'Accompagnement des investissements immobiliers des établissements privés':
        'Accompagnement des investissements immobiliers des établissements privés',
      'Actions européennes et internationales': 'Actions européennes et internationales',
      'Agriculture, filière bois et alimentation': 'Agriculture, filière bois et alimentation',
      Apprentissage: 'Apprentissage',
      Biodiversité: 'Biodiversité',
      'Cinéma, livre, radio et pratiques culturelles': 'Cinéma, livre, radio et pratiques culturelles',
      'Contractualisation avec les territoires': 'Contractualisation avec les territoires',
      "Création, développement et transmission d'entreprises":
        "Création, développement et transmission d'entreprises",
      'Dynamiques territoriales': 'Dynamiques territoriales',
      "Développement des secteurs clés de l'économie bretonne":
        "Développement des secteurs clés de l'économie bretonne",
      Eau: 'Eau',
      'Economie sociale et solidaire et innovation sociale': 'Economie sociale et solidaire et innovation sociale',
      'Energie et ressources': 'Energie et ressources',
      'Enseignement supérieur et vie étudiante': 'Enseignement supérieur et vie étudiante',
      'Equipements des lycées publics': 'Equipements des lycées publics',
      'Fonctionnement des lycées publics': 'Fonctionnement des lycées publics',
      "Fonds d'intervention régional": "Fonds d'intervention régional",
      'Formation qualifiante': 'Formation qualifiante',
      'Formations sanitaires et sociales': 'Formations sanitaires et sociales',
      'Information et promotion': 'Information et promotion',
      'Infrastructures de mobilités': 'Infrastructures de mobilités',
      "Innovation et économie de la connaissance": "Innovation et économie de la connaissance",
      'Inventaire et valorisation du patrimoine': 'Inventaire et valorisation du patrimoine',
      'Jeunesse, égalité des droits et vie associative': 'Jeunesse, égalité des droits et vie associative',
      'Langues de Bretagne': 'Langues de Bretagne',
      'Orientation et information sur les métiers': 'Orientation et information sur les métiers',
      'Participation au fonctionnement des établissements privés':
        'Participation au fonctionnement des établissements privés',
      'Projets individuels de formation et qualification': 'Projets individuels de formation et qualification',
      'Pêche, aquaculture et développement maritime': 'Pêche, aquaculture et développement maritime',
      Recherche: 'Recherche',
      'Spectacle vivant, arts plastiques et pratiques culturelles':
        'Spectacle vivant, arts plastiques et pratiques culturelles',
      Sports: 'Sports',
      "Structuration de l'économie bretonne et économie circulaire":
        "Structuration de l'économie bretonne et économie circulaire",
      Tourisme: 'Tourisme',
      'Usages numériques et cybersécurité': 'Usages numériques et cybersécurité',
      'Vie des stagiaires de la formation professionnelle': 'Vie des stagiaires de la formation professionnelle',
    },
  },
}

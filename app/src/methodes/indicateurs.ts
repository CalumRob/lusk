/**
 * Le registre Méthodes des indicateurs et des Stories (issue #129, CONTEXT.md →
 * Méthodes, docs/themes/README.md §The Méthodes contract). Un registre typé :
 * par thème construit (demographie · habitat · economie), la documentation
 * éditoriale de chaque indicateur — ce qu'il mesure, son unité, sa source —
 * puis de chaque Story — ce qu'elle lit, ses lectures. Les clés d'indicateurs
 * sont les clés EXACTES de la payload (public/data/indicateurs_<theme>.json) :
 * l'union est le contrat. Les unités et les sources sont le ground truth de la
 * payload ; le sourceId, quand il existe, pointe vers l'entrée du registre des
 * sources (sources.ts) — l'ancre de la table. La langue est publique : jamais
 * de gates, de noms de code, de noms d'artefacts.
 */

/** Les thèmes construits — la section Méthodes ne couvre que ce qui est construit. */
export const THEMES_CONSTRUITS = ['demographie', 'habitat', 'economie'] as const

export type ThemeConstruit = (typeof THEMES_CONSTRUITS)[number]

/** La documentation éditoriale d'un indicateur — la moitié « ce que ça mesure » du registre. */
export interface IndicateurMethodes {
  /** Le label d'affichage (les termes de CONTEXT.md). */
  label: string
  /** Ce que l'indicateur mesure, son concept — en français public. */
  definition: string
  /** L'unité ground truth de la payload — vide pour un rapport sans unité (LQ). */
  unite: string
  /** La source ground truth — le nom affiché (dégradation : aucune entrée sources). */
  source: string
  /** L'id de l'entrée du registre des sources (l'ancre de la table) — null si absente. */
  sourceId: string | null
}

/** Une lecture d'une Story — une classification publiée et son explication factuelle. */
export interface LectureStory {
  /** La classification de la payload (ground truth) que cette lecture documente. */
  clef: string
  /** Le nom d'affichage de la lecture, en français public. */
  nom: string
  /** Ce que la lecture dit, factuellement. */
  lecture: string
}

/** La documentation éditoriale d'une Story — un indicateur approfondi. */
export interface StoryMethodes {
  /** Le story_key de la payload (ground truth). */
  clef: string
  /** Le titre d'affichage (les termes de CONTEXT.md). */
  titre: string
  /** Ce que la Story lit — en français public. */
  definition: string
  /** Les lectures — la Story par défaut (top-N) n'en porte pas. */
  lectures: LectureStory[]
}

/** La documentation d'un thème construit : ses indicateurs + ses Stories. */
export interface ThemeMethodes {
  indicateurs: Record<string, IndicateurMethodes>
  stories: StoryMethodes[]
}

/**
 * Le registre complet — une entrée par thème construit. Ordre du registre =
 * ordre d'affichage de la page (démographie, habitat, économie). La forme
 * thème → documentation est le contrat que le futur test de parité assertera
 * contre les JSON commis de la payload.
 */
export const THEMES_METHODES: Record<ThemeConstruit, ThemeMethodes> = {
  // ---- Démographie (docs/themes/demographie.md) ----
  demographie: {
    indicateurs: {
      densite: {
        label: 'Densité de population',
        definition:
          'Le nombre d’habitants rapporté à la superficie de la commune, en habitants au kilomètre carré. C’est la mesure la plus immédiate de la répartition de la population sur le territoire.',
        unite: 'hab/km²',
        source: 'INSEE — Série historique du recensement',
        sourceId: 'serie_historique',
      },
      structure_age: {
        label: 'Structure par âge',
        definition:
          'La répartition de la population en sept tranches d’âge, de moins de 15 ans à 80 ans et plus. Chaque tranche est exprimée en part de la population totale, ce qui rend les territoires comparables quelle que soit leur taille.',
        unite: '%',
        source: 'INSEE — Population par sexe et âge (PRINC)',
        sourceId: 'age_detail',
      },
      evolution_1968: {
        label: 'Évolution de la population depuis 1968',
        definition:
          'La variation de la population entre le recensement de 1968 et la dernière population légale, en pourcentage. Un regard de long terme : il distingue les territoires qui se densifient de ceux qui se vident.',
        unite: '%',
        source: 'INSEE — Série historique du recensement',
        sourceId: 'serie_historique',
      },
      taille_menages: {
        label: 'Taille moyenne des ménages',
        definition:
          'Le nombre moyen de personnes par ménage. Un indicateur de la structure des ménages — vieillissement, décohabitation — et de la demande de logements, en lien avec le thème Habitat.',
        unite: 'pers./ménage',
        source: 'INSEE — Ménages (dossier complet)',
        sourceId: 'menages',
      },
    },
    stories: [
      {
        clef: 'trajectoire-demographique',
        titre: 'Trajectoire démographique',
        definition:
          'La Story de la Démographie lit la trajectoire de population du territoire à travers ses deux forces : le solde naturel (naissances moins décès) et le solde migratoire (l’évolution totale moins le solde naturel). Chaque force est exprimée en taux annuel moyen pour 1 000 habitants sur la période intercensitaire ; le signe de chacun des deux taux désigne l’une des quatre lectures. Rien n’est rapporté à une référence extérieure : la lecture ne parle que des deux forces propres au territoire.',
        lectures: [
          {
            clef: 'attire-renouvelle',
            nom: 'Attire et renouvelle',
            lecture:
              'Les deux taux sont positifs : la population se renouvelle par les naissances et grossit par les arrivées.',
          },
          {
            clef: 'attire-meurt',
            nom: 'Attire sans se renouveler',
            lecture:
              'Le taux migratoire est positif et le taux naturel négatif : les arrivées compensent l’excédent des décès sur les naissances.',
          },
          {
            clef: 'vide-meurt',
            nom: 'Se vide sans se renouveler',
            lecture:
              'Les deux taux sont négatifs : la population diminue, par les départs comme par l’excédent des décès sur les naissances.',
          },
          {
            clef: 'vide-renouvelle',
            nom: 'Se vide malgré les naissances',
            lecture:
              'Le taux naturel est positif et le taux migratoire négatif : les naissances compensent un solde migratoire déficitaire.',
          },
        ],
      },
    ],
  },

  // ---- Habitat (docs/themes/habitat.md) ----
  habitat: {
    indicateurs: {
      mix_logements: {
        label: 'Mix de logements',
        definition:
          'La répartition du parc de logements entre résidences principales, résidences secondaires et logements vacants, en part du parc total. Le poids des résidences secondaires et des logements vacants signale la tension entre le bâti et son occupation.',
        unite: '%',
        source: 'INSEE — Logements (dossier complet)',
        sourceId: 'logements',
      },
      statut_anciennete_taille: {
        label: 'Statut d’occupation, ancienneté et taille',
        definition:
          'Trois dimensions du parc de résidences principales : le statut d’occupation (propriétaire, locataire, logé gratuitement), l’ancienneté d’emménagement (de moins de 2 ans à 30 ans et plus) et la taille du logement (du studio aux 5 pièces et plus), chacune en part du parc concerné.',
        unite: '%',
        source: 'INSEE — Logements (dossier complet)',
        sourceId: 'logements',
      },
      prix_m2: {
        label: 'Médiane prix au m²',
        definition:
          'Le prix médian déclaré au mètre carré des ventes de maisons et d’appartements, sur les cinq dernières années. La médiane, plutôt que la moyenne, n’est pas tirée par les ventes extrêmes ; chaque année de la période est publiée à part pour suivre l’évolution. L’indicateur n’est pas publié quand les ventes sont trop peu nombreuses pour être représentatives.',
        unite: '€/m²',
        source: 'Étalab — DVF géolocalisées',
        sourceId: null,
      },
      part_passoires: {
        label: 'Part de passoires thermiques',
        definition:
          'La part des logements dont l’étiquette énergétique du diagnostic de performance énergétique (DPE) est F ou G — les passoires thermiques. La part est calculée sur la base des DPE recensés, jamais sur le parc entier : cette base surreprésente les logements vendus ou loués, une limite documentée. L’indicateur n’est pas publié quand la base compte moins de 30 logements.',
        unite: '%',
        source: 'ADEME — Observatoire DPE, logements existants',
        sourceId: null,
      },
      distribution_dpe: {
        label: 'Distribution des étiquettes DPE (A à G)',
        definition:
          'La répartition des étiquettes énergétiques du parc, de A à G, sur la même base que la part de passoires : c’est la visualisation de l’indicateur précédent, les parts F et G étant mises en évidence. La base mêle plusieurs régimes d’étiquetage — les réformes de 2024 et de 2026 ont rendu les diagnostics récents plus favorables, une limite de comparabilité documentée.',
        unite: '%',
        source: 'ADEME — Observatoire DPE, logements existants',
        sourceId: null,
      },
    },
    stories: [
      {
        clef: 'etat-energetique-du-parc',
        titre: 'L’état énergétique du parc',
        definition:
          'La Story de l’Habitat lit la distribution des étiquettes DPE (A à G) du parc et la classe en quatre lectures par une règle de concentration déterministe, qui ne dépend que des parts d’étiquettes. La lecture n’est pas calculée quand la base DPE compte moins de 30 logements : le classement ne serait pas fiable.',
        lectures: [
          {
            clef: 'parc-heterogene',
            nom: 'Parc hétérogène',
            lecture:
              'Le parc est polarisé : au moins 25 % d’étiquettes A/B/C et au moins 25 % d’étiquettes F/G — des logements très performants et des passoires cohabitent. Cette lecture est vérifiée en premier.',
          },
          {
            clef: 'passoire-energetique',
            nom: 'Passoire énergétique',
            lecture:
              'Au moins 30 % de la base DPE est étiquetée F ou G : le parc est dominé par les logements très énergivores.',
          },
          {
            clef: 'parc-performant',
            nom: 'Parc performant',
            lecture:
              'Au moins 50 % de la base DPE est étiquetée A, B ou C : le parc est concentré sur le haut de l’échelle énergétique.',
          },
          {
            clef: 'parc-intermediaire',
            nom: 'Parc intermédiaire',
            lecture:
              'La lecture restante : le parc est dominé par les étiquettes intermédiaires (C, D, E), sans polarisation.',
          },
        ],
      },
    ],
  },

  // ---- Économie/Emploi (docs/themes/economie-emploi.md, docs/design/methodes.md) ----
  economie: {
    indicateurs: {
      lq: {
        label: 'Spécialisation des établissements',
        definition:
          'Le location quotient (LQ) mesure la spécialisation d’un territoire dans une activité : la part des établissements actifs du territoire relevant de cette activité, rapportée à la part de la même activité dans l’ensemble de la Bretagne. Un quotient supérieur à 1 signale une surreprésentation, inférieur à 1 une sous-représentation. Le LQ compte les établissements, jamais les emplois ni les personnes. La référence est la moyenne bretonne.',
        unite: '',
        source: 'data.bretagne.bzh — Base SIRENE — Région Bretagne (sirene-v3-consolidee)',
        sourceId: 'sirene_snapshot',
      },
      lq_emploi: {
        label: 'Spécialisation de l’emploi salarié',
        definition:
          'Le location quotient appliqué à l’emploi salarié : la part des effectifs salariés du territoire dans une activité, rapportée à la part bretonne. Là où le LQ des établissements lit le tissu productif — ce que la commune abrite —, le LQ de l’emploi lit l’emploi offert sur place.',
        unite: '',
        source: 'INSEE — Flores : nombre d’établissements et effectifs salariés par secteur d’activité (A88)',
        sourceId: 'flores_a88',
      },
      eco_activites: {
        label: 'Part des éco-activités',
        definition:
          'La part des établissements actifs du territoire relevant d’activités liées à l’environnement et à l’énergie — l’économie verte. Le périmètre s’appuie sur la liste européenne des activités éco-industrielles : ce n’est pas le périmètre officiel du SDES, qui ne publie pas de liste d’activités, mais l’approximation la plus proche, documentée comme telle.',
        unite: '%',
        source: 'data.bretagne.bzh — Base SIRENE — Région Bretagne (sirene-v3-consolidee)',
        sourceId: 'sirene_snapshot',
      },
      chomage: {
        label: 'Chômage au sens du recensement',
        definition:
          'La part de la population active résidente de 15 à 64 ans au chômage. Le chômage est ici mesuré au sens du recensement : ce n’est ni la mesure BIT de l’enquête Emploi, ni la mesure administrative de France Travail. Le recensement lissant la collecte sur cinq années, la valeur publiée est une moyenne sur la période, pas un point conjoncturel.',
        unite: '%',
        source: 'INSEE — Population active et chômage (dossier complet, principaux indicateurs, exploitation principale)',
        sourceId: 'rp_chomage',
      },
    },
    stories: [
      {
        clef: 'ce-que-la-commune-sait-faire',
        titre: 'Ce que la commune abrite',
        definition:
          'La Story par défaut de l’Économie : elle lit les trois activités où le territoire est le plus spécialisé — les trois premiers rangs du location quotient, calculé sur les établissements actifs et comparé à la moyenne bretonne. Un quotient supérieur à 1 signale une activité surreprésentée dans le tissu productif local. Elle s’affiche pour chaque commune, sauf quand la Story de saillance « Le matin, la commune se vide » se déclenche.',
        lectures: [],
      },
      {
        clef: 'le-matin-la-commune-se-vide',
        titre: 'Le matin, la commune se vide',
        definition:
          'La Story de saillance de l’Économie, qui remplace la Story par défaut quand elle se déclenche : elle compare l’emploi salarié présent dans la commune (au lieu de travail) aux actifs occupés qui y résident (au lieu de résidence). Le ratio dortoir — emplois sur place divisés par actifs occupés résidents — mesure si la commune se remplit ou se vide le matin. Entre les deux seuils, l’équilibre prévaut et la Story par défaut s’affiche.',
        lectures: [
          {
            clef: 'dortoir-profond',
            nom: 'Dortoir profond',
            lecture:
              'Le ratio est inférieur à 0,15 : la commune compte bien plus d’actifs occupés résidents que d’emplois sur place — elle se vide le matin.',
          },
          {
            clef: 'pole-emploi',
            nom: 'Pôle d’emploi',
            lecture:
              'Le ratio est supérieur à 1,5 : la commune compte bien plus d’emplois que d’actifs occupés résidents — elle se remplit le matin.',
          },
        ],
      },
    ],
  },
}

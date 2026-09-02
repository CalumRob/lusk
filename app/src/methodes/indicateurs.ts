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
 *
 * Les Stories suivent le modèle du jour (CONTEXT.md, 2026-08-06, amendé
 * 2026-08-12 — follow-up #308) : l'Économie est un thème à Story unique —
 * « Ce que la commune abrite » (top-5 du LQ). La Story de structure de la
 * région « Ce que la Bretagne abrite » est RETIRÉE du contrat de la fiche
 * (#367 — la fiche de la région ne la référence plus) et du registre : un
 * thème n'est documenté que pour ce que sa fiche montre. La lecture « Le
 * matin, la commune se vide » est en pause (statut 'en-pause'), documentée
 * comme note Méthodes mais non publiée.
 *
 * Depuis le suivi #367, le registre documente aussi la DIRECTION du
 * classement de chaque indicateur (ADR-0015 — « 1er est toujours bon ») : le
 * sens public « plus = mieux » / « moins = mieux » que la table « Le sens des
 * classements » de la page affiche par indicateur. Les indicateurs re-través
 * y sont documentés — voitures en trois parts (0/1/2+, la part sans voiture
 * en tête), le découpage statut / âge du bâti / type qui remplace
 * statut_anciennete_taille, le stationnement voiture pour 1 000 habitants,
 * les deux ratios (bornes électriques ÷ stations-service, places vélo ÷
 * places voiture) et les lectures perte de diversité / perte totale (div_loss,
 * tot_loss). Les clés nouvelles sont documentées avant leur publication dans
 * la payload (les décisions sont verrouillées, #367) ; les clés anciennes
 * restent documentées tant que la payload commise les porte.
 */

import { slugifierAncre } from '@/methodes/ancres'
import { datasetDeSource } from '@/methodes/sources'
import type { Theme } from '@/payload/types'

/** Les thèmes construits — la section Méthodes ne couvre que ce qui est construit. */
export const THEMES_CONSTRUITS = ['demographie', 'habitat', 'economie', 'mobilite', 'milieux'] as const

export type ThemeConstruit = (typeof THEMES_CONSTRUITS)[number]

/**
 * La direction du classement d'un indicateur (ADR-0015) : quel bout du rang
 * est le bon. Le pipeline déclare la désirabilité de chaque clé et corrige le
 * rang (« 1er est toujours bon ») ; le registre documente ici le sens pour le
 * lecteur de Méthodes — le vocabulaire public du glyphe de la fiche (#367) :
 * 'plus-est-mieux' = plus la valeur est élevée, meilleur est le rang (▲) ;
 * 'moins-est-mieux' = plus elle est basse, meilleur est le rang (▼).
 */
export type DirectionRang = 'plus-est-mieux' | 'moins-est-mieux'

/** Le libellé public de la direction — « plus = mieux » / « moins = mieux ». */
export const LIBELLES_DIRECTION: Record<DirectionRang, string> = {
  'plus-est-mieux': 'plus = mieux',
  'moins-est-mieux': 'moins = mieux',
}

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
  /**
   * La direction du classement (ADR-0015) — quel bout du rang est le bon,
   * jamais silencieuse : chaque indicateur porte son sens.
   */
  direction: DirectionRang
  /** Réserve de lecture propre à cet indicateur, publiée avec sa source. */
  caveat?: string
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

/** L'état de publication d'une Story — publiée, ou en pause (note Méthodes, non publiée). */
export type StatutStory = 'publiee' | 'en-pause'

/** La documentation éditoriale d'une Story — un indicateur approfondi. */
export interface StoryMethodes {
  /** La clé de la Story (le story_key cible du modèle — payload en migration). */
  clef: string
  /** Le titre d'affichage (les termes de CONTEXT.md). */
  titre: string
  /** Ce que la Story lit — en français public. */
  definition: string
  /** L'état de publication : une Story en pause est documentée, jamais publiée. */
  statut: StatutStory
  /** Les lectures — la Story par défaut (top-N) n'en porte pas. */
  lectures: LectureStory[]
}

/** La documentation d'un thème construit : ses indicateurs + ses Stories. */
export interface ThemeMethodes {
  indicateurs: Record<string, IndicateurMethodes>
  stories: StoryMethodes[]
  /**
   * L'horloge lente du thème (ADR-0012, CONTEXT.md → Alive) — documentée comme
   * fait de première classe quand le thème est un instantané sur rythme lent :
   * ce que le flagship consomme, à quelle fréquence chaque entrée bouge, le
   * déclencheur de rebuild. Absente pour les thèmes légers (rythme hebdomadaire).
   */
  horlogeLente?: HorlogeLenteMethodes
  /**
   * Les deux horloges du thème (ADR-0014) — le fait de première classe de la
   * promesse de transparence quand l'indicateur et la Story vivent sur des
   * horloges différentes : la même forme que l'horloge lente, une entrée par
   * horloge. Absente pour les thèmes à horloge unique.
   */
  deuxHorloges?: DeuxHorlogesMethodes
}

/** Une entrée de l'horloge lente — une donnée que l'instantané consomme. */
export interface EntreeHorlogeLente {
  /** La donnée consommée, en français public (jamais un nom d'artefact). */
  donnee: string
  /** À quelle fréquence la donnée bouge chez son producteur. */
  frequence: string
  /** Le millésime consommé par l'instantané (la référence publiée). */
  reference: string
}

/** L'horloge lente d'un thème — le fait de première classe de l'instantané. */
export interface HorlogeLenteMethodes {
  /** Ce que le flagship consomme, en une phrase. */
  consommation: string
  /** Les entrées de l'instantané — à quelle fréquence chacune bouge. */
  entrees: EntreeHorlogeLente[]
  /** Le déclencheur de rebuild — quand le thème se recalcule. */
  declencheur: string
}

/**
 * Les deux horloges d'un thème (ADR-0014) — le fait de première classe de la
 * promesse de transparence : quand l'indicateur et la Story vivent sur des
 * horloges différentes, le thème le dit. La même forme que l'horloge lente
 * (consommation, entrées, déclencheur) — une entrée par horloge.
 */
export interface DeuxHorlogesMethodes {
  /** Ce que les deux horloges du thème sont, en une phrase. */
  consommation: string
  /** Les horloges — ce qui bouge sur chacune, à quelle fréquence, la référence. */
  entrees: EntreeHorlogeLente[]
  /** Le déclencheur — quand chaque horloge fait bouger le thème. */
  declencheur: string
}

/**
 * L'ancrage stable d'un indicateur dans les blocs (#indicateur-<clef>, issue
 * #334). La clé de payload est déjà un slug stable (part_passoires) ; on la
 * préfixe et on normalise les séparateurs pour ne jamais entrer en collision
 * avec l'ancrage de section (#indicateurs).
 */
export function ancreIndicateur(clef: string): string {
  return slugifierAncre('indicateur', clef)
}

/** Un indicateur qui consomme un jeu — la ligne de la matrice (issue #336). */
export interface IndicateurConsommateur {
  /** La clé de payload — l'ancre #indicateur-<clef> du bloc de documentation. */
  clef: string
  /** Le label d'affichage (le même que le bloc). */
  label: string
  /** Le thème de l'indicateur — le filtre des onglets Sources · <thème>
   *  (#467 : tout thème publié, le sixième compris). */
  theme: Theme
}

/**
 * La matrice indicateur ↔ source (issue #336, #206 item 52) — la jointure
 * INVERSE du lien « Source » des blocs : chaque indicateur dont le sourceId
 * pointe une entrée du registre des sources appartient au jeu de cette entrée
 * (datasetDeSource, ADR-0022). Ordre du registre = ordre de la liste. Les
 * Stories n'y sont jamais (elles ne portent pas de champ source — gated
 * #74/#308) : la matrice énonce ce que le modèle peut exprimer aujourd'hui,
 * et sa forme n'aura pas à changer quand elles rejoindront (seule sa source).
 */
export function indicateursParDataset(): ReadonlyMap<string, readonly IndicateurConsommateur[]> {
  const parDataset = new Map<string, IndicateurConsommateur[]>()
  for (const theme of THEMES_CONSTRUITS) {
    for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
      if (indicateur.sourceId === null) continue
      const dataset = datasetDeSource(indicateur.sourceId)
      const ligne: IndicateurConsommateur = { clef, label: indicateur.label, theme }
      const groupe = parDataset.get(dataset)
      if (groupe) groupe.push(ligne)
      else parDataset.set(dataset, [ligne])
    }
  }
  return parDataset
}

const MOBILITE_SHARE_LABELS: Record<string, string> = {
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
}

const MOBILITE_SHARE_INDICATORS: Record<string, IndicateurMethodes> = Object.fromEntries(
  Object.entries(MOBILITE_SHARE_LABELS).map(([key, label]) => [
    key,
    {
      label,
      definition:
        `${label}. La valeur est la part des bâtiments résidentiels du territoire d’où l’on peut atteindre le service en vingt minutes. Plus cette part est élevée, mieux c’est.`,
      unite: '%',
      source:
        'Lusk — analyse d’accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)',
      sourceId: 'mobilite_snapshot',
      direction: 'plus-est-mieux' as const,
    },
  ]),
)

const MOBILITE_AVG_INDICATORS: Record<string, IndicateurMethodes> = Object.fromEntries(
  [
    ['avg_tot_car', 'Nombre moyen d’équipements accessibles — en voiture'],
    ['avg_tot_b', 'Nombre moyen d’équipements accessibles — à vélo'],
    ['avg_tot_t', 'Nombre moyen d’équipements accessibles — à pied ou en transports en commun'],
    ['avg_div_car', 'Nombre moyen de types d’équipements accessibles — en voiture'],
    ['avg_div_b', 'Nombre moyen de types d’équipements accessibles — à vélo'],
    ['avg_div_t', 'Nombre moyen de types d’équipements accessibles — à pied ou en transports en commun'],
  ].map(([key, label]) => [
    key,
    {
      label,
      definition: `${label}. La valeur est la moyenne par bâtiment résidentiel des équipements ou types d’équipements atteignables en vingt minutes. Plus cette moyenne est élevée, mieux c’est.`,
      unite: key.startsWith('avg_tot_') ? 'équipements / bâtiment' : 'types d’équipement / bâtiment',
      source:
        'Lusk — analyse d’accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)',
      sourceId: 'mobilite_snapshot',
      direction: 'plus-est-mieux' as const,
    },
  ]),
)

const MOBILITE_BUILDING_INDICATOR: Record<string, IndicateurMethodes> = {
  nb_buildings: {
    label: 'Bâtiments résidentiels analysés',
    definition:
      'Le nombre de bâtiments résidentiels analysés dans le territoire. Cette taille sert aussi de poids aux agrégations par bâtiment du thème Mobilité.',
    unite: 'bâtiments',
    source:
      'Lusk — analyse d’accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)',
    sourceId: 'mobilite_snapshot',
    direction: 'plus-est-mieux',
  },
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
        direction: 'plus-est-mieux',
      },
      structure_age: {
        label: 'Structure par âge',
        definition:
          'La répartition de la population en sept tranches d’âge, de moins de 15 ans à 80 ans et plus, déclinée pour les femmes et pour les hommes : quatorze parts par territoire, une par croisement d’une tranche et d’un sexe. Chaque part est rapportée à la population totale du territoire — jamais au seul effectif de son sexe : les quatorze parts totalisent donc 100 %, et les deux versants se lisent à la même échelle, comme les deux côtés d’une pyramide des âges. Le classement, lui, ne porte sur aucune tranche en particulier : il compare la part des moins de 20 ans dans la population totale. Cette part est une mesure à part, fournie telle quelle par le recensement ; elle recoupe les deux premières tranches sans se confondre avec elles, et ne se déduit donc pas de leur somme.',
        unite: '%',
        source: 'INSEE — Population par sexe et âge (PRINC)',
        sourceId: 'age_detail',
        direction: 'plus-est-mieux',
      },
      evolution_1968: {
        label: 'Évolution de la population depuis 1968',
        definition:
          'La variation de la population entre le recensement de 1968 et la dernière population légale, en pourcentage. Un regard de long terme : il distingue les territoires qui se densifient de ceux qui se vident.',
        unite: '%',
        source: 'INSEE — Série historique du recensement',
        sourceId: 'serie_historique',
        direction: 'plus-est-mieux',
      },
      taille_menages: {
        label: 'Taille moyenne des ménages',
        definition:
          'Le nombre moyen de personnes par ménage. Un indicateur de la structure des ménages — vieillissement, décohabitation — et de la demande de logements, en lien avec le thème Habitat.',
        unite: 'pers./ménage',
        source: 'INSEE — Ménages (dossier complet)',
        sourceId: 'menages',
        direction: 'plus-est-mieux',
      },
    },
    stories: [
      {
        clef: 'trajectoire-demographique',
        titre: 'Trajectoire démographique',
        statut: 'publiee',
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
          'La répartition du parc de logements entre résidences principales, résidences secondaires et logements vacants, en part du parc total. Le poids des résidences secondaires et des logements vacants signale la tension entre le bâti et son occupation. Le classement lit la part des résidences principales.',
        unite: '%',
        source: 'INSEE — Logements (dossier complet)',
        sourceId: 'logements',
        direction: 'plus-est-mieux',
      },
      statut: {
        label: 'Statut d’occupation',
        definition:
          'L’occupation des résidences principales, en quatre parts : propriétaire, locataire HLM (le parc social), locataire du parc privé et logé gratuitement. Le poids du logement social et la part des propriétaires lisent la tension du parc (issue #368 : l’ancienne clé à 14 modalités — occupation, ancienneté et taille confondus — est scindée, la taille n’est plus publiée).',
        unite: '%',
        source: 'INSEE — Logements (dossier complet)',
        sourceId: 'logements',
        direction: 'plus-est-mieux',
      },
      age_du_bati: {
        label: 'Âge du bâti',
        definition:
          'La période d’achèvement des résidences principales, en six tranches (d’avant 1919 à 2006 et après), en part du stock dont la période est connue. Le vieux bâti est le plus dur à isoler — la part du parc d’avant 1971 (avant la première réglementation thermique) est la tension DPE de la commune. La période inconnue du recensement (~2 % des résidences principales) est un fait de la donnée, hors de l’univers publié.',
        unite: '%',
        source: 'INSEE — Logements (dossier complet)',
        sourceId: 'logements',
        direction: 'moins-est-mieux',
      },
      type: {
        label: 'Type de logement',
        definition:
          'La répartition des résidences principales entre maisons et appartements, en part de l’univers (maison + appartement) — les autres logements de métropole (~1 %), hors de l’univers comme les dépendances côté prix. La part d’appartements signale la densité du bâti.',
        unite: '%',
        source: 'INSEE — Logements (dossier complet)',
        sourceId: 'logements',
        direction: 'plus-est-mieux',
      },
      prix_m2: {
        label: 'Médiane prix au m²',
        definition:
          'Le prix médian déclaré au mètre carré des ventes de maisons et d’appartements, sur les cinq dernières années. La médiane, plutôt que la moyenne, n’est pas tirée par les ventes extrêmes ; chaque année de la période est publiée à part pour suivre l’évolution. L’indicateur n’est pas publié quand les ventes sont trop peu nombreuses pour être représentatives. Le classement se lit à l’envers : un prix plus bas, c’est mieux pour l’accès au logement.',
        unite: '€/m²',
        source: 'Étalab — DVF géolocalisées',
        // Le jeu DVF (ADR-0022 : l'en-tête #source-dvf) — le sourceId épingle
        // une ligne du jeu, la matrice et le lien « Source » résolvent l'en-tête
        sourceId: 'dvf_2021_dep22',
        direction: 'moins-est-mieux',
        caveat: 'Non publié quand les ventes sont trop peu nombreuses pour être représentatives.',
      },
      part_passoires: {
        label: 'Part de passoires thermiques',
        definition:
          'La part des logements dont l’étiquette énergétique du diagnostic de performance énergétique (DPE) est F ou G — les passoires thermiques. La part est calculée sur la base des DPE recensés, jamais sur le parc entier : cette base surreprésente les logements vendus ou loués, une limite documentée. L’indicateur n’est pas publié quand la base compte moins de 30 logements. Le classement se lit à l’envers : moins de passoires, c’est mieux.',
        unite: '%',
        source: 'ADEME — Observatoire DPE, logements existants',
        // Le jeu DPE (ADR-0022 : l'en-tête #source-dpe), la même forme que DVF
        sourceId: 'dpe_22',
        direction: 'moins-est-mieux',
        caveat: 'La base DPE surreprésente les logements vendus ou loués ; non publié sous 30 logements.',
      },
      distribution_dpe: {
        label: 'Distribution des étiquettes DPE (A à G)',
        definition:
          'La répartition des étiquettes énergétiques du parc, de A à G, sur la même base que la part de passoires : c’est la visualisation de l’indicateur précédent, les parts F et G étant mises en évidence. Une composition en sept parts — le classement lit la part des étiquettes F et G, la même valeur que la part de passoires : moins de F/G, c’est mieux. La base mêle plusieurs régimes d’étiquetage — les réformes de 2024 et de 2026 ont rendu les diagnostics récents plus favorables, une limite de comparabilité documentée. La figure rend les étiquettes dans les couleurs officielles du DPE (A à G), jamais dans la palette du thème (#367).',
        unite: '%',
        source: 'ADEME — Observatoire DPE, logements existants',
        sourceId: 'dpe_22',
        direction: 'moins-est-mieux',
        caveat: 'Les réformes de 2024 et 2026 rendent les diagnostics récents moins directement comparables.',
      },
    },
    stories: [
      {
        clef: 'etat-energetique-du-parc',
        titre: 'L’état énergétique du parc',
        statut: 'publiee',
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
      effectifs_salaries: {
        label: 'Effectifs salariés (lieu de travail)',
        definition:
          'Le nombre total d’emplois salariés présents dans la commune, comptés au lieu de travail — les salariés des établissements implantés sur le territoire, qu’ils y résident ou non. C’est la taille du tissu économique local, en valeur absolue, comme la population l’est pour la démographie ; la lecture relative de l’emploi est l’affaire de la Story, pas de cet indicateur.',
        unite: 'salariés',
        source: 'INSEE — Flores : nombre d’établissements et effectifs salariés par secteur d’activité (A88)',
        sourceId: 'flores_a88',
        direction: 'plus-est-mieux',
      },
      eco_activites: {
        label: 'Part des éco-activités',
        definition:
          'La part des établissements actifs du territoire relevant d’activités liées à l’environnement et à l’énergie — l’économie verte. Le périmètre s’appuie sur la liste européenne des activités éco-industrielles : ce n’est pas le périmètre officiel du SDES, qui ne publie pas de liste d’activités, mais l’approximation la plus proche, documentée comme telle.',
        unite: '%',
        source: 'data.bretagne.bzh — Base SIRENE — Région Bretagne',
        sourceId: 'sirene_snapshot',
        direction: 'plus-est-mieux',
      },
      chomage: {
        label: 'Chômage au sens du recensement',
        definition:
          'La part de la population active résidente de 15 à 64 ans au chômage. Le chômage est ici mesuré au sens du recensement : ce n’est ni la mesure BIT de l’enquête Emploi, ni la mesure administrative de France Travail. Le recensement lissant la collecte sur cinq années, la valeur publiée est une moyenne sur la période, pas un point conjoncturel. Le classement se lit à l’envers : un chômage plus bas, c’est mieux.',
        unite: '%',
        source: 'INSEE — Population active et chômage (dossier complet, principaux indicateurs, exploitation principale)',
        sourceId: 'rp_chomage',
        direction: 'moins-est-mieux',
      },
    },
    stories: [
      {
        clef: 'ce-que-la-commune-abrite',
        titre: 'Ce que la commune abrite',
        statut: 'publiee',
        definition:
          'La Story de l’Économie, la seule du thème (le thème est à Story unique) : elle lit les cinq activités où le territoire est le plus spécialisé — les cinq premiers rangs du location quotient, calculé sur les établissements actifs et comparé à la moyenne bretonne. Un quotient supérieur à 1 signale une activité surreprésentée dans le tissu productif local. Le titre est volontairement neutre sur la matière — « abrite », héberge : la mesure porte sur les établissements, jamais sur les emplois ni sur les personnes ; c’est le label « Spécialisation des établissements » qui porte cette précision. Publiée pour les communes, les EPCI et les départements. La région, dont le quotient est dégénéré, n’a pas de Story de spécialisation — sa lecture de structure est retirée du contrat de la fiche (#367) : son onglet Économie rend ses indicateurs.',
        lectures: [],
      },
      {
        clef: 'le-matin-la-commune-se-vide',
        titre: 'Le matin, la commune se vide',
        statut: 'en-pause',
        definition:
          'Une note Méthodes — une lecture analytique en pause, non publiée : elle compare l’emploi salarié présent dans la commune (au lieu de travail) aux actifs occupés qui y résident (au lieu de résidence). Le ratio dortoir — emplois sur place divisés par actifs occupés résidents — mesure si la commune se remplit ou se vide le matin. Elle n’est pas publiée aujourd’hui : le thème porte une Story unique (« Ce que la commune abrite »), et cette lecture reste un outil d’analyse en réserve, prête pour le futur modèle multi-Stories.',
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
          {
            clef: 'equilibre',
            nom: 'Équilibre',
            lecture:
              'Le ratio se situe entre 0,15 et 1,5 : la commune n’est ni dortoir ni pôle d’emploi, et c’est la Story par défaut qui s’affiche.',
          },
        ],
      },
    ],
  },

  // ---- Mobilité (docs/themes/mobilite.md, ADR-0012) ----
  mobilite: {
    indicateurs: {
      voitures_menage: {
        label: 'Voitures par ménage',
        definition:
          'La motorisation des ménages du territoire en trois parts réelles, issues du recensement : les ménages sans voiture, les ménages à une voiture et les ménages à deux voitures ou plus — les trois parts totalisent 100 % des ménages. La part des ménages sans voiture est lue en tête de la figure : c’est elle que le classement lit (plus elle est élevée, moins le territoire dépend de la voiture). C’est le pendant de la demande — ce qu’on peut atteindre à pied ou en transports en commun d’un côté, combien de voitures on possède de l’autre.',
        unite: '%',
        source:
          'INSEE \u2014 Recensement de la population, exploitations principales (Logements) \u2014 tableau LOG T12 \u00ab \u00c9quipement automobile des m\u00e9nages \u00bb (le jeu DS_RP_LOGEMENT_PRINC, la dimension CARS)',
        sourceId: 'rp_logement_princ',
        direction: 'plus-est-mieux',
      },
      reseaux: {
        label: 'Réseaux à pied, à vélo et en voiture',
        definition:
          'La longueur (en kilomètres) et la densité (en kilomètres par kilomètre carré) des réseaux routier, cyclable et piéton du territoire, relevés dans la cartographie participative OpenStreetMap. Trois modes sont distingués — à pied, à vélo, en voiture — chacun avec sa longueur et sa densité. Le classement lit le détail vélo.',
        unite: 'km',
        source:
          'OpenStreetMap \u2014 r\u00e9seaux routier/cyclable/pi\u00e9ton (extrait Geofabrik Bretagne) \u2014 \u00a9 OpenStreetMap contributors, licence ODbL 1.0 (ADR-0001)',
        sourceId: 'osm_reseaux',
        direction: 'plus-est-mieux',
      },
      offre_tc: {
        label: 'Offre de transports en commun',
        definition:
          'La part des bâtiments résidentiels du territoire situés à moins de 500 mètres à vol d’oiseau d’un arrêt de transports en commun — le rayon de « 10 minutes à pied » autour d’un arrêt. Les arrêts sont ceux de la base multimodale Korrigo, la fédération des réseaux de transport public bretons.',
        unite: '%',
        source:
          'Bretagne Mobilit\u00e9 \u2014 Korrigo : base multimodale GTFS des transports publics en Bretagne (les 24+ r\u00e9seaux : BreizhGo TER/car/maritime + les r\u00e9seaux urbains STAR, Bibus, QUB, TUB, MAT, Izilo, TBK, Kic\u00e9o\u2026)',
        sourceId: 'korrigo',
        direction: 'plus-est-mieux',
      },
      raccordement_tc: {
        label: 'Population bretonne joignable en 90 minutes en TC',
        definition:
          'La part de la population bretonne qui peut rejoindre le territoire en moins de 90 minutes en train, en car ou en bus, de mairie à mairie. Le calcul retient le meilleur départ d’un mercredi réel de période scolaire, avec une marche plafonnée à 40 minutes à chaque extrémité, sans aucun trajet en voiture.',
        unite: '%',
        source:
          'Lusk — matrice temps mairie à mairie du raccordement (routage r5r figé)',
        sourceId: 'matrice_temps_mairies',
        direction: 'plus-est-mieux',
        caveat:
          'Aux niveaux agrégés, les communes non routées sont exclues du dénominateur et la couverture réellement mesurée est signalée. Une commune non routée reste indisponible, jamais ramenée à zéro.',
      },
      raccordement_courbe: {
        label: 'Courbe cumulative — population bretonne joignable en TC',
        definition:
          'La courbe cumulative de la part de population bretonne joignable selon le temps de trajet en transports en commun, de mairie à mairie, jusqu’à 6 heures, publiée sur onze seuils.',
        unite: '%',
        source:
          'Lusk — matrice temps mairie à mairie du raccordement (routage r5r figé)',
        sourceId: 'matrice_temps_mairies',
        direction: 'plus-est-mieux',
      },
      raccordement_reference: {
        label: 'Référence médiane — commune bretonne',
        definition:
          'La courbe médiane des communes bretonnes routées, affichée comme référence sur la courbe cumulative du raccordement.',
        unite: '%',
        source:
          'Lusk — matrice temps mairie à mairie du raccordement (routage r5r figé)',
        sourceId: 'matrice_temps_mairies',
        direction: 'plus-est-mieux',
      },
      bornes_recharge: {
        label: 'Bornes de recharge pour véhicules électriques',
        definition:
          'Le nombre de stations de recharge pour véhicules électriques (IRVE) présentes sur le territoire. Le compte porte les stations, jamais les prises : une station peut offrir plusieurs points de charge, et c’est l’offre de recharge qui compte. Les stations sans commune identifiable restent hors comptage — une limite signalée par le fichier lui-même.',
        unite: 'bornes',
        source:
          'Etalab / data.bretagne.bzh \u2014 Fichier consolid\u00e9 des Bornes de Recharge pour V\u00e9hicules \u00c9lectriques (IRVE), sch\u00e9ma 2.2.0',
        sourceId: 'bornes-recharges',
        direction: 'plus-est-mieux',
      },
      bornes_ev_par_station_service: {
        label: 'Bornes de recharge pour 1 station-service',
        definition:
          'Le rapport entre l’offre de recharge électrique et l’offre de carburant du territoire : le nombre de bornes IRVE pour une station-service (la source officielle BPE B316 — les stations ayant vendu 500 000 litres ou plus l’année précédente). Le classement lit le rapport : plus il y a de bornes par station-service, mieux le territoire prépare la bascule vers l’électrique. Le rapport n’est publié que là où le territoire compte au moins une station-service.',
        unite: 'bornes / station',
        source: 'INSEE — Base permanente des équipements (BPE25), fichier détail géolocalisé, filtre analytique B316 stations-service',
        sourceId: 'bpe_b316',
        direction: 'plus-est-mieux',
      },
      places_stationnement_velo_1000: {
        label: 'Places de stationnement vélo pour 1 000 habitants',
        definition:
          'Le nombre de places de stationnement vélo rapporté à 1 000 habitants, précalculé par le hub d’indicateurs territoriaux de transition écologique depuis la base nationale du stationnement cyclable — elle-même issue de la cartographie participative OpenStreetMap.',
        unite: 'places / 1 000 hab',
        source:
          'Ecolab \u2014 Nombre de places de stationnement v\u00e9lo pour 1 000 hab. (hub d\u2019indicateurs territoriaux de transition \u00e9cologique ; source OSM : Base Nationale du Stationnement Cyclable)',
        sourceId: 'stationnement-velo',
        direction: 'plus-est-mieux',
      },
      places_stationnement_voiture_1000: {
        label: 'Places de stationnement voiture pour 1 000 habitants',
        definition:
          'Le nombre de places de stationnement voiture rapporté à 1 000 habitants, estimé depuis les aires de stationnement de la cartographie participative OpenStreetMap (amenity=parking — les surfaces, jamais le champ capacity, porté par une minorité des aires), divisé par des facteurs documentés : 25 m² par place en parc de surface, environ 11,5 m² par place en voirie. Une estimation, jamais un inventaire — l’espace que la voiture stationnée prend dans l’espace public. Le classement se lit à l’envers : moins de places par habitant, c’est mieux — la part de l’espace public que la voiture occupe.',
        unite: 'places / 1 000 hab',
        source:
          'OpenStreetMap \u2014 r\u00e9seaux routier/cyclable/pi\u00e9ton (extrait Geofabrik Bretagne) \u2014 \u00a9 OpenStreetMap contributors, licence ODbL 1.0 (ADR-0001)',
         sourceId: 'osm_reseaux',
        direction: 'moins-est-mieux',
      },
      stationnement_velo_par_voiture: {
        label: 'Places de stationnement vélo pour 1 place voiture',
        definition:
          'Le rapport entre l’offre de stationnement des deux modes : le nombre de places vélo (la base nationale du stationnement cyclable) pour une place voiture (l’estimation des aires de stationnement OpenStreetMap). Le classement lit le rapport : plus il y a de places vélo par place voiture, mieux l’espace public est partagé entre les modes.',
        unite: 'places vélo / place voiture',
        source:
          'OpenStreetMap \u2014 r\u00e9seaux routier/cyclable/pi\u00e9ton (extrait Geofabrik Bretagne) \u2014 \u00a9 OpenStreetMap contributors, licence ODbL 1.0 (ADR-0001)',
         sourceId: 'osm_reseaux',
        direction: 'plus-est-mieux',
      },
      offre_cyclable: {
        label: 'L’offre cyclable',
        definition:
          'La figure « L’offre cyclable » du sous-bloc « L’offre de mobilité alternative » : la longueur (en kilomètres) du réseau cyclable du territoire, relevée dans le jeu Geovelo « Aménagements cyclables France Métropolitaine » (data.gouv.fr, licence ODbL — la même famille que l’extrait OpenStreetMap, ADR-0001). La figure lit l’offre sous deux angles : le ratio « X % de l’infrastructure routière » — la longueur cyclable rapportée au réseau routier du territoire — et les barres protégé / partagé en kilomètres pour 1 000 habitants, la composition de l’offre entre l’espace séparé du trafic motorisé (pistes, voies vertes, CVCB, aménagements mixtes piéton-vélo) et l’espace partagé (bandes, doubles sens, vélos rues, couloirs bus+vélo). Le réseau est défini par l’enum complet du schéma national : PISTE CYCLABLE, BANDE CYCLABLE, DOUBLE SENS CYCLABLE PISTE, DOUBLE SENS CYCLABLE BANDE, DOUBLE SENS CYCLABLE NON MATERIALISE, VOIE VERTE, VELO RUE, COULOIR BUS+VELO, CHAUSSEE A VOIE CENTRALE BANALISEE, ACCOTEMENT REVETU HORS CVCB, AMENAGEMENT MIXTE PIETON VELO HORS VOIE VERTE, GOULOTTE, RAMPE et AUTRE (AUCUN marque le côté sans aménagement). La longueur suit la règle de l’ADR-0016 : chaque segment contribue une fois par direction qu’il sert — une piste bidirectionnelle compte deux fois — et chaque segment aboutit dans exactement une commune, celle du côté porteur de l’aménagement (le côté gauche gagne quand le droit est vide ; le côté droit départage quand les deux portent). Pour le ratio, les deux longueurs comparées suivent la même convention de géométrie unique — chaque segment compté une fois, quel que soit le sens : la comparaison avec le réseau routier ne gonfle jamais le numérateur. Une limite de source est documentée, jamais dissimulée : le jeu dérive de la cartographie participative OpenStreetMap, dont la couverture est hétérogène dans le rural breton (docs/research/openstreetmap.md §1.6) — les communes peu cartographiées voient leur offre sous-estimée. La figure est limitée par sa plus lente horloge : sa source de référence est l’extrait OpenStreetMap (le réseau routier du dénominateur), jamais le snapshot Geovelo frais — le décalage entre les deux horloges est un fait de première classe, documenté sur la fiche.',
        unite: 'km',
        source:
          'Geovelo \u2014 Am\u00e9nagements cyclables France M\u00e9tropolitaine (sch\u00e9ma national v0.3.5, ODbL \u2014 \u00a9 OpenStreetMap contributors, ADR-0001)',
        sourceId: 'amenagements_cyclables',
        direction: 'plus-est-mieux',
      },
      div_loss_t: {
        label: 'Perte de diversité — à pied ou en transports en commun',
        definition:
          'La valeur que la lecture « Vingt minutes sans voiture » rend : le nombre de types de services qui sortent de la portée quotidienne du territoire quand la voiture est retirée — ce qu’on atteint en voiture en 20 minutes, moins ce qu’on atteint encore à pied ou en transports en commun. Un compte, jamais un indice. Le classement se lit à l’envers : moins de services perdus, c’est mieux.',
        unite: 'types de services',
        source:
          'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
        sourceId: 'mobilite_snapshot',
        direction: 'moins-est-mieux',
      },
      div_loss_b: {
        label: 'Perte de diversité — à vélo',
        definition:
          'La même perte lue à vélo : les types de services qui sortent de la portée quotidienne du territoire quand la voiture est retirée, en ne comptant que ce que la bicyclette préserve déjà au-delà de la marche et des transports en commun. La lecture vélo est bornée pour ne jamais être pire que la lecture à pied. Le classement se lit à l’envers : moins de services perdus, c’est mieux.',
        unite: 'types de services',
        source:
          'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
        sourceId: 'mobilite_snapshot',
        direction: 'moins-est-mieux',
      },
      tot_loss_t: {
        label: 'Perte totale d’accès — à pied ou en transports en commun',
        definition:
          'La lecture complémentaire de la perte de diversité : le volume d’accès perdu quand la voiture est retirée. Pour chaque bâtiment, les services qu’il atteignait en voiture en 20 minutes et qu’il ne peut plus atteindre à pied ou en transports en commun ; la valeur publiée est la médiane de ce compte sur les bâtiments du territoire. Là où la perte de diversité compte les types de services, celle-ci compte le volume d’accès perdu — les deux lectures se complètent sur la figure de la lecture. Le classement se lit à l’envers : moins d’accès perdus, c’est mieux.',
        unite: 'accès perdus',
        source:
          'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
        sourceId: 'mobilite_snapshot',
        direction: 'moins-est-mieux',
      },
      tot_loss_b: {
        label: 'Perte totale d’accès — à vélo',
        definition:
          'La lecture complémentaire de la perte de diversité lue à vélo : le volume d’accès perdu quand la voiture est retirée, en ne comptant que ce que la bicyclette préserve déjà — la médiane, sur les bâtiments du territoire, du nombre d’accès perdus par bâtiment. La lecture vélo est bornée pour ne jamais être pire que la lecture à pied (la même règle que la perte de diversité, ADR-0012). Comme elle, elle se lit en regard de sa version à pied ou en transports en commun sur la figure de la lecture. Le classement se lit à l’envers : moins d’accès perdus, c’est mieux.',
        unite: 'accès perdus',
        source:
          'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
        sourceId: 'mobilite_snapshot',
        direction: 'moins-est-mieux',
      },
      iso_alimentation: {
        label: 'Part des bâtiments sans accès à l’alimentation',
        definition:
          'La part des bâtiments résidentiels du territoire d’où l’on ne peut atteindre aucun commerce alimentaire à pied ou en transports en commun en 20 minutes. La lecture en manque est volontaire : un territoire agit sur ce que ses bâtiments n’ont pas à portée. Le classement se lit à l’envers : moins de bâtiments isolés, c’est mieux.',
        unite: '%',
        source:
          'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
        sourceId: 'mobilite_snapshot',
        direction: 'moins-est-mieux',
      },
      iso_sante: {
        label: 'Part des bâtiments sans accès à la santé',
        definition:
          'La part des bâtiments résidentiels du territoire d’où l’on ne peut atteindre aucun service de santé à pied ou en transports en commun en 20 minutes. La lecture en manque est volontaire : un territoire agit sur ce que ses bâtiments n’ont pas à portée. Le classement se lit à l’envers : moins de bâtiments isolés, c’est mieux.',
        unite: '%',
        source:
          'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
        sourceId: 'mobilite_snapshot',
        direction: 'moins-est-mieux',
      },
      iso_administration: {
        label: 'Part des bâtiments sans accès aux services administratifs',
        definition:
          'La part des bâtiments résidentiels du territoire d’où l’on ne peut atteindre aucun service administratif à pied ou en transports en commun en 20 minutes. La lecture en manque est volontaire : un territoire agit sur ce que ses bâtiments n’ont pas à portée. Le classement se lit à l’envers : moins de bâtiments isolés, c’est mieux.',
        unite: '%',
        source:
          'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
        sourceId: 'mobilite_snapshot',
        direction: 'moins-est-mieux',
      },
      iso_ecole: {
        label: 'Part des bâtiments sans accès à l’école',
        definition:
          'La part des bâtiments résidentiels du territoire d’où l’on ne peut atteindre aucune école à pied ou en transports en commun en 20 minutes. La lecture en manque est volontaire : un territoire agit sur ce que ses bâtiments n’ont pas à portée. Le classement se lit à l’envers : moins de bâtiments isolés, c’est mieux.',
        unite: '%',
        source:
          'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
        sourceId: 'mobilite_snapshot',
        direction: 'moins-est-mieux',
      },
      iso_banque: {
        label: 'Part des bâtiments sans accès à la banque',
        definition:
          'La part des bâtiments résidentiels du territoire d’où l’on ne peut atteindre aucune banque à pied ou en transports en commun en 20 minutes. La lecture en manque est volontaire : un territoire agit sur ce que ses bâtiments n’ont pas à portée. Le classement se lit à l’envers : moins de bâtiments isolés, c’est mieux.',
        unite: '%',
        source:
          'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
        sourceId: 'mobilite_snapshot',
        direction: 'moins-est-mieux',
      },
      ...MOBILITE_AVG_INDICATORS,
      ...MOBILITE_SHARE_INDICATORS,
      ...MOBILITE_BUILDING_INDICATOR,
    },
    stories: [
      {
        clef: 'vingt-minutes-sans-voiture',
        titre: 'Vingt minutes sans voiture',
        statut: 'publiee',
        definition:
          'La Story par défaut du thème Mobilité — le titre du flagship, la seule exception au vocabulaire « à pied ou en transports en commun ». Elle lit la perte de diversité : le nombre de types de services qui sortent de la portée quotidienne du territoire quand la voiture est retirée — ce qu’on atteint en voiture en 20 minutes, moins ce qu’on atteint encore à pied ou en transports en commun. Chaque bâtiment du territoire est le point de départ d’un trajet ; la Story rassemble la distribution bâtiment par bâtiment, en marque la médiane et la compare aux territoires de même échelle. C’est un compte, jamais un indice : le nombre se lit tel quel, il ne cache pas son calcul. La Story s’affiche pour tous les territoires — tout territoire a une perte.',
        lectures: [],
      },
      {
        clef: 'ce-que-le-velo-preserve',
        titre: 'Ce que le vélo préserve',
        statut: 'publiee',
        definition:
          'La Story candidate du thème Mobilité, déclenchée par la saillance : elle lit le delta vélo — les types de services que la bicyclette préserve déjà au-delà de la marche et des transports en commun. « Déjà » est le mot exact : la Story lit le réseau actuel, jamais un réseau rêvé — ce que le vélo permet, pas ce que de meilleures infrastructures apporteraient. Elle ne remplace la Story par défaut que là où le delta est réel : la plupart des communes ne préservent qu’un type de service environ — rien à raconter — et ce n’est que dans les territoires les mieux dotés que la bicyclette préserve vraiment la diversité (de l’ordre de quatre à dix types de services).',
        lectures: [],
      },
    ],
    horlogeLente: {
      consommation:
        'Le thème Mobilité est construit autour d’une analyse d’accessibilité figée : un instantané calculé le 28 février 2026 et porté dans le pipeline le 6 août 2026. Ses trois données de référence — les équipements de proximité, les réseaux et les bâtiments — ne bougent pas chaque semaine : le thème se rafraîchit sur un rythme lent, et il le dit. Les autres sources du thème (recensement, transports, bornes, stationnement vélo) suivent le rythme hebdomadaire des autres thèmes.',
      entrees: [
        {
          donnee:
            'Les équipements de proximité (alimentation, santé, services administratifs, écoles, banques)',
          frequence: 'annuelle — un nouveau millésime publié chaque année',
          reference: 'BPE 2024',
        },
        {
          donnee: 'Les réseaux à pied, à vélo et en voiture',
          frequence:
            'l’extrait cartographique est reconstruit chaque jour, mais l’instantané fige celui du 5 août 2026',
          reference: 'extrait du 5 août 2026',
        },
        {
          donnee: 'Les bâtiments résidentiels',
          frequence:
            'par campagnes espacées — la base nationale des bâtiments évolue rarement',
          reference: 'BDNB juillet 2025',
        },
      ],
      declencheur:
        'Le thème se recalcule à la main, sur décision — jamais automatiquement : quand l’une de ses données de référence bouge de façon significative (un nouveau millésime d’équipements, une actualisation majeure des réseaux ou des bâtiments), l’analyse est re-générée, figée à sa nouvelle date d’instantané, puis re-portée dans le pipeline. La date publiée est celle de l’instantané : le thème ne prétend jamais être plus frais que son calcul.',
    },
    deuxHorloges: {
      consommation:
        'La figure « L’offre cyclable » vit sur DEUX horloges, et le thème le dit (la promesse de transparence des deux horloges, jamais effacée) : l’offre vélo — le numérateur du ratio — sur l’horloge fraîche du jeu Geovelo « Aménagements cyclables » (snapshots mensuels), le réseau routier — le dénominateur du « X % de l’infrastructure routière » — sur l’horloge lente de l’extrait OpenStreetMap. Le ratio est limité par sa plus lente horloge : la source de référence est l’extrait OpenStreetMap, jamais le snapshot Geovelo frais — le décalage entre les deux est un fait de première classe, jamais dissimulé.',
      entrees: [
        {
          donnee:
            'L’offre vélo — le numérateur du ratio (le jeu Geovelo « Aménagements cyclables »)',
          frequence: 'mensuelle — un snapshot du jeu publié chaque mois',
          reference: 'snapshot 2026-08 (la date du fichier épinglé par le pipeline)',
        },
        {
          donnee:
            'Le réseau routier — le dénominateur du ratio (l’extrait OpenStreetMap de Bretagne)',
          frequence:
            'l’extrait est reconstruit chaque jour, mais le pipeline le fige sur un rythme lent',
          reference: 'extrait du 5 août 2026',
        },
      ],
      declencheur:
        'La figure se recalcule quand l’une des deux horloges bouge, mais le vintage publié est celui de sa source de référence — la plus lente : l’extrait OpenStreetMap (le dénominateur routier). Le ratio ne prétend jamais être plus frais que son dénominateur, même quand l’offre vélo Geovelo est plus récente.',
    },
  },

  // ---- Milieux (docs/themes/milieux.md, ADR-0014 + ADR-0017) ----
  // L'axe terre du cinquième thème : l'INTENSITÉ ÉTAT (l'état artificialisé par
  // habitant aux deux millésimes OCS-GE, #239) et la série annuelle CONSOENAF
  // (le seul signal annuel, conservé) — puis l'Histoire unique « Se densifier,
  // s'étaler, ou s'en aller » (#174, pivotée #238) avec ses quatre lectures et
  // le fait de première classe des TROIS HORLOGES (la promesse de transparence
  // étendue par ADR-0017 : la population, l'état OCS-GE, le flux annuel — la
  // règle des deux horloges d'ADR-0014, jamais effacée).
  milieux: {
    indicateurs: {
      artif_par_habitant: {
        label: 'Intensité état',
        definition:
          'La surface artificialisée par habitant, aux deux millésimes OCS-GE de la fenêtre du territoire (M2 puis M3), en mètres carrés par habitant — un ÉTAT, jamais un flux : la part de terre artificialisée rapportée à la population, à chaque date. Le dénominateur est la population du recensement qui BORNE l\u2019état (RP 2017 pour l\u2019état initial, RP 2023 pour l\u2019état final — jamais interpolée) ; le numérateur est l\u2019état artificialisé de l\u2019IGN (OCS GE Artificialisation v2.0, la référence officielle ZAN). Défini pour TOUT territoire — une commune qui se vide comme une commune qui grandit : l\u2019intensité par habitant ne connaît pas le trou des habitants ajoutés. Le classement se lit tel quel : déjà par habitant, aucune normalisation de surface. Les deux lignes (M2, M3) partagent le rang de l\u2019état final. Approximation documentée : l\u2019état initial M2 des départements 22, 29 et 56 intègre le patch correctif officiel de l\u2019IGN — les anomalies qu\u2019il recense (~20 % de ses polygones inversent le statut artificiel) sont appliquées au niveau matrice sur les polygones concernés ; le 35 n\u2019a pas de patch.',
        unite: 'm²/hab',
        // Le jeu (ADR-0022 : le nom du jeu sur l'en-tête ; le sourceId pointe la
        // ligne vintage exacte — l'état M3 du département 22)
        source: 'IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération)',
        sourceId: 'ocsge_artificialisation_22_2025',
        direction: 'moins-est-mieux',
      },
      conso_enaf_annuel: {
        label: 'Consommation d\u2019ENAF \u2014 série annuelle',
        definition:
          'La consommation d\u2019espaces naturels, agricoles et forestiers, année par année depuis 2011 — une ligne par année (2011, 2012, \u2026 2024), en hectares, pour suivre l\u2019évolution du rythme de consommation du territoire. Le seul signal ANNUEL du thème : l\u2019état OCS-GE est triennal, cette série garde la fraîcheur d\u2019un flux chaque année. Le fichier Cerema distribue ces consommations en mètres carrés alors que son dictionnaire les annonce en hectares : le pipeline convertit explicitement (÷ 10 000) et le teste — la conversion n\u2019est jamais silencieusement trustée (docs/research/zan-rennes.md). La série partage le classement de la part de surface consommée du territoire ; le classement se lit à l\u2019envers : moins on consomme, c\u2019est mieux.',
        unite: 'ha',
        source:
          'Cerema \u2014 Consommation d\u2019espaces naturels, agricoles et forestiers (CONSOENAF) 2011-2025 : indicateurs communaux (Fichiers Fonciers) \u2014 le dictionnaire Cerema annonce les consommations \u00aben hectares \u00bb, le fichier les distribue en m\u00e8tres carr\u00e9s : le pipeline convertit explicitement (\u00f7 10 000) et le teste, jamais silencieusement (docs/research/zan-rennes.md)',
        sourceId: 'consoenaf',
        direction: 'moins-est-mieux',
      },
      trajectoire_artif_par_habitant: {
        label: 'Trajectoire par habitant',
        definition:
          'La valeur que la lecture « Se densifier, s\u2019\u00e9taler, ou s\u2019en aller » rend : le rapport entre l\u2019\u00e9tat artificialis\u00e9 par habitant \u00e0 l\u2019\u00e9tat final et \u00e0 l\u2019\u00e9tat initial (M3/M2, les mill\u00e9simes OCS-GE du territoire). Un rapport inf\u00e9rieur \u00e0 1 signale une pression fonci\u00e8re par personne qui s\u2019all\u00e8ge \u2014 la densification ; sup\u00e9rieur \u00e0 1, l\u2019\u00e9talement. Le classement se lit \u00e0 l\u2019envers : une trajectoire qui baisse, c\u2019est mieux.',
        unite: '',
        source: 'IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération)',
        sourceId: 'ocsge_artificialisation_22_2025',
        direction: 'moins-est-mieux',
      },
    },
    stories: [
      {
        clef: 'se-densifier-setaler-ou-sen-aller',
        titre: 'Se densifier, s\u2019\u00e9taler, ou s\u2019en aller',
        statut: 'publiee',
        definition:
          'La Story du thème Milieux, la seule : elle lit le territoire contre sa terre — la variation de population contre la TRAJECTOIRE PAR HABITANT, le ratio M3/M2 de la surface artificialisée par habitant (les états OCS-GE, pivot #238, ADR-0017). La force population est lue comme un TAUX ANNUEL MOYEN pour 1 000 habitants (‰/an) — le registre Démographie, la même convention INSEE que taux_solde_naturel (l\u2019amendement #306 d\u2019ADR-0017 : jamais la variation brute, jamais un absolu annualisé) ; la durée dérive des deux millésimes de la série, le compte brut reste cité dans le prose. La population vient de la série historique du recensement (la règle de source : jamais les champs embarqués d\u2019un autre jeu), sur la fenêtre dérivée des millésimes RP (2017-2023 aujourd\u2019hui — elle glisse quand l\u2019INSEE publie). L\u2019état vient de l\u2019IGN (OCS GE Artificialisation v2.0), sur la fenêtre des millésimes OCS-GE du territoire (le couple de SON département — le span pour un EPCI transfrontalier, jamais caché). Chaque territoire lit exactement une des quatre lectures, par le signe seul de chaque force (seuil 0, la règle des quadrants d\u2019ADR-0011). Le bloc est fondé sur les notes de recherche docs/research/zan-rennes.md et docs/research/ocs-ge.md.',
        lectures: [
          {
            clef: 'grandir-en-se-densifiant',
            nom: 'Grandir en se densifiant',
            lecture:
              'La population augmente et la surface artificialisée par habitant diminue — la population grandit plus vite que la terre artificialisée : le territoire se densifie.',
          },
          {
            clef: 'grandir-en-setalant',
            nom: 'Grandir en s\u2019\u00e9talant',
            lecture:
              'La population augmente et la surface artificialisée par habitant augmente — la terre artificialisée grandit plus vite que la population : la croissance s\u2019étale.',
          },
          {
            clef: 'sen-aller-et-consommer-quand-meme',
            nom: 'S\u2019en aller, et consommer quand m\u00eame',
            lecture:
              'La population diminue et la surface artificialisée par habitant augmente — la pression foncière par personne continue de grimper : le territoire se vide, et consomme quand même.',
          },
          {
            clef: 'les-departs-laissent-la-place-a-la-renaturation',
            nom: 'Les d\u00e9parts laissent la place \u00e0 la renaturation',
            lecture:
              'La population diminue et la surface artificialisée par habitant diminue — la terre artificialisée a réellement SHRINKÉ (l\u2019état final est inférieur à l\u2019état initial) : la désartificialisation est mesurée, jamais une hypothèse.',
          },
        ],
      },
    ],
    deuxHorloges: {
      consommation:
        'Le thème porte TROIS horloges, et le dit (la promesse de transparence étendue par ADR-0017, la règle des deux horloges d\u2019ADR-0014 jamais effacée) : la population (la fenêtre de la Story), l\u2019état OCS-GE (la fenêtre des états du territoire) et le flux annuel CONSOENAF (la série, délibérément plus fraîche).',
      entrees: [
        {
          donnee: 'La population — la fenêtre de la Story',
          frequence:
            'au rythme des recensements — les millésimes de la série historique',
          reference: 'RP 2017 et 2023 (la fenêtre 2017-2023, dérivée, jamais codée en dur)',
        },
        {
          donnee: 'L\u2019état artificialisé — les millésimes OCS-GE',
          frequence: 'triennal — au rythme des prises de vue aériennes de l\u2019IGN',
          reference:
            'le couple M2\u2192M3 du département (22 : 2021\u21922025 \u00b7 29 : 2021\u21922024 \u00b7 35 : 2020\u21922023 \u00b7 56 : 2022\u21922024 — le span pour un EPCI transfrontalier)',
        },
        {
          donnee: 'La consommation d\u2019ENAF — la série annuelle',
          frequence: 'annuelle — le jeu CONSOENAF est mis à jour chaque année',
          reference: 'CONSOENAF 2011-2025 (COG 2025)',
        },
      ],
      declencheur:
        'Quand l\u2019INSEE publie un nouveau recensement dans la série historique, la fenêtre de la Story glisse ; quand l\u2019IGN publie un nouveau millésime OCS-GE, la fenêtre des états glisse ; la série annuelle, elle, suit simplement l\u2019horloge CONSOENAF. Chaque horloge est nommée sur la fiche, jamais les trois confondues.',
    },
  },
}

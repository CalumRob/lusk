/**
 * Le registre Méthodes de l'élément Programmes & financements (issue #180,
 * CONTEXT.md → Méthodes, docs/themes/README.md §The Méthodes contract). Un
 * registre typé : par id de source → les faits éditoriaux ET la fraîcheur que
 * le pipeline ingère réellement — les six sources du manifeste complet du
 * thème (MANIFEST_PROGRAMMES_COMPLET : les cinq jeux ANCT/DGALN du manifeste
 * #175 + l'export SCDL des subventions #176). Les valeurs documentées ici
 * (URL, format, licence, version, dates, fraîcheur) sont celles des fragments
 * de manifeste (pipeline/R/manifest_programmes.R, pipeline/R/subventions.R) —
 * jamais inventées. Le vocabulaire des badges (sigle → nom français) est la
 * moitié « affichage » de l'élément (fiche/apercu.ts, ADR-0013) ; les trois
 * sortes de couverture et la règle du badge ORT sont le modèle de CONTEXT.md.
 *
 * La langue est publique : jamais de gates, de noms de code, de noms
 * d'artefacts (la discipline de methodes-indicateurs.spec.ts).
 */

import type { SigleProgramme } from '@/payload/types'

/** Une source de l'élément Programmes & financements — ce que le pipeline ingère. */
export interface SourceProgramme {
  /** Le nom d'affichage de la source (le fragment de manifeste du pipeline). */
  nom: string
  /** L'éditeur / producteur de la donnée. */
  editeur: string
  /** L'URL publique du jeu de données — jamais inventée (le fragment de manifeste). */
  url: string
  /** Le format du fichier ingéré (CSV — ou XLSX pour l'ORT, la ressource CSV étant cassée). */
  format: 'CSV' | 'XLSX'
  /** La licence de la donnée (Licence Ouverte 2.0 pour les six sources). */
  licence: string
  /** La version / le millésime du fragment de manifeste. */
  version: string
  /** La date de référence ISO (le COG pour les jeux ANCT) — null pour l'ORT (fraîcheur par ligne). */
  dateReference: string | null
  /** La date de publication ISO (la mise en ligne du fichier) — null pour l'ORT (jamais la métadonnée de page). */
  datePublication: string | null
  /** La fraîcheur, en français public — la règle du pipeline, jamais un mot interne. */
  fraicheur: string
  /** La note éditoriale — ce que la source porte, en français public. */
  note: string
}

/**
 * Le registre complet des sources de l'élément — une entrée par source, indexée
 * par l'id exact du manifeste du pipeline. Ordre du registre = ordre
 * d'affichage de la section (les deux labels ANCT, les deux contrats, l'outil
 * ORT, puis la source des subventions — l'ordre du manifeste concaténé).
 */
export const SOURCES_PROGRAMMES: Record<string, SourceProgramme> = {
  // ---- Les labels, ancrés à la commune (manifest_programmes.R) ----
  acv: {
    nom: 'ANCT — Programme Action cœur de ville : liste des communes sélectionnées (COG 2025)',
    editeur: 'ANCT',
    url: 'https://static.data.gouv.fr/resources/programme-action-coeur-de-ville/20250924-154200/liste-acv-com2025-20250704.csv',
    format: 'CSV',
    licence: 'Licence Ouverte 2.0',
    version: '2025',
    dateReference: '2025-01-01',
    datePublication: '2025-09-24',
    fraicheur: 'Mise à jour du jeu de données : 24 septembre 2025',
    note: 'Le label Action cœur de ville : la liste officielle des communes lauréates, au grain de la commune (le fichier « Liste des communes bénéficiaires (COG 2025) » du jeu ANCT sur data.gouv.fr). Le badge est ancré à la commune — 11 villes bretonnes (Lannion, Saint-Brieuc, Morlaix, Quimper, Fougères, Redon, Saint-Malo, Vitré, Lorient, Pontivy, Vannes).',
  },
  pvd: {
    nom: 'ANCT — Programme Petites villes de demain : liste des communes sélectionnées (COG 2025)',
    editeur: 'ANCT',
    url: 'https://static.data.gouv.fr/resources/programme-petites-villes-de-demain/20260427-160836/liste-pvd-com2025-20260427.csv',
    format: 'CSV',
    licence: 'Licence Ouverte 2.0',
    version: '2025',
    dateReference: '2025-01-01',
    datePublication: '2026-04-27',
    fraicheur: 'Mise à jour du jeu de données : 27 avril 2026',
    note: 'Le label Petites villes de demain : la liste officielle des communes lauréates, au grain de la commune (le fichier « Liste des communes bénéficiaires (COG 2025) » du jeu ANCT sur data.gouv.fr). Le badge est ancré à la commune — 135 communes bretonnes (le même compte dans les deux sources ANCT).',
  },

  // ---- Les contrats, ancrés à l'EPCI signataire (manifest_programmes.R) ----
  crte: {
    nom: 'ANCT — Contrat de relance et de transition écologique : suivi du périmètre (COG 2025), les groupements couverts par CRTE',
    editeur: 'ANCT',
    url: 'https://static.data.gouv.fr/resources/contrat-de-relance-et-de-transition-ecologique/20250924-161900/liste-crte-grpt2025-20250717.csv',
    format: 'CSV',
    licence: 'Licence Ouverte 2.0',
    version: '2025',
    dateReference: '2025-07-17',
    datePublication: '2025-09-24',
    fraicheur: 'Mise à jour du jeu de données : 24 septembre 2025',
    note: 'Le contrat de relance et de transition écologique : le fichier « Suivi du périmètre (COG 2025) » du jeu ANCT, qui recense les groupements couverts par chaque contrat — le grain signataire : les EPCI porteurs. Le badge est ancré aux seules lignes EPCI du fichier (une commune qui signe individuellement n\u2019engage pas son EPCI) — 40 contrats bretons.',
  },
  territoires_industrie: {
    nom: 'ANCT/Banque des Territoires — liste des Territoires d\u2019industrie et des communes concernées (les territoires arrêtés fin 2022)',
    editeur: 'ANCT / Banque des Territoires',
    url: 'https://opendata.caissedesdepots.fr/api/explore/v2.1/catalog/datasets/liste-des-territoires-dindustrie-et-des-communes-concernees/exports/csv?use_labels=true',
    format: 'CSV',
    licence: 'Licence Ouverte 2.0',
    version: '2022',
    dateReference: '2022-12-31',
    datePublication: '2025-09-30',
    fraicheur: 'Mise à jour du jeu de données : 30 septembre 2025',
    note: 'Le badge contractuel Territoires d\u2019industrie : les territoires labellisés et les EPCI qu\u2019ils regroupent (le jeu de la Banque des Territoires, moissonné sur data.gouv.fr). Le badge est ancré à l\u2019EPCI — 10 territoires bretons, 32 EPCI.',
  },

  // ---- L'outil ORT, ancré à la commune ET à l'EPCI (manifest_programmes.R) ----
  ort: {
    nom: 'DGALN/ANCT — Liste des communes couvertes par des opérations de revitalisation de territoire (ORT) : conventions signées (classeur XLSX, feuille « Suivi conventions »)',
    editeur: 'DGALN / ANCT',
    url: 'https://grist.numerique.gouv.fr/o/dgaln/api/docs/j4i9oKD3jzFtgEUuM9sXnL/download/xlsx?',
    format: 'XLSX',
    licence: 'Licence Ouverte 2.0',
    version: 'en continu',
    dateReference: null,
    datePublication: null,
    fraicheur: 'Actualisation par ligne : chaque convention porte sa propre date (« Dernière actualisation » du classeur) — la métadonnée de page, périmée, n\u2019est jamais citée',
    note: 'L\u2019outil ORT (opération de revitalisation de territoire) : les communes couvertes par une convention signée (statut « Signée » uniquement — jamais « Terminée » ni « Non signée »). La ressource est le classeur XLSX du jeu DGALN/ANCT (la ressource CSV du même jeu sert un sous-ensemble Lot-et-Garonne cassé, jamais une base). Le badge est ancré à la commune ET à l\u2019EPCI.',
  },

  // ---- Les subventions de la Région, l'export SCDL (subventions.R) ----
  subventions_scdl: {
    nom: 'Région Bretagne — subventions attribuées (SCDL), subventions_attribuees_scdl0 (data.bretagne.bzh, rafraîchi chaque semaine)',
    editeur: 'Région Bretagne',
    url: 'https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/subventions_attribuees_scdl0/exports/csv?limit=-1&timezone=UTC&use_labels=false&delimiter=%3B',
    format: 'CSV',
    licence: 'Licence Ouverte 2.0',
    version: '2026-08-05',
    dateReference: '2026-08-05',
    datePublication: '2026-08-05',
    fraicheur: 'Rafraîchi chaque semaine (l\u2019export hebdomadaire de la Région — le vintage verrouillé du contrat)',
    note: 'La moitié « subventions » de l\u2019élément : l\u2019export SCDL des subventions attribuées par la Région (une ligne = une décision de subvention, jamais un versement ; montant total décidé). L\u2019élément montre les montants attribués aux territoires bretons, au cadrage de l\u2019année de décision complète la plus récente.',
  },
}

/**
 * Le vocabulaire des badges — le sigle affiché et son nom complet (ADR-0013 :
 * la moitié « affichage » reste dans l'app, fiche/apercu.ts). Les sigles sont
 * ceux du contrat payload (SIGLES_PROGRAMMES) ; « Territoires d'industrie »
 * est le sigle provisoire — le programme est officiellement nommé sans
 * acronyme (PRD #162).
 */
export const VOCABULAIRE_PROGRAMMES: Record<SigleProgramme, string> = {
  ACV: 'Action Cœur de Ville',
  PVD: 'Petites Villes de Demain',
  CRTE: 'Contrat de Relance et de Transition Écologique',
  "Territoires d'industrie": "Territoires d'industrie",
  ORT: 'Opération de revitalisation de territoire',
}

/** Une sorte de couverture de l'élément — comment un programme atteint la fiche. */
export interface CouvertureProgramme {
  /** Le titre de la couverture, en français public. */
  titre: string
  /** Ce que la couverture signifie, factuellement. */
  texte: string
  /** Les sigles concernés par cette couverture. */
  sigles: SigleProgramme[]
}

/**
 * Les trois sortes de couverture de l'élément (CONTEXT.md → Programmes &
 * financements, ADR-0013) : les contrats EPCI couvrent leurs communes membres,
 * les labels remontent en portage nommé, le département et la région comptent —
 * les verbes ne sur-vendent jamais l'ancre.
 */
export const COUVERTURES_PROGRAMMES: CouvertureProgramme[] = [
  {
    titre: 'Les contrats couvrent leurs communes membres',
    texte: 'Un contrat signé par un EPCI (CRTE, Territoires d\u2019industrie) s\u2019affiche sur la fiche de l\u2019EPCI signataire et couvre ses communes membres — la couverture descend du contrat vers les communes, jamais l\u2019inverse.',
    sigles: ['CRTE', "Territoires d'industrie"],
  },
  {
    titre: 'Les labels remontent en portage nommé',
    texte: 'Un label porté par une commune (ACV, PVD) s\u2019affiche sur la fiche de la commune lauréate et remonte sur la fiche de son EPCI en portage nommé — chaque commune labellisée est citée par son nom, la liste complète et déroulable, jamais tronquée.',
    sigles: ['ACV', 'PVD'],
  },
  {
    titre: 'Le département et la région comptent',
    texte: 'Au niveau du département et de la région, l\u2019élément agrège : les contrats signés avec leurs EPCI nommés, les communes labellisées nommées, la couverture ORT comptée, le total annuel des subventions — jamais un badge plat que le territoire n\u2019a pas signé.',
    sigles: ['ACV', 'PVD', 'CRTE', "Territoires d'industrie", 'ORT'],
  },
]

/**
 * La règle du badge ORT (CONTEXT.md → ORT, PRD #162) : badgé seulement là où
 * il ajoute de l'information — une commune labellisée ACV/PVD dont la
 * convention « vaut ORT » porte ce fait sur son label (le rider « convention
 * valant ORT »), jamais une seconde puce ORT. Le double badge est interdit.
 */
export const REGLE_BADGE_ORT =
  'Le badge ORT ne s\u2019affiche que là où il ajoute de l\u2019information : une commune ' +
  'labellisée ACV ou PVD dont la convention « vaut ORT » porte ce fait sur son ' +
  'label (le rider « convention valant ORT ») — jamais une seconde puce ORT. ' +
  'Le même territoire n\u2019est jamais doublement badgé pour la même convention.'

/**
 * La ligne « jamais les résultats » de l'élément (PRD #162, user story 15) :
 * l'élément montre l'adhésion aux programmes et les montants attribués — rien
 * ne prétend mesurer un résultat.
 */
export const LIGNE_JAMAIS_RESULTATS =
  'L\u2019élément montre l\u2019adhésion aux programmes et les montants attribués — jamais ' +
  'les résultats : un badge dit « couvert », un montant de subvention dit ' +
  '« attribué », rien ne prétend à un résultat.'

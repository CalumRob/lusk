import type { Theme } from '@/payload/types'
import type { IndicatorPageMetadata } from '@/payload/types'

export { CONTENU_SOUS_GROUPES_FICHE } from '@/fiche/content/ficheGrammar'

/** Stable product wording and organization for published indicator pages. */
export interface PageCatalogueContent {
  /** The producer resource key bound to this product page and its URL. */
  readonly resourceKey: string
  readonly label: string
  /** Renderer compatibility is app-owned; facts and native shape remain API-owned. */
  readonly figureFamily: IndicatorPageMetadata['family']
}

export interface SousGroupeCatalogueContent {
  readonly key: string
  readonly label: string
  readonly pages: readonly PageCatalogueContent[]
}

export interface ThemeCatalogueContent {
  readonly theme: Theme
  readonly label: string
  readonly sousGroupes: readonly SousGroupeCatalogueContent[]
}

/**
 * App-owned editorial content for the /indicateurs catalogue and its grouped
 * global-search entries. Resource keys bind page navigation to producer
 * identities; factual semantics and measurements remain producer/API-owned.
 */
export const CONTENU_CATALOGUE_INDICATEURS = [
  {
    theme: 'mobilite',
    label: 'Mobilité',
    sousGroupes: [
      {
        key: 'partage-de-lespace-public',
        label: 'Le partage de l’espace public',
        pages: [
          { resourceKey: 'reseaux', label: 'Réseaux à pied / vélo / voiture', figureFamily: 'list' },
          { resourceKey: 'reseaux_par_habitant', label: 'Longueur du réseau par habitant', figureFamily: 'list' },
          { resourceKey: 'surface_reseaux_routiers', label: 'Part du territoire consacré aux réseaux routiers', figureFamily: 'scalar' },
          { resourceKey: 'places_stationnement_velo_1000', label: 'Places de stationnement vélo pour 1 000 hab.', figureFamily: 'scalar' },
          { resourceKey: 'places_stationnement_voiture_1000', label: 'Places de stationnement voiture pour 1 000 hab.', figureFamily: 'scalar' },
          { resourceKey: 'stationnement_velo_par_voiture', label: 'Places de stationnement vélo pour 1 place voiture', figureFamily: 'scalar' },
          { resourceKey: 'offre_cyclable', label: 'L’offre cyclable', figureFamily: 'composition' },
        ],
      },
      {
        key: 'motorisation',
        label: 'La motorisation',
        pages: [
          { resourceKey: 'voitures_menage', label: 'Voitures par ménage', figureFamily: 'composition' },
          { resourceKey: 'bornes_recharge', label: 'Bornes de recharge pour véhicules électriques', figureFamily: 'scalar' },
          { resourceKey: 'bornes_ev_par_station_service', label: 'Bornes de recharge par station-service', figureFamily: 'scalar' },
        ],
      },
      {
        key: 'offre-transports-commun',
        label: 'L’offre de transports en commun',
        pages: [
          { resourceKey: 'offre_tc', label: 'Part des bâtiments près d’un arrêt (à 500 m)', figureFamily: 'scalar' },
          { resourceKey: 'raccordement_tc', label: 'Population bretonne joignable en 90 minutes en TC', figureFamily: 'scalar' },
          { resourceKey: 'raccordement_courbe', label: 'Courbe cumulative — population bretonne joignable en TC', figureFamily: 'trajectory' },
        ],
      },
    ],
  },
  {
    theme: 'demographie',
    label: 'Démographie',
    sousGroupes: [
      {
        key: 'etat-de-la-population',
        label: 'État de la population',
        pages: [
          { resourceKey: 'densite', label: 'Densité de population', figureFamily: 'scalar' },
          { resourceKey: 'structure_age', label: 'Structure par âge', figureFamily: 'pyramid' },
          { resourceKey: 'taille_menages', label: 'Taille moyenne des ménages', figureFamily: 'scalar' },
        ],
      },
      {
        key: 'trajectoire-demographique',
        label: 'Trajectoire démographique',
        pages: [
          { resourceKey: 'evolution_1968', label: 'Évolution de la population depuis 1968', figureFamily: 'scalar' },
        ],
      },
    ],
  },
  {
    theme: 'habitat',
    label: 'Habitat',
    sousGroupes: [
      {
        key: 'composition-du-parc',
        label: 'La composition du parc',
        pages: [
          { resourceKey: 'mix_logements', label: 'Mix de logements', figureFamily: 'composition' },
          { resourceKey: 'statut', label: 'Statut d’occupation', figureFamily: 'composition' },
          { resourceKey: 'type', label: 'Type de logement', figureFamily: 'composition' },
        ],
      },
      {
        key: 'etat-energetique-du-parc',
        label: 'L’état énergétique du parc',
        pages: [
          { resourceKey: 'distribution_dpe', label: 'Distribution des étiquettes DPE (A à G)', figureFamily: 'distribution' },
          { resourceKey: 'part_passoires', label: 'Part de passoires thermiques', figureFamily: 'scalar' },
          { resourceKey: 'age_du_bati', label: 'Âge du bâti', figureFamily: 'composition' },
        ],
      },
      {
        key: 'marche',
        label: 'Le marché',
        pages: [
          { resourceKey: 'prix_m2', label: 'Médiane prix au m²', figureFamily: 'trajectory' },
        ],
      },
    ],
  },
  {
    theme: 'economie',
    label: 'Économie/Emploi',
    sousGroupes: [
      {
        key: 'sante-et-taille',
        label: 'Santé et taille du tissu productif',
        pages: [
          { resourceKey: 'effectifs_salaries', label: 'Effectifs salariés (lieu de travail)', figureFamily: 'scalar' },
          { resourceKey: 'chomage', label: 'Chômage (population active)', figureFamily: 'scalar' },
        ],
      },
      {
        key: 'structure-verte',
        label: 'La structure verte',
        pages: [
          { resourceKey: 'eco_activites', label: 'Part des éco-activités', figureFamily: 'scalar' },
        ],
      },
    ],
  },
  {
    theme: 'milieux',
    label: 'Milieux',
    sousGroupes: [
      {
        key: 'artificialisation',
        label: 'L’artificialisation',
        pages: [
          { resourceKey: 'artif_par_habitant', label: 'Intensité état', figureFamily: 'trajectory' },
          { resourceKey: 'conso_enaf_annuel', label: 'Consommation d’ENAF — série annuelle', figureFamily: 'trajectory' },
        ],
      },
    ],
  },
  {
    theme: 'programmes',
    label: 'Programmes et subventions',
    sousGroupes: [
      {
        key: 'subventions',
        label: 'Subventions attribuées',
        pages: [
          { resourceKey: 'subventions_annuelles', label: 'Subventions régionales attribuées', figureFamily: 'scalar' },
          { resourceKey: 'subventions_par_domaine', label: 'Subventions régionales par domaine', figureFamily: 'list' },
        ],
      },
    ],
  },
] as const satisfies readonly ThemeCatalogueContent[]

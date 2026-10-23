import type { Theme } from '@/payload/types'

/** Stable product wording and organization for published indicator pages. */
export interface PageCatalogueContent {
  /** The producer resource key bound to this product page and its URL. */
  readonly resourceKey: string
  readonly label: string
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
          { resourceKey: 'reseaux', label: 'Réseaux à pied / vélo / voiture' },
          { resourceKey: 'reseaux_par_habitant', label: 'Longueur du réseau par habitant' },
          { resourceKey: 'surface_reseaux_routiers', label: 'Part du territoire consacré aux réseaux routiers' },
          { resourceKey: 'places_stationnement_velo_1000', label: 'Places de stationnement vélo pour 1 000 hab.' },
          { resourceKey: 'places_stationnement_voiture_1000', label: 'Places de stationnement voiture pour 1 000 hab.' },
          { resourceKey: 'stationnement_velo_par_voiture', label: 'Places de stationnement vélo pour 1 place voiture' },
          { resourceKey: 'offre_cyclable', label: 'L’offre cyclable' },
        ],
      },
      {
        key: 'motorisation',
        label: 'La motorisation',
        pages: [
          { resourceKey: 'voitures_menage', label: 'Voitures par ménage' },
          { resourceKey: 'bornes_recharge', label: 'Bornes de recharge pour véhicules électriques' },
          { resourceKey: 'bornes_ev_par_station_service', label: 'Bornes de recharge par station-service' },
        ],
      },
      {
        key: 'offre-transports-commun',
        label: 'L’offre de transports en commun',
        pages: [
          { resourceKey: 'offre_tc', label: 'Part des bâtiments près d’un arrêt (à 500 m)' },
          { resourceKey: 'raccordement_tc', label: 'Population bretonne joignable en 90 minutes en TC' },
          { resourceKey: 'raccordement_courbe', label: 'Courbe cumulative — population bretonne joignable en TC' },
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
          { resourceKey: 'densite', label: 'Densité de population' },
          { resourceKey: 'structure_age', label: 'Structure par âge' },
          { resourceKey: 'taille_menages', label: 'Taille moyenne des ménages' },
        ],
      },
      {
        key: 'trajectoire-demographique',
        label: 'Trajectoire démographique',
        pages: [
          { resourceKey: 'evolution_1968', label: 'Évolution de la population depuis 1968' },
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
          { resourceKey: 'mix_logements', label: 'Mix de logements' },
          { resourceKey: 'statut', label: 'Statut d’occupation' },
          { resourceKey: 'type', label: 'Type de logement' },
        ],
      },
      {
        key: 'etat-energetique-du-parc',
        label: 'L’état énergétique du parc',
        pages: [
          { resourceKey: 'distribution_dpe', label: 'Distribution des étiquettes DPE (A à G)' },
          { resourceKey: 'part_passoires', label: 'Part de passoires thermiques' },
          { resourceKey: 'age_du_bati', label: 'Âge du bâti' },
        ],
      },
      {
        key: 'marche',
        label: 'Le marché',
        pages: [
          { resourceKey: 'prix_m2', label: 'Médiane prix au m²' },
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
          { resourceKey: 'effectifs_salaries', label: 'Effectifs salariés (lieu de travail)' },
          { resourceKey: 'chomage', label: 'Chômage (population active)' },
        ],
      },
      {
        key: 'structure-verte',
        label: 'La structure verte',
        pages: [
          { resourceKey: 'eco_activites', label: 'Part des éco-activités' },
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
          { resourceKey: 'artif_par_habitant', label: 'Intensité état' },
          { resourceKey: 'conso_enaf_annuel', label: 'Consommation d’ENAF — série annuelle' },
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
          { resourceKey: 'subventions_annuelles', label: 'Subventions régionales attribuées' },
          { resourceKey: 'subventions_par_domaine', label: 'Subventions régionales par domaine' },
        ],
      },
    ],
  },
] as const satisfies readonly ThemeCatalogueContent[]

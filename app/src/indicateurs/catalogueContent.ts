import type { Theme } from '@/payload/types'
import type { IndicatorPageMetadata } from '@/payload/types'

export { CONTENU_SOUS_GROUPES_FICHE } from '@/fiche/content/ficheGrammar'

/** Stable app-owned page bindings and figure presentation for published indicators. */
export interface PageCatalogueContent {
  /** The producer resource key bound to this product page and its URL. */
  readonly resourceKey: string
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
 * App-owned page membership, organization, order and renderer compatibility.
 * Public resource labels come from the native discovery contract unless the
 * existing libellesAffichage layer supplies a fact-free editorial override.
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
          { resourceKey: 'reseaux', figureFamily: 'list' },
          { resourceKey: 'reseaux_par_habitant', figureFamily: 'list' },
          { resourceKey: 'surface_reseaux_routiers', figureFamily: 'scalar' },
          { resourceKey: 'places_stationnement_velo_1000', figureFamily: 'scalar' },
          { resourceKey: 'places_stationnement_voiture_1000', figureFamily: 'scalar' },
          { resourceKey: 'stationnement_velo_par_voiture', figureFamily: 'scalar' },
          { resourceKey: 'offre_cyclable', figureFamily: 'composition' },
        ],
      },
      {
        key: 'motorisation',
        label: 'La motorisation',
        pages: [
          { resourceKey: 'voitures_menage', figureFamily: 'composition' },
          { resourceKey: 'bornes_recharge', figureFamily: 'scalar' },
          { resourceKey: 'bornes_ev_par_station_service', figureFamily: 'scalar' },
          { resourceKey: 'stations_service', figureFamily: 'scalar' },
          { resourceKey: 'stations_service_1000', figureFamily: 'scalar' },
          { resourceKey: 'bornes_recharge_1000', figureFamily: 'scalar' },
        ],
      },
      {
        key: 'offre-transports-commun',
        label: 'L’offre de transports en commun',
        pages: [
          { resourceKey: 'offre_tc', figureFamily: 'scalar' },
          { resourceKey: 'raccordement_tc', figureFamily: 'scalar' },
          { resourceKey: 'raccordement_courbe', figureFamily: 'trajectory' },
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
          { resourceKey: 'densite', figureFamily: 'scalar' },
          { resourceKey: 'structure_age', figureFamily: 'pyramid' },
          { resourceKey: 'taille_menages', figureFamily: 'scalar' },
        ],
      },
      {
        key: 'trajectoire-demographique',
        label: 'Trajectoire démographique',
        pages: [
          { resourceKey: 'evolution_1968', figureFamily: 'scalar' },
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
          { resourceKey: 'mix_logements', figureFamily: 'composition' },
          { resourceKey: 'statut', figureFamily: 'composition' },
          { resourceKey: 'type', figureFamily: 'composition' },
        ],
      },
      {
        key: 'etat-energetique-du-parc',
        label: 'L’état énergétique du parc',
        pages: [
          { resourceKey: 'distribution_dpe', figureFamily: 'distribution' },
          { resourceKey: 'part_passoires', figureFamily: 'scalar' },
          { resourceKey: 'age_du_bati', figureFamily: 'composition' },
        ],
      },
      {
        key: 'marche',
        label: 'Le marché',
        pages: [
          { resourceKey: 'prix_m2', figureFamily: 'trajectory' },
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
          { resourceKey: 'effectifs_salaries', figureFamily: 'scalar' },
          { resourceKey: 'chomage', figureFamily: 'scalar' },
        ],
      },
      {
        key: 'structure-verte',
        label: 'La structure verte',
        pages: [
          { resourceKey: 'eco_activites', figureFamily: 'scalar' },
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
          { resourceKey: 'artif_par_habitant', figureFamily: 'trajectory' },
          { resourceKey: 'conso_enaf_annuel', figureFamily: 'trajectory' },
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
          { resourceKey: 'subventions_annuelles', figureFamily: 'scalar' },
          { resourceKey: 'subventions_par_domaine', figureFamily: 'list' },
        ],
      },
    ],
  },
] as const satisfies readonly ThemeCatalogueContent[]

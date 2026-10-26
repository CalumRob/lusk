import type { FamilleFigure, NoeudTexteRiche, Theme } from '@/payload/types'

/** App-owned display names shared by the fiche and Mobilité's semantic content. */
export const CONTENU_SOUS_GROUPES_FICHE = {
  mobilite: {
    'acces-aux-services': 'L’accès aux services',
    'partage-de-lespace-public': 'Le partage de l’espace public',
    motorisation: 'La motorisation',
    'offre-transports-commun': 'L’offre de transports en commun',
  },
} as const

export interface FicheReadingGrammar {
  /** Template text and its presentation order; the resolved row remains API-owned. */
  readonly template: readonly NoeudTexteRiche[]
  readonly params: readonly string[]
  readonly figure?: { readonly family: FamilleFigure; readonly indicator: string }
}

export interface FicheSubgroupGrammar {
  /** Structural binding to the producer's subgroup identity. */
  readonly key: string
  readonly label: string
  readonly framing: string
  /** Producer resource identities and their display order, not availability. */
  readonly indicators: readonly string[]
  readonly figure: { readonly family: FamilleFigure; readonly indicator: string }
  readonly reading?: FicheReadingGrammar
}

const texte = (content: string): NoeudTexteRiche => ({ type: 'text', content })
const param = (key: string): NoeudTexteRiche => ({ type: 'param', key })
const territoire: NoeudTexteRiche = { type: 'territoire' }
const strong = (key: string): NoeudTexteRiche => ({ type: 'strong', children: [param(key)] })
const sources: NoeudTexteRiche = {
  type: 'link',
  href: '/sources',
  children: [texte('Sources')],
}

/**
 * Stable presentation grammar for the shared fiche consumers. Resource keys
 * bind to producer rows; they do not promise a row, a measurement or a reading.
 * Theme metadata remains available to its unrelated factual/page/map readers.
 */
export const GRAMMAIRE_SOUS_GROUPES_FICHE = {
  mobilite: [
    {
      key: 'acces-aux-services',
      label: CONTENU_SOUS_GROUPES_FICHE.mobilite['acces-aux-services'],
      framing: 'Ce que les bâtiments de la commune peuvent atteindre à pied ou en transports en commun : les parts de bâtiments sans accès aux services essentiels.',
      indicators: [
        'tot_loss_t', 'tot_loss_b', 'iso_alimentation', 'iso_sante', 'iso_administration', 'iso_ecole', 'iso_banque',
        'share_food_t', 'share_food_b', 'share_food_c', 'share_health_t', 'share_health_b', 'share_health_c',
        'share_admin_t', 'share_admin_b', 'share_admin_c', 'share_school_t', 'share_school_b', 'share_school_c',
        'share_bank_t', 'share_bank_b', 'share_bank_c', 'avg_tot_car', 'avg_tot_b', 'avg_tot_t',
        'avg_div_car', 'avg_div_b', 'avg_div_t', 'nb_buildings',
      ],
      figure: { family: 'comparison-bars', indicator: 'iso_alimentation' },
      reading: {
        params: ['div_loss_t', 'div_loss_b', 'tot_loss_t', 'tot_loss_b', 'pct_iso_full_t', 'classification_saillance'],
        template: [
          texte('Sans voiture, '),
          param('div_loss_t'),
          texte(' types de services disparaissent de l’accès quotidien de '),
          territoire,
          texte('. '),
          sources,
        ],
      },
    },
    {
      key: 'partage-de-lespace-public',
      label: CONTENU_SOUS_GROUPES_FICHE.mobilite['partage-de-lespace-public'],
      framing: 'La place laissée aux vélos et à la voiture dans l’espace public : les réseaux, le stationnement vélo et l’offre cyclable.',
      indicators: [
        'reseaux', 'reseaux_par_habitant', 'surface_reseaux_routiers', 'places_stationnement_velo_1000',
        'places_stationnement_voiture_1000', 'stationnement_velo_par_voiture', 'offre_cyclable',
      ],
      // The shared compact renderer's specialized offer treatment is selected
      // by the scalar family; this remains app presentation, not producer policy.
      figure: { family: 'composition', indicator: 'offre_cyclable' },
    },
    {
      key: 'motorisation',
      label: CONTENU_SOUS_GROUPES_FICHE.mobilite.motorisation,
      framing: 'L’équipement automobile des ménages et les bornes de recharge pour véhicules électriques.',
      indicators: ['voitures_menage', 'bornes_recharge', 'bornes_ev_par_station_service'],
      figure: { family: 'composition', indicator: 'voitures_menage' },
    },
    {
      key: 'offre-transports-commun',
      label: CONTENU_SOUS_GROUPES_FICHE.mobilite['offre-transports-commun'],
      framing: 'La part des bâtiments à moins de 500 mètres d’un arrêt, et le raccordement du territoire au réseau : la population bretonne joignable en 90 minutes en train, en car ou en bus, de mairie à mairie.',
      indicators: ['offre_tc', 'raccordement_tc', 'raccordement_courbe', 'raccordement_reference'],
      figure: { family: 'scalar', indicator: 'offre_tc' },
    },
  ],
  demographie: [
    {
      key: 'etat-de-la-population',
      label: 'État de la population',
      framing: 'La population de la commune : sa taille, sa densité et la structure de ses ménages.',
      indicators: ['densite', 'structure_age', 'taille_menages'],
      figure: { family: 'pyramid', indicator: 'structure_age' },
    },
    {
      key: 'trajectoire-demographique',
      label: 'Trajectoire démographique',
      framing: "L'évolution de la population depuis 1968 et les deux forces qui la portent : le solde naturel et le solde migratoire.",
      indicators: ['evolution_1968'],
      figure: { family: 'scalar', indicator: 'evolution_1968' },
      reading: {
        params: ['periode', 'taux_solde_naturel', 'taux_solde_migratoire', 'classification'],
        template: [
          texte('Entre '), param('periode'), texte(', la population de '), territoire, texte(' '),
          strong('classification'), texte(' : '), param('taux_solde_naturel'), texte(' par an (naturel), '),
          param('taux_solde_migratoire'), texte(' (migratoire). '), sources,
        ],
      },
    },
  ],
  habitat: [
    {
      key: 'composition-du-parc',
      label: 'La composition du parc',
      framing: "La composition du parc de logements de la commune : le mix, le statut d'occupation et le type.",
      indicators: ['mix_logements', 'statut', 'type'],
      figure: { family: 'composition', indicator: 'mix_logements' },
    },
    {
      key: 'etat-energetique-du-parc',
      label: 'L’état énergétique du parc',
      framing: 'L’état énergétique du parc : la distribution des étiquettes DPE, la part de passoires thermiques et l’âge du bâti.',
      indicators: ['distribution_dpe', 'part_passoires', 'age_du_bati'],
      figure: { family: 'composition', indicator: 'distribution_dpe' },
      reading: {
        params: ['classification', 'part_passoires', 'part_abc', 'n_dpe'],
        template: [
          texte('Le parc de '), territoire, texte(' est '), strong('classification'), texte(' : '),
          param('part_passoires'), texte(' de passoires thermiques. '), sources,
        ],
      },
    },
    {
      key: 'marche',
      label: 'Le marché',
      framing: 'Le marché immobilier de la commune : la médiane du prix au m² des ventes.',
      indicators: ['prix_m2'],
      figure: { family: 'trajectory', indicator: 'prix_m2' },
    },
  ],
  economie: [
    {
      key: 'sante-et-taille',
      label: 'Santé et taille du tissu productif',
      framing: "La santé du tissu productif local : l'emploi salarié au lieu de travail et le chômage au sens du recensement.",
      indicators: ['effectifs_salaries', 'chomage'],
      figure: { family: 'scalar', indicator: 'effectifs_salaries' },
      reading: {
        params: ['rang', 'activity_label', 'lq', 'n'],
        figure: { family: 'list', indicator: 'lq' },
        template: [
          texte('La commune se spécialise dans '),
          strong('activity_label'),
          texte(' (rang '), param('rang'), texte(' du top 5). '), sources,
        ],
      },
    },
    {
      key: 'structure-verte',
      label: 'La structure verte',
      framing: 'La place des établissements verts dans le tissu productif.',
      indicators: ['eco_activites'],
      figure: { family: 'scalar', indicator: 'eco_activites' },
    },
  ],
  milieux: [
    {
      key: 'artificialisation',
      label: 'L’artificialisation',
      framing: 'La consommation de la terre par l’urbanisation : l’état artificialisé et le flux annuel.',
      indicators: ['artif_par_habitant', 'conso_enaf_annuel'],
      figure: { family: 'comparison-bars', indicator: 'artif_par_habitant' },
      reading: {
        params: ['periode_pop', 'periode_artif', 'delta_population', 'trajectoire_artif_par_habitant', 'classification'],
        template: [
          texte('Entre '), param('periode_pop'), texte(' et '), param('periode_artif'), texte(', '),
          territoire, texte(' '), strong('classification'), texte(' (trajectoire '),
          param('trajectoire_artif_par_habitant'), texte(' par habitant). '), sources,
        ],
      },
    },
  ],
  programmes: [
    {
      key: 'couverture',
      label: 'Programmes et contrats',
      framing: "Les programmes de l'État et les outils juridiques qui couvrent le territoire : labels communaux, contrats intercommunaux et convention ORT — des faits d'action publique, jamais des résultats.",
      indicators: ['couverture_programmes'],
      figure: { family: 'list', indicator: 'couverture_programmes' },
    },
    {
      key: 'subventions',
      label: 'Subventions attribuées',
      framing: 'Les subventions attribuées par la Région Bretagne au territoire : le total annuel partout, la ventilation par domaine sur les fiches communales.',
      indicators: ['subventions_annuelles', 'subventions_par_domaine'],
      figure: { family: 'scalar', indicator: 'subventions_annuelles' },
    },
  ],
} satisfies Readonly<Record<Theme, readonly FicheSubgroupGrammar[]>>

export function sousGroupesFiche(theme: Theme): readonly FicheSubgroupGrammar[] {
  return GRAMMAIRE_SOUS_GROUPES_FICHE[theme]
}

export function sousGroupeFiche(theme: Theme, key: string): FicheSubgroupGrammar | undefined {
  return sousGroupesFiche(theme).find((subgroup) => subgroup.key === key)
}

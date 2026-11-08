import type { FamilleFigure, NoeudTexteRiche, Theme, ThemeMetadata } from '@/payload/types'

/** Stable app labels for producer-declared axis kinds; unknown kinds stay neutral. */
const LIBELLES_AXE_NATIF: Readonly<Record<string, string>> = {
  year: 'Année',
  duration_minute: 'Temps de trajet (minutes)',
  state_role: 'État',
  declared_detail: 'Détail',
}

export function libelleAxeNatif(axisKind: string | undefined): string {
  return axisKind ? LIBELLES_AXE_NATIF[axisKind] ?? 'Coordonnée' : 'Coordonnée'
}

/**
 * App-owned display names shared by the fiche and Mobilité's semantic content.
 * Stable presentation copy — the facts it describes remain producer-owned.
 */
export const CONTENU_SOUS_GROUPES_FICHE = {
  mobilite: {
    'acces-aux-services': 'L’accès aux services',
    'partage-de-lespace-public': 'Le partage de l’espace public',
    motorisation: 'La motorisation',
    'offre-transports-commun': 'L’offre de transports en commun',
  },
} as const

/**
 * App-owned editorial framing per subgroup, keyed by the producer subgroup
 * identity. Wording and organisation only: no unit, threshold, axis, status or
 * availability claim is derived from it. A subgroup whose wording carries
 * producer-owned facts (a measurement, observation boundary, category scope,
 * distance, duration or eligibility scope) keeps a
 * `null` here and resolves its clause from the verified producer subgroup
 * declaration instead — see `cadrageSousGroupeFiche`.
 */
export const CADRAGES_SOUS_GROUPES_FICHE = {
  mobilite: {
    // #627 - the acces-aux-services framing described the retired building-
    // share snapshot; the production AEDAR evidence owns the unit's copy.
    'acces-aux-services': null,
    'partage-de-lespace-public': 'La place laissée aux vélos et à la voiture dans l’espace public : les réseaux, le stationnement vélo et l’offre cyclable.',
    motorisation: 'L’équipement automobile des ménages et les bornes de recharge pour véhicules électriques.',
    // Factual: the 500 m catchment and the 90-minute transit reach are producer thresholds.
    'offre-transports-commun': null,
  },
  demographie: {
    'etat-de-la-population': 'La population de la commune : sa taille, sa densité et la structure de ses ménages.',
    // The observation start year is producer-owned; keep the mixed clause
    // attached to the verified subgroup declaration rather than freezing it.
    'trajectoire-demographique': null,
  },
  habitat: {
    'composition-du-parc': "La composition du parc de logements de la commune : le mix, le statut d'occupation et le type.",
    'etat-energetique-du-parc': 'L’état énergétique du parc : la distribution des étiquettes DPE, la part de passoires thermiques et l’âge du bâti.',
    // Factual: the statistic and its price-per-square-metre unit are producer-owned.
    marche: null,
  },
  economie: {
    // Factual: workplace location and the census definition are producer-owned.
    'sante-et-taille': null,
    'structure-verte': 'La place des établissements verts dans le tissu productif.',
  },
  milieux: {
    artificialisation: 'La consommation de la terre par l’urbanisation : l’état artificialisé et le flux annuel.',
  },
  programmes: {
    couverture: "Les programmes de l'État et les outils juridiques qui couvrent le territoire : labels communaux, contrats intercommunaux et convention ORT — des faits d'action publique, jamais des résultats.",
    // Factual: the annual total everywhere vs the per-domain breakdown on commune fiches is producer eligibility.
    subventions: null,
  },
} as const satisfies Readonly<Record<Theme, Readonly<Record<string, string | null>>>>

export interface FicheReadingGrammar {
  /** Template text and its presentation order; the resolved row remains API-owned. */
  readonly template: readonly NoeudTexteRiche[]
  readonly params: readonly string[]
  /** Field bindings chosen for map display, not a claim of available values.
   * Textual reading parameters need not be offered as choropleth choices. */
  readonly mapFields?: readonly string[]
  readonly figure?: { readonly family: FamilleFigure; readonly indicator: string }
}

export interface FicheSubgroupGrammar {
  /** Structural binding to the producer's subgroup identity. */
  readonly key: string
  readonly label: string
  /**
   * App-owned editorial framing. `null` = the clause carries producer-owned
   * facts and resolves from the verified producer subgroup declaration
   * (`cadrageSousGroupeFiche`); without verified metadata it stays withheld.
   */
  readonly framing: string | null
  /** Producer resource identities and their display order, not availability. */
  readonly indicators: readonly string[]
  /** The subgroup's compact figure; absent when the unit's evidence has no
   * published indicator figure (the AEDAR accessibility unit). */
  readonly figure?: { readonly family: FamilleFigure; readonly indicator: string }
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
      // #627 - structural identity only: the pagination and the production
      // AEDAR unit bind this key; the retired snapshot indicators, figure and
      // reading no longer exist in app grammar.
      key: 'acces-aux-services',
      label: CONTENU_SOUS_GROUPES_FICHE.mobilite['acces-aux-services'],
      framing: CADRAGES_SOUS_GROUPES_FICHE.mobilite['acces-aux-services'],
      indicators: [],
    },
    {
      key: 'partage-de-lespace-public',
      label: CONTENU_SOUS_GROUPES_FICHE.mobilite['partage-de-lespace-public'],
      framing: CADRAGES_SOUS_GROUPES_FICHE.mobilite['partage-de-lespace-public'],
      indicators: [
        'reseaux', 'reseaux_par_habitant', 'surface_reseaux_routiers', 'places_stationnement_velo_1000',
        'places_stationnement_voiture_1000', 'stationnement_velo_par_voiture', 'offre_cyclable',
      ],
      figure: { family: 'composition', indicator: 'offre_cyclable' },
    },
    {
      key: 'motorisation',
      label: CONTENU_SOUS_GROUPES_FICHE.mobilite.motorisation,
      framing: CADRAGES_SOUS_GROUPES_FICHE.mobilite['motorisation'],
      indicators: ['voitures_menage', 'bornes_recharge', 'bornes_ev_par_station_service'],
      figure: { family: 'composition', indicator: 'voitures_menage' },
    },
    {
      key: 'offre-transports-commun',
      label: CONTENU_SOUS_GROUPES_FICHE.mobilite['offre-transports-commun'],
      framing: CADRAGES_SOUS_GROUPES_FICHE.mobilite['offre-transports-commun'],
      indicators: ['offre_tc', 'raccordement_tc', 'raccordement_courbe', 'raccordement_reference'],
      figure: { family: 'scalar', indicator: 'offre_tc' },
    },
  ],
  demographie: [
    {
      key: 'etat-de-la-population',
      label: 'État de la population',
      framing: CADRAGES_SOUS_GROUPES_FICHE.demographie['etat-de-la-population'],
      indicators: ['densite', 'structure_age', 'taille_menages'],
      figure: { family: 'pyramid', indicator: 'structure_age' },
    },
    {
      key: 'trajectoire-demographique',
      label: 'Trajectoire démographique',
      framing: CADRAGES_SOUS_GROUPES_FICHE.demographie['trajectoire-demographique'],
      indicators: ['evolution_1968'],
      figure: { family: 'scalar', indicator: 'evolution_1968' },
      reading: {
        params: ['periode', 'taux_solde_naturel', 'taux_solde_migratoire', 'classification'],
        mapFields: ['taux_solde_naturel', 'taux_solde_migratoire'],
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
      framing: CADRAGES_SOUS_GROUPES_FICHE.habitat['composition-du-parc'],
      indicators: ['mix_logements', 'statut', 'type'],
      figure: { family: 'composition', indicator: 'mix_logements' },
    },
    {
      key: 'etat-energetique-du-parc',
      label: 'L’état énergétique du parc',
      framing: CADRAGES_SOUS_GROUPES_FICHE.habitat['etat-energetique-du-parc'],
      indicators: ['distribution_dpe', 'part_passoires', 'age_du_bati'],
      figure: { family: 'composition', indicator: 'distribution_dpe' },
      reading: {
        params: ['classification', 'part_passoires', 'part_abc', 'n_dpe'],
        mapFields: ['part_passoires', 'part_abc', 'n_dpe'],
        template: [
          texte('Le parc de '), territoire, texte(' est '), strong('classification'), texte(' : '),
          param('part_passoires'), texte(' de passoires thermiques. '), sources,
        ],
      },
    },
    {
      key: 'marche',
      label: 'Le marché',
      framing: CADRAGES_SOUS_GROUPES_FICHE.habitat['marche'],
      indicators: ['prix_m2'],
      figure: { family: 'trajectory', indicator: 'prix_m2' },
    },
  ],
  economie: [
    {
      key: 'sante-et-taille',
      label: 'Santé et taille du tissu productif',
      framing: CADRAGES_SOUS_GROUPES_FICHE.economie['sante-et-taille'],
      indicators: ['effectifs_salaries', 'chomage'],
      figure: { family: 'scalar', indicator: 'effectifs_salaries' },
      reading: {
        params: ['rang', 'activity_label', 'lq', 'n'],
        // The parameter wording stays producer-owned (param_labels).
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
      framing: CADRAGES_SOUS_GROUPES_FICHE.economie['structure-verte'],
      indicators: ['eco_activites'],
      figure: { family: 'scalar', indicator: 'eco_activites' },
    },
  ],
  milieux: [
    {
      key: 'artificialisation',
      label: 'L’artificialisation',
      framing: CADRAGES_SOUS_GROUPES_FICHE.milieux['artificialisation'],
      indicators: ['artif_par_habitant', 'conso_enaf_annuel'],
      figure: { family: 'comparison-bars', indicator: 'artif_par_habitant' },
      reading: {
        params: ['periode_pop', 'periode_artif', 'delta_population', 'trajectoire_artif_par_habitant', 'classification'],
        mapFields: ['delta_population', 'trajectoire_artif_par_habitant'],
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
      framing: CADRAGES_SOUS_GROUPES_FICHE.programmes['couverture'],
      indicators: ['couverture_programmes'],
      figure: { family: 'list', indicator: 'couverture_programmes' },
    },
    {
      key: 'subventions',
      label: 'Subventions attribuées',
      framing: CADRAGES_SOUS_GROUPES_FICHE.programmes['subventions'],
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

/**
 * Carte's presentation-only projection of the shared fiche grammar. The keys
 * and order are candidates for layer display, not declarations of map
 * eligibility or fact availability; consumers still intersect them with the
 * verified producer/API resource and map contracts.
 */
export interface GroupeCouchesCarte {
  readonly key: string
  readonly label: string
  /** Map-display field choices; intersected with the native reading declaration. */
  readonly storyFields: readonly string[]
  /** Resource identities in fiche presentation order. */
  readonly resourceKeys: readonly string[]
}

export function groupesCouchesCarte(theme: Theme): readonly GroupeCouchesCarte[] {
  return sousGroupesFiche(theme).map((subgroup) => ({
    key: subgroup.key,
    label: subgroup.label,
    storyFields: [...(subgroup.reading?.mapFields ?? [])],
    resourceKeys: [...subgroup.indicators],
  }))
}

/**
 * Resolve a subgroup's framing. App-owned editorial framing is returned as is;
 * a `null` entry contains producer-owned measurement, observation, category or
 * eligibility facts and is read from the VERIFIED producer subgroup declaration
 * only — pending, unavailable or incompatible metadata withholds the explanation
 * instead of inventing or freezing a factual literal in app content.
 */
export function cadrageSousGroupeFiche(
  subgroup: FicheSubgroupGrammar,
  metadata?: ThemeMetadata,
): string | null {
  if (subgroup.framing !== null) return subgroup.framing
  return metadata?.subgroups.find((candidate) => candidate.key === subgroup.key)?.framing ?? null
}

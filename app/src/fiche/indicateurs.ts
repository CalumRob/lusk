/**
 * The fiche's indicator vocabulary — French labels for the standard indicator
 * keys and the structure_age tranche details. Product terms from CONTEXT.md
 * (indicateur, tranche d'âge). Later themes extend NOMS_INDICATEURS when
 * their block lands.
 */

import type { Theme } from '@/payload/types'

/** The indicator labels per theme — key → label (the fiche contract's figures). */
export const NOMS_INDICATEURS: Record<Theme, Record<string, string>> = {
  demographie: {
    densite: 'Densité de population',
    structure_age: 'Structure par âge',
    evolution_1968: 'Évolution de la population depuis 1968',
    taille_menages: 'Taille moyenne des ménages',
  },
  // Mobilité (issue #142, ADR-0012) : la « Taille », la grille d'isolation (les
  // 5 parts, cadrage « sans accès »), l'étage demande/réseaux et le sous-bloc.
  // La règle de vocabulaire du flagship : les libellés disent « à pied ou en
  // transports en commun », jamais « sans voiture » — le titre de la Story
  // « Vingt minutes sans voiture » est la seule exception sanctionnée.
  mobilite: {
    nb_buildings: 'Bâtiments résidentiels analysés',
    iso_alimentation: 'Part des bâtiments sans accès à l’alimentation (à pied ou en transports en commun)',
    iso_sante: 'Part des bâtiments sans accès à la santé (à pied ou en transports en commun)',
    iso_administration: 'Part des bâtiments sans accès aux services administratifs (à pied ou en transports en commun)',
    iso_ecole: 'Part des bâtiments sans accès à l’école (à pied ou en transports en commun)',
    iso_banque: 'Part des bâtiments sans accès à la banque (à pied ou en transports en commun)',
    voitures_menage: 'Voitures par ménage',
    reseaux: 'Réseaux à pied / vélo / voiture',
    offre_tc: 'Part des bâtiments près d’un arrêt (à 500 m)',
    bornes_recharge: 'Bornes de recharge pour véhicules électriques',
    places_stationnement_velo_1000: 'Places de stationnement vélo pour 1 000 hab.',
  },
  habitat: {},
  // Économie (issue #121, forme reshapée) : le bloc est 3 indicateurs — taille
  // (Flores A88), santé (concept censitaire) et verdure (approximation EGSS).
  // Jamais de LQ dans le bloc : le LQ est la Story (issue #120).
  economie: {
    effectifs_salaries: 'Effectifs salariés (lieu de travail)',
    chomage: 'Chômage (population active)',
    eco_activites: 'Part des éco-activités',
  },
}

/** The structure_age tranche labels (the pipeline's 7 tranches exhaustives). */
export const NOMS_TRANCHES_AGE: Record<string, string> = {
  '<15': 'Moins de 15 ans',
  '15-24': '15 à 24 ans',
  '25-39': '25 à 39 ans',
  '40-54': '40 à 54 ans',
  '55-64': '55 à 64 ans',
  '65-79': '65 à 79 ans',
  '80+': '80 ans et plus',
}

/**
 * The reseaux detail labels (issue #142) — the t/b/c modes × length/density.
 * The t-mode is foot/transit: the labels carry the sanctioned vocabulary
 * « à pied ou en transports en commun »; the modes wear the mode colors on
 * the figure (DESIGN.md §Modes — t/b/c).
 */
export const NOMS_DETAILS_RESEAUX: Record<string, string> = {
  t_longueur: 'Longueur — à pied ou en transports en commun',
  t_densite: 'Densité — à pied ou en transports en commun',
  b_longueur: 'Longueur — à vélo',
  b_densite: 'Densité — à vélo',
  c_longueur: 'Longueur — en voiture',
  c_densite: 'Densité — en voiture',
}

/** The voitures_menage detail labels (the two car-ownership parts, RP LOG T12). */
export const NOMS_DETAILS_VOITURES_MENAGE: Record<string, string> = {
  sans_voiture: 'Ménages sans voiture',
  deux_plus: 'Ménages avec 2 voitures ou plus',
}

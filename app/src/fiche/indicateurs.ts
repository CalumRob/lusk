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
  mobilite: {},
  habitat: {},
  economie: {},
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

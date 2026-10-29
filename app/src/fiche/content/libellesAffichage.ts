import type { Theme } from '@/payload/types'

/**
 * App-owned EDITORIAL display labels (#827) — ordinary French wording for a
 * resource, keyed to the real resource identity. This map deliberately carries
 * NO fact: no observation boundary or period, no threshold, unit or ratio
 * scale, no employment/unemployment definition, no age/year/time band, no
 * reference scope, no classification or domain vocabulary. Those labels stay
 * producer-owned and resolve from the native semantic contract (first) or the
 * existing verified producer declarations (`indicator_labels`), whose exact
 * readers are listed in the PR. A fact-bearing label must never be copied
 * here: it would freeze a producer fact in app content.
 */
export const LIBELLES_INDICATEURS_APP: Readonly<Record<Theme, Readonly<Record<string, string>>>> = {
  mobilite: {},
  demographie: {
    densite: 'Densité de population',
    structure_age: 'Structure par âge',
    taille_menages: 'Taille moyenne des ménages',
  },
  habitat: {
    mix_logements: 'Mix de logements',
    statut: 'Statut d’occupation',
    age_du_bati: 'Âge du bâti',
    type: 'Type de logement',
  },
  economie: {
    eco_activites: 'Part des éco-activités',
  },
  milieux: {},
  programmes: {
    couverture_programmes: 'Couverture programmatique',
  },
}

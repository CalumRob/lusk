import type { Theme } from '@/payload/types'

/**
 * App-owned EDITORIAL display labels (#827) — ordinary French wording for a
 * resource or one of its declared details, keyed to the real resource/detail
 * identities. This map deliberately carries NO fact: no threshold, unit or
 * ratio scale, no age/year/time band, no reference scope, no classification or
 * domain vocabulary. Those labels stay producer-owned and resolve from the
 * native semantic contract (first) or the existing verified producer
 * declarations (`indicator_labels` / `detail_labels` / `param_labels`), whose
 * exact readers are listed in the PR. A fact-bearing label must never be
 * copied here: it would freeze a producer fact in app content.
 */
export const LIBELLES_INDICATEURS_APP: Readonly<Record<Theme, Readonly<Record<string, string>>>> = {
  mobilite: {},
  demographie: {
    densite: 'Densité de population',
    structure_age: 'Structure par âge',
    evolution_1968: 'Évolution de la population depuis 1968',
    taille_menages: 'Taille moyenne des ménages',
  },
  habitat: {
    mix_logements: 'Mix de logements',
    statut: 'Statut d’occupation',
    age_du_bati: 'Âge du bâti',
    type: 'Type de logement',
  },
  economie: {
    effectifs_salaries: 'Effectifs salariés (lieu de travail)',
    chomage: 'Chômage (population active)',
    eco_activites: 'Part des éco-activités',
  },
  milieux: {},
  programmes: {
    couverture_programmes: 'Couverture programmatique',
  },
}

/** App-owned EDITORIAL detail labels, keyed by the resource then the detail value. */
export const LIBELLES_DETAILS_APP: Readonly<Record<Theme, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  mobilite: {},
  demographie: {},
  habitat: {
    mix_logements: {
      principales: 'Résidences principales',
      secondaires: 'Résidences secondaires',
      vacants: 'Logements vacants',
    },
    statut: {
      proprietaire: 'Propriétaires',
      hlm: 'Locataires HLM (parc social)',
      locataire_prive: 'Locataires du parc privé',
      loge_gratuit: 'Logés gratuitement',
    },
    type: {
      maison: 'Maisons',
      appartement: 'Appartements',
    },
  },
  economie: {},
  milieux: {},
  programmes: {},
}

/**
 * The indicator/story-scalar joins onto the territory masks — the map's KPI
 * plumbing (ADR-0008: « features carry the territoire code so the map joins
 * the fiche payload's KPIs »; ADR-0019: every number a fiche renders is a
 * layer — the story scalars join like the indicator rows). Pure functions:
 * rows in, features + paint expression out. The join is by territoire code; a
 * territory without a row keeps a null value (rendered in the neutral no-data
 * color, never invented).
 */

import type { ExpressionSpecification } from 'maplibre-gl'

import type { CollectionMasque, FeatureTerritoire, NiveauMasque } from '../geo/types'
import type { Indicateur, Payload, SigleProgramme, Theme } from '../payload/types'
import { formaterValeur } from '../payload/selectors'
import { typeAdhesionDuNiveau, typeSubventionsDuNiveau } from './programmesCouches'
import { COULEUR_NEUTRE } from './couleurs'

/** The MapLibre paint expression for a choropleth fill (step + null guard). */
export type ExpressionCouleurs = ExpressionSpecification

/** A feature enriched with the joined indicator (the fill + the popup read it). */
export interface FeatureAvecValeur extends FeatureTerritoire {
  properties: FeatureTerritoire['properties'] & {
    valeur: number | null
    valeur_formatee: string | null
  }
}

export interface CollectionAvecValeurs {
  type: 'FeatureCollection'
  features: FeatureAvecValeur[]
}

/** A joined value per territoire — the minimal shape the fill, the legend and
 *  the popup read. The story scalars carry no unit (the histoires table
 *  publishes none) : `unit` is '' there — the legend shows the number alone,
 *  never an invented unit. */
export interface ValeurLigne {
  value: number | null
  unit: string
}

/**
 * The rows that feed one choropleth: the theme's indicator with `detail ===
 * null` (one value per territory) — or, when `detail` is given (a grouped
 * multi-detail layer, ADR-0019), that detail's rows. Returns territoire → row.
 *
 * Issue #390 — the sex dimension: a sex-split indicator (structure_age) publishes
 * one row per (territoire × detail × sex). The carte stays GROUPED BY `key +
 * detail`, never by sex: the F **and** M rows of one age band collapse into ONE
 * territory value — their sum — keeping the shared rank / unit / vintage carried
 * by the indicator rows. A non-sex (legacy) detail has exactly one row per
 * territoire and passes through untouched.
 *
 * Malformed sex groups THROW rather than produce a number. Half a pyramid summed
 * into a choropleth is indistinguishable from a real value on screen: a band
 * with only F would paint a territory as if a third of its people did not exist.
 * So an incomplete ({F} or {M} alone), duplicated ({F, F}) or mixed
 * (sexed + unsexed) group is a contract violation, not a value. A group whose
 * shape is valid but whose share is unknown (a null value) yields `null` — the
 * neutral no-data colour — never a partial sum.
 */
export function indicateurParTerritoire(
  lignes: readonly Indicateur[],
  theme: Theme,
  indicateur: string,
  detail: string | null = null,
): Map<string, Indicateur> {
  const groupes = new Map<string, Indicateur[]>()
  for (const ligne of lignes) {
    if (ligne.theme !== theme || ligne.key !== indicateur || ligne.detail !== detail) continue
    const groupe = groupes.get(ligne.territoire)
    if (groupe) groupe.push(ligne)
    else groupes.set(ligne.territoire, [ligne])
  }

  const parTerritoire = new Map<string, Indicateur>()
  for (const [territoire, groupe] of groupes) {
    parTerritoire.set(territoire, resoudreGroupeSexe(territoire, groupe, indicateur))
  }
  return parTerritoire
}

/** Les deux sexes du contrat éclaté par sexe (issue #390) — jamais un total. */
const SEXES_ATTENDUS: readonly ['F', 'M'] = ['F', 'M']

/**
 * Résout les lignes d'un même (territoire × key × detail) en UNE ligne de
 * territoire (issue #390).
 *
 * - une seule ligne sans sexe : le cas historique, rendue telle quelle ;
 * - exactement {F, M} : l'agrégat — la somme des deux parts, `sex: null` (c'est
 *   un agrégat, plus une ligne de sexe). Si l'une des deux parts est inconnue
 *   (null), la somme est INCONNUE (null) : on ne publie pas la moitié d'une
 *   pyramide comme si c'était le tout ;
 * - tout le reste (un seul sexe, un sexe en double, un mélange sexué /
 *   non-sexué, plusieurs lignes non-sexuées) : une violation de contrat, qui
 *   échoue fort au lieu d'inventer une valeur partielle.
 */
function resoudreGroupeSexe(
  territoire: string,
  groupe: readonly Indicateur[],
  indicateur: string,
): Indicateur {
  const prefixe = `carte : indicateur « ${indicateur} » de « ${territoire} »`
  const sexuees = groupe.filter((l) => l.sex !== null && l.sex !== undefined)
  const sansSexe = groupe.filter((l) => l.sex === null || l.sex === undefined)

  // le cas historique : une ligne, pas de sexe
  if (sexuees.length === 0) {
    if (sansSexe.length > 1) {
      throw new Error(
        `${prefixe} : ${sansSexe.length} lignes sans sexe pour un même détail — ` +
          `un détail non éclaté par sexe a exactement une ligne par territoire`,
      )
    }
    return sansSexe[0]!
  }

  if (sansSexe.length > 0) {
    throw new Error(
      `${prefixe} : représentation du sexe mixte — ${sexuees.length} ligne(s) sexuée(s) ` +
        `et ${sansSexe.length} ligne(s) sans sexe pour un même détail`,
    )
  }

  // le contrat : exactement une ligne F et une ligne M
  for (const sexe of SEXES_ATTENDUS) {
    const compte = sexuees.filter((l) => l.sex === sexe).length
    if (compte !== 1) {
      throw new Error(
        `${prefixe} : groupe de sexes incomplet ou en double — ${compte} ligne(s) ` +
          `de sexe « ${sexe} » au lieu d'une seule (attendu : ` +
          `${SEXES_ATTENDUS.join(' + ')}, jamais un sexe seul)`,
      )
    }
  }

  const base = sexuees.find((l) => l.sex === 'F')!
  const autre = sexuees.find((l) => l.sex === 'M')!
  // une part inconnue rend la somme inconnue — jamais une somme partielle
  const valeur =
    base.value === null || base.value === undefined || autre.value === null || autre.value === undefined
      ? null
      : base.value + autre.value

  return { ...base, value: valeur, sex: null }
}

/**
 * The story-scalar join (ADR-0019): the theme's Story row per territoire, read
 * at the scalar field `champ` — the layer's one value per territory (a story
 * scalar IS a number per territoire). The histoires table carries no unit
 * column, so the joined lines are unit-less (`unit: ''`, the honest number).
 */
export function valeurHistoireParTerritoire(
  payload: Payload,
  theme: Theme,
  champ: string,
): Map<string, ValeurLigne> {
  const parTerritoire = new Map<string, ValeurLigne>()
  for (const histoire of payload.histoires) {
    if (histoire.theme !== theme) continue
    const valeur = (histoire as unknown as Record<string, unknown>)[champ]
    parTerritoire.set(histoire.territoire, {
      value: typeof valeur === 'number' ? valeur : null,
      unit: '',
    })
  }
  return parTerritoire
}

/**
 * The collection with the joined values baked into each feature's properties
 * (`valeur` for the paint, `valeur_formatee` for the popup/legend). Accepts
 * either join — the indicator rows (Map<string, Indicateur>) or the story
 * scalars (Map<string, ValeurLigne>) — the same shape either way. The
 * geometry itself is untouched — a new FeatureCollection, never a mutation.
 */
export function collectionAvecValeurs(
  collection: CollectionMasque,
  parTerritoire: ReadonlyMap<string, ValeurLigne>,
): CollectionAvecValeurs {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => {
      const ligne = parTerritoire.get(feature.properties.territoire)
      return {
        ...feature,
        properties: {
          ...feature.properties,
          valeur: ligne?.value ?? null,
          valeur_formatee: ligne ? formaterValeur(ligne) : null,
        },
      }
    }),
  }
}

/**
 * The choropleth fill expression: `step` over the feature's `valeur`, with a
 * null/missing guard falling back to the neutral no-data color. Empty breaks
 * (no data at all) collapse to the neutral fill — the honest empty map.
 */
export function expressionCouleurs(seuils: readonly number[], couleurs: readonly string[]): ExpressionCouleurs {
  if (couleurs.length < 2) throw new RangeError('Il faut au moins 2 couleurs pour une choroplèthe')
  const [couleurBase, ...autres] = couleurs
  const step: unknown[] = ['step', ['get', 'valeur'], couleurBase]
  for (let i = 0; i < seuils.length; i++) {
    step.push(seuils[i], autres[i] ?? couleurBase)
  }
  return [
    'case',
    ['all', ['has', 'valeur'], ['!=', ['get', 'valeur'], null]],
    step,
    COULEUR_NEUTRE,
  ] as unknown as ExpressionCouleurs
}

/** The membership join (ADR-0013, #282) — the programmes' anchor rows read at
 *  the niveau's anchor type: `membre: true` for a covered territory, the
 *  territory ABSENT from the map otherwise. A sigle not anchored at the level
 *  (CRTE at commune) joins nothing — the honest empty highlight. */
export function membresParTerritoire(
  payload: Payload,
  sigle: SigleProgramme,
  niveau: NiveauMasque,
): Map<string, boolean> {
  const parTerritoire = new Map<string, boolean>()
  const type = typeAdhesionDuNiveau(niveau)
  if (!type) return parTerritoire
  for (const membre of payload.programmes?.membres ?? []) {
    if (membre.sigle === sigle && membre.type === type) parTerritoire.set(membre.territoire, true)
  }
  return parTerritoire
}

/** The subvention join (#282) — the total € per territory at the niveau's
 *  aggregate type: the sum of the territory's `montant` rows (the commune's
 *  by-area split or the EPCI/département annual total, ADR-0013). A territory
 *  without rows keeps null (rendered in the neutral no-data color, never an
 *  invented zero). */
export function subventionsParTerritoire(
  payload: Payload,
  niveau: NiveauMasque,
): Map<string, ValeurLigne> {
  const parTerritoire = new Map<string, ValeurLigne>()
  const type = typeSubventionsDuNiveau(niveau)
  for (const subvention of payload.programmes?.subventions ?? []) {
    if (subvention.type !== type) continue
    const actuel = parTerritoire.get(subvention.territoire)?.value ?? 0
    parTerritoire.set(subvention.territoire, {
      value: actuel + subvention.montant,
      unit: '€',
    })
  }
  return parTerritoire
}

/** A feature enriched with the membership boolean (the categorical fill reads it). */
export interface FeatureAvecMembre extends FeatureTerritoire {
  properties: FeatureTerritoire['properties'] & {
    membre: boolean
  }
}

export interface CollectionAvecMembres {
  type: 'FeatureCollection'
  features: FeatureAvecMembre[]
}

/** The collection with the membership baked into each feature's properties —
 *  `membre: true` for a covered territory, false otherwise (the in/out
 *  categorical paint). The geometry itself is untouched. */
export function collectionAvecMembres(
  collection: CollectionMasque,
  parTerritoire: ReadonlyMap<string, boolean>,
): CollectionAvecMembres {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        membre: parTerritoire.get(feature.properties.territoire) ?? false,
      },
    })),
  }
}

/**
 * The membership highlight expression (ADR-0019 #282) — CATEGORICAL, beside
 * the value `expressionCouleurs`: a covered territory lights up in the
 * highlight color, a non-member renders in the neutral fill. Two classes,
 * never a ramp.
 */
export function expressionMembres(couleurMembre: string): ExpressionCouleurs {
  return ['case', ['==', ['get', 'membre'], true], couleurMembre, COULEUR_NEUTRE] as unknown as ExpressionCouleurs
}

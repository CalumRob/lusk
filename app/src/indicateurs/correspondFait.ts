import type { Indicateur, Sexe, TerritoireType, Theme } from '@/payload/types'

/**
 * Le mode d'égalité d'une composante nullable de la clé de jointure
 * thème × clé × détail × sexe × dimension (#507) :
 *  - **'stricte'** — la composante du fait ÉGALE celle des critères, null
 *    compris : un critère null n'accepte que les faits sans composante. La
 *    facette sans sexe déclaré lit les lignes NON-SEXÉES — la publication
 *    sans découpage F/M — jamais un mélange où une valeur « F » ou « M »
 *    tiendrait lieu de total ;
 *  - **'tolerante'** — un critère null accepte toute valeur du fait ; un
 *    critère non null exige l'égalité exacte. Disponible pour un appelant qui
 *    légitime explicitement le mélange ; AUCUN site Repères ne l'utilise
 *    depuis #507 (le verrou de parité interdit aux deux lectures de diverger).
 *
 * Le choix est EXPLICITE à chaque appel : les deux copies inline historiques
 * divergeaient précisément parce que cette sémantique était implicite.
 */
export type ModeEgalite = 'stricte' | 'tolerante'

/** Les critères de sélection d'un fait Repères — la clé de jointure déclarée une fois pour toutes. */
export interface CriteresFait {
  /** Le thème du fait — THÈME × CLÉ toujours : les clés ne sont pas uniques entre thèmes (#383, #438). */
  theme: Theme
  /** La clé publiée du fait. */
  cle: string
  /** Le détail exact attendu — null = fait sans détail. Incompatible avec `details`. */
  detail?: string | null
  /**
   * L'appartenance aux détails DÉCLARÉS (la liste fermée de la page) — un fait
   * sans détail n'appartient jamais à une liste déclarée. Incompatible avec `detail`.
   */
  details?: readonly string[]
  /** Le sexe attendu — absent : aucune clause sexe ; null : lignes non-sexées selon le mode. */
  sexe?: Sexe | null
  /** La dimension analytique attendue — même sémantique absence/null que le sexe. */
  dimension?: string | null
  /** Le niveau territorial publié du fait (`fact.type`) quand la lecture est niveau-portée. */
  niveau?: TerritoireType
  /** Le territoire exact du fait (les modèles par territoire : signature, profil, chemin…). */
  territoire?: string
  /** Exiger une valeur publiée (`fact.value !== null`) — les statistiques ne lisent que les valeurs. */
  avecValeur?: boolean
}

/** Les choix sémantiques explicites de la jointure — requis à chaque appel. */
export interface OptionsCorrespondance {
  /** L'égalité sur le sexe : stricte (null ↔ null seulement) ou tolérante. */
  sexe: ModeEgalite
  /** L'égalité sur la dimension : mêmes modes que le sexe. */
  dimension: ModeEgalite
  /**
   * Ignorer TOTALEMENT la clause sexe — l'exception DÉCLARÉE de la vue Carte
   * (#483, le « mensonge cartographique ») : `resoudreGroupeSexe` (fusion.ts,
   * #390) agrège F + M au moment de la peinture et jette par contrat tout
   * groupe unisexe ; pré-filtrer par `facet.sex` affamerait l'agrégation
   * (0 ligne « M ») et ferait mourir l'onglet Carte des pages pyramides. La
   * clause sexe appartient à la fusion, pas au filtre de la carte.
   */
  ignorerSexe?: boolean
}

/**
 * LA configuration partagée de la jointure des faits Repères (#507) :
 * égalité STRICTE sur le sexe et la dimension — le statut de famille et tous
 * les modèles filtrent LA même population par construction.
 */
export const CORRESPONDANCE_STRICTE: OptionsCorrespondance = Object.freeze({ sexe: 'stricte', dimension: 'stricte' })

/**
 * La configuration de la vue Carte (#483) : identique à la stricte, moins la
 * clause sexe — IGNORÉE par contrat, l'agrégation F + M vivant dans la fusion.
 */
export const CORRESPONDANCE_CARTE: OptionsCorrespondance = Object.freeze({ sexe: 'stricte', dimension: 'stricte', ignorerSexe: true })

const egalite = (fait: string | null | undefined, critere: string | null | undefined, mode: ModeEgalite): boolean => {
  // Une composante ABSENTE des critères (undefined) ne crée AUCUNE clause :
  // le filtre thème × clé seul lit toutes les lignes de la clé, sexes et
  // dimensions confondus. Un critère explicite (null ou nommé) engage le mode.
  if (critere === undefined) return true
  const valeurFait = fait ?? null
  return mode === 'stricte' ? valeurFait === critere : critere === null || valeurFait === critere
}

/**
 * `correspondFait(fait, criteres, options)` — LE prédicat unique de jointure
 * des faits Repères (#507). Un fait correspond quand ses coordonnées répondent
 * aux critères : THÈME × CLÉ toujours (les clés ne sont pas uniques entre
 * thèmes, #383/#438), puis détail exact OU appartenance aux détails déclarés,
 * sexe et dimension selon le mode explicite choisi, niveau, territoire,
 * valeur publiée. Le périmètre actif (niveau × dansScope) reste du ressort
 * des appelants — il est territorial, pas une identité de fait.
 */
export function correspondFait(fait: Indicateur, criteres: CriteresFait, options: OptionsCorrespondance): boolean {
  if (fait.theme !== criteres.theme || fait.key !== criteres.cle) return false
  if (criteres.detail !== undefined) {
    if ((fait.detail ?? null) !== (criteres.detail ?? null)) return false
  } else if (criteres.details !== undefined) {
    if (fait.detail === null || !criteres.details.includes(fait.detail)) return false
  }
  if (!options.ignorerSexe && !egalite(fait.sex, criteres.sexe, options.sexe)) return false
  if (!egalite(fait.dimension, criteres.dimension, options.dimension)) return false
  if (criteres.niveau !== undefined && fait.type !== criteres.niveau) return false
  if (criteres.territoire !== undefined && fait.territoire !== criteres.territoire) return false
  if (criteres.avecValeur === true && fait.value === null) return false
  return true
}

/** Le filtre des faits par le prédicat unique — le sucre des 13 sites appelants (#507). */
export function filtrerFaits<T extends Indicateur>(faits: readonly T[], criteres: CriteresFait, options: OptionsCorrespondance): T[] {
  return faits.filter((fait) => correspondFait(fait, criteres, options))
}

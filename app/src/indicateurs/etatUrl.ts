/**
 * La machine à états URL pure de la Page d'indicateur (#508).
 *
 * Les règles de niveau de la Page d'indicateur vivaient en watchers
 * mutuellement réactifs dans IndicateurPage.vue — le scope validé, la purge
 * de la query normalisée et la cascade « URL explicite → niveau mémorisé du
 * visiteur → niveau le plus fin publié » se répondaient à chaque écriture :
 * la classe de bogue #474 (« territoires chargés, métadonnées pas encore »)
 * strippait silencieusement un departement/EPCI valide. Elles vivent ICI,
 * pures, verrouillées par la table de vérité (etat-url.spec.ts) :
 *
 *  - `resoudreEtatUrl` résout l'état depuis une query brute + les territoires
 *    publiés (+ les niveaux publiés de la page + le niveau mémorisé du
 *    visiteur, passés en ARGUMENTS — jamais lus ici) ;
 *  - `queryCanonique` produit la query canonique depuis un état : ce qui
 *    s'écrit, ce qui se supprime ;
 *  - `fusionnerFacette` fusionne la facette canonique résolue du descripteur
 *    dans une query courante (l'applier #438/#474).
 *
 * Le composant ne garde que des APPLIERS : des watchers muets qui alimentent
 * les fonctions et écrivent leur résultat via router.replace. L'ordre
 * d'insertion des clés EST la sérialisation : les producteurs de query
 * conservent la place des clés existantes et ajoutent les nouvelles en
 * DERNIER — les URLs restent octet pour octet celles d'avant #508.
 *
 * Le vocabulaire de niveau est exclusivement celui du contrat d'exploration
 * (#505) — PARAM_NIVEAU, NIVEAUX_COMPARABLES, estNiveauComparable,
 * lireTerritoirePorte : zéro règle dupliquée. La Région, exclue de la
 * comparaison data-first (ADR-0024), ne porte JAMAIS un niveau ; son handoff
 * porte le territoire sans niveau et la page résout son repli honnête.
 */

import { PARAM_NIVEAU, NIVEAUX_COMPARABLES, estNiveauComparable, lireTerritoirePorte } from '@/fiche/contratExploration'
import type { NiveauComparable } from '@/fiche/contratExploration'
import type { LocationQuery } from 'vue-router'
import type { Territoire, TerritoireType } from '@/payload/types'

/**
 * Le repli honnête : le PREMIER niveau comparable publié, dans l'ordre du
 * contrat (du plus fin au plus large) — « commune » quand rien n'est publié,
 * le repli historique de la page.
 */
export const niveauLePlusFin = (publies: readonly TerritoireType[]): NiveauComparable =>
  NIVEAUX_COMPARABLES.find((niveau) => publies.includes(niveau)) ?? 'commune'

/**
 * LA cascade de niveaux (#508) — l'unique implémentation, consommée par la
 * résolution d'état ET par le modèle d'exploration : le niveau explicite s'il
 * est comparable ET publié par la page, sinon le niveau mémorisé du visiteur
 * s'il est applicable, sinon le repli au plus fin publié. Une chaîne hors
 * contrat (la Région, un paramètre répété → tableau) n'est JAMAIS un niveau
 * porté.
 */
export function resoudreNiveau(explicite: unknown, memorise: unknown, publies: readonly TerritoireType[]): NiveauComparable {
  const supportes = publies.filter((niveau): niveau is NiveauComparable => estNiveauComparable(niveau))
  if (estNiveauComparable(explicite) && supportes.includes(explicite)) return explicite
  if (estNiveauComparable(memorise) && supportes.includes(memorise)) return memorise
  return niveauLePlusFin(publies)
}

/**
 * L'état URL résolu d'une Page d'indicateur pour UNE query — les deux
 * fenêtres du chargement comprises (#474).
 */
export interface EtatUrlIndicateur {
  /**
   * Le périmètre département/EPCI validé contre les COMMUNES publiées — null
   * tant que la référence territoires n'est pas là : la fenêtre #474 reflète
   * le brut de l'URL, elle ne valide ni ne purge rien.
   */
  scopeValide: { departement?: string; epci?: string } | null
  /**
   * Le niveau résolu par la cascade — null tant que les niveaux publiés de
   * la page sont inconnus (les métadonnées pas encore là) : la query
   * canonique n'écrit ALORS RIEN, jamais un « niveau: undefined ».
   */
  niveau: NiveauComparable | null
}

export interface EntreeResolutionEtat {
  /** La query brute de l'URL — valeurs possiblement répétées ou non-chaînes. */
  query: LocationQuery
  /** Les territoires PUBLIÉS (la référence) — vide pendant la fenêtre de chargement. */
  territoires: readonly Territoire[]
  /** Les niveaux déclarés par la facette de la page — absent tant que les métadonnées ne sont pas là. */
  niveauxPublies?: readonly TerritoireType[]
  /** Le niveau mémorisé du visiteur — LU PAR LE COMPOSANT et passé en argument, jamais lu ici. */
  niveauMemorise?: string
}

/**
 * La fonction pure n°1 (#508) : l'état résolu depuis une query + les
 * territoires publiés. Deux indépendances honnêtes — la cascade ne dépend
 * QUE des niveaux publiés de la page ; la validation du périmètre ne dépend
 * QUE de la référence territoires. Dans la vraie page les métadonnées
 * n'arrivent qu'après la référence (l'ordre du chargeur), mais chaque moitié
 * se comporte seule, exactement comme les deux temps du découpage #474.
 */
export function resoudreEtatUrl({ query, territoires, niveauxPublies, niveauMemorise }: EntreeResolutionEtat): EtatUrlIndicateur {
  const niveau = niveauxPublies ? resoudreNiveau(lireTerritoirePorte(query).niveau, niveauMemorise, niveauxPublies) : null
  if (territoires.length === 0) return { scopeValide: null, niveau }
  // La validation lit les COMMUNES publiées : un département/EPCI n'existe
  // pour la comparaison communale que s'il porte des communes publiées —
  // l'annuaire seul ne suffit pas.
  const communes = territoires.filter((territoire) => territoire.type === 'commune')
  const brutDepartement = typeof query.departement === 'string' ? query.departement : undefined
  const brutEpci = typeof query.epci === 'string' ? query.epci : undefined
  let departement = brutDepartement !== undefined && communes.some((commune) => commune.departement === brutDepartement) ? brutDepartement : undefined
  const epci = brutEpci !== undefined && communes.some((commune) => commune.epci === brutEpci) ? brutEpci : undefined
  // Une paire département+EPCI qu'AUCUNE commune ne porte ensemble perd son
  // département et garde son EPCI (le miroir exact du validScope historique).
  if (departement !== undefined && epci !== undefined && !communes.some((commune) => commune.departement === departement && commune.epci === epci)) departement = undefined
  return { scopeValide: { departement, epci }, niveau }
}

/**
 * La fonction pure n°2 (#508) : la query canonique depuis un état — ce qui
 * s'écrit, ce qui se supprime.
 *
 *  - le niveau résolu s'écrit SUR PLACE s'il existe, EN DERNIER s'il manque ;
 *  - un état non encore résoluble (`niveau: null`) n'écrit RIEN (#474) ;
 *  - le périmètre département/EPCI ne vit qu'au niveau communal — il part dès
 *    que le niveau quitte communal, même VALIDE ;
 *  - le périmètre devenu invalide est purgé dès que les territoires sont
 *    publiés — JAMAIS pendant la fenêtre où ils manquent encore
 *    (`scopeValide: null`) ;
 *  - les `extras` (tri, ordre, recherche, vue…) passent D'ABORD, les règles
 *    de canonisation ENSUITE.
 */
export function queryCanonique(query: LocationQuery, etat: EtatUrlIndicateur, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const next: Record<string, unknown> = { ...query, ...extras }
  if (etat.niveau !== null) next[PARAM_NIVEAU] = etat.niveau
  if (next[PARAM_NIVEAU] !== 'commune') {
    delete next.departement
    delete next.epci
  }
  if (etat.scopeValide) {
    if (next.departement !== etat.scopeValide.departement) delete next.departement
    if (next.epci !== etat.scopeValide.epci) delete next.epci
  }
  return next
}

/** Les clés de facette que la fusion remplace toujours — la facette canonique vient du descripteur, jamais du brut de l'URL. */
const CLES_FACETTE = ['facet', 'detail', 'sex', 'dimension'] as const

/**
 * La fusion de la facette canonique résolue (`resolvedUrl` du dispatch de
 * famille) dans la query courante : les clés de facette existantes sont
 * remplacées SUR PLACE, le paramètre `facet` divergent supprimé, les clés
 * que la query ne porte pas encore ajoutées EN DERNIER.
 */
export function fusionnerFacette(query: LocationQuery, urlResolue: string): Record<string, unknown> {
  const canonique = new URLSearchParams(urlResolue.slice(1))
  const next: Record<string, unknown> = { ...query }
  for (const cle of CLES_FACETTE) delete next[cle]
  canonique.forEach((valeur, cle) => {
    next[cle] = valeur
  })
  return next
}

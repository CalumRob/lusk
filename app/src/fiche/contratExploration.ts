/**
 * Le contrat d'exploration (#505) — LA couture unique de la passarelle
 * Fiche d'identité ↔ Page d'indicateur (ADR-0024, l'état de handoff approuvé
 * par le PO). Le vocabulaire que quatre sites consommateurs tapaient chacun à
 * la main vit ICI, une seule fois :
 *
 *  - les noms des paramètres de query (`territoire`, `niveau`, `theme`) ;
 *  - l'ensemble des niveaux comparables, du plus fin au plus large — la
 *    règle « la Région ne porte pas de niveau » déclarée EXACTEMENT UNE FOIS ;
 *  - les constructeurs de liens dans les deux sens.
 *
 * Les deux directions de la couture :
 *
 *  - fiche → page : `routeIndicateur` construit la route nommée de la Page
 *    d'indicateur en emportant le territoire de la fiche comme état explicite
 *    de l'URL (?territoire=…) plus ?niveau= quand il est comparable (commune /
 *    EPCI / département). La Région est exclue de la comparaison data-first :
 *    son handoff porte le territoire SANS niveau — la page résout alors son
 *    repli honnête et nomme « absent à ce niveau » un territoire hors
 *    périmètre, jamais une invention.
 *  - page → fiche : `lienFiche` reconstruit la fiche d'un territoire comparé
 *    (les lignes du tableau Repères, les extrêmes, les nuages) en préservant
 *    le thème actif (?theme=…) — jamais un aller sans retour.
 *
 * Le comportement est déjà verrouillé mot pour mot par les specs existantes
 * (exploration-handoff.spec.ts, indicateur-view.spec.ts,
 * contexte-switcher.spec.ts, router.spec.ts) : ce module ne possède que le
 * vocabulaire — zéro changement observable (#505).
 */

import type { RouteLocationRaw, LocationQuery } from 'vue-router'
import type { TerritoireType } from '@/payload/types'

/** Le paramètre de query qui porte le territoire mis en avant. */
export const PARAM_TERRITOIRE = 'territoire'

/** Le paramètre de query qui porte le niveau de comparaison explicite. */
export const PARAM_NIVEAU = 'niveau'

/** Le paramètre de query qui préserve le thème actif sur le retour vers la fiche. */
export const PARAM_THEME = 'theme'

/**
 * Les niveaux comparables d'une Page d'indicateur, du plus fin au plus large
 * — LA déclaration unique (#505). La Région n'y figure pas : exclue de la
 * comparaison data-first (ADR-0024), son handoff porte le territoire sans
 * niveau et la page résout son repli honnête.
 */
export const NIVEAUX_COMPARABLES = ['commune', 'epci', 'departement'] as const

/** Un niveau comparable — exactement les membres de NIVEAUX_COMPARABLES. */
export type NiveauComparable = (typeof NIVEAUX_COMPARABLES)[number]

/** L'appartenance au comparable : une chaîne hors cet ensemble n'est JAMAIS un niveau porté. */
export function estNiveauComparable(valeur: unknown): valeur is NiveauComparable {
  return typeof valeur === 'string' && (NIVEAUX_COMPARABLES as readonly string[]).includes(valeur)
}

/** La référence minimale d'un territoire pour construire un lien de la couture. */
export interface RefTerritoire {
  territoire: string
  type: TerritoireType
}

/** L'état territoire↔niveau que la passarelle transporte dans la query. */
export interface EtatTerritoire {
  territoire?: string
  /** Le niveau comparable — JAMAIS porté pour la Région (la règle ci-dessus). */
  niveau?: NiveauComparable
}

/**
 * Ce que la passarelle EMPORTE de la fiche vers la page : le territoire de
 * la fiche, plus son niveau quand il est comparable. Sans territoire, rien
 * n'est porté. L'ordre d'insertion des clés (territoire puis niveau) est le
 * comportement observable : c'est lui qui sérialise ?territoire=…&niveau=….
 */
export function emporterTerritoire(territoire: RefTerritoire | null | undefined): EtatTerritoire {
  if (!territoire) return {}
  return estNiveauComparable(territoire.type)
    ? { territoire: territoire.territoire, niveau: territoire.type }
    : { territoire: territoire.territoire }
}

/**
 * Le constructeur fiche → Page d'indicateur : la route nommée de la page,
 * thème et indicateur en params de route, l'état emporté en query. L'écrivain
 * côté fiche (handoffExploration) ajoute SA règle d'honnêteté par-dessus —
 * une page non publiée ne produit aucun lien.
 */
export function routeIndicateur(
  theme: string,
  clef: string,
  territoire: RefTerritoire | null | undefined,
): RouteLocationRaw {
  return { name: 'indicateur', params: { theme, indicator: clef }, query: { ...emporterTerritoire(territoire) } }
}

/**
 * Ce que la page REÇOIT de la passarelle : la lecture validée des deux
 * paramètres portés. Une valeur non-chaîne (paramètre répété → tableau) ou un
 * niveau hors contrat ne passe jamais — la page résout alors SON repli
 * honnête, elle ne fait pas confiance au brut de l'URL.
 */
export function lireTerritoirePorte(query: LocationQuery): EtatTerritoire {
  const brutNiveau = query[PARAM_NIVEAU]
  return {
    territoire: typeof query[PARAM_TERRITOIRE] === 'string' ? (query[PARAM_TERRITOIRE] as string) : undefined,
    niveau: estNiveauComparable(brutNiveau) ? brutNiveau : undefined,
  }
}

/**
 * Le constructeur page → fiche : le chemin canonique de la fiche d'un
 * territoire comparé, avec le thème actif préservé dans la query quand il en
 * a un — le même href que dessinaient les modèles avant #505, octet pour octet.
 */
export function lienFiche(territoire: RefTerritoire, theme?: string): string {
  const chemin = `/territoire/${territoire.type}/${territoire.territoire}`
  return theme === undefined ? chemin : `${chemin}?${PARAM_THEME}=${theme}`
}

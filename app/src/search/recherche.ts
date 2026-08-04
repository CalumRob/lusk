/**
 * The global search domain — pure functions, tested in isolation
 * (__tests__/recherche.spec.ts). The GlobalSearchBar consumes these; nothing
 * here touches the DOM, the network or the payload layer. Names from
 * LIBGEO/LIBEPCI carry diacritics, so matching is accent-insensitive:
 * "rennes" must find "Rennes" (normaliserTexte, NFKD decomposition).
 */

import type { Territoire, TerritoireType } from '../payload/types'

/** The French label of a territoire type — the search result chip. */
const LIBELLES_TYPE: Record<TerritoireType, string> = {
  commune: 'Commune',
  epci: 'EPCI',
  departement: 'Département',
  region: 'Région',
}

/**
 * The matching form of a name: lowercased, diacritics stripped (NFD), French
 * ligatures expanded, and separators (space, hyphen, apostrophe) collapsed to
 * a single space so "Saint-Malo" and "saint malo" compare equal.
 */
export function normaliserTexte(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[\s'’\-]+/g, ' ')
    .trim()
}

const SCORE_EXACT = 100
const SCORE_PREFIXE = 80
const SCORE_DEBUT_MOT = 60
const SCORE_FRAGMENT = 40

/**
 * Match quality of one name against the query, higher = better:
 * exact > name-prefix > word-start > any-substring; 0 = no match.
 */
function scoreCorrespondance(nomNormalise: string, requeteNormalisee: string): number {
  if (nomNormalise === requeteNormalisee) return SCORE_EXACT
  if (nomNormalise.startsWith(requeteNormalisee)) return SCORE_PREFIXE
  if (nomNormalise.split(' ').some((mot) => mot.startsWith(requeteNormalisee))) {
    return SCORE_DEBUT_MOT
  }
  if (nomNormalise.includes(requeteNormalisee)) return SCORE_FRAGMENT
  return 0
}

/**
 * Search the territoires reference table by name — accent-insensitive, exact
 * prefixes first, ties broken by shortest name then alphabetical order.
 * Defaults to ~8 results (the search dropdown's size).
 */
export function rechercherTerritoires(
  territoires: Territoire[],
  requete: string,
  limite = 8,
): Territoire[] {
  const requeteNormalisee = normaliserTexte(requete)
  if (requeteNormalisee === '') return []

  return territoires
    .map((t) => ({ territoire: t, score: scoreCorrespondance(normaliserTexte(t.nom), requeteNormalisee) }))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.territoire.nom.length - b.territoire.nom.length ||
        a.territoire.nom.localeCompare(b.territoire.nom, 'fr'),
    )
    .slice(0, limite)
    .map((r) => r.territoire)
}

export function libelleType(type: TerritoireType): string {
  return LIBELLES_TYPE[type]
}

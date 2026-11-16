/**
 * The global search domain — pure functions, tested in isolation
 * (__tests__/recherche.spec.ts). The GlobalSearchBar consumes these; nothing
 * here touches the DOM, the network or the payload layer. Names from
 * LIBGEO/LIBEPCI carry diacritics, so matching is accent-insensitive:
 * "rennes" must find "Rennes" (normaliserTexte, NFKD decomposition).
 */

import type { Territoire, TerritoireType, Theme } from '../payload/types'

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
const SCORE_CODE_EXACT = 120
const SCORE_CODE_PREFIXE = 110
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
 * Le pipeline partagé des deux moitiés de la recherche (#409) : normalisation,
 * score, filtre des correspondances, tri (score décroissant, départages
 * libellé court puis alphabétique FR), borne. Les deux recherches ne
 * fournissent leur libellé ; les territoires peuvent aussi fournir leur
 * identifiant administratif (#1028) : code exact d'abord, puis préfixe de code,
 * sans doubler une ligne ; les scores de nom restent inchangés.
 */
function rechercherScorees<T>(
  entrees: readonly T[],
  requete: string,
  texte: (entree: T) => string,
  limite: number,
  identifiant?: (entree: T) => string,
): T[] {
  const requeteNormalisee = normaliserTexte(requete)
  if (requeteNormalisee === '') return []
  const codeSaisi = requete.trim()

  return entrees
    .map((entree) => {
      const code = identifiant?.(entree)
      const scoreCode = code === undefined
        ? 0
        : code === codeSaisi
          ? SCORE_CODE_EXACT
          : code.startsWith(codeSaisi)
            ? SCORE_CODE_PREFIXE
            : 0
      return {
        entree,
        code,
        score: scoreCode || scoreCorrespondance(normaliserTexte(texte(entree)), requeteNormalisee),
      }
    })
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.score === SCORE_CODE_PREFIXE && b.score === SCORE_CODE_PREFIXE && a.code && b.code
          ? a.code.localeCompare(b.code)
          : 0) ||
        texte(a.entree).length - texte(b.entree).length ||
        texte(a.entree).localeCompare(texte(b.entree), 'fr'),
    )
    .slice(0, limite)
    .map((r) => r.entree)
}

/**
 * Search by administrative identifier (trimmed string: exact code first, then
 * code prefix as the visitor types), then by name — accent-insensitive,
 * existing name ranks and tie breaks. No numeric coercion.
 * Defaults to ~8 results (the search dropdown's size).
 */
export function rechercherTerritoires(
  territoires: readonly Territoire[],
  requete: string,
  limite = 8,
): Territoire[] {
  return rechercherScorees(territoires, requete, (territoire) => territoire.nom, limite,
    (territoire) => territoire.territoire)
}

export function libelleType(type: TerritoireType): string {
  return LIBELLES_TYPE[type]
}

/**
 * Une entrée Indicateur de la recherche groupée (#409) — une Page
 * d'indicateur du catalogue app-owned, avec le libellé éditorial du thème.
 */
export interface EntreeRechercheIndicateur {
  theme: Theme
  /** Le libellé éditorial du thème — jamais un slug brut. */
  themeLabel: string
  /** Le libellé public app-owned de la page. */
  label: string
  href: string
}

/**
 * Search the catalogue entries by public label — the SAME matching/scoring as
 * the territoires search (accent-insensitive, prefix before substring), a
 * smaller cap (the grouped dropdown's per-section size).
 */
export function rechercherIndicateurs(
  entrees: readonly EntreeRechercheIndicateur[],
  requete: string,
  limite = 4,
): EntreeRechercheIndicateur[] {
  return rechercherScorees(entrees, requete, (entree) => entree.label, limite)
}

/**
 * Text measurement for the shared Cahier PDF (#1024).
 *
 * The layout uses the *actual* embedded face metrics: the composer passes a
 * measurement that delegates to jsPDF's registered TTF, so a comparison
 * heading, a table column or a wrapped source line is measured with the same
 * glyph widths the reader receives. Nothing here invents a character-count
 * heuristic.
 */

export interface MesureTexte {
  /** Width of one run in millimetres. */
  largeur(texte: string, police: string, taillePt: number, espacementPt?: number): number
  /** Ascent+descent line box in millimetres for the face at that size. */
  hauteurLigne(police: string, taillePt: number): number
  /** Width of a space in the face at that size. */
  espace(police: string, taillePt: number): number
}

export interface OptionsPliage {
  readonly police: string
  readonly taillePt: number
  readonly largeurMax: number
  readonly espacementPt?: number
  /** Break an unbreakable token by characters as a last resort (headers only). */
  readonly casserMotsLongs?: boolean
}

export interface LigneMesuree {
  readonly texte: string
  readonly largeur: number
}

function mots(texte: string): string[] {
  return texte.split(/\s+/).filter(Boolean)
}

/** Greedy word wrapping measured against the real face. */
export function plierTexte(
  texte: string,
  mesure: MesureTexte,
  options: OptionsPliage,
): readonly LigneMesuree[] {
  const { police, taillePt, largeurMax, espacementPt = 0, casserMotsLongs = false } = options
  const largeur = (value: string) => mesure.largeur(value, police, taillePt, espacementPt)
  const normalise = texte.replace(/\s+/g, ' ').trim()
  if (!normalise) return [{ texte: '', largeur: 0 }]
  const sortie: LigneMesuree[] = []
  let courant = ''
  const pousser = () => {
    if (courant) sortie.push({ texte: courant, largeur: largeur(courant) })
    courant = ''
  }
  for (const mot of mots(normalise)) {
    const candidat = courant ? `${courant} ${mot}` : mot
    if (largeur(candidat) <= largeurMax) {
      courant = candidat
      continue
    }
    if (courant) pousser()
    if (largeur(mot) <= largeurMax) {
      courant = mot
      continue
    }
    if (!casserMotsLongs) {
      // Keep the full token on its own line; the caller decides whether that
      // is acceptable (a number is never truncated or wrapped).
      courant = mot
      continue
    }
    let morceau = ''
    for (const caractere of Array.from(mot)) {
      const candidatCaractere = morceau + caractere
      if (morceau && largeur(candidatCaractere) > largeurMax) {
        sortie.push({ texte: morceau, largeur: largeur(morceau) })
        morceau = caractere
      } else {
        morceau = candidatCaractere
      }
    }
    courant = morceau
  }
  pousser()
  return sortie.length ? sortie : [{ texte: '', largeur: 0 }]
}

/** Number of laid-out lines; does not include the line box height. */
export function nombreLignes(
  texte: string,
  mesure: MesureTexte,
  options: OptionsPliage,
): number {
  return plierTexte(texte, mesure, options).length
}

/**
 * Two-line test used by the approved comparison heading. The caller includes
 * the prefix width in `largeurMax` for the first line.
 */
export function tientEnDeuxLignes(
  texte: string,
  mesure: MesureTexte,
  options: OptionsPliage,
): boolean {
  return nombreLignes(texte, mesure, options) <= 2
}

export function largeurMaxLigne(
  lignes: readonly LigneMesuree[],
): number {
  return lignes.reduce((max, ligne) => Math.max(max, ligne.largeur), 0)
}

/** Single-line measured ellipsis for the compact territory table header only. */
export function tronquerParMesure(
  texte: string,
  mesure: MesureTexte,
  options: Omit<OptionsPliage, 'casserMotsLongs'>,
): string {
  const { police, taillePt, largeurMax, espacementPt = 0 } = options
  const largeur = (value: string) => mesure.largeur(value, police, taillePt, espacementPt)
  if (largeur(texte) <= largeurMax) return texte
  const points = '…'
  const caracteres = Array.from(texte)
  let bas = 0
  let haut = caracteres.length
  while (bas < haut) {
    const milieu = Math.ceil((bas + haut) / 2)
    const candidat = `${caracteres.slice(0, milieu).join('').trimEnd()}${points}`
    if (largeur(candidat) <= largeurMax) bas = milieu
    else haut = milieu - 1
  }
  return `${caracteres.slice(0, bas).join('').trimEnd()}${points}`
}

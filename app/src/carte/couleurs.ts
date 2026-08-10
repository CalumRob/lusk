/**
 * The map's color system — DESIGN.md §2: one anchor hex per theme, the ramp
 * derives from it (the same one-hex-change-follows rule as the CSS tokens).
 * MapLibre paints cannot read CSS custom properties, so the theme ramp roles
 * are computed here from the anchors — the app-side mirror of tokens.css.
 *
 * The ramp roles are the tokens.css §2 recipes, verbatim (color-mix in OKLab):
 * wash = 8 % anchor over surface-secondary, soft = 16 % anchor over
 * surface-primary, line = the anchor, strong = 62 % anchor over #0C1B19. The
 * fiche reads those roles; the choropleth must read the same ramp (audit #208
 * item 56): `echelleChoroplethe` samples the role path wash → soft → line →
 * strong, so the map's darkest class IS the theme's strong, its lightest IS
 * the theme's wash.
 *
 * A11y (DESIGN.md §8): the ramp is the fill, never the sole carrier — every
 * territory also carries its formatted value (popup, legend buckets), so the
 * reading never depends on color perception alone.
 */

import type { Theme } from '../payload/types'

/** The theme anchors — mirror of tokens.css (§2), validated by the tokens contract. */
export const ANCRAGES_THEMES: Record<Theme, string> = {
  mobilite: '#6BA3B5', // teal
  demographie: '#8E85C4', // indigo
  habitat: '#C98F6E', // terracotta
  economie: '#D9A441', // amber — or/ambre, hors du vert-bleu de marque (#214)
  milieux: '#A99A5E', // olive/kaki — l'axe terre (ADR-0014), ancrage provisoire
}

/** The neutral fill: territory masks in Aperçu + no-data territories.
 *  Un vert-gris clair — lightened (issue #68) so it sits back against the
 *  light positron basemap (ADR-0018) while still reading at commune level. */
export const COULEUR_NEUTRE = '#D8E6E2'

/** The diverging ramp's shared counter-hue (ADR-0019): the negative pole of
 *  every diverging ramp, whatever the theme — mirror of the --mode-car token
 *  (tokens.css §2). */
export const COULEUR_CORAL = '#A94562'

/** The light neutral at zero of the diverging ramp (ADR-0019) — deliberately
 *  distinct from COULEUR_NEUTRE: a territory at zero must not read as a
 *  no-data territory. */
export const COULEUR_NEUTRE_ZERO = '#F2F5F4'

/** The outline of the territory masks (reads on both basemap and fills). */
export const COULEUR_CONTOUR = '#4E6E68'

/** The mask outline width in px — tightened to a hairline (issue #68) that
 *  stays visible at commune level. */
export const LARGEUR_CONTOUR = 0.75

/** The ramp poles — tokens.css §2: the surfaces the roles mix over, and the
 *  dark pole every strong role mixes toward. */
const SURFACE_SECONDAIRE = '#F8FBFB' // the wash base (page background)
const SURFACE_PRIMAIRE = '#FFFFFF' // the soft base (cards, header)
const FONCE = '#0C1B19' // the ramps' dark pole (DESIGN.md §2)

interface Rgb {
  r: number
  g: number
  b: number
}

interface Oklab {
  L: number
  a: number
  b: number
}

function hexVersRgb(hex: string): Rgb {
  const propre = hex.replace(/^#/, '')
  const valeur = Number.parseInt(propre, 16)
  if (![3, 6].includes(propre.length) || Number.isNaN(valeur)) {
    throw new RangeError(`Couleur hexadécimale invalide : ${hex}`)
  }
  if (propre.length === 3) {
    return {
      r: Number.parseInt(propre[0] + propre[0], 16),
      g: Number.parseInt(propre[1] + propre[1], 16),
      b: Number.parseInt(propre[2] + propre[2], 16),
    }
  }
  return {
    r: (valeur >> 16) & 255,
    g: (valeur >> 8) & 255,
    b: valeur & 255,
  }
}

function versLineaire(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function depuisLineaire(c: number): number {
  const borne = Math.max(0, Math.min(1, c))
  return borne <= 0.0031308 ? 12.92 * borne : 1.055 * Math.pow(borne, 1 / 2.4) - 0.055
}

/** sRGB → OKLab (the tokens.css color-mix space). */
function rgbVersOklab({ r, g, b }: Rgb): Oklab {
  const rl = versLineaire(r / 255)
  const gl = versLineaire(g / 255)
  const bl = versLineaire(b / 255)
  let l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl
  let m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl
  let s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl
  l = Math.cbrt(l)
  m = Math.cbrt(m)
  s = Math.cbrt(s)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** OKLab → sRGB. */
function oklabVersRgb({ L, a, b }: Oklab): Rgb {
  let l = L + 0.3963377774 * a + 0.2158037573 * b
  let m = L - 0.1055613458 * a - 0.0638541728 * b
  let s = L - 0.0894841775 * a - 1.291485548 * b
  l = l * l * l
  m = m * m * m
  s = s * s * s
  return {
    r: depuisLineaire(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    g: depuisLineaire(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    b: depuisLineaire(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
  }
}

function rgbVersHex({ r, g, b }: Rgb): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)))
  const valeur = (c(r) << 16) | (c(g) << 8) | c(b)
  return `#${valeur.toString(16).padStart(6, '0')}`
}

/** The tokens.css §2 mix recipe: color-mix(in oklab, ancre P%, base) — the
 *  anchor's P % share over the base, mixed in OKLab. Throws on an invalid hex
 *  (a drift guard). */
function melangerOklab(ancre: string, base: string, partAncre: number): string {
  const A = rgbVersOklab(hexVersRgb(ancre))
  const B = rgbVersOklab(hexVersRgb(base))
  return rgbVersHex(
    oklabVersRgb({
      L: A.L * partAncre + B.L * (1 - partAncre),
      a: A.a * partAncre + B.a * (1 - partAncre),
      b: A.b * partAncre + B.b * (1 - partAncre),
    }),
  )
}

/** The theme ramp's four roles (tokens.css §2, computed for the map — the
 *  exact recipes the CSS tokens declare: the fiche and the map now read the
 *  same ramp). `line` is the anchor itself. */
export interface RolesRampesTheme {
  wash: string
  soft: string
  line: string
  strong: string
}

export function rolesRampesTheme(ancrage: string): RolesRampesTheme {
  return {
    wash: melangerOklab(ancrage, SURFACE_SECONDAIRE, 0.08), // 8 % sur surface-secondary
    soft: melangerOklab(ancrage, SURFACE_PRIMAIRE, 0.16), // 16 % sur surface-primary
    line: ancrage,
    strong: melangerOklab(ancrage, FONCE, 0.62), // 62 % sur #0C1B19
  }
}

/**
 * The choropleth ramp for a theme anchor: `nombreEtapes` steps sampled along
 * the theme's role path wash → soft → line → strong (in OKLab, the tokens.css
 * space), lightest to darkest. The map's extremes are literally the theme's
 * wash and strong — the same two poles the fiche reads. Throws on an invalid
 * hex or fewer than 2 steps (a drift guard).
 */
export function echelleChoroplethe(ancrage: string, nombreEtapes: number): string[] {
  if (nombreEtapes < 2) throw new RangeError('La rampe demande au moins 2 étapes')
  return rampePole(ancrage, nombreEtapes)
}

/**
 * One pole of the diverging ramp: `nombreEtapes` steps of the anchor's role
 * path wash → soft → line → strong, lightest to darkest — the same sampling
 * as `echelleChoroplethe`, generalised to any step count so a 3-bucket side
 * still spans wash → strong (its pole keeps its darkest class).
 */
function rampePole(ancrage: string, nombreEtapes: number): string[] {
  if (nombreEtapes <= 1) {
    rolesRampesTheme(ancrage) // le garde-fou de dérive : l'ancre est validée même pour une étape unique
    return [ancrage]
  }
  const { wash, soft, line, strong } = rolesRampesTheme(ancrage)
  const chemin: string[] = [wash, soft, line, strong]
  const etapes: string[] = []
  for (let i = 0; i < nombreEtapes; i++) {
    const position = (i / (nombreEtapes - 1)) * (chemin.length - 1)
    const segment = Math.min(Math.floor(position), chemin.length - 2)
    const fraction = position - segment
    etapes.push(melangerOklab(chemin[segment], chemin[segment + 1], 1 - fraction))
  }
  return etapes
}

/**
 * The diverging ramp (ADR-0019): one colour per class over the diverging
 * breaks — the shared coral counter-hue at the negative pole (darkest first,
 * the most negative class), the light neutral at zero, the theme anchor at
 * the positive pole (lightest first, the most positive class). `seuils` must
 * straddle zero (both sides present) — otherwise the ramp has no two poles.
 * Throws on an invalid hex or unbalanced breaks (a drift guard).
 */
export function rampeDivergente(ancrage: string, seuils: readonly number[]): string[] {
  const nbNegatifs = seuils.filter((s) => s < 0).length
  const nbPositifs = seuils.filter((s) => s > 0).length
  if (nbNegatifs === 0 || nbPositifs === 0) {
    throw new RangeError('Une rampe divergente demande des seuils de part et d’autre de zéro')
  }
  const poleNegatif = rampePole(COULEUR_CORAL, nbNegatifs).reverse() // foncé → clair
  const polePositif = rampePole(ancrage, nbPositifs) // clair → foncé
  return [...poleNegatif, COULEUR_NEUTRE_ZERO, ...polePositif]
}

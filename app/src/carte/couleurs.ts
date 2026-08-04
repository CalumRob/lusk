/**
 * The map's color system — DESIGN.md §2: one anchor hex per theme, the ramp
 * derives from it (the same one-hex-change-follows rule as the CSS tokens).
 * MapLibre paints cannot read CSS custom properties, so the choropleth ramp
 * is computed here from the anchors — the app-side mirror of tokens.css.
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
  economie: '#7FA875', // green
}

/** The neutral fill: territory masks in Aperçu + no-data territories. */
export const COULEUR_NEUTRE = '#E4ECEA'

/** The outline of the territory masks (reads on both basemap and fills). */
export const COULEUR_CONTOUR = '#FFFFFF'

const BLANC = { r: 255, g: 255, b: 255 }
const FONCE = { r: 12, g: 27, b: 25 } // #0C1B19 — the ramps' dark pole (DESIGN.md §2)

function hexVersRgb(hex: string): { r: number; g: number; b: number } {
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

function melanger(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number): string {
  const c = (x: number, y: number) => Math.round(x + (y - x) * t)
  const valeur = (c(a.r, b.r) << 16) | (c(a.g, b.g) << 8) | c(a.b, b.b)
  return `#${valeur.toString(16).padStart(6, '0')}`
}

/**
 * The choropleth ramp for a theme anchor: `nombreEtapes` steps from a light
 * mix (anchor + white) to a dark mix (anchor + #0C1B19) — perceptually even,
 * single hue, per DESIGN.md §2. Throws on an invalid hex (a drift guard).
 */
export function echelleChoroplethe(ancrage: string, nombreEtapes: number): string[] {
  if (nombreEtapes < 2) throw new RangeError('La rampe demande au moins 2 étapes')
  const ancre = hexVersRgb(ancrage)
  const claire = melanger(ancre, BLANC, 0.88)
  const foncee = melanger(ancre, FONCE, 0.45)
  const etapes: string[] = []
  for (let i = 0; i < nombreEtapes; i++) {
    const t = i / (nombreEtapes - 1)
    etapes.push(melanger(hexVersRgb(claire), hexVersRgb(foncee), t))
  }
  return etapes
}

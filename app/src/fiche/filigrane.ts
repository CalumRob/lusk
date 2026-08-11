import type { InjectionKey } from 'vue'

import type { Theme } from '@/payload/types'

/**
 * Le filigrane de la fiche — the pure draw behind the fiche watermark
 * (DESIGN.md §7). Size and position re-draw on each mount (tab switch),
 * constrained to the tab area between the subheader and the footer; the
 * accent color maps the active theme. The width thresholds mirror the
 * --filigrane-largeur-* tokens.
 */

/** Injection key for the draw's RNG — tests provide a deterministic one. */
export const FILIGRANE_ALEA_KEY: InjectionKey<() => number> = Symbol('filigrane-alea')

/** The ermine's aspect — viewBox "15 95.7 86.4 47" (locked lockup). */
export const RAPPORT_ERMINE = 47 / 86.4

/** The width thresholds — mirrors the --filigrane-largeur-* tokens. */
export const FILIGRANE_LARGEUR = {
  minVw: 0.04,
  minPx: 280,
  maxVw: 0.64,
  maxPx: 680,
} as const

export interface BornesLargeur {
  min: number
  max: number
}

export interface ZoneFiligrane {
  largeur: number
  hauteur: number
}

export interface TirageFiligrane {
  x: number
  y: number
  largeur: number
  hauteur: number
}

/** The width range in px for the current viewport (vw-capped at the tokens). */
export function bornesLargeurFiligrane(largeurVueport: number): BornesLargeur {
  return {
    min: Math.min(largeurVueport * FILIGRANE_LARGEUR.minVw, FILIGRANE_LARGEUR.minPx),
    max: Math.min(largeurVueport * FILIGRANE_LARGEUR.maxVw, FILIGRANE_LARGEUR.maxPx),
  }
}

/** One random draw — the mark always fits inside the content area. */
export function tirerFiligrane(
  zone: ZoneFiligrane,
  alea: () => number,
  bornes: BornesLargeur,
): TirageFiligrane {
  const largeur = bornes.min + alea() * (bornes.max - bornes.min)
  const hauteur = largeur * RAPPORT_ERMINE
  const x = alea() * Math.max(0, zone.largeur - largeur)
  const y = alea() * Math.max(0, zone.hauteur - hauteur)
  return { x, y, largeur, hauteur }
}

/** The accent fills' color — Aperçu falls back to the brand anchor. */
export function couleurFiligrane(theme: Theme | null): string {
  return theme ? `var(--theme-${theme}-line)` : 'var(--brand-500)'
}

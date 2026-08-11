import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FILIGRANE_LARGEUR,
  RAPPORT_ERMINE,
  bornesLargeurFiligrane,
  couleurFiligrane,
  tirerFiligrane,
} from '../fiche/filigrane'

/**
 * Le filigrane de la fiche — the pure draw: the random draw of size and
 * position within the fiche content area, the width thresholds (mirroring
 * the --filigrane-largeur-* tokens), and the per-theme accent mapping.
 */

/** A deterministic fake RNG — cycles through the given values. */
function aleaAvec(valeurs: number[]): () => number {
  let i = 0
  return () => valeurs[i++ % valeurs.length]
}

describe('bornesLargeurFiligrane — the width thresholds (vw-capped)', () => {
  it('caps at the fixed px thresholds on a wide viewport', () => {
    expect(bornesLargeurFiligrane(2000)).toEqual({ min: 80, max: 680 })
  })

  it('scales with the viewport below the caps', () => {
    // 1024 px viewport: 4vw = 40.96 (< 280), 64vw = 655.36 (< 680)
    expect(bornesLargeurFiligrane(1024)).toEqual({ min: 40.96, max: 655.36 })
  })

  it('mirrors the --filigrane-largeur-* tokens in tokens.css (no drift)', () => {
    const css = readFileSync(
      join(process.cwd(), 'src', 'styles', 'tokens.css'),
      'utf-8',
    )
    expect(css).toContain(
      `--filigrane-largeur-min: min(${FILIGRANE_LARGEUR.minVw * 100}vw, ${FILIGRANE_LARGEUR.minPx}px)`,
    )
    expect(css).toContain(
      `--filigrane-largeur-max: min(${FILIGRANE_LARGEUR.maxVw * 100}vw, ${FILIGRANE_LARGEUR.maxPx}px)`,
    )
  })
})

describe('tirerFiligrane — the draw stays inside the content area', () => {
  const zone = { largeur: 1000, hauteur: 800 }
  const bornes = { min: 240, max: 460 }

  it('draws the min size at the top-left when the RNG returns 0', () => {
    const tirage = tirerFiligrane(zone, aleaAvec([0, 0, 0]), bornes)
    expect(tirage.largeur).toBe(240)
    expect(tirage.x).toBe(0)
    expect(tirage.y).toBe(0)
  })

  it('draws the max size at the bottom-right when the RNG returns 1', () => {
    const tirage = tirerFiligrane(zone, aleaAvec([1, 1, 1]), bornes)
    expect(tirage.largeur).toBe(460)
    expect(tirage.x).toBe(1000 - 460)
    expect(tirage.y).toBe(800 - 460 * RAPPORT_ERMINE)
  })

  it('keeps size, x and y inside their bounds for any draw', () => {
    for (let i = 0; i < 50; i += 1) {
      const alea = Math.random
      const tirage = tirerFiligrane(zone, alea, bornes)
      expect(tirage.largeur).toBeGreaterThanOrEqual(bornes.min)
      expect(tirage.largeur).toBeLessThanOrEqual(bornes.max)
      expect(tirage.x).toBeGreaterThanOrEqual(0)
      expect(tirage.x).toBeLessThanOrEqual(zone.largeur - tirage.largeur)
      expect(tirage.y).toBeGreaterThanOrEqual(0)
      expect(tirage.y).toBeLessThanOrEqual(zone.hauteur - tirage.hauteur)
    }
  })

  it('preserves the ermine aspect ratio (hauteur = largeur × RAPPORT_ERMINE)', () => {
    const tirage = tirerFiligrane(zone, aleaAvec([0.5, 0.5, 0.5]), bornes)
    expect(tirage.hauteur).toBeCloseTo(tirage.largeur * RAPPORT_ERMINE, 6)
  })

  it('clamps to zero travel when the mark is wider than the area', () => {
    const etroit = { largeur: 100, hauteur: 100 }
    const tirage = tirerFiligrane(etroit, aleaAvec([0.5, 0.9, 0.9]), bornes)
    expect(tirage.x).toBe(0)
    expect(tirage.y).toBe(0)
  })
})

describe('couleurFiligrane — the accent maps to the active theme', () => {
  it('maps Aperçu (null) to the brand anchor — the canonical lockup colors', () => {
    expect(couleurFiligrane(null)).toBe('var(--brand-500)')
  })

  it('maps each theme to its anchor line token', () => {
    expect(couleurFiligrane('mobilite')).toBe('var(--theme-mobilite-line)')
    expect(couleurFiligrane('demographie')).toBe('var(--theme-demographie-line)')
    expect(couleurFiligrane('habitat')).toBe('var(--theme-habitat-line)')
    expect(couleurFiligrane('economie')).toBe('var(--theme-economie-line)')
  })
})

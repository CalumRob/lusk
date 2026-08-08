import { describe, expect, it } from 'vitest'

import { SEUILS_INDICATEURS, seuilsIndicateur, seuilsQuantiles } from '../carte/seuils'

/** The choropleth's class breaks: per-indicator FIXED scales (audit #208 item
 *  58) with the quantile fallback for an indicator without a locked scale. */

describe('SEUILS_INDICATEURS — the per-indicator fixed scales (audit #208 item 58)', () => {
  it('locks a sensible density ladder (hab/km²) — the INSEE density categories', () => {
    expect(SEUILS_INDICATEURS.densite).toEqual([30, 60, 100, 300])
  })

  it('locks the passoires scale as fractions — the DPE passoire line at 17 %', () => {
    expect(SEUILS_INDICATEURS.part_passoires).toEqual([0.1, 0.17, 0.25, 0.35])
  })
})

describe('seuilsIndicateur — the per-indicator breaks', () => {
  it('returns the fixed scale for an indicator with a locked scale', () => {
    expect(seuilsIndicateur('densite', [1, 2, 3], 5)).toEqual([30, 60, 100, 300])
    expect(seuilsIndicateur('part_passoires', [1, 2, 3], 5)).toEqual([0.1, 0.17, 0.25, 0.35])
  })

  it('falls back to quantiles for an indicator without a locked scale', () => {
    const valeurs = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(seuilsIndicateur('sans-echelle', valeurs, 5)).toEqual(seuilsQuantiles(valeurs, 5))
  })
})

describe('seuilsQuantiles — the class breaks', () => {
  it('returns empty breaks for no finite values', () => {
    expect(seuilsQuantiles([], 5)).toEqual([])
    expect(seuilsQuantiles([Number.NaN, Number.POSITIVE_INFINITY], 5)).toEqual([])
  })

  it('excludes NA values (they never take a bucket)', () => {
    const seuils = seuilsQuantiles([1, 2, 3, 4, 5, 6, Number.NaN, 7, 8, 9, 10], 5)
    expect(seuils).toHaveLength(4)
  })

  it('returns 4 upper bounds for 5 classes', () => {
    const valeurs = Array.from({ length: 100 }, (_, i) => i + 1)
    const seuils = seuilsQuantiles(valeurs, 5)
    expect(seuils).toHaveLength(4)
    expect(seuils[0]).toBeGreaterThan(10)
    expect(seuils[0]).toBeLessThan(30)
    expect(seuils[3]).toBeGreaterThan(70)
    expect(seuils[3]).toBeLessThan(90)
  })

  it('splits 1..100 near 20/40/60/80 (the R-7 quantile interpolation)', () => {
    const valeurs = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(seuilsQuantiles(valeurs, 5).map((s) => Math.round(s))).toEqual([21, 41, 60, 80])
  })

  it('gives each distinct value its own class when there are fewer than classes', () => {
    expect(seuilsQuantiles([50, 150, 200], 5)).toEqual([150, 200])
  })

  it('handles repeated values (a rank tie) without inventing a break', () => {
    const seuils = seuilsQuantiles([100, 100, 150, 200, 200, 200, 300], 5)
    expect(seuils[0]).toBeGreaterThan(100)
    expect(seuils[0]).toBeLessThan(300)
  })

  it('returns sorted, strictly increasing breaks', () => {
    const valeurs = Array.from({ length: 50 }, () => Math.random() * 100)
    const seuils = seuilsQuantiles(valeurs, 6)
    for (let i = 1; i < seuils.length; i++) {
      expect(seuils[i]).toBeGreaterThan(seuils[i - 1])
    }
  })
})

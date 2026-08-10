import { describe, expect, it } from 'vitest'

import { echelleValeurs, seuilsLogarithmiques, seuilsQuantiles } from '../carte/seuils'

/**
 * The choropleth's class breaks (ADR-0019 — the rule of three, computed from
 * the VALUES, never a per-indicator spec): signed → diverging (per-side
 * tail-test buckets, the neutral at zero), heavy tail (p99/median > 10) →
 * log-spaced sequential, tame → linear/quantile sequential. SEUILS_INDICATEURS
 * (the fixed ladders) is deleted: the break values are the data's own.
 */

/** The Rennes density case (ADR-0019): a heavy-tailed distribution over
 *  ~1 200 communes — max 4 582, p99 ≈ 1 695, p90 ≈ 319. */
function densitesBretagne(): number[] {
  const valeurs: number[] = []
  // la masse des ~1 100 communes rurales : des densités faibles (1..60)
  for (let i = 0; i < 1080; i++) valeurs.push(1 + i * (59 / 1079))
  // les villes moyennes : 100..514
  for (let i = 0; i < 70; i++) valeurs.push(100 + i * 6)
  // les grandes villes : 500..2 372
  for (let i = 0; i < 40; i++) valeurs.push(500 + i * 48)
  // le haut de la queue : 2 500..3 500
  for (let i = 0; i < 5; i++) valeurs.push(2500 + i * 250)
  valeurs.push(4582) // Rennes
  return valeurs
}

describe('echelleValeurs — la règle des trois échelles (ADR-0019)', () => {
  it('détecte une distribution signée (min < 0 && max > 0) → divergente', () => {
    const echelle = echelleValeurs([-8, -3, -1, 0, 2, 5, 12])
    expect(echelle.type).toBe('divergente')
    // les seuils croisent zéro : la borne la plus « intérieure » de chaque côté
    const negatifs = echelle.seuils.filter((s) => s < 0)
    const positifs = echelle.seuils.filter((s) => s > 0)
    expect(negatifs.length).toBeGreaterThan(0)
    expect(positifs.length).toBeGreaterThan(0)
    expect(Math.max(...negatifs)).toBeLessThan(0)
    expect(Math.min(...positifs)).toBeGreaterThan(0)
  })

  it('détecte une queue lourde (p99/médiane > 10) → log', () => {
    const echelle = echelleValeurs([...densitesBretagne()])
    expect(echelle.type).toBe('log')
  })

  it('classe une distribution sage → linéaire (quantiles)', () => {
    const valeurs = Array.from({ length: 100 }, (_, i) => i + 1)
    const echelle = echelleValeurs(valeurs)
    expect(echelle.type).toBe('lineaire')
    expect(echelle.seuils).toEqual(seuilsQuantiles(valeurs, 5))
  })

  it('est pure sur les valeurs : aucune échelle par indicateur ne survit', () => {
    // densité 1..100 et part de passoires 0.1..0.35 : même règle, leurs propres valeurs
    expect(echelleValeurs(Array.from({ length: 100 }, (_, i) => i + 1)).type).toBe('lineaire')
    expect(echelleValeurs([0.05, 0.1, 0.17, 0.25, 0.35])).toEqual({
      type: 'lineaire',
      seuils: [0.1, 0.17, 0.25, 0.35],
    })
  })

  it('renvoie une échelle vide pour des valeurs sans fini (jamais une classe inventée)', () => {
    expect(echelleValeurs([])).toEqual({ type: 'lineaire', seuils: [] })
    expect(echelleValeurs([Number.NaN, Number.POSITIVE_INFINITY])).toEqual({ type: 'lineaire', seuils: [] })
  })

  it('gardé non-signé : un nuage positif reste séquentiel (5 classes, inchangé)', () => {
    const valeurs = Array.from({ length: 100 }, (_, i) => i + 1)
    const echelle = echelleValeurs(valeurs)
    expect(echelle.type).toBe('lineaire')
    expect(echelle.seuils).toHaveLength(4) // 5 classes, les mêmes quantiles qu'avant
    expect(echelle.seuils.map((s) => Math.round(s))).toEqual([21, 41, 60, 80])
  })
})

describe('echelleValeurs — signée → divergente, buckets par côté (ADR-0019)', () => {
  it('taille chaque côté par son propre test de queue : côté doux 3 buckets, côté lourd 4', () => {
    // négatif sage (−1..−20), positif à queue lourde (1, 2, 4, …, 4096)
    const negatifs = Array.from({ length: 20 }, (_, i) => -(i + 1))
    const positifs = Array.from({ length: 13 }, (_, i) => 2 ** i)
    const echelle = echelleValeurs([...negatifs, ...positifs])

    expect(echelle.type).toBe('divergente')
    expect(echelle.seuils.filter((s) => s < 0)).toHaveLength(3) // quantiles
    expect(echelle.seuils.filter((s) => s > 0)).toHaveLength(4) // log
  })

  it('espace le côté doux en quantiles — les bornes du 1..20', () => {
    const negatifs = Array.from({ length: 20 }, (_, i) => -(i + 1))
    const positifs = Array.from({ length: 13 }, (_, i) => 2 ** i)
    const echelle = echelleValeurs([...negatifs, ...positifs])

    expect(echelle.seuils[0]).toBeCloseTo(-15.25)
    expect(echelle.seuils[1]).toBeCloseTo(-10.5)
    expect(echelle.seuils[2]).toBeCloseTo(-5.75)
  })

  it('espace le côté lourd en log — des rapports de bornes constants', () => {
    const negatifs = Array.from({ length: 20 }, (_, i) => -(i + 1))
    const positifs = Array.from({ length: 13 }, (_, i) => 2 ** i)
    const echelle = echelleValeurs([...negatifs, ...positifs])

    const [p1, p2, p3, p4] = echelle.seuils.filter((s) => s > 0)
    expect(p1).toBeGreaterThan(0)
    // géométrique : p2/p1 ≈ p3/p2 ≈ p4/p3 (la même raison en log)
    expect(p2 / p1).toBeCloseTo(p3 / p2, 1)
    expect(p3 / p2).toBeCloseTo(p4 / p3, 1)
    expect(p1).toBeGreaterThan(0)
  })

  it('une distribution signée des deux côtés doux donne 3 buckets de chaque côté', () => {
    const echelle = echelleValeurs([-20, -15, -10, -5, -2, -1, 1, 2, 5, 10, 15, 20])
    expect(echelle.type).toBe('divergente')
    expect(echelle.seuils.filter((s) => s < 0)).toHaveLength(3)
    expect(echelle.seuils.filter((s) => s > 0)).toHaveLength(3)
  })

  it('rend des seuils strictement croissants qui enjambent zéro', () => {
    const echelle = echelleValeurs([-50, -30, -10, -5, -1, 0, 2, 10, 40, 100, 400, 1600])
    expect(echelle.type).toBe('divergente')
    for (let i = 1; i < echelle.seuils.length; i++) {
      expect(echelle.seuils[i]).toBeGreaterThan(echelle.seuils[i - 1])
    }
    expect(echelle.seuils.some((s) => s < 0)).toBe(true)
    expect(echelle.seuils.some((s) => s > 0)).toBe(true)
  })
})

describe('echelleValeurs — queue lourde → log (l’ancre Rennes, ADR-0019)', () => {
  it('ne partage plus le bucket du haut avec la gamme 176–538 : l’espacement log isole la queue', () => {
    const echelle = echelleValeurs(densitesBretagne())

    expect(echelle.type).toBe('log')
    expect(echelle.seuils).toHaveLength(7) // 8 classes
    const dernier = echelle.seuils[echelle.seuils.length - 1]
    // l’ancienne échelle fixe [30, 60, 100, 300] mettait Rennes (4 582) dans le
    // 300+ partagé avec les 176..538 — la borne haute doit maintenant ouvrir la
    // classe de queue AVANT Rennes et APRÈS la gamme 176..538.
    expect(dernier).toBeGreaterThan(538)
    expect(dernier).toBeLessThan(4582)
  })

  it('espace les bornes en progression géométrique (raison constante)', () => {
    const echelle = echelleValeurs(densitesBretagne())
    const rapport = (a: number, b: number) => b / a
    for (let i = 1; i < echelle.seuils.length - 1; i++) {
      expect(rapport(echelle.seuils[i - 1], echelle.seuils[i])).toBeCloseTo(
        rapport(echelle.seuils[i], echelle.seuils[i + 1]),
        1,
      )
    }
  })
})

describe('seuilsLogarithmiques — les buckets espacés en log (la queue lourde)', () => {
  it('renvoie des bornes vides sans valeurs strictement positives', () => {
    expect(seuilsLogarithmiques([], 8)).toEqual([])
    expect(seuilsLogarithmiques([Number.NaN, Number.POSITIVE_INFINITY], 8)).toEqual([])
    expect(seuilsLogarithmiques([0, 0, 0], 8)).toEqual([])
  })

  it('donne une classe par valeur distincte quand il y a moins de valeurs que de classes', () => {
    expect(seuilsLogarithmiques([2, 4, 8], 5)).toEqual([4, 8])
  })

  it('espace les bornes en géométrique — la raison est constante', () => {
    const puissances = Array.from({ length: 13 }, (_, i) => 2 ** i)
    const seuils = seuilsLogarithmiques(puissances, 8)
    expect(seuils).toHaveLength(7)
    const raison = seuils[1] / seuils[0]
    for (let i = 1; i < seuils.length; i++) {
      expect(seuils[i] / seuils[i - 1]).toBeCloseTo(raison, 6)
    }
  })

  it('produit des bornes strictement croissantes et positives', () => {
    const seuils = seuilsLogarithmiques(Array.from({ length: 200 }, (_, i) => i + 1), 8)
    for (let i = 0; i < seuils.length; i++) {
      expect(seuils[i]).toBeGreaterThan(0)
      if (i > 0) expect(seuils[i]).toBeGreaterThan(seuils[i - 1])
    }
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
